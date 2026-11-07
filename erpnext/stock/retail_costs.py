"""Shared, read-only historical sale costs with native source and field permissions.

Uses ERPNext's posted stock valuation, allocated in stock UOM like Gross Profit.
There is no Item Price / current buying-rate fallback. Unknown is never zero.
"""
from collections import defaultdict
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import flt, getdate, get_time, today


BATCH = 200
HEADER_FIELDS = ["name", "posting_date", "posting_time", "update_stock", "is_return", "is_debit_note", "return_against"]
ITEM_FIELDS = ["name", "parent", "item_code", "warehouse", "qty", "stock_qty", "base_net_amount", "dn_detail",
	"delivery_note", "sales_order", "so_detail", "cost_center", "project", "sales_invoice_item"]


def readable(doctype, filters, fields, parenttype=None):
	if not frappe.has_permission(parenttype or doctype, "read"):
		return []
	kwargs = {"parent_doctype": parenttype} if parenttype else {}
	return frappe.get_list(doctype, filters=filters, fields=fields, limit_page_length=0, **kwargs)


def children(doctype, parenttype, parents, fields):
	rows = []
	parents = sorted(set(parents))
	for offset in range(0, len(parents), BATCH):
		rows.extend(readable(doctype, {"parent": ["in", parents[offset:offset + BATCH]], "parenttype": parenttype}, fields, parenttype))
	return rows


def vouchers(doctype, company, names, fields):
	rows = []
	names = sorted(set(name for name in names if name))
	for offset in range(0, len(names), BATCH):
		rows.extend(readable(doctype, {"company": company, "docstatus": 1,
			"posting_date": ["<=", today()], "name": ["in", names[offset:offset + BATCH]]}, fields))
	return {row.name: row for row in rows if all(field in row for field in fields)}


def invoice_rows(company, start, end, codes=None, warehouses=None):
	"""Resolve permitted parent and child fields before any cost or sales aggregation."""
	headers = readable("Sales Invoice", {"company": company, "docstatus": 1,
		"is_opening": "No", "posting_date": ["between", [start, end]]}, HEADER_FIELDS + ["base_net_total", "total_qty"])
	by_name = {row.name: row for row in headers}
	rows = []
	for child in children("Sales Invoice Item", "Sales Invoice", by_name, ITEM_FIELDS):
		header = by_name[child.parent]
		if any(child.get(key) is None for key in ("name", "item_code", "stock_qty", "base_net_amount")) or any(
			header.get(key) is None for key in ("posting_date", "is_return", "update_stock", "is_debit_note")
		):
			frappe.throw(_("Required sales fields are not readable."), frappe.PermissionError)
		if codes is not None and child.item_code not in codes:
			continue
		if warehouses is not None and child.warehouse not in warehouses:
			continue
		row = frappe._dict(header)
		row.update(child)
		row.update(parenttype="Sales Invoice", item_row=child.name, document_qty=child.get("qty"), qty=child.stock_qty)
		rows.append(row)
	return rows, headers


