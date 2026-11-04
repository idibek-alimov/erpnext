# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import math

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate, today

from erpnext.controllers.item_variant import create_variant, get_variant
from erpnext.stock.page.product_catalog.product_catalog import get_default_company

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
	if len(template.attributes) != len([a for a in (color_attr, size_attr) if a]):
		frappe.throw(_("Use the Item form for products with additional variant attributes"))
	return color_attr, size_attr


def set_item_price(item_code, price_list, rate, currency):
	uom = frappe.get_cached_value("Item", item_code, "stock_uom")
	prices = current_prices([item_code], currency, {item_code: uom})
	current = prices.get((item_code, price_list))
	if current and flt(current.price_list_rate) == flt(rate):
		return
	if current:
		price = frappe.get_doc("Item Price", current.name)
		price.price_list_rate = rate
		price.save()
	else:
		frappe.get_doc(dict(doctype="Item Price", item_code=item_code, price_list=price_list,
			price_list_rate=rate, currency=currency, uom=uom)).insert()


def get_item_supplier(item_code, company, codes=None):
	"""Fetches the default supplier or the supplier from the most recent Purchase Invoice."""
	if not item_code:
		return ""
	from erpnext.stock.page.product_detail.product_detail import get_supplier

	return get_supplier(item_code, codes or [item_code], company)


