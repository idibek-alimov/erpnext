# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, flt, getdate, today

from erpnext.controllers.item_variant import create_variant
from erpnext.stock.doctype.quick_product_restock.quick_product_restock import (
	current_prices,
	get_product_by_code,
	get_product_template_info,
	get_restock_defaults,
	search_products,
	set_item_price,
)

test_dependencies = ["Company", "Price List", "Item Attribute", "Item Group", "UOM"]


class TestQuickProductRestock(FrappeTestCase):
	def setUp(self):
		frappe.set_user("Administrator")
		self.company = "_Test Company"
		for price_list in ("Standard Buying", "Standard Selling"):
			if not frappe.db.exists("Price List", price_list):
				frappe.get_doc(dict(doctype="Price List", price_list_name=price_list, currency="INR", enabled=1,
					buying=price_list == "Standard Buying", selling=price_list == "Standard Selling")).insert()
			else:
				frappe.db.set_value("Price List", price_list, "currency", "INR")
			frappe.clear_document_cache("Price List", price_list)
		frappe.get_single("Accounts Settings").save()
		warehouses = frappe.get_all("Warehouse", filters={"company": self.company, "is_group": 0, "disabled": 0},
			pluck="name", order_by="name")
		self.warehouse, self.other_warehouse = warehouses[:2]
		self.supplier = frappe.get_doc(dict(doctype="Supplier", supplier_name="QPR " + frappe.generate_hash(length=8),
			supplier_group="All Supplier Groups")).insert().name
		for name, values in (("QPR Color", ["Red", "Blue"]), ("QPR Size", ["M", "L"])):
			if not frappe.db.exists("Item Attribute", name):
				frappe.get_doc(dict(doctype="Item Attribute", attribute_name=name,
					item_attribute_values=[dict(attribute_value=v, abbr=v) for v in values])).insert()
		self.template = frappe.get_doc(dict(doctype="Item", item_code="QPR-" + frappe.generate_hash(length=10),
			item_name="Restock test shirt", item_group="_Test Item Group", stock_uom="_Test UOM", is_stock_item=1,
			has_variants=1, attributes=[dict(attribute="QPR Color"), dict(attribute="QPR Size")],
			item_defaults=[dict(company=self.company, default_supplier=self.supplier)])).insert()
		self.variant = create_variant(self.template.name, {"QPR Color": "Red", "QPR Size": "M"}).insert()
		set_item_price(self.variant.name, "Standard Buying", 50, "INR")
		set_item_price(self.variant.name, "Standard Selling", 100, "INR")

	def tearDown(self):
		frappe.set_user("Administrator")
		frappe.db.rollback()

	def restock(self, **values):
		data = dict(doctype="Quick Product Restock", item=self.template.name, company=self.company,
			target_warehouse=self.warehouse, supplier=self.supplier, posting_date=today(),
			items=[dict(item_code=self.variant.name, qty=2, buying_price=50, old_selling_price=100, selling_price=100)])
		data.update(values)
		return frappe.get_doc(data)

	def test_receipt_reconciles_stock_invoice_and_open_ended_debt(self):
		doc = self.restock().insert()
		doc.submit()
		doc.reload()
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertEqual((flt(doc.total_qty), flt(doc.purchase_total), flt(doc.remaining_debt)), (2, 100, 100))
		self.assertEqual((flt(invoice.grand_total), flt(invoice.outstanding_amount)), (100, 100))
		self.assertEqual(invoice.items[0].stock_uom, self.variant.stock_uom)
		self.assertEqual(flt(invoice.items[0].conversion_factor), 1)
		self.assertTrue(invoice.payment_deadline_not_agreed)
		self.assertIsNone(invoice.due_date)
		self.assertEqual(invoice.payment_schedule, [])
		self.assertEqual(invoice.status, "Unpaid")
		ledger = frappe.get_all("Stock Ledger Entry", filters={"voucher_no": invoice.name, "is_cancelled": 0},
			fields=["actual_qty", "stock_value_difference", "warehouse"])
		self.assertEqual(sum(flt(r.actual_qty) for r in ledger), 2)
		self.assertEqual(sum(flt(r.stock_value_difference) for r in ledger), 100)
		self.assertEqual({r.warehouse for r in ledger}, {self.warehouse})

	def test_partial_full_payment_and_cancel_keep_native_allocations(self):
		account = frappe.db.get_value("Account", {"company": self.company, "account_type": "Cash", "is_group": 0}, "name")
		for amount in (40, 100):
			with self.subTest(amount=amount):
				doc = self.restock(payment_amount=amount, payment_account=account, payment_date=today()).insert()
				doc.submit()
				doc.reload()
				invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
				payment = frappe.get_doc("Payment Entry", doc.payment_entry)
				self.assertEqual(flt(invoice.outstanding_amount), 100 - amount)
				self.assertEqual(payment.references[0].reference_name, invoice.name)
				self.assertEqual(flt(payment.references[0].allocated_amount), amount)
				doc.cancel()
				self.assertEqual(frappe.db.get_value("Payment Entry", payment.name, "docstatus"), 2)
				self.assertEqual(frappe.db.get_value("Purchase Invoice", invoice.name, "docstatus"), 2)

	def test_stock_is_scoped_to_selected_receiving_warehouse(self):
		for warehouse, qty in ((self.warehouse, 2), (self.other_warehouse, 3)):
			doc = self.restock(target_warehouse=warehouse,
				items=[dict(item_code=self.variant.name, qty=qty, buying_price=50, selling_price=100)]).insert()
			doc.submit()
		for warehouse, expected in ((self.warehouse, 2), (self.other_warehouse, 3), (None, None)):
			info = get_product_template_info(self.template.name, self.company, warehouse)
			self.assertEqual(info["rows"][0]["current_stock"], expected)
			self.assertEqual(info["supplier"], self.supplier)

	def test_explicit_deadline_reaches_invoice(self):
		deadline = add_days(today(), 7)
		doc = self.restock(due_date=deadline, bill_no="SUPPLIER-QPR").insert()
		doc.submit()
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertFalse(invoice.payment_deadline_not_agreed)
		self.assertEqual(getdate(invoice.due_date), getdate(deadline))
		self.assertEqual(getdate(invoice.payment_schedule[0].due_date), getdate(deadline))
		self.assertEqual(invoice.bill_no, "SUPPLIER-QPR")

	def test_price_only_is_explicit_and_cancel_preserves_published_prices(self):
		rows = [dict(item_code=self.variant.name, qty=0, buying_price=50, selling_price=120)]
		with self.assertRaises(frappe.ValidationError):
			self.restock(items=rows).insert()
		doc = self.restock(items=rows, price_only=1).insert()
		doc.submit()
		doc.reload()
		self.assertFalse(doc.purchase_invoice)
		self.assertFalse(doc.payment_entry)
		self.assertEqual(flt(doc.purchase_total), 0)
		doc.cancel()
		prices = current_prices([self.variant.name], "INR", {self.variant.name: "_Test UOM"})
		self.assertEqual(flt(prices[(self.variant.name, "Standard Selling")].price_list_rate), 120)

	def test_new_variant_receives_in_stock_unit_and_keeps_supplier(self):
		doc = self.restock(items=[dict(color="Blue", size="L", qty=3, buying_price=45, selling_price=100)]).insert()
		doc.submit()
		doc.reload()
		variant = frappe.get_doc("Item", doc.items[0].item_code)
		self.assertEqual(variant.variant_of, self.template.name)
		self.assertEqual(variant.item_defaults[0].default_supplier, self.supplier)
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertEqual((flt(invoice.items[0].stock_qty), flt(invoice.grand_total)), (3, 135))

	def test_wrong_product_rows_duplicates_and_invalid_numbers_are_rejected(self):
		other = frappe.copy_doc(self.template)
		other.item_code = "OTHER-" + frappe.generate_hash(length=8)
		other.has_variants = 0
		other.attributes = []
		other.insert()
		for rows in (
			[dict(item_code=other.name, qty=1, buying_price=50, selling_price=100)],
			[dict(item_code=self.variant.name, qty=-1, buying_price=50, selling_price=100)],
			[dict(item_code=self.variant.name, qty=0.5, buying_price=50, selling_price=100)],
			[dict(item_code=self.variant.name, qty=1, buying_price=-1, selling_price=100)],
			[dict(item_code=self.variant.name, qty=1, buying_price=50, selling_price=0)],
			[dict(item_code=self.variant.name, qty=1, buying_price=50, selling_price=100)] * 2,
			[dict(color="Red", size="M", qty=1, buying_price=50, selling_price=100)],
		):
			with self.subTest(rows=rows), self.assertRaises(frappe.ValidationError):
				self.restock(items=rows).insert()
		for values in (dict(payment_amount=-1), dict(payment_amount=101), dict(price_only=1),
			dict(posting_date=add_days(today(), 1)), dict(payment_amount=1, payment_date=add_days(today(), -1))):
			with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
				self.restock(**values).insert()

	def test_other_company_warehouse_and_price_currency_are_rejected(self):
		warehouse = frappe.db.get_value("Warehouse", {"company": "_Test Company 1", "is_group": 0}, "name")
		with self.assertRaises(frappe.ValidationError):
			get_product_template_info(self.template.name, self.company, warehouse)
		with self.assertRaises(frappe.ValidationError):
			self.restock(target_warehouse=warehouse).insert()
		frappe.db.set_value("Price List", "Standard Selling", "currency", "USD")
		frappe.clear_document_cache("Price List", "Standard Selling")
		with self.assertRaises(frappe.ValidationError):
			self.restock().insert()

	def test_future_and_party_specific_prices_are_not_overwritten(self):
		future = frappe.get_doc(dict(doctype="Item Price", item_code=self.variant.name, price_list="Standard Selling",
			currency="INR", price_list_rate=200, uom="_Test UOM", valid_from=add_days(today(), 5))).insert()
		party = frappe.get_doc(dict(doctype="Item Price", item_code=self.variant.name, price_list="Standard Buying",
			currency="INR", supplier=self.supplier, price_list_rate=25, uom="_Test UOM")).insert()
		set_item_price(self.variant.name, "Standard Selling", 120, "INR")
		set_item_price(self.variant.name, "Standard Buying", 60, "INR")
		self.assertEqual(flt(future.reload().price_list_rate), 200)
		self.assertEqual(flt(party.reload().price_list_rate), 25)
		info = get_product_template_info(self.template.name, self.company, self.warehouse)
		self.assertEqual((info["rows"][0]["buying_price"], info["rows"][0]["selling_price"]), (60, 120))

	def test_partial_name_is_never_resolved_implicitly(self):
		with self.assertRaises(frappe.ValidationError):
			self.restock(item=None, item_name="Restock test").insert()
		self.assertTrue(any(r["item_code"] == self.template.name for r in search_products("Restock test")))

	def test_read_endpoints_require_restock_permission(self):
		frappe.set_user("Guest")
		for call in (lambda: search_products("QPR"), lambda: get_product_by_code(self.template.name),
			lambda: get_product_template_info(self.template.name, self.company, self.warehouse),
			lambda: get_restock_defaults(self.company)):
			with self.assertRaises(frappe.PermissionError):
				call()

	def test_native_invoice_permission_is_checked_before_any_writes(self):
		doc = self.restock(items=[dict(color="Blue", size="L", qty=1, buying_price=45, selling_price=120)]).insert()
		original = frappe.has_permission
		def permission(doctype, ptype="read", *args, **kwargs):
			if doctype == "Purchase Invoice" and ptype == "submit":
				raise frappe.PermissionError
			return original(doctype, ptype, *args, **kwargs)
		with patch("frappe.has_permission", side_effect=permission), self.assertRaises(frappe.PermissionError):
			doc.submit()
		self.assertFalse(doc.items[0].item_code)
		self.assertFalse(doc.purchase_invoice)

	def test_stock_user_cannot_submit_without_native_invoice_permissions(self):
		user = frappe.get_doc(dict(doctype="User", email="qpr-stock@example.com", first_name="Restock Stock User",
			send_welcome_email=0, roles=[dict(role="Stock User")])).insert()
		doc = self.restock().insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			doc.submit()
		frappe.set_user("Administrator")
		self.assertFalse(doc.purchase_invoice)

	def test_defaults_do_not_invent_deadlines(self):
		with patch("erpnext.accounts.party.get_payment_terms_template", return_value=None):
			self.assertIsNone(get_restock_defaults(self.company, self.supplier)["due_date"])

	def test_item_and_warehouse_user_restrictions_are_applied_to_read_endpoints(self):
		user = frappe.get_doc(dict(doctype="User", email="qpr-manager@example.com", first_name="Restock Manager",
			send_welcome_email=0, roles=[dict(role=r) for r in
				("Stock Manager", "Stock User", "Item Manager", "Accounts Manager", "Purchase Master Manager", "Sales Master Manager")])).insert()
		frappe.get_doc(dict(doctype="User Permission", user=user.name, allow="Warehouse", for_value=self.warehouse,
			apply_to_all_doctypes=1)).insert()
		frappe.get_doc(dict(doctype="User Permission", user=user.name, allow="Item", for_value=self.template.name,
			apply_to_all_doctypes=1)).insert()
		frappe.set_user(user.name)
		with self.assertRaises(frappe.PermissionError):
			get_product_template_info(self.template.name, self.company, self.other_warehouse)
		info = get_product_template_info(self.template.name, self.company, self.warehouse)
		self.assertEqual(info["rows"], [])
		self.assertIsNone(get_product_by_code(self.variant.name))

	def test_variant_barcode_resolves_parent_but_disabled_variants_do_not(self):
		self.variant.append("barcodes", dict(barcode="QPR-" + frappe.generate_hash(length=12)))
		self.variant.save()
		barcode = self.variant.barcodes[0].barcode
		self.assertEqual(get_product_by_code(barcode)["item_code"], self.template.name)
		self.variant.disabled = 1
		self.variant.save()
		self.assertIsNone(get_product_by_code(barcode))

	def test_duplicate_and_amend_keep_existing_item_links(self):
		doc = self.restock().insert()
		copy = frappe.copy_doc(doc)
		self.assertEqual(copy.items[0].item_code, self.variant.name)
		copy.insert()
		copy.submit()
		copy.reload()
		self.assertEqual(frappe.get_doc("Purchase Invoice", copy.purchase_invoice).items[0].item_code, self.variant.name)

	def test_receiving_quantity_uses_stock_unit_instead_of_default_purchase_pack(self):
		pack = frappe.get_doc(dict(doctype="UOM", uom_name="QPR Pack")).insert()
		self.variant.append("uoms", dict(uom=pack.name, conversion_factor=12))
		self.variant.purchase_uom = pack.name
		self.variant.save()
		doc = self.restock().insert()
		doc.submit()
		invoice = frappe.get_doc("Purchase Invoice", doc.purchase_invoice)
		self.assertEqual(invoice.items[0].uom, self.variant.stock_uom)
		self.assertEqual(flt(invoice.items[0].stock_qty), 2)
		self.assertEqual(flt(invoice.grand_total), 100)
