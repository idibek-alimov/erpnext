# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

from erpnext.controllers.item_variant import create_variant
from erpnext.stock.page.product_catalog.product_catalog import get_default_company, get_stores_warehouse

PRICE_LISTS = ("Standard Selling", "Standard Buying")


def get_template_attributes(template):
	"""Returns (color_attribute, size_attribute) names used by a template item."""
	color_attr = size_attr = None
	for a in template.attributes:
		name = (a.attribute or "").lower()
		if "colo" in name and not color_attr:
			color_attr = a.attribute
		elif "size" in name and not size_attr:
			size_attr = a.attribute
	if not (color_attr or size_attr):
		frappe.throw(_("This product has no Color or Size attribute, so new sizes cannot be added."))
	return color_attr, size_attr


def set_item_price(item_code, price_list, rate, currency):
	name = frappe.db.get_value("Item Price", {"item_code": item_code, "price_list": price_list}, "name")
	if name:
		if flt(frappe.db.get_value("Item Price", name, "price_list_rate")) != flt(rate):
			frappe.db.set_value("Item Price", name, "price_list_rate", rate)
	else:
		frappe.get_doc(
			{
				"doctype": "Item Price",
				"item_code": item_code,
				"price_list": price_list,
				"price_list_rate": rate,
				"currency": currency,
			}
		).insert(ignore_permissions=True)


class QuickProductRestock(Document):
	def validate(self):
		self.set_defaults()

		item = frappe.get_doc("Item", self.item)
		if item.variant_of:
			frappe.throw(_("Please select the main product, not a single size/color variant."))
		self.item_name = item.item_name

		if not self.items:
			frappe.throw(_("There are no sizes to receive. Please select a Product first."))

		color_attr = size_attr = None
		if item.has_variants:
			color_attr, size_attr = get_template_attributes(item)

		seen = set()
		for row in self.items:
			idx = row.idx
			row.qty = flt(row.qty)
			if row.qty < 0:
				frappe.throw(_("Row {0}: Received Qty cannot be negative").format(idx))
			if flt(row.selling_price) <= 0:
				frappe.throw(_("Row {0}: NEW Retail Price must be greater than 0").format(idx))
			if row.qty > 0 and flt(row.buying_price) <= 0:
				frappe.throw(_("Row {0}: Please enter the Cost of this delivery").format(idx))

			if row.item_code:
				row.is_new_variant = 0
			else:
				if not item.has_variants:
					frappe.throw(_("Row {0}: This product has no sizes/colors, new rows cannot be added.").format(idx))
				row.is_new_variant = 1
				if color_attr and not (row.color or "").strip():
					frappe.throw(_("Row {0}: Please enter a Color").format(idx))
				if size_attr and not (row.size or "").strip():
					frappe.throw(_("Row {0}: Please enter a Size").format(idx))
				if row.qty <= 0:
					frappe.throw(_("Row {0}: A new size/color needs a Received Qty greater than 0").format(idx))

			key = ((row.color or "").strip().lower(), (row.size or "").strip().lower())
			if key in seen:
				frappe.throw(_("Row {0}: {1} / {2} is listed twice").format(idx, row.color or "-", row.size or "-"))
			seen.add(key)

	def set_defaults(self):
		if not self.company:
			self.company = get_default_company()
		if not self.target_warehouse and self.company:
			self.target_warehouse = get_stores_warehouse(self.company)

	def on_submit(self):
		currency = frappe.get_cached_value("Company", self.company, "default_currency") or "TJS"
		self.create_new_variants()
		self.update_prices(currency)
		self.process_stock_intake(currency)

	# ---------- New sizes / colors ----------
	def get_next_short_code(self):
		max_val = frappe.db.sql(
			"SELECT MAX(CAST(custom_short_code AS UNSIGNED)) FROM `tabItem` WHERE custom_short_code REGEXP '^[0-9]+$'"
		)[0][0]
		return (max_val or 1000) + 1

	def resolve_or_create_attribute_value(self, attr_name, user_val):
		val = user_val.strip()
		attr_doc = frappe.get_doc("Item Attribute", attr_name)

		existing_abbrs = {r.abbr.upper(): r.attribute_value for r in attr_doc.item_attribute_values if r.abbr}
		existing_vals = {r.attribute_value.lower(): r.attribute_value for r in attr_doc.item_attribute_values if r.attribute_value}

		if val.lower() in existing_vals:
			return existing_vals[val.lower()]
		if val.upper() in existing_abbrs:
			return existing_abbrs[val.upper()]

		cand_abbr = val[:4].upper()
		if cand_abbr in existing_abbrs:
			idx = 1
			while f"{cand_abbr[:3]}{idx}" in existing_abbrs:
				idx += 1
			cand_abbr = f"{cand_abbr[:3]}{idx}"

		attr_doc.append("item_attribute_values", {"attribute_value": val, "abbr": cand_abbr})
		attr_doc.save(ignore_permissions=True)
		return val

	def create_new_variants(self):
		new_rows = [r for r in self.items if not r.item_code]
		if not new_rows:
			return

		template = frappe.get_doc("Item", self.item)
		color_attr, size_attr = get_template_attributes(template)
		next_code = self.get_next_short_code()

		for row in new_rows:
			attr_args = {}
			if color_attr:
				attr_args[color_attr] = self.resolve_or_create_attribute_value(color_attr, row.color)
			if size_attr:
				attr_args[size_attr] = self.resolve_or_create_attribute_value(size_attr, row.size)

			short_code = str(next_code)
			next_code += 1
			barcode = (row.barcode or "").strip() or short_code

			variant = create_variant(template.name, attr_args)
			variant.custom_short_code = short_code
			variant.append("barcodes", {"barcode": barcode})
			variant.flags.ignore_permissions = True
			variant.insert()

			row.db_set("item_code", variant.name)
			row.db_set("custom_short_code", short_code)
			row.db_set("barcode", barcode)

	# ---------- Per-size prices ----------
	def update_prices(self, currency):
		for row in self.items:
			if not row.item_code:
				continue
			set_item_price(row.item_code, "Standard Selling", flt(row.selling_price), currency)
			if flt(row.buying_price) > 0:
				set_item_price(row.item_code, "Standard Buying", flt(row.buying_price), currency)

	# ---------- Stock ----------
	def process_stock_intake(self, currency):
		stock_rows = [r for r in self.items if flt(r.qty) > 0 and r.item_code]
		if not stock_rows:
			return

		remarks = _("Stock received via Quick Product Restock {0} ({1})").format(self.name, self.item_name)

		if self.supplier:
			pi = frappe.new_doc("Purchase Invoice")
			pi.company = self.company
			pi.supplier = self.supplier
			pi.set_posting_time = 1
			pi.posting_date = self.posting_date
			pi.bill_date = self.posting_date
			pi.bill_no = self.bill_no or f"QPR-{self.name}"
			pi.update_stock = 1
			pi.currency = currency
			pi.remarks = remarks
			for row in stock_rows:
				pi.append(
					"items",
					{
						"item_code": row.item_code,
						"qty": row.qty,
						"rate": row.buying_price,
						"warehouse": self.target_warehouse,
					},
				)
			pi.flags.ignore_permissions = True
			pi.flags.ignore_mandatory = True
			pi.insert()
			pi.submit()
			self.db_set("purchase_invoice", pi.name)
		else:
			se = frappe.new_doc("Stock Entry")
			se.stock_entry_type = "Material Receipt"
			se.company = self.company
			se.set_posting_time = 1
			se.posting_date = self.posting_date
			se.remarks = remarks
			for row in stock_rows:
				se.append(
					"items",
					{
						"item_code": row.item_code,
						"qty": row.qty,
						"t_warehouse": self.target_warehouse,
						"basic_rate": row.buying_price,
					},
				)
			se.flags.ignore_permissions = True
			se.flags.ignore_mandatory = True
			se.insert()
			se.submit()
			self.db_set("stock_entry", se.name)

	def on_cancel(self):
		if self.purchase_invoice:
			pi = frappe.get_doc("Purchase Invoice", self.purchase_invoice)
			if pi.docstatus == 1:
				pi.flags.ignore_permissions = True
				pi.cancel()

		if self.stock_entry:
			se = frappe.get_doc("Stock Entry", self.stock_entry)
			if se.docstatus == 1:
				se.flags.ignore_permissions = True
				se.cancel()


