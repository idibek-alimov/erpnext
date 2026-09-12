# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestQuickProductIntake(FrappeTestCase):
	def setUp(self):
		self.company = "Radolfa"
		self.warehouse = frappe.db.get_value(
			"Warehouse",
			{"company": self.company, "is_group": 0, "warehouse_name": ["in", ["Stores", "Finished Goods"]]},
			"name",
		) or frappe.db.get_value(
			"Warehouse",
			{"company": self.company, "is_group": 0},
			"name",
		)

		self.supplier_name = "Test Apparel Supplier"
		if not frappe.db.exists("Supplier", self.supplier_name):
			supp = frappe.get_doc({
				"doctype": "Supplier",
				"supplier_name": self.supplier_name,
				"supplier_group": "All Supplier Groups",
			})
			supp.insert(ignore_permissions=True)

	def test_variant_matrix_intake_with_supplier(self):
		doc = frappe.get_doc({
			"doctype": "Quick Product Intake",
			"item_name": "Premium Cotton Tee",
			"item_group": "Products",
			"company": self.company,
			"target_warehouse": self.warehouse,
			"supplier": self.supplier_name,
			"buying_price": 50.0,
			"selling_price": 120.0,
			"has_variants": 1,
			"discount_percentage": 10.0,
			"create_pricing_rule": 1,
			"items": [
				{"color": "Black", "size": "M", "qty": 5, "buying_price": 50.0, "selling_price": 120.0},
				{"color": "Black", "size": "L", "qty": 5, "buying_price": 50.0, "selling_price": 120.0},
				{"color": "White", "size": "M", "qty": 5, "buying_price": 50.0, "selling_price": 120.0},
				{"color": "White", "size": "L", "qty": 5, "buying_price": 50.0, "selling_price": 120.0},
			]
		})
		doc.insert()
		doc.submit()
		doc.reload()

		# Verify Template Item
		self.assertTrue(bool(doc.template_item))
		template = frappe.get_doc("Item", doc.template_item)
		self.assertEqual(template.has_variants, 1)
		self.assertTrue(bool(template.custom_short_code))

		# Verify Variant Items
		for row in doc.items:
			self.assertTrue(bool(row.generated_item_code))
			self.assertTrue(bool(row.custom_short_code))
			var_item = frappe.get_doc("Item", row.generated_item_code)
			self.assertEqual(var_item.variant_of, template.name)
			self.assertEqual(var_item.custom_short_code, row.custom_short_code)

			# Verify Item Prices
			buying_price = frappe.db.get_value(
				"Item Price", {"item_code": row.generated_item_code, "price_list": "Standard Buying"}, "price_list_rate"
			)
			self.assertEqual(buying_price, 50.0)

			selling_price = frappe.db.get_value(
				"Item Price", {"item_code": row.generated_item_code, "price_list": "Standard Selling"}, "price_list_rate"
			)
			self.assertEqual(selling_price, 120.0)

		# Verify Purchase Invoice
		self.assertTrue(bool(doc.purchase_invoice))
		pi = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertEqual(pi.docstatus, 1)
		self.assertEqual(pi.update_stock, 1)
		self.assertEqual(len(pi.items), 4)

		# Verify Pricing Rule
		self.assertTrue(bool(doc.pricing_rule))
		pr = frappe.get_doc("Pricing Rule", doc.pricing_rule)
		self.assertEqual(pr.docstatus, 1)
		self.assertEqual(pr.discount_percentage, 10.0)

		# Test Cancel
		doc.cancel()
		pi.reload()
		pr.reload()
		self.assertEqual(pi.docstatus, 2)
		self.assertEqual(pr.docstatus, 2)

	def test_standalone_item_intake_without_supplier(self):
		doc = frappe.get_doc({
			"doctype": "Quick Product Intake",
			"item_name": "Leather Cardholder",
			"item_group": "Products",
			"company": self.company,
			"target_warehouse": self.warehouse,
			"buying_price": 40.0,
			"selling_price": 90.0,
			"has_variants": 0,
			"items": [
				{"variant_title": "Leather Cardholder", "qty": 10, "buying_price": 40.0, "selling_price": 90.0}
			]
		})
		doc.insert()
		doc.submit()
		doc.reload()

		row = doc.items[0]
		self.assertTrue(bool(row.generated_item_code))
		self.assertTrue(bool(row.custom_short_code))

		item_doc = frappe.get_doc("Item", row.generated_item_code)
		self.assertEqual(item_doc.has_variants, 0)
		self.assertEqual(item_doc.custom_short_code, row.custom_short_code)

		# Verify Stock Entry
		self.assertTrue(bool(doc.stock_entry))
		se = frappe.get_doc("Stock Entry", doc.stock_entry)
		self.assertEqual(se.docstatus, 1)
		self.assertEqual(se.stock_entry_type, "Material Receipt")

		# Test Cancel
		doc.cancel()
		se.reload()
		self.assertEqual(se.docstatus, 2)


def run_manual_test():
	test_case = TestQuickProductIntake()
	test_case.setUp()
	print("Running test_variant_matrix_intake_with_supplier...")
	test_case.test_variant_matrix_intake_with_supplier()
	print("✓ PASSED: Variant Matrix Intake with Supplier (Purchase Invoice + Pricing + Short codes)")

	print("Running test_standalone_item_intake_without_supplier...")
	test_case.test_standalone_item_intake_without_supplier()
	print("✓ PASSED: Standalone Item Intake without Supplier (Stock Entry Material Receipt)")

	print("\nALL QUICK PRODUCT INTAKE TESTS PASSED! 🎉")
