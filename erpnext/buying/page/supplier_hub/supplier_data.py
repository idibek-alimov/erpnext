"""Scoped supplier activity, native payables, and deduplicated linked inventory."""

from collections import Counter, defaultdict
from copy import copy

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from erpnext.accounts.report.accounts_receivable.accounts_receivable import ReceivablePayableReport
from erpnext.stock.page.product_catalog.catalog_data import period_dates
from erpnext.buying.page.supplier_hub.supplier_revision import current_revision


def readable(doctype, filters, fields):
	if not frappe.has_permission(doctype, "read"):
		return []
	return frappe.get_list(doctype, filters=filters, fields=fields, limit_page_length=0)


QUERY_BATCH_SIZE = 200


def batched_rows(doctype, filters, fields, key, values, *, permitted=False, **kwargs):
	"""Bound generated IN clauses while retaining native document/row permissions."""
	if permitted and not frappe.has_permission(doctype, "read"):
		return []
	query = frappe.get_list if permitted else frappe.get_all
	values = sorted(set(values))
	rows = []
	for offset in range(0, len(values), QUERY_BATCH_SIZE):
		rows.extend(query(doctype, filters={**filters, key: ["in", values[offset:offset + QUERY_BATCH_SIZE]]},
			fields=fields, limit_page_length=0, **kwargs))
	return rows


def linked_inventory(names, invoices, filters, company, scope, detailed=False):
	"""Discover supplier links first; fetch only permitted linked items and their models."""
	direct = defaultdict(set)
	for doctype, parents in (("Purchase Invoice", invoices), ("Purchase Receipt",
		batched_rows("Purchase Receipt", filters, ["name", "supplier"], "supplier", names, permitted=True))):
		parent_map = {p.name: p.supplier for p in parents}
		for child in batched_rows(doctype + " Item", {"parenttype": doctype}, ["parent", "item_code"], "parent", parent_map):
			if child.item_code:
				direct[parent_map[child.parent]].add(child.item_code)
	# These candidates do not reach the response until Item row permissions are applied below.
	for default in batched_rows("Item Default", {"company": company}, ["parent", "default_supplier"],
		"default_supplier", names):
		direct[default.default_supplier].add(default.parent)
	fields = ["name", "variant_of", "has_variants", "stock_uom"] + (
		["item_name", "item_group", "image", "custom_short_code", "disabled"] if detailed else [])
	candidates = set().union(*direct.values()) if direct else set()
	items = {i.name: i for i in batched_rows("Item", {}, fields, "name", candidates, permitted=True)}
	templates = [i.name for i in items.values() if i.has_variants]
	items.update({i.name: i for i in batched_rows("Item", {}, fields, "variant_of", templates, permitted=True)})
	if detailed:
		parents = {i.variant_of for i in items.values() if i.variant_of} - set(items)
		items.update({i.name: i for i in batched_rows("Item", {}, fields, "name", parents, permitted=True)})
	links = expand_links(direct, items)
	codes = set().union(*links.values()) if links else set()
	stock = {}
	# Both dimensions stay bounded, even on sites with many warehouses.
	for offset in range(0, len(scope), QUERY_BATCH_SIZE):
		for row in batched_rows("Bin", {"warehouse": ["in", scope[offset:offset + QUERY_BATCH_SIZE]]},
			["item_code", "sum(actual_qty) as qty", "sum(stock_value) as value"], "item_code", codes,
			permitted=True, group_by="item_code"):
			balance = stock.setdefault(row.item_code, dict(qty=0, value=0))
			balance["qty"] += flt(row.qty)
			balance["value"] += flt(row.value)
	return items, links, stock


class SupplierPayables(ReceivablePayableReport):
	"""Use native allocation/FX rules, with batched schedules and permitted vouchers."""

	def __init__(self, company, suppliers, invoices, journals, payments, schedules):
		super().__init__(dict(company=company, party_type="Supplier", party=list(suppliers),
			based_on_payment_terms=1, report_date=period_dates("today")[1]))
		self.allowed_invoices = invoices
		self.allowed_journals = journals
		self.allowed_payments = payments
		self.schedules = schedules
		self.suppliers = suppliers

	def get_invoice_details(self):
		self.invoice_details = {**self.allowed_invoices, **self.allowed_journals}

	def get_party_details(self, party):
		return self.suppliers.get(party, {})

	def build_data(self):
		# Ledger permission alone must not disclose a restricted source invoice/journal.
		allowed = {"Purchase Invoice": self.allowed_invoices, "Journal Entry": self.allowed_journals,
			"Payment Entry": self.allowed_payments}
		self.voucher_balance = {key: row for key, row in self.voucher_balance.items()
			if row.voucher_no in allowed.get(row.voucher_type, {})}
		super().build_data()

	def get_payment_terms(self, row):
		terms = self.schedules.get(row.voucher_no, []) if row.voucher_type == "Purchase Invoice" else []
		original = frappe._dict(row)
		row.payment_terms = []
		if not terms:
			return
		invoice = self.allowed_invoices[row.voucher_no]
		if invoice.is_return:
			return
		row.paid -= flt(invoice.total_advance)
		for term in terms:
			self.append_payment_term(row, frappe._dict({**invoice, **term}), copy(original), self.company_currency)