class HistoricalCostLookup:
	"""Batch the evidence graph once, then value every row without database calls."""
	def __init__(self, rows, company):
		self.company = company
		self.reasons = {}
		self.headers = vouchers("Sales Invoice", company, [row.parent for row in rows], HEADER_FIELDS)
		originals = vouchers("Sales Invoice", company, [row.get("return_against") for row in self.headers.values()], HEADER_FIELDS)
		self.headers.update(originals)
		original_rows = children("Sales Invoice Item", "Sales Invoice", originals, ITEM_FIELDS)
		self.original_rows = defaultdict(list)
		for child in original_rows:
			row = frappe._dict(self.headers[child.parent])
			row.update(child)
			row.update(parenttype="Sales Invoice", item_row=child.name, qty=child.get("stock_qty"))
			self.original_rows[child.parent].append(row)
		all_rows = list(rows) + [row for values in self.original_rows.values() for row in values]
		self.deliveries = vouchers("Delivery Note", company, [row.get("delivery_note") for row in all_rows],
			["name", "posting_date", "posting_time", "is_return"])
		# Invoice-first delivery notes are discovered through their typed native child link.
		parents = sorted(self.headers)
		for offset in range(0, len(parents), BATCH):
			for doc in readable("Delivery Note", [["company", "=", company], ["docstatus", "=", 1],
				["posting_date", "<=", today()], ["Delivery Note Item", "against_sales_invoice", "in", parents[offset:offset + BATCH]]],
				["name", "posting_date", "posting_time", "is_return"]):
				self.deliveries[doc.name] = doc
		self.delivery_rows = children("Delivery Note Item", "Delivery Note", self.deliveries,
			["name", "parent", "item_code", "warehouse", "stock_qty", "against_sales_invoice", "si_detail"])
		self.delivery_by_name = {row.name: row for row in self.delivery_rows}
		self.delivery_by_invoice_row = defaultdict(list)
		for row in self.delivery_rows:
			if row.get("si_detail"):
				self.delivery_by_invoice_row[row.si_detail].append(row)
		self.packed = defaultdict(list)
		for kind, names in (("Sales Invoice", self.headers), ("Delivery Note", self.deliveries)):
			for row in children("Packed Item", kind, names,
				["name", "parent", "parent_item", "parent_detail_docname", "item_code", "warehouse", "qty"]):
				self.packed[(kind, row.parent, row.get("parent_detail_docname"))].append(row)
		codes = {row.item_code for row in all_rows} | {row.item_code for values in self.packed.values() for row in values}
		self.items = {}
		for offset in range(0, len(sorted(codes)), BATCH):
			self.items.update({row.name: row for row in readable("Item", {"name": ["in", sorted(codes)[offset:offset + BATCH]]},
				["name", "is_stock_item"])})
		self.warehouses = {row.name for row in readable("Warehouse", {"company": company, "is_group": 0}, ["name"])}
		self.stock = defaultdict(list)
		for kind, names in (("Sales Invoice", self.headers), ("Delivery Note", self.deliveries)):
			names = sorted(names)
			for offset in range(0, len(names), BATCH):
				for row in readable("Stock Ledger Entry", {"company": company, "is_cancelled": 0,
					"posting_date": ["<=", today()], "voucher_type": kind, "voucher_no": ["in", names[offset:offset + BATCH]]},
					["item_code", "warehouse", "voucher_no", "voucher_detail_no", "actual_qty", "stock_value_difference"]):
					self.stock[(kind, row.voucher_no, row.voucher_detail_no, row.item_code, row.warehouse)].append(row)
		# Native Gross Profit uses the latest dated PI cost for nonstock items. Keep
		# that policy, but require native PI scope, company, net/base and stock UOM.
		self.purchases = defaultdict(list)
		nonstock = [code for code, item in self.items.items() if item.get("is_stock_item") == 0]
		for offset in range(0, len(nonstock), BATCH):
			headers = readable("Purchase Invoice", [["company", "=", company], ["docstatus", "=", 1],
				["is_return", "=", 0], ["posting_date", "<=", max((row.posting_date for row in all_rows), default=today())],
				["Purchase Invoice Item", "item_code", "in", nonstock[offset:offset + BATCH]]], ["name", "posting_date", "posting_time"])
			purchase_headers = {row.name: row for row in headers if all(field in row for field in ("posting_date", "posting_time"))}
			for row in children("Purchase Invoice Item", "Purchase Invoice", purchase_headers,
				["name", "parent", "item_code", "stock_qty", "base_net_amount", "project", "cost_center"]):
				row.update(posting_date=purchase_headers[row.parent].get("posting_date"), posting_time=purchase_headers[row.parent].get("posting_time"))
				self.purchases[row.item_code].append(row)

	def unknown(self, row, reason):
		self.reasons[(row.parent, row.item_row)] = reason
		return None

	def stock_cost(self, kind, parent, detail, item, warehouse, qty):
		if warehouse not in self.warehouses or item not in self.items:
			return None
		rows = self.stock.get((kind, parent, detail, item, warehouse), [])
		if not rows or any(row.get(key) is None for row in rows for key in ("actual_qty", "stock_value_difference")):
			return None
		moved = sum(Decimal(str(row.actual_qty)) for row in rows)
		value = sum(Decimal(str(row.stock_value_difference)) for row in rows)
		if not moved or abs(Decimal(str(qty))) > abs(moved) + Decimal("0.000001"):
			return None
		return float(Decimal(str(qty)) * value / moved)

	def source_cost(self, kind, parent, detail, item, warehouse, qty, source_qty):
		packed = self.packed.get((kind, parent, detail))
		if packed:
			if not source_qty or any(row.get(field) is None for row in packed for field in ("name", "item_code", "warehouse", "qty")):
				return None
			# SellingController records packed component SLEs under the parent item row.
			values = [self.stock_cost(kind, parent, detail, row.item_code, row.warehouse,
				flt(row.get("qty")) * qty / source_qty) for row in packed]
			return sum(values) if None not in values else None
		return self.stock_cost(kind, parent, detail, item, warehouse, qty)

	def cost(self, row, seen=None):
		seen = set(seen or ())
		key = (row.parent, row.item_row)
		if key in seen:
			return self.unknown(row, "cyclic_return_link")
		seen.add(key)
		header = self.headers.get(row.parent)
		if not header or any(header.get(field) is None for field in ("posting_date", "update_stock", "is_debit_note", "is_return")):
			return self.unknown(row, "source_restricted")
		if header.is_debit_note:
			return 0.0
		qty = row.get("qty")
		if qty is None:
			return self.unknown(row, "quantity_missing")
		qty = flt(qty)
		if not qty:
			return 0.0
		item = self.items.get(row.item_code)
		if not item or item.get("is_stock_item") is None:
			return self.unknown(row, "item_restricted")
		if header.update_stock:
			value = self.source_cost("Sales Invoice", row.parent, row.item_row, row.item_code, row.warehouse, qty, qty)
			if value is not None:
				return value
		if row.get("dn_detail"):
			delivery = self.delivery_by_name.get(row.dn_detail)
			if delivery and delivery.parent == row.get("delivery_note") and delivery.item_code == row.item_code:
				value = self.source_cost("Delivery Note", delivery.parent, delivery.name, row.item_code,
					delivery.get("warehouse"), qty, delivery.get("stock_qty"))
				if value is not None:
					return value
		deliveries = [delivery for delivery in self.delivery_by_invoice_row.get(row.item_row, [])
			if delivery.get("against_sales_invoice") == row.parent and delivery.item_code == row.item_code]
		if deliveries:
			covered = sum(flt(delivery.get("stock_qty")) for delivery in deliveries)
			if covered and abs(covered) + 0.000001 >= abs(qty):
				values = [self.source_cost("Delivery Note", delivery.parent, delivery.name, row.item_code,
					delivery.get("warehouse"), flt(delivery.get("stock_qty")), delivery.get("stock_qty")) for delivery in deliveries]
				if None not in values:
					return sum(values) * qty / covered
		if header.is_return and header.get("return_against"):
			originals = [original for original in self.original_rows[header.return_against] if original.item_code == row.item_code
				and (not row.get("sales_invoice_item") or original.item_row == row.sales_invoice_item)]
			if len(originals) == 1 and originals[0].get("qty"):
				value = self.cost(originals[0], seen)
				if value is not None:
					return value * qty / originals[0].qty
		if item.is_stock_item == 0:
			if any(field not in row for field in ("project", "cost_center")):
				return self.unknown(row, "purchase_matching_fields_restricted")
			purchases = [purchase for purchase in self.purchases[row.item_code] if purchase.get("posting_date")
				and (getdate(purchase.posting_date), get_time(purchase.get("posting_time") or "00:00:00")) <=
				(getdate(header.posting_date), get_time(header.get("posting_time") or "23:59:59"))
				and all(not row.get(field) or purchase.get(field) == row.get(field) for field in ("project", "cost_center"))]
			if purchases:
				purchase = max(purchases, key=lambda value: (getdate(value.posting_date), str(value.get("posting_time") or ""), value.parent, value.name))
				if flt(purchase.get("stock_qty")) > 0 and purchase.get("base_net_amount") is not None:
					return qty * purchase.base_net_amount / purchase.stock_qty
		return self.unknown(row, "valuation_missing_or_restricted")


