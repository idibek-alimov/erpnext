# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext.controllers.item_variant import create_variant


class QuickProductIntake(Document):
	def validate(self):
		self.validate_prices()
		self.set_company_defaults()
		self.validate_matrix_items()

	def validate_prices(self):
		if not self.buying_price or self.buying_price <= 0:
			frappe.throw(_("Cost (Buying Price) must be greater than 0"))
		if not self.selling_price or self.selling_price <= 0:
			frappe.throw(_("Retail (Selling Price) must be greater than 0"))

	def set_company_defaults(self):
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)

		if not self.target_warehouse and self.company:
			self.target_warehouse = frappe.db.get_value(
				"Warehouse",
				{"company": self.company, "is_group": 0, "warehouse_name": ["in", ["Stores", "Finished Goods"]]},
				"name",
			) or frappe.db.get_value(
				"Warehouse",
				{"company": self.company, "is_group": 0},
				"name",
			)

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
			if not row.buying_price:
				row.buying_price = self.buying_price
			if not row.selling_price:
				row.selling_price = self.selling_price

	def on_submit(self):
		color_attr, size_attr = self.ensure_attributes_exist()
		next_code = self.get_next_short_code()
		currency = frappe.get_cached_value("Company", self.company, "default_currency") or "TJS"

		if self.has_variants:
			next_code = self.create_template_and_variants(color_attr, size_attr, next_code)
		else:
			next_code = self.create_standalone_item(next_code)

		self.create_item_prices(currency)
		self.process_stock_intake(currency)
		self.process_promotional_discount()

	def ensure_attributes_exist(self):
		"""Ensures Colour and Size Item Attributes and all specified values exist in the database."""
		color_attr = "Colour" if frappe.db.exists("Item Attribute", "Colour") else "Color"
		if not frappe.db.exists("Item Attribute", color_attr):
			doc = frappe.get_doc({"doctype": "Item Attribute", "attribute_name": color_attr})
			doc.insert(ignore_permissions=True)

		size_attr = "Size"
		if not frappe.db.exists("Item Attribute", size_attr):
			doc = frappe.get_doc({"doctype": "Item Attribute", "attribute_name": size_attr})
			doc.insert(ignore_permissions=True)

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
		attr_doc.save(ignore_permissions=True)
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
				"attributes": [
					{"attribute": color_attr},
					{"attribute": size_attr},
				],
			}
		)
		template.flags.ignore_permissions = True
		template.insert()
		self.db_set("template_item", template.name)

		# Create Variant Items
		for row in self.items:
			variant_short_code = str(next_code)
			next_code += 1

			row.custom_short_code = variant_short_code
			row.barcode = row.barcode or variant_short_code

			attr_args = {color_attr: row.color.strip(), size_attr: row.size.strip()}
			variant = create_variant(template.name, attr_args)
			variant.custom_short_code = variant_short_code
			variant.append("barcodes", {"barcode": row.barcode})
			variant.flags.ignore_permissions = True
			variant.insert()

			row.db_set("custom_short_code", variant_short_code)
			row.db_set("barcode", row.barcode)
			row.db_set("generated_item_code", variant.name)

		return next_code

	def create_standalone_item(self, next_code):
		base_code = self.get_clean_base_code()
		item_short_code = str(next_code)
		next_code += 1

		row = self.items[0]
		barcode = row.barcode or item_short_code

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
			}
		)
		item_doc.append("barcodes", {"barcode": barcode})
		item_doc.flags.ignore_permissions = True
		item_doc.insert()

		row.db_set("custom_short_code", item_short_code)
		row.db_set("barcode", barcode)
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
				).insert(ignore_permissions=True)

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
				).insert(ignore_permissions=True)

	def process_stock_intake(self, currency):
		stock_rows = [r for r in self.items if r.qty and r.qty > 0 and r.generated_item_code]
		if not stock_rows:
			return

		if self.supplier:
			# Create Purchase Invoice with update_stock = 1
			pi = frappe.new_doc("Purchase Invoice")
			pi.company = self.company
			pi.supplier = self.supplier
			pi.posting_date = frappe.utils.today()
			pi.bill_date = frappe.utils.today()
			pi.bill_no = f"QPI-{self.name}"
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

			pi.flags.ignore_permissions = True
			pi.flags.ignore_mandatory = True
			pi.insert()
			pi.submit()
			self.db_set("purchase_invoice", pi.name)
		else:
			# Create Stock Entry (Material Receipt)
			se = frappe.new_doc("Stock Entry")
			se.stock_entry_type = "Material Receipt"
			se.company = self.company
			se.posting_date = frappe.utils.today()
			se.remarks = _("Stock Intake from Quick Product Intake {0} ({1})").format(self.name, self.item_name)

			for row in stock_rows:
				se.append(
					"items",
					{
						"item_code": row.generated_item_code,
						"qty": row.qty,
						"t_warehouse": self.target_warehouse,
						"basic_rate": row.buying_price or self.buying_price,
					},
				)

			se.flags.ignore_permissions = True
			se.flags.ignore_mandatory = True
			se.insert()
			se.submit()
			self.db_set("stock_entry", se.name)

	def process_promotional_discount(self):
		if not (self.discount_percentage and self.discount_percentage > 0 and self.create_pricing_rule):
			return

		rule = frappe.new_doc("Pricing Rule")
		rule.title = f"Promo {self.discount_percentage}% - {self.item_name}"
		rule.apply_on = "Item Code"
		rule.price_or_product_discount = "Price"
		rule.rate_or_discount = "Discount Percentage"
		rule.discount_percentage = self.discount_percentage
		rule.selling = 1
		rule.for_price_list = "Standard Selling"
		rule.company = self.company

		for row in self.items:
			if row.generated_item_code:
				rule.append("items", {"item_code": row.generated_item_code})

		rule.flags.ignore_permissions = True
		rule.insert()
		rule.submit()
		self.db_set("pricing_rule", rule.name)

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

		if self.pricing_rule:
			pr = frappe.get_doc("Pricing Rule", self.pricing_rule)
			if pr.docstatus == 1:
				pr.flags.ignore_permissions = True
				pr.cancel()