def financial_rows(suppliers, invoices, payments, payables, start, end, can_payables, can_purchases, can_payments):
	"""Current balances and period activity have deliberately independent date scopes."""
	rows = {s.name: dict(name=s.name, supplier_name=s.supplier_name or s.name,
		supplier_group=s.supplier_group or "", mobile_no=s.mobile_no or "", email_id=s.email_id or "",
		disabled=cint(s.disabled), current_debt=0 if can_payables else None,
		overdue=0 if can_payables else None, credits=0 if can_payables else None,
		purchases=0 if can_purchases else None, total_purchased=0 if can_purchases else None,
		net_payments=0 if can_payments else None, invoice_count=0,
		last_purchase_date=None, last_purchase_invoice=None) for s in suppliers}
	for entry in payables:
		if entry.get("party") not in rows:
			continue
		row = rows[entry["party"]]
		amount = flt(entry.get("outstanding"))
		row["current_debt"] += max(amount, 0)
		row["credits"] += max(-amount, 0)
		if amount > 0 and entry.get("due_date") and getdate(entry["due_date"]) < end:
			row["overdue"] += amount
	for invoice in invoices:
		row = rows.get(invoice.supplier)
		if row is None or invoice.is_opening == "Yes":
			continue
		amount = flt(invoice.base_grand_total)
		row["total_purchased"] += amount
		if start <= getdate(invoice.posting_date) <= end:
			row["purchases"] += amount
			row["invoice_count"] += 1
		if not invoice.is_return and amount > 0:
			key = (str(invoice.posting_date), str(invoice.creation), invoice.name)
			if key > row.get("_last_key", ("", "", "")):
				row.update(_last_key=key, last_purchase_date=str(invoice.posting_date), last_purchase_invoice=invoice.name)
	for payment in payments:
		if payment.party in rows and start <= getdate(payment.posting_date) <= end:
			amount = flt(payment.base_paid_amount) if payment.payment_type == "Pay" else -flt(payment.base_received_amount)
			rows[payment.party]["net_payments"] += amount
	for row in rows.values():
		row.pop("_last_key", None)
	return list(rows.values())


def expand_links(direct, items):
	"""A template links its variants. One variant does not link unrelated siblings."""
	children = defaultdict(set)
	for item in items.values():
		if item.variant_of:
			children[item.variant_of].add(item.name)
	return {supplier: {code for item in codes if item in items
		for code in ([item] if not items[item].has_variants else children[item])}
		for supplier, codes in direct.items()}


def inventory_rows(rows, links, items, stock, can_stock):
	counts = Counter(code for codes in links.values() for code in codes)
	for row in rows:
		codes = links.get(row["name"], set())
		row["_stock_codes"] = codes
		row["stock_value"] = sum(flt(stock.get(code, {}).get("value")) for code in codes) if can_stock else None
		row["stock_qty"] = sum(flt(stock.get(code, {}).get("qty")) for code in codes) if can_stock else None
		row["in_stock"] = any(flt(stock.get(code, {}).get("qty")) > 0 for code in codes) if can_stock else None
		units = {items[code].stock_uom for code in codes}
		row["stock_uom"] = next(iter(units)) if len(units) == 1 else None
		row["models_count"] = len({items[code].variant_of or code for code in codes}) if can_stock else None
		row["skus_count"] = len(codes) if can_stock else None
		row["shared_products"] = sum(counts[code] > 1 for code in codes)
	return rows