class QuickProductRestock(Document):
	def resolve_item(self):
		target = None
		if getattr(self, "short_code", None):
			target = get_product_by_code(self.short_code)
		# A partial name is never sufficient to choose a product on the server.
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
		item.check_permission("read")
		if item.disabled or not item.is_stock_item:
			frappe.throw(_("Select an enabled stock product"))
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
		seen_items = set()
		self.currency = frappe.get_cached_value("Company", self.company, "default_currency")
		permitted = permitted_items([r.item_code for r in self.items if r.item_code])
		attrs = variant_attributes(list(permitted))
		prices = current_prices(list(permitted), self.currency, {c: d.stock_uom for c, d in permitted.items()})
		for row in self.items:
			idx = row.idx
			row.qty = flt(row.qty)
			if not math.isfinite(row.qty) or row.qty < 0:
				frappe.throw(_("Row {0}: Received Qty cannot be negative").format(idx))
			row.buying_price = flt(row.buying_price, row.precision("buying_price"))
			row.selling_price = flt(row.selling_price, row.precision("selling_price"))
			if not math.isfinite(row.selling_price) or row.selling_price <= 0:
				frappe.throw(_("Row {0}: NEW Retail Price must be greater than 0").format(idx))
			if not math.isfinite(row.buying_price) or row.buying_price < 0 or (row.qty > 0 and row.buying_price <= 0):
				frappe.throw(_("Row {0}: Please enter the Cost of this delivery").format(idx))

			if row.item_code:
				child = permitted.get(row.item_code)
				if not child:
					frappe.throw(_("Not permitted to receive this item"), frappe.PermissionError)
				if child.disabled or not child.is_stock_item or child.has_variants or (child.variant_of or child.name) != item.name:
					frappe.throw(_("Row {0}: Item does not belong to the selected product").format(idx))
				if row.item_code in seen_items:
					frappe.throw(_("Row {0}: Item is listed twice").format(idx))
				seen_items.add(row.item_code)
				row.color = attrs.get(row.item_code, {}).get(color_attr, "")
				row.size = attrs.get(row.item_code, {}).get(size_attr, "")
				row.stock_uom = child.stock_uom
				row.custom_short_code = child.custom_short_code
				old = prices.get((row.item_code, "Standard Selling"))
				row.old_selling_price = old.price_list_rate if old else 0
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
				args = {attr: (row.get(field) or "").strip() for field, attr in (("color", color_attr), ("size", size_attr)) if attr}
				if get_variant(item.name, args):
					frappe.throw(_("Row {0}: This variant already exists. Reload the product.").format(idx))
				row.stock_uom = item.stock_uom
				row.old_selling_price = 0

			if frappe.get_cached_value("UOM", row.stock_uom, "must_be_whole_number") and row.qty % 1:
				frappe.throw(_("Row {0}: Quantity must be a whole number for this unit").format(idx))

			key = ((row.color or "").strip().lower(), (row.size or "").strip().lower())
			if key in seen:
				frappe.throw(_("Row {0}: {1} / {2} is listed twice").format(idx, row.color or "-", row.size or "-"))
			seen.add(key)
		self.validate_receipt_and_payment()

	def validate_receipt_and_payment(self):
		frappe.get_cached_doc("Company", self.company).check_permission("read")
		supplier = frappe.get_doc("Supplier", self.supplier)
		supplier.check_permission("read")
		if supplier.disabled:
			frappe.throw(_("Select an enabled supplier"))
		if self.target_warehouse:
			check_warehouse(self.company, self.target_warehouse)
		for name in PRICE_LISTS:
			price_list = frappe.get_cached_doc("Price List", name)
			price_list.check_permission("read")
			if not price_list.enabled or price_list.currency != self.currency:
				frappe.throw(_("Price list {0} must be enabled and use company currency {1}").format(name, self.currency))
		self.posting_date = getdate(self.posting_date or today())
		if self.posting_date > getdate():
			frappe.throw(_("Receipt date cannot be in the future"))
		if self.bill_date and getdate(self.bill_date) > self.posting_date:
			frappe.throw(_("Supplier invoice date cannot be after the receipt date"))
		if self.due_date and getdate(self.due_date) < getdate(self.bill_date or self.posting_date):
			frappe.throw(_("Payment deadline cannot be before the supplier invoice date"))
		self.total_qty = sum(r.qty for r in self.items)
		self.purchase_total = sum(flt(r.qty * r.buying_price, self.precision("purchase_total")) for r in self.items)
		if not self.total_qty and not self.price_only:
			frappe.throw(_("Enter a received quantity or enable Price update only"))
		if self.total_qty and self.price_only:
			frappe.throw(_("Turn off Price update only to receive stock"))
		if self.total_qty and not self.target_warehouse:
			frappe.throw(_("Select a warehouse for the incoming stock"))
		self.payment_amount = flt(self.payment_amount, self.precision("payment_amount"))
		if not math.isfinite(self.payment_amount) or not 0 <= self.payment_amount <= self.purchase_total:
			frappe.throw(_("Payment must be between 0 and the purchase total"))
		self.remaining_debt = flt(self.purchase_total - self.payment_amount, self.precision("remaining_debt"))
		if self.payment_amount:
			frappe.has_permission("Payment Entry", "create", throw=True)
			frappe.has_permission("Payment Entry", "submit", throw=True)
			if not self.payment_account or not self.payment_date:
				frappe.throw(_("Select the payment account and date"))
			if not self.posting_date <= getdate(self.payment_date) <= getdate():
				frappe.throw(_("Payment date must be between the receipt date and today"))
			account = frappe.get_doc("Account", self.payment_account)
			account.check_permission("read")
			if (account.company != self.company or account.is_group or account.disabled
				or account.account_type not in ("Cash", "Bank") or account.account_currency != self.currency):
				frappe.throw(_("Select an enabled cash or bank account in the company currency"))

	def set_defaults(self):
		if not self.company:
			self.company = get_default_company()
		if not self.target_warehouse and self.company:
			self.target_warehouse = get_default_warehouse(self.company)
		if not self.supplier and self.item:
			self.supplier = get_item_supplier(self.item, self.company)

	def on_submit(self):
		if self.total_qty:
			frappe.has_permission("Purchase Invoice", "create", throw=True)
			frappe.has_permission("Purchase Invoice", "submit", throw=True)
		if any(not r.item_code for r in self.items):
			frappe.has_permission("Item", "create", throw=True)
		currency = self.currency
		self.create_new_variants()
		self.update_prices(currency)
		self.process_stock_intake(currency)
		if self.payment_amount:
			from erpnext.buying.page.supplier_detail.detail_data import record_payment

			result = record_payment(self.supplier, self.purchase_invoice, self.company, self.payment_amount,
				account=self.payment_account, posting_date=self.payment_date, reference_no=self.payment_reference)
			self.db_set("payment_entry", result["payment_entry"])

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
		attr_doc.save()
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
			variant.set("item_defaults", [dict(company=self.company, default_supplier=self.supplier,
				default_warehouse=self.target_warehouse)])
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
		pi.bill_date = self.bill_date or self.posting_date
		pi.bill_no = self.bill_no or self.name
		pi.payment_deadline_not_agreed = not bool(self.due_date)
		pi.ignore_default_payment_terms_template = 1
		pi.due_date = self.due_date
		pi.disable_rounded_total = 1
		pi.ignore_pricing_rule = 1
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
					"uom": row.stock_uom,
					"conversion_factor": 1,
				},
			)
		pi.insert()
		# Native taxes/withholding can change a total. Never silently post a different debt.
		if flt(pi.grand_total, self.precision("purchase_total")) != flt(self.purchase_total, self.precision("purchase_total")):
			frappe.throw(_("Invoice total differs from the summary. Use the Purchase Invoice form for taxes or additional charges."))
		pi.submit()
		self.db_set("purchase_invoice", pi.name)

	def on_cancel(self):
		if self.payment_entry:
			payment = frappe.get_doc("Payment Entry", self.payment_entry)
			if payment.docstatus == 1:
				payment.cancel()
		if self.purchase_invoice:
			pi = frappe.get_doc("Purchase Invoice", self.purchase_invoice)
			if pi.docstatus == 1:
				pi.cancel()