def invoice_costs(company, start, end, expected_sales=None):
	rows, headers = invoice_rows(company, start, end)
	if not frappe.has_permission("Sales Invoice", "read"):
		return dict(cogs=None, gross_profit=None, revenue=None, row_count=None, unknown_rows=None,
			reasons=["sales_restricted"], as_of=today())
	lookup = HistoricalCostLookup(rows, company)
	costs = [lookup.cost(row) for row in rows]
	revenue = sum((Decimal(str(row.base_net_amount)) for row in rows), Decimal(0))
	missing = sum(value is None for value in costs)
	reasons = set(lookup.reasons.values())
	quantities = defaultdict(lambda: Decimal(0))
	for row in rows:
		if row.get("document_qty") is None:
			reasons.add("invoice_lines_not_reconciled")
		else:
			quantities[row.parent] += Decimal(str(row.document_qty))
	if any(header.get("total_qty") is None or abs(quantities[header.name] - Decimal(str(header.total_qty))) > Decimal("0.000001") for header in headers):
		reasons.add("invoice_lines_not_reconciled")
	if expected_sales is None or abs(revenue - Decimal(str(expected_sales))) > Decimal("0.01"):
		reasons.add("invoice_lines_not_reconciled")
	complete = not missing and not reasons
	total = sum((Decimal(str(value)) for value in costs if value is not None), Decimal(0))
	return dict(cogs=float(total) if complete else None, gross_profit=float(revenue - total) if complete else None,
		revenue=float(revenue), known_cogs=float(total), row_count=len(rows), unknown_rows=missing,
		reasons=sorted(reasons), as_of=today(), basis="invoice_date_with_posted_fulfilment_cost_as_of_today")