def filter_and_summarize(rows, stock, search="", supplier_group=None, debt_filter=None,
	stock_filter="all", stock_qty=0, sort_by="debt_desc", page=1, page_size=20):
	term = (search or "").strip().casefold()
	matched = []
	for row in rows:
		if term and not any(term in str(row.get(k) or "").casefold()
			for k in ("name", "supplier_name", "mobile_no", "email_id")):
			continue
		if supplier_group not in (None, "", "All", "all") and row["supplier_group"] != supplier_group:
			continue
		debt, overdue, qty = row["current_debt"], row["overdue"], row["stock_qty"]
		if debt_filter == "with_debt" and (debt is None or debt <= 0):
			continue
		if debt_filter == "overdue" and (overdue is None or overdue <= 0):
			continue
		if debt_filter == "settled" and (debt is None or debt > 0):
			continue
		if debt_filter == "in_stock" and not row["in_stock"]:
			continue
		if stock_filter != "all" and (qty is None or
			(stock_filter in ("gte", "lte") and not row["stock_uom"]) or
			(stock_filter == "gte" and qty < flt(stock_qty)) or
			(stock_filter == "lte" and qty > flt(stock_qty)) or
			(stock_filter == "zero" and row["in_stock"])):
			continue
		matched.append(row)
	keys = {"debt_desc": "current_debt", "overdue_desc": "overdue", "stock_val_desc": "stock_value",
		"purchased_desc": "purchases", "last_purchase_desc": "last_purchase_date"}
	if sort_by == "name_asc":
		matched.sort(key=lambda r: (r["supplier_name"].casefold(), r["name"]))
	else:
		key = keys.get(sort_by, "current_debt")
		matched.sort(key=lambda r: (r.get(key) or ("" if key == "last_purchase_date" else 0), r["name"]), reverse=True)
	def total(key):
		return sum(r[key] for r in matched) if all(r[key] is not None for r in rows) else None
	codes = set().union(*(r["_stock_codes"] for r in matched)) if matched else set()
	summary = dict(total_debt=total("current_debt"), overdue=total("overdue"), purchases=total("purchases"),
		credits=total("credits"), total_stock_value=sum(flt(stock.get(c, {}).get("value")) for c in codes)
		if all(r["stock_value"] is not None for r in rows) else None,
		suppliers_count=len(matched), suppliers_with_debt_count=sum((r["current_debt"] or 0) > 0 for r in matched),
		shared_products=sum(n > 1 for n in Counter(c for r in matched for c in r["_stock_codes"]).values()))
	summary["has_shared_products"] = any(r["shared_products"] for r in matched)
	page_size = min(100, max(1, cint(page_size) or 20))
	page = min(max(1, cint(page)), max(1, (len(matched) + page_size - 1) // page_size))
	visible = [{k: v for k, v in r.items() if k != "_stock_codes"} for r in matched[(page - 1) * page_size:page * page_size]]
	result = dict(suppliers=visible, summary=summary, total=len(matched), page=page, page_size=page_size)
	# Small supplier lists can page through an already-authorized browser snapshot.
	# Bound the payload; large lists continue using normal server pagination.
	if len(matched) <= 500:
		result["matching_rows"] = [{k: v for k, v in row.items() if k != "_stock_codes"} for row in matched]
	return result


def load_supplier_context(company=None, period="month", warehouse=None, supplier=None,
	*, include_stock=True, include_payables=True):
	"""One permission-aware source for both the hub and supplier detail."""
	from erpnext.stock.page.product_catalog.product_catalog import get_default_company

	frappe.has_permission("Supplier", "read", throw=True)
	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	start, end = period_dates(period)
	if supplier:
		frappe.get_doc("Supplier", supplier).check_permission("read")
	suppliers = frappe.get_list("Supplier", filters={"name": supplier} if supplier else {}, fields=["name", "supplier_name", "supplier_group", "mobile_no", "email_id", "disabled"], limit_page_length=0)
	names = [s.name for s in suppliers]
	can_purchases = frappe.has_permission("Purchase Invoice", "read")
	can_payments = frappe.has_permission("Payment Entry", "read")
	can_payables = can_purchases and frappe.get_cached_doc("Report", "Accounts Payable").is_permitted()
	can_stock = frappe.has_permission("Item", "read") and frappe.has_permission("Warehouse", "read") and frappe.has_permission("Bin", "read")
	filters = dict(company=company, docstatus=1, posting_date=["<=", end])
	invoices = batched_rows("Purchase Invoice", filters,
		["name", "supplier", "posting_date", "creation", "due_date", "payment_deadline_not_agreed", "bill_no", "bill_date", "base_grand_total", "is_return", "is_opening", "party_account_currency", "currency", "conversion_rate", "total_advance"] +
		(["grand_total", "outstanding_amount", "status", "return_against"] if supplier else []), "supplier", names, permitted=True)
	payments = batched_rows("Payment Entry", {**filters, "party_type": "Supplier",
		"payment_type": ["in", ["Pay", "Receive"]]},
		["name", "party", "posting_date", "payment_type", "base_paid_amount", "base_received_amount"] +
		(["creation", "mode_of_payment", "paid_from", "paid_to", "reference_no", "remarks", "owner", "paid_amount", "received_amount", "paid_from_account_currency", "paid_to_account_currency"] if supplier else []), "party", names, permitted=True)
	payables = []
	if include_payables and can_payables and names:
		journals = readable("Journal Entry", filters, ["name", "due_date", "bill_no", "bill_date"])
		schedules = defaultdict(list)
		if invoices:
			for term in batched_rows("Payment Schedule", {"parenttype": "Purchase Invoice"},
				["parent", "due_date", "payment_term", "payment_amount", "base_payment_amount", "description", "paid_amount", "base_paid_amount", "discounted_amount"],
				"parent", [i.name for i in invoices], order_by="paid_amount desc, due_date asc"):
				schedules[term.parent].append(term)
		payables = SupplierPayables(company, {s.name: s for s in suppliers}, {i.name: i for i in invoices},
			{j.name: j for j in journals}, {p.name: p for p in payments}, schedules).run(dict(account_type="Payable", naming_by=["Buying Settings", "supp_master_name"]))[1]
	rows = financial_rows(suppliers, invoices, payments, payables, start, end, can_payables, can_purchases, can_payments)
	warehouses = readable("Warehouse", {"company": company, "is_group": 0}, ["name"])
	warehouse_names = [w.name for w in warehouses]
	if warehouse and warehouse not in warehouse_names:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	scope = [warehouse] if warehouse else warehouse_names
	items, links, stock = {}, {}, {}
	if include_stock and can_stock and names:
		items, links, stock = linked_inventory(names, invoices, filters, company, scope, detailed=bool(supplier))
	rows = inventory_rows(rows, links, items, stock, can_stock and include_stock)
	return dict(company=company, start=start, end=end, suppliers=suppliers, rows=rows,
		invoices=invoices, payments=payments, payables=payables, items=items, links=links, stock=stock,
		warehouse_names=warehouse_names, can_payables=can_payables, can_purchases=can_purchases,
		can_payments=can_payments, can_stock=can_stock)


def build_supplier_hub(search=None, supplier_group=None, debt_filter="all", company=None,
	period="month", warehouse=None, stock_filter="all", stock_qty=0, sort_by="debt_desc", page=1, page_size=20,
	known_revision=None):
	if debt_filter not in (None, "all", "with_debt", "settled", "overdue", "in_stock") or stock_filter not in ("all", "gte", "lte", "zero"):
		frappe.throw(_("Invalid filter"))
	frappe.has_permission("Supplier", "read", throw=True)
	from erpnext.stock.page.product_catalog.product_catalog import get_default_company

	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	revision = current_revision((company, period, warehouse or ""))
	if known_revision and known_revision == revision:
		return dict(unchanged=True, revision=revision)
	context = load_supplier_context(company, period, warehouse)
	company, start, end = context["company"], context["start"], context["end"]
	rows, stock, suppliers = context["rows"], context["stock"], context["suppliers"]
	can_payables, can_purchases, can_payments, can_stock = (context[k] for k in
		("can_payables", "can_purchases", "can_payments", "can_stock"))
	result = filter_and_summarize(rows, stock, search, supplier_group, debt_filter, stock_filter, stock_qty, sort_by, page, page_size)
	# Empty restricted scopes must still show unavailable, never a misleading zero.
	for allowed, keys in ((can_payables, ("total_debt", "overdue", "credits")), (can_purchases, ("purchases",)), (can_stock, ("total_stock_value",))):
		if not allowed:
			for key in keys:
				result["summary"][key] = None
	return dict(**result, revision=revision, company=company, currency=frappe.get_cached_value("Company", company, "default_currency"),
		companies=frappe.get_list("Company", pluck="name", limit_page_length=0), warehouses=context["warehouse_names"],
		supplier_groups=sorted({s.supplier_group for s in suppliers if s.supplier_group}),
		from_date=str(start) if period != "all" else None, to_date=str(end),
		permissions=dict(payables=bool(can_payables), purchases=bool(can_purchases), payments=bool(can_payments), stock=bool(can_stock),
			create_supplier=frappe.has_permission("Supplier", "create")))