def require_restock_access():
	frappe.has_permission("Quick Product Restock", "read", throw=True)
	frappe.has_permission("Item", "read", throw=True)


def check_warehouse(company, warehouse):
	frappe.get_cached_doc("Company", company).check_permission("read")
	doc = frappe.get_doc("Warehouse", warehouse)
	doc.check_permission("read")
	if doc.company != company or doc.is_group or doc.disabled:
		frappe.throw(_("Select an enabled warehouse in this company"))


def permitted_items(codes):
	result = {}
	for batch in frappe.utils.create_batch(list(set(codes)), 400):
		for row in frappe.get_list("Item", filters={"name": ["in", batch]},
			fields=["name", "item_name", "custom_short_code", "stock_uom", "variant_of", "disabled", "has_variants", "is_stock_item"],
			limit_page_length=0):
			result[row.name] = row
	return result


def variant_attributes(codes):
	result = {}
	for batch in frappe.utils.create_batch(codes, 400):
		for row in frappe.get_all("Item Variant Attribute", filters={"parent": ["in", batch]},
			fields=["parent", "attribute", "attribute_value"], limit_page_length=0):
			result.setdefault(row.parent, {})[row.attribute] = row.attribute_value
	return result


def current_prices(codes, currency, uoms):
	"""Only generic, active stock-unit prices; never overwrite party/batch/UOM prices."""
	frappe.has_permission("Item Price", "read", throw=True)
	result = {}
	for batch in frappe.utils.create_batch(codes, 400):
		rows = frappe.get_list("Item Price", filters={"item_code": ["in", batch],
			"price_list": ["in", PRICE_LISTS], "currency": currency},
			fields=["name", "item_code", "price_list", "price_list_rate", "uom", "valid_from", "valid_upto",
				"customer", "supplier", "batch_no", "packing_unit"], order_by="valid_from desc, modified desc, name desc", limit_page_length=0)
		for row in rows:
			if (row.customer or row.supplier or row.batch_no or flt(row.packing_unit) > 1
				or (row.uom and row.uom != uoms.get(row.item_code))
				or (row.valid_from and getdate(row.valid_from) > getdate())
				or (row.valid_upto and getdate(row.valid_upto) < getdate())):
				continue
			result.setdefault((row.item_code, row.price_list), row)
	return result


@frappe.whitelist()
def get_default_warehouse(company=None):
	require_restock_access()
	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	rows = frappe.get_list("Warehouse", filters={"company": company, "is_group": 0, "disabled": 0},
		fields=["name", "warehouse_name"], order_by="name", limit_page_length=0)
	preferred = next((w for w in rows if w.warehouse_name == "Stores"), None)
	return preferred.name if preferred else rows[0].name if rows else None


@frappe.whitelist()
def get_restock_defaults(company, supplier=None, posting_date=None, bill_date=None):
	require_restock_access()
	from erpnext.accounts.party import get_due_date, get_payment_terms_template

	frappe.get_cached_doc("Company", company).check_permission("read")
	deadline = None
	if supplier:
		frappe.get_doc("Supplier", supplier).check_permission("read")
		terms = get_payment_terms_template(supplier, "Supplier", company)
		if terms:
			deadline = get_due_date(posting_date or today(), "Supplier", supplier, company,
				bill_date=bill_date, template_name=terms)
	return dict(currency=frappe.get_cached_value("Company", company, "default_currency"), due_date=deadline)


@frappe.whitelist()
def get_restock_rows(item, company=None, warehouse=None):
	return get_product_template_info(item, company, warehouse)["rows"]


