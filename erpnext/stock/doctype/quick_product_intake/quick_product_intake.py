# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import math

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate, today
from erpnext.controllers.item_variant import create_variant


class QuickProductIntake(Document):
	def validate(self):
		self.validate_prices()
		self.set_company_defaults()
		self.validate_matrix_items()
		self.set_margin()
		self.validate_receipt_and_payment()

	def set_margin(self):
		if self.buying_price:
			self.margin_percentage = flt((self.selling_price - self.buying_price) / self.buying_price * 100, 2)

	def validate_prices(self):
		if not math.isfinite(flt(self.buying_price)) or flt(self.buying_price) <= 0:
			frappe.throw(_("Cost (Buying Price) must be greater than 0"))
		if not math.isfinite(flt(self.selling_price)) or flt(self.selling_price) <= 0:
			frappe.throw(_("Retail (Selling Price) must be greater than 0"))

	def set_company_defaults(self):
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)

		if self.company and not self.target_warehouse and frappe.has_permission("Warehouse", "read"):
			warehouses = frappe.get_list("Warehouse", filters={"company": self.company, "is_group": 0, "disabled": 0},
				fields=["name", "warehouse_name"], order_by="name", limit_page_length=0)
			preferred = next((w for w in warehouses if w.warehouse_name == "Stores"), None)
			self.target_warehouse = preferred.name if preferred else warehouses[0].name if warehouses else None

	def validate_matrix_items(self):
		if not self.has_variants:
			if not self.items:
				self.append(
					"items",
					{
						"variant_title": self.item_name,
						"qty": 0,
						"buying_price": self.buying_price,
						"selling_price": self.selling_price,
					},
				)
		else:
			if not self.items:
				frappe.throw(_("Please generate matrix rows for the selected colors and sizes."))

		for row in self.items:
			row.qty = flt(row.qty)
			if not math.isfinite(row.qty) or row.qty < 0:
				frappe.throw(_("Row {0}: Incoming quantity cannot be negative").format(row.idx))
			if not row.buying_price:
				row.buying_price = self.buying_price
			if not row.selling_price:
				row.selling_price = self.selling_price
			for field in ("buying_price", "selling_price"):
				value = flt(row.get(field), row.precision(field))
				if not math.isfinite(value) or value <= 0:
					frappe.throw(_("Row {0}: Buying and selling prices must be greater than 0").format(row.idx))
				row.set(field, value)

		if not self.has_variants and len(self.items) != 1:
			frappe.throw(_("A product without variants must have exactly one row"))
		if self.has_variants:
			active = [key for key in ("color", "size") if any((r.get(key) or "").strip() for r in self.items)]
			if not active:
				frappe.throw(_("Select at least one color or size"))
			seen = set()
			for row in self.items:
				key = tuple((row.get(field) or "").strip().casefold() for field in active)
				if not all(key):
					frappe.throw(_("Row {0}: Fill the selected variant attributes").format(row.idx))
				if key in seen:
					frappe.throw(_("Row {0}: Duplicate color and size combination").format(row.idx))
				seen.add(key)

	def validate_receipt_and_payment(self):
		frappe.get_doc("Supplier", self.supplier).check_permission("read")
		frappe.get_cached_doc("Company", self.company).check_permission("read")
		self.currency = frappe.get_cached_value("Company", self.company, "default_currency")
		for name in ("Standard Buying", "Standard Selling"):
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
		if self.target_warehouse:
			warehouse = frappe.get_doc("Warehouse", self.target_warehouse)
			warehouse.check_permission("read")
			if warehouse.company != self.company or warehouse.is_group or warehouse.disabled:
				frappe.throw(_("Select an enabled warehouse in this company"))
		if any(r.qty > 0 for r in self.items) and not self.target_warehouse:
			frappe.throw(_("Select a warehouse for the incoming stock"))
		total = sum(flt(r.qty * flt(r.buying_price), self.precision("payment_amount")) for r in self.items)
		self.payment_amount = flt(self.payment_amount, self.precision("payment_amount"))
		if not math.isfinite(self.payment_amount) or self.payment_amount < 0 or self.payment_amount > total:
			frappe.throw(_("Payment must be between 0 and the purchase total"))
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

	def on_submit(self):
		frappe.has_permission("Item", "create", throw=True)
		frappe.has_permission("Item Price", "create", throw=True)
		if any(r.qty > 0 for r in self.items):
			frappe.has_permission("Purchase Invoice", "create", throw=True)
			frappe.has_permission("Purchase Invoice", "submit", throw=True)
		color_attr, size_attr = self.ensure_attributes_exist()
		next_code = self.get_next_short_code()
		currency = frappe.get_cached_value("Company", self.company, "default_currency") or "TJS"

		if self.has_variants:
			next_code = self.create_template_and_variants(color_attr, size_attr, next_code)
		else:
			next_code = self.create_standalone_item(next_code)

		self.create_item_prices(currency)
		self.process_stock_intake(currency)
		if self.payment_amount:
			from erpnext.buying.page.supplier_detail.detail_data import record_payment

			result = record_payment(self.supplier, self.purchase_invoice, self.company, self.payment_amount,
				account=self.payment_account, posting_date=self.payment_date, reference_no=self.payment_reference)
			self.db_set("payment_entry", result["payment_entry"])

	def ensure_attributes_exist(self):
		"""Ensures Colour and Size Item Attributes and all specified values exist in the database."""
		color_attr = "Colour" if frappe.db.exists("Item Attribute", "Colour") else "Color"
		if not frappe.db.exists("Item Attribute", color_attr):
			doc = frappe.get_doc({"doctype": "Item Attribute", "attribute_name": color_attr})
			doc.insert()

		size_attr = "Size"
		if not frappe.db.exists("Item Attribute", size_attr):
			doc = frappe.get_doc({"doctype": "Item Attribute", "attribute_name": size_attr})
			doc.insert()

		# Ensure values exist for each row and resolve them to canonical attribute values
		for row in self.items:
			if row.color:
				row.color = self.resolve_or_create_attribute_value(color_attr, row.color)
			if row.size:
				row.size = self.resolve_or_create_attribute_value(size_attr, row.size)

		return color_attr, size_attr

	def resolve_or_create_attribute_value(self, attr_name, user_val):
		val = user_val.strip()
		attr_doc = frappe.get_doc("Item Attribute", attr_name)

		existing_abbrs = {r.abbr.upper(): r.attribute_value for r in attr_doc.item_attribute_values if r.abbr}
		existing_vals = {r.attribute_value.lower(): r.attribute_value for r in attr_doc.item_attribute_values if r.attribute_value}

		if val.lower() in existing_vals:
			return existing_vals[val.lower()]

		if val.upper() in existing_abbrs:
			return existing_abbrs[val.upper()]

		# Create new attribute value with unique abbr
		cand_abbr = val[:4].upper()
		if cand_abbr in existing_abbrs:
			idx = 1
			while f"{cand_abbr[:3]}{idx}" in existing_abbrs:
				idx += 1
			cand_abbr = f"{cand_abbr[:3]}{idx}"

		attr_doc.append("item_attribute_values", {
			"attribute_value": val,
			"abbr": cand_abbr
		})
		attr_doc.save()
		return val

	def get_next_short_code(self):
		max_val = frappe.db.sql(
			"SELECT MAX(CAST(custom_short_code AS UNSIGNED)) FROM `tabItem` WHERE custom_short_code REGEXP '^[0-9]+$'"
		)[0][0]
		return (max_val or 1000) + 1

	def get_clean_base_code(self):
		if self.item_code:
			return self.item_code.strip()
		base = frappe.scrub(self.item_name).replace("_", "-").upper()
		# Ensure unique
		if frappe.db.exists("Item", base):
			base = f"{base}-{frappe.generate_hash(length=4).upper()}"
		return base

	def create_template_and_variants(self, color_attr, size_attr, next_code):
		base_code = self.get_clean_base_code()

		# Create Template Item
		template_short_code = str(next_code)
		next_code += 1

		template = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": base_code,
				"item_name": self.item_name,
				"item_group": self.item_group,
				"stock_uom": self.stock_uom or "Nos",
				"is_stock_item": 1,
				"has_variants": 1,
				"variant_based_on": "Item Attribute",
				"custom_short_code": template_short_code,
				"attributes": [{"attribute": attr} for field, attr in (("color", color_attr), ("size", size_attr))
					if any(r.get(field) for r in self.items)],
				"item_defaults": [self.item_defaults()],
			}
		)
		template.insert()
		self.db_set("template_item", template.name)

		# Create Variant Items
		for row in self.items:
			variant_short_code = str(next_code)
			next_code += 1

			row.custom_short_code = variant_short_code

			attr_args = {attr: row.get(field).strip() for field, attr in (("color", color_attr), ("size", size_attr)) if row.get(field)}
			variant = create_variant(template.name, attr_args)
			variant.custom_short_code = variant_short_code
			if row.variant_title:
				variant.item_name = row.variant_title
			if row.barcode and len(str(row.barcode).strip()) >= 8:
				variant.append("barcodes", {"barcode": str(row.barcode).strip(), "barcode_type": "EAN"})
			variant.set("item_defaults", [self.item_defaults()])
			variant.insert()

			gen_barcode = frappe.db.get_value("Item Barcode", {"parent": variant.name}, "barcode") or row.barcode or variant_short_code
			row.db_set("custom_short_code", variant_short_code)
			row.db_set("barcode", gen_barcode)
			row.db_set("generated_item_code", variant.name)

		return next_code

	def item_defaults(self):
		return dict(company=self.company, default_supplier=self.supplier, default_warehouse=self.target_warehouse)

	def create_standalone_item(self, next_code):
		base_code = self.get_clean_base_code()
		item_short_code = str(next_code)
		next_code += 1

		row = self.items[0]

		item_doc = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": base_code,
				"item_name": self.item_name,
				"item_group": self.item_group,
				"stock_uom": self.stock_uom or "Nos",
				"is_stock_item": 1,
				"has_variants": 0,
				"custom_short_code": item_short_code,
				"item_defaults": [self.item_defaults()],
			}
		)
		if row.barcode and len(str(row.barcode).strip()) >= 8:
			item_doc.append("barcodes", {"barcode": str(row.barcode).strip(), "barcode_type": "EAN"})
		item_doc.insert()
		self.db_set("template_item", item_doc.name)

		gen_barcode = frappe.db.get_value("Item Barcode", {"parent": item_doc.name}, "barcode") or row.barcode or item_short_code
		row.db_set("custom_short_code", item_short_code)
		row.db_set("barcode", gen_barcode)
		row.db_set("generated_item_code", item_doc.name)

		return next_code

	def create_item_prices(self, currency):
		for row in self.items:
			if not row.generated_item_code:
				continue

			# Standard Buying
			if not frappe.db.exists("Item Price", {"item_code": row.generated_item_code, "price_list": "Standard Buying"}):
				frappe.get_doc(
					{
						"doctype": "Item Price",
						"item_code": row.generated_item_code,
						"price_list": "Standard Buying",
						"price_list_rate": row.buying_price or self.buying_price,
						"currency": currency,
					}
				).insert()

			# Standard Selling
			if not frappe.db.exists("Item Price", {"item_code": row.generated_item_code, "price_list": "Standard Selling"}):
				frappe.get_doc(
					{
						"doctype": "Item Price",
						"item_code": row.generated_item_code,
						"price_list": "Standard Selling",
						"price_list_rate": row.selling_price or self.selling_price,
						"currency": currency,
					}
				).insert()

	def process_stock_intake(self, currency):
		stock_rows = [r for r in self.items if r.qty and r.qty > 0 and r.generated_item_code]
		if not stock_rows:
			return

		# Zero-stock creation deliberately has no invoice, payment, or supplier debt.
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
		pi.remarks = _("Stock Intake from Quick Product Intake {0} ({1})").format(self.name, self.item_name)

		for row in stock_rows:
			pi.append(
				"items",
				{
					"item_code": row.generated_item_code,
					"qty": row.qty,
					"rate": row.buying_price or self.buying_price,
					"warehouse": self.target_warehouse,
				},
			)

		pi.insert()
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

		if self.stock_entry:
			se = frappe.get_doc("Stock Entry", self.stock_entry)
			if se.docstatus == 1:
				se.cancel()

		if self.pricing_rule:
			pr = frappe.get_doc("Pricing Rule", self.pricing_rule)
			if pr.docstatus == 1:
				pr.cancel()


@frappe.whitelist()
def get_intake_defaults(company, supplier=None, posting_date=None, bill_date=None):
	"""Read agreement defaults; never invent a payment deadline without terms."""
	from erpnext.accounts.party import get_due_date, get_payment_terms_template

	frappe.has_permission("Quick Product Intake", "create", throw=True)
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
def get_attribute_options():
	"""Existing Colour and Size values, used for the checkbox pickers."""
	frappe.has_permission("Quick Product Intake", "create", throw=True)

	def values(*names):
		for n in names:
			if frappe.db.exists("Item Attribute", n):
				return frappe.get_all(
					"Item Attribute Value",
					filters={"parent": n},
					fields=["attribute_value"],
					order_by="idx asc",
					pluck="attribute_value",
				)
		return []

	return {"colors": values("Colour", "Color"), "sizes": values("Size")}
