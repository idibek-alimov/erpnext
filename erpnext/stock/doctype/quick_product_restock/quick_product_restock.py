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


def get_item_supplier(item_code):
	"""Fetches the default supplier or the supplier from the most recent Purchase Invoice."""
	if not item_code:
		return ""
	supp = frappe.db.get_value("Item Default", {"parent": item_code}, "default_supplier")
	if supp:
		return supp
	res = frappe.db.sql(
		"""SELECT pi.supplier FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		JOIN `tabItem` i ON (i.name = pii.item_code AND (i.name = %s OR i.variant_of = %s))
		WHERE pi.docstatus = 1
		ORDER BY pi.posting_date DESC, pi.creation DESC LIMIT 1""",
		(item_code, item_code),
	)
	return res[0][0] if res else ""


class QuickProductRestock(Document):
	def resolve_item(self):
		target = None
		if getattr(self, "short_code", None):
			target = get_product_by_code(self.short_code)
		if not target and getattr(self, "item_name", None):
			matches = search_products(self.item_name, limit=1)
			if matches:
				target = matches[0]
		if target:
			self.item = target["item_code"]
			self.item_name = target["item_name"]
			self.short_code = target["short_code"]
		else:
			frappe.throw(_("Could not find product matching '{0}'").format(self.short_code or self.item_name))

	def validate(self):
		self.set_defaults()

		if not self.supplier:
			frappe.throw(_("Supplier is required for receiving stock delivery."))

		if not self.item:
			if getattr(self, "short_code", None) or getattr(self, "item_name", None):
				self.resolve_item()
			else:
				frappe.throw(_("Please select a Product."))

		item = frappe.get_doc("Item", self.item)
		if item.variant_of:
			frappe.throw(_("Please select the main product, not a single size/color variant."))
		self.item_name = item.item_name
		self.short_code = item.custom_short_code or item.name

		if not self.items:
			frappe.throw(_("Please enter the received quantity for at least one size."))

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
		if not self.supplier and self.item:
			self.supplier = get_item_supplier(self.item)

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

		pi = frappe.new_doc("Purchase Invoice")
		pi.company = self.company
		pi.supplier = self.supplier
		pi.set_posting_time = 1
		pi.posting_date = self.posting_date
		pi.bill_date = self.posting_date
		pi.bill_no = f"QPR-{self.name}"
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

	def on_cancel(self):
		if self.purchase_invoice:
			pi = frappe.get_doc("Purchase Invoice", self.purchase_invoice)
			if pi.docstatus == 1:
				pi.flags.ignore_permissions = True
				pi.cancel()


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


@frappe.whitelist()
def get_product_template_info(item):
	"""Returns template attributes, available attribute values, last supplier, and existing rows."""
	doc = frappe.get_doc("Item", item)
	if doc.variant_of:
		frappe.throw(_("Please select the main product, not a single size/color variant."))

	color_attr = size_attr = None
	if doc.has_variants:
		color_attr, size_attr = get_template_attributes(doc)

	available_colors = []
	if color_attr:
		available_colors = [
			r.attribute_value
			for r in frappe.get_all(
				"Item Attribute Value",
				filters={"parent": color_attr},
				fields=["attribute_value"],
				order_by="idx asc, attribute_value asc",
			)
		]

	available_sizes = []
	if size_attr:
		available_sizes = [
			r.attribute_value
			for r in frappe.get_all(
				"Item Attribute Value",
				filters={"parent": size_attr},
				fields=["attribute_value"],
				order_by="idx asc, attribute_value asc",
			)
		]

	rows = get_restock_rows(item)
	supplier = get_item_supplier(item)

	return {
		"item_code": doc.name,
		"item_name": doc.item_name,
		"short_code": doc.custom_short_code or doc.name,
		"supplier": supplier,
		"has_variants": doc.has_variants,
		"color_attr": color_attr,
		"size_attr": size_attr,
		"available_colors": available_colors,
		"available_sizes": available_sizes,
		"rows": rows,
	}


@frappe.whitelist()
def search_products(query="", limit=20):
	"""Searches main products (not variants) by item_name, custom_short_code, or item_code."""
	query = (query or "").strip()
	conditions = ["disabled = 0", "(variant_of IS NULL OR variant_of = '')"]
	values = {"limit": int(limit or 20)}

	if query:
		conditions.append(
			"(item_name LIKE %(q)s OR custom_short_code LIKE %(q)s OR name LIKE %(q)s)"
		)
		values["q"] = f"%{query}%"
		values["q_exact"] = query
		values["q_start"] = f"{query}%"
		order_clause = "CASE WHEN custom_short_code = %(q_exact)s THEN 0 WHEN item_name LIKE %(q_start)s THEN 1 ELSE 2 END, item_name ASC"
	else:
		order_clause = "item_name ASC"

	items = frappe.db.sql(
		f"""
		SELECT name, item_name, custom_short_code
		FROM `tabItem`
		WHERE {" AND ".join(conditions)}
		ORDER BY {order_clause}
		LIMIT %(limit)s
		""",
		values,
		as_dict=True,
	)

	results = []
	for it in items:
		code_display = it.custom_short_code or it.name
		results.append(
			{
				"label": f"{it.item_name} [ID: {code_display}]",
				"value": it.item_name,
				"item_code": it.name,
				"item_name": it.item_name,
				"short_code": it.custom_short_code or it.name,
			}
		)
	return results


@frappe.whitelist()
def get_product_by_code(code):
	"""Finds a main product by custom_short_code, name, or barcode."""
	code = (code or "").strip()
	if not code:
		return None

	# 1. Main item with custom_short_code
	item = frappe.db.get_value(
		"Item",
		{"custom_short_code": code, "disabled": 0, "variant_of": ("is", "not set")},
		["name", "item_name", "custom_short_code"],
		as_dict=True,
	)
	if not item:
		# 2. Variant item with custom_short_code -> resolve to parent template
		var = frappe.db.get_value(
			"Item",
			{"custom_short_code": code, "disabled": 0, "variant_of": ("is", "set")},
			["name", "variant_of"],
			as_dict=True,
		)
		if var and var.variant_of:
			item = frappe.db.get_value(
				"Item",
				var.variant_of,
				["name", "item_name", "custom_short_code"],
				as_dict=True,
			)

	if not item:
		# 3. Barcode match
		barcode_item = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
		if barcode_item:
			b_doc = frappe.db.get_value(
				"Item",
				barcode_item,
				["name", "item_name", "custom_short_code", "variant_of"],
				as_dict=True,
			)
			if b_doc:
				if b_doc.variant_of:
					item = frappe.db.get_value(
						"Item",
						b_doc.variant_of,
						["name", "item_name", "custom_short_code"],
						as_dict=True,
					)
				else:
					item = b_doc

	if not item:
		# 4. Item code (name) match
		i_doc = frappe.db.get_value(
			"Item",
			{"name": code, "disabled": 0},
			["name", "item_name", "custom_short_code", "variant_of"],
			as_dict=True,
		)
		if i_doc:
			if i_doc.variant_of:
				item = frappe.db.get_value(
					"Item",
					i_doc.variant_of,
					["name", "item_name", "custom_short_code"],
					as_dict=True,
				)
			else:
				item = i_doc

	if item:
		return {
			"item_code": item.name,
			"item_name": item.item_name,
			"short_code": item.custom_short_code or item.name,
		}
	return None