@frappe.whitelist()
def get_default_warehouse(company=None):
	return get_stores_warehouse(company or get_default_company())


@frappe.whitelist()
def get_restock_rows(item):
	"""Returns one row per existing size/color of the product with current stock and prices."""
	doc = frappe.get_doc("Item", item)
	if doc.variant_of:
		frappe.throw(_("Please select the main product, not a single size/color variant."))

	if doc.has_variants:
		variants = frappe.get_all(
			"Item",
			filters={"variant_of": item, "disabled": 0},
			fields=["name", "custom_short_code"],
			order_by="custom_short_code asc, name asc",
		)
	else:
		variants = [frappe._dict(name=doc.name, custom_short_code=doc.custom_short_code)]

	codes = [v.name for v in variants]
	if not codes:
		return []

	stock = {
		r.item_code: flt(r.qty)
		for r in frappe.db.sql(
			"SELECT item_code, SUM(actual_qty) AS qty FROM `tabBin` WHERE item_code IN %(codes)s GROUP BY item_code",
			{"codes": codes},
			as_dict=True,
		)
	}

	prices = {"Standard Selling": {}, "Standard Buying": {}}
	for p in frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", codes], "price_list": ["in", list(PRICE_LISTS)]},
		fields=["item_code", "price_list", "price_list_rate"],
		order_by="modified desc",
	):
		prices[p.price_list].setdefault(p.item_code, flt(p.price_list_rate))

	attrs = {}
	for a in frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", codes]},
		fields=["parent", "attribute", "attribute_value"],
	):
		attrs.setdefault(a.parent, []).append(a)

	rows = []
	for v in variants:
		color = size = ""
		for a in attrs.get(v.name, []):
			attr_name = (a.attribute or "").lower()
			if "colo" in attr_name:
				color = a.attribute_value
			elif "size" in attr_name:
				size = a.attribute_value

		barcode = frappe.db.get_value("Item Barcode", {"parent": v.name}, "barcode") or v.custom_short_code or ""
		sell = prices["Standard Selling"].get(v.name, 0)
		rows.append(
			{
				"item_code": v.name,
				"color": color,
				"size": size,
				"custom_short_code": v.custom_short_code or "",
				"barcode": barcode,
				"current_stock": stock.get(v.name, 0),
				"qty": 0,
				"buying_price": prices["Standard Buying"].get(v.name, 0),
				"old_selling_price": sell,
				"selling_price": sell,
			}
		)
	return rows
