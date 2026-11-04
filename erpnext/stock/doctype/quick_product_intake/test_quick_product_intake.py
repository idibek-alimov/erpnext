# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, getdate, today

from erpnext.buying.page.supplier_detail.detail_data import invoice_rows
from erpnext.buying.page.supplier_hub.supplier_data import load_supplier_context

test_dependencies = ["Company", "Price List", "Item Attribute"]


class TestQuickProductIntake(FrappeTestCase):
	def setUp(self):
		self.company = "_Test Company"
		# Keep this company-currency workflow independent of online exchange services.
		for price_list in ("Standard Buying", "Standard Selling"):
			frappe.db.set_value("Price List", price_list, "currency", "INR")
			frappe.clear_document_cache("Price List", price_list)
		frappe.get_single("Accounts Settings").save()
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

	def tearDown(self):
		frappe.db.rollback()

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

		# Test Cancel
		doc.cancel()
		pi.reload()
		self.assertEqual(pi.docstatus, 2)

	def test_standalone_item_intake_with_supplier(self):
		doc = frappe.get_doc({
			"doctype": "Quick Product Intake",
			"item_name": "Leather Cardholder",
			"item_group": "Products",
			"company": self.company,
			"target_warehouse": self.warehouse,
			"supplier": self.supplier_name,
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

		self.assertTrue(doc.purchase_invoice)
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertEqual(invoice.docstatus, 1)
		self.assertEqual(invoice.update_stock, 1)
		self.assertEqual(invoice.supplier, self.supplier_name)

		# Test Cancel
		doc.cancel()
		invoice.reload()
		self.assertEqual(invoice.docstatus, 2)

	def intake(self, **values):
		data = dict(doctype="Quick Product Intake", item_name="QPI " + frappe.generate_hash(length=8),
			item_group="Products", company=self.company, target_warehouse=self.warehouse,
			supplier=self.supplier_name, buying_price=50, selling_price=100, has_variants=0,
			posting_date=add_days(today(), -2), items=[dict(qty=2)])
		data.update(values)
		return frappe.get_doc(data)

	def supplier_context(self):
		context = load_supplier_context(self.company, "today", supplier=self.supplier_name)
		context["currency"] = frappe.get_cached_value("Company", self.company, "default_currency")
		return context

	def test_no_deadline_is_unpaid_not_overdue_and_stock_reconciles(self):
		doc = self.intake().insert()
		doc.submit()
		doc.reload()
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertTrue(invoice.payment_deadline_not_agreed)
		self.assertIsNone(invoice.due_date)
		self.assertEqual(invoice.payment_schedule, [])
		self.assertEqual(invoice.status, "Unpaid")
		from erpnext.controllers.accounts_controller import update_invoice_status
		update_invoice_status()
		self.assertEqual(frappe.db.get_value("Purchase Invoice", invoice.name, "status"), "Unpaid")
		self.assertEqual(flt(invoice.outstanding_amount), 100)
		self.assertEqual(getdate(invoice.posting_date), getdate(doc.posting_date))
		context = self.supplier_context()
		row = next(r for r in invoice_rows(context) if r["name"] == invoice.name)
		self.assertEqual((row["outstanding"], row["days_overdue"], row["due_date"]), (100, 0, None))
		self.assertEqual(context["rows"][0]["overdue"], 0)
		self.assertEqual(context["rows"][0]["stock_value"], 100)
		from erpnext.accounts.report.accounts_receivable.accounts_receivable import ReceivablePayableReport
		report = ReceivablePayableReport(dict(company=self.company, party_type="Supplier", party=[self.supplier_name],
			ageing_based_on="Due Date", based_on_payment_terms=1))
		rows = report.run(dict(account_type="Payable", naming_by=["Buying Settings", "supp_master_name"]))[1]
		row = next(r for r in rows if r.voucher_no == invoice.name)
		self.assertEqual((flt(row.outstanding), flt(row.total_due)), (100, 0))

	def test_explicit_deadline_reaches_native_schedule_and_supplier_overdue(self):
		doc = self.intake(due_date=add_days(today(), -1), bill_no="SUPPLIER-123").insert()
		doc.submit()
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertFalse(invoice.payment_deadline_not_agreed)
		self.assertEqual(invoice.bill_no, "SUPPLIER-123")
		self.assertEqual(getdate(invoice.payment_schedule[0].due_date), getdate(doc.due_date))
		self.assertEqual(invoice.status, "Overdue")
		self.assertEqual(self.supplier_context()["rows"][0]["overdue"], 100)

	def test_zero_stock_variants_keep_supplier_without_invoice_or_debt(self):
		doc = self.intake(has_variants=1, items=[dict(size="M", qty=0), dict(size="L", qty=0)]).insert()
		doc.submit()
		doc.reload()
		self.assertFalse(doc.purchase_invoice)
		self.assertFalse(doc.payment_entry)
		context = self.supplier_context()
		self.assertEqual(context["rows"][0]["current_debt"], 0)
		self.assertEqual(context["links"][self.supplier_name], {r.generated_item_code for r in doc.items})
		for code in [doc.template_item] + [r.generated_item_code for r in doc.items]:
			self.assertEqual(frappe.db.get_value("Item Default", {"parent": code, "company": self.company}, "default_supplier"), self.supplier_name)

	def test_partial_and_full_payments_and_cancellation(self):
		account = frappe.db.get_value("Account", {"company": self.company, "account_type": "Cash", "is_group": 0}, "name")
		for amount in (40, 100):
			with self.subTest(amount=amount):
				doc = self.intake(payment_amount=amount, payment_account=account, payment_date=today()).insert()
				doc.submit()
				doc.reload()
				invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
				payment = frappe.get_doc("Payment Entry", doc.payment_entry)
				self.assertEqual(flt(invoice.outstanding_amount), 100 - amount)
				self.assertEqual(payment.references[0].reference_name, invoice.name)
				self.assertEqual(flt(payment.references[0].allocated_amount), amount)
				self.assertEqual(invoice.status, "Paid" if amount == 100 else "Partly Paid")
				balances = self.supplier_context()["rows"][0]
				self.assertEqual((balances["current_debt"], balances["stock_value"]), (100 - amount, 100))
				doc.cancel()
				self.assertEqual(frappe.db.get_value("Payment Entry", payment.name, "docstatus"), 2)
				self.assertEqual(frappe.db.get_value("Purchase Invoice", invoice.name, "docstatus"), 2)

	def test_invalid_quantities_prices_and_payments_are_rejected(self):
		for values in (dict(items=[dict(qty=-1)]), dict(items=[dict(qty=2, buying_price=-1)]),
			dict(payment_amount=101), dict(payment_amount=-1), dict(items=[dict(qty=0)], payment_amount=1),
			dict(has_variants=0, items=[dict(qty=1), dict(qty=1)]),
			dict(has_variants=1, items=[dict(size="M", qty=1), dict(size="m", qty=1)])):
			with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
				self.intake(**values).insert()

	def test_product_detail_uses_company_supplier_even_with_no_stock(self):
		from erpnext.stock.page.product_detail.product_detail import get_product_detail

		doc = self.intake(items=[dict(qty=0)]).insert()
		doc.submit()
		product = get_product_detail(doc.template_item, company=self.company)
		self.assertEqual(product["supplier"], self.supplier_name)
		self.assertEqual(product["company_name"], self.company)

	def test_price_lists_must_use_the_company_currency(self):
		frappe.db.set_value("Price List", "Standard Buying", "currency", "USD")
		frappe.clear_document_cache("Price List", "Standard Buying")
		with self.assertRaises(frappe.ValidationError):
			self.intake().insert()

	def test_product_supplier_fallback_uses_permitted_company_invoices(self):
		from erpnext.stock.page.product_detail.product_detail import get_supplier

		doc = self.intake().insert()
		doc.submit()
		frappe.db.set_value("Item Default", {"parent": doc.template_item}, "default_supplier", None)
		self.assertEqual(get_supplier(doc.template_item, [doc.template_item], self.company), self.supplier_name)
		self.assertEqual(get_supplier(doc.template_item, [doc.template_item], "_Test Company 1"), "")
		original = frappe.has_permission
		def permission(doctype, ptype="read", *args, **kwargs):
			return False if doctype == "Purchase Invoice" else original(doctype, ptype, *args, **kwargs)
		with patch("frappe.has_permission", side_effect=permission):
			self.assertEqual(get_supplier(doc.template_item, [doc.template_item], self.company), "")

	def test_defaults_only_suggest_a_deadline_when_terms_exist(self):
		from erpnext.stock.doctype.quick_product_intake.quick_product_intake import get_intake_defaults
		from erpnext.accounts.party import get_payment_terms_template
		with patch("erpnext.accounts.party.get_payment_terms_template", return_value=None):
			self.assertIsNone(get_intake_defaults(self.company, self.supplier_name)["due_date"])
		with patch("erpnext.accounts.party.get_payment_terms_template", return_value="TERMS"), patch(
			"erpnext.accounts.party.get_due_date", return_value="2026-12-01"):
			self.assertEqual(get_intake_defaults(self.company, self.supplier_name)["due_date"], "2026-12-01")

	def test_invoice_creation_permission_is_checked_before_product_creation(self):
		doc = self.intake().insert()
		original = frappe.has_permission
		def permission(doctype, ptype="read", *args, **kwargs):
			if doctype == "Purchase Invoice" and ptype == "create":
				raise frappe.PermissionError
			return original(doctype, ptype, *args, **kwargs)
		with patch("frappe.has_permission", side_effect=permission), self.assertRaises(frappe.PermissionError):
			doc.submit()
		self.assertFalse(doc.template_item)
		self.assertFalse(doc.purchase_invoice)