@frappe.whitelist()
def get_product_template_info(item, company=None, warehouse=None):
	require_restock_access()
	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	if warehouse:
		check_warehouse(company, warehouse)
	doc = frappe.get_doc("Item", item)
	doc.check_permission("read")
	if doc.variant_of:
		frappe.throw(_("Please select the main product, not a single size/color variant."))
	if doc.disabled or not doc.is_stock_item:
		frappe.throw(_("Select an enabled stock product"))
	color_attr, size_attr = get_template_attributes(doc) if doc.has_variants else (None, None)
	if doc.has_variants:
		variants = frappe.get_list("Item", filters={"variant_of": item, "disabled": 0, "is_stock_item": 1},
			fields=["name", "custom_short_code", "stock_uom"], order_by="custom_short_code asc, name asc", limit_page_length=0)
	else:
		variants = [doc]
	codes = [v.name for v in variants]
	attrs = variant_attributes(codes)
	currency = frappe.get_cached_value("Company", company, "default_currency")
	prices = current_prices(codes, currency, {v.name: v.stock_uom for v in variants})
	stock, barcodes = {}, {}
	for batch in frappe.utils.create_batch(codes, 400):
		if warehouse:
			for row in frappe.get_all("Bin", filters={"warehouse": warehouse, "item_code": ["in", batch]},
				fields=["item_code", "actual_qty"], limit_page_length=0):
				stock[row.item_code] = flt(row.actual_qty)
		for row in frappe.get_all("Item Barcode", filters={"parent": ["in", batch]},
			fields=["parent", "barcode"], order_by="idx", limit_page_length=0):
			barcodes.setdefault(row.parent, row.barcode)
	rows = []
	for variant in variants:
		buy = prices.get((variant.name, "Standard Buying"))
		sell = prices.get((variant.name, "Standard Selling"))
		rows.append(dict(item_code=variant.name, color=attrs.get(variant.name, {}).get(color_attr, ""),
			size=attrs.get(variant.name, {}).get(size_attr, ""), custom_short_code=variant.custom_short_code or "",
			barcode=barcodes.get(variant.name, variant.custom_short_code or ""), stock_uom=variant.stock_uom,
			current_stock=stock.get(variant.name, 0) if warehouse else None, qty=0,
			buying_price=flt(buy.price_list_rate) if buy else 0,
			old_selling_price=flt(sell.price_list_rate) if sell else 0,
			selling_price=flt(sell.price_list_rate) if sell else 0))
	def values(attr):
		if not attr:
			return []
		attribute = frappe.get_doc("Item Attribute", attr)
		attribute.check_permission("read")
		return [r.attribute_value for r in attribute.item_attribute_values]
	return dict(item_code=doc.name, item_name=doc.item_name, short_code=doc.custom_short_code or doc.name,
		supplier=get_item_supplier(item, company, codes), has_variants=doc.has_variants, color_attr=color_attr,
		size_attr=size_attr, available_colors=values(color_attr), available_sizes=values(size_attr),
		rows=rows, currency=currency, warehouse=warehouse, stock_uom=doc.stock_uom)


def product_result(item):
	return dict(label=f"{item.item_name} [{item.custom_short_code or item.name}]", value=item.item_name,
		item_code=item.name, item_name=item.item_name, short_code=item.custom_short_code or item.name)


@frappe.whitelist()
def search_products(query="", limit=20):
	require_restock_access()
	query = (query or "").strip()
	rows = frappe.get_list("Item", filters={"disabled": 0, "is_stock_item": 1, "variant_of": ["is", "not set"]},
		or_filters={key: ["like", f"%{query}%"] for key in ("item_name", "custom_short_code", "name")},
		fields=["name", "item_name", "custom_short_code"], order_by="item_name, name",
		limit_page_length=min(50, max(1, cint(limit) or 20)))
	return [product_result(row) for row in rows]


@frappe.whitelist()
def get_product_by_code(code):
	require_restock_access()
	code = (code or "").strip()
	if not code:
		return None
	rows = frappe.get_list("Item", filters={"disabled": 0, "is_stock_item": 1},
		or_filters={"custom_short_code": code, "name": code},
		fields=["name", "variant_of"], limit_page_length=2)
	if not rows:
		# Child lookup is only used to find a candidate; Item permissions are applied below.
		parent = frappe.db.get_value("Item Barcode", {"barcode": code}, "parent")
		rows = frappe.get_list("Item", filters={"name": parent, "disabled": 0, "is_stock_item": 1},
			fields=["name", "variant_of"], limit_page_length=1) if parent else []
	if len(rows) > 1:
		frappe.throw(_("This code matches more than one product. Select the product by name."))
	if not rows:
		return None
	row = rows[0]
	parents = frappe.get_list("Item", filters={"name": row.variant_of or row.name, "disabled": 0, "is_stock_item": 1},
		fields=["name", "item_name", "custom_short_code"], limit_page_length=1)
	return product_result(parents[0]) if parents else None
