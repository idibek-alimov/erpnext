# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase


class TestQuickExpense(FrappeTestCase):
	def setUp(self):
		self.company = "Radolfa"
		self.cash_account = frappe.db.get_value(
			"Account", {"company": self.company, "account_type": "Cash", "is_group": 0}, "name"
		)
		if not self.cash_account:
			self.cash_account = frappe.db.get_value(
				"Account", {"company": self.company, "account_name": "Cash", "is_group": 0}, "name"
			)

		self.supplier_name = "Test Utility Supplier"
		if not frappe.db.exists("Supplier", self.supplier_name):
			supp = frappe.get_doc({
				"doctype": "Supplier",
				"supplier_name": self.supplier_name,
				"supplier_group": "All Supplier Groups",
			})
			supp.insert(ignore_permissions=True)

		self.emp_name = "Test Employee"
		emp = frappe.db.get_value("Employee", {"employee_name": self.emp_name}, "name")
		if not emp:
			emp_doc = frappe.get_doc({
				"doctype": "Employee",
				"first_name": "Test",
				"last_name": "Employee",
				"company": self.company,
				"gender": "Male",
				"status": "Active",
				"date_of_birth": "1990-01-01",
				"date_of_joining": "2026-01-01"
			})
			emp_doc.insert(ignore_permissions=True)
			emp = emp_doc.name
		self.emp = emp

	def test_utility_bill_creates_purchase_invoice_and_payment_entry(self):
		qe = frappe.get_doc({
			"doctype": "Quick Expense",
			"company": self.company,
			"expense_category": "Electricity",
			"amount": 250.0,
			"paid_from": self.cash_account,
			"party_type": "Supplier",
			"party": self.supplier_name,
			"bill_no": "BILL-ELEC-001",
			"description": "August electricity bill"
		})
		qe.insert()
		self.assertTrue(bool(qe.expense_account))

		qe.submit()
		qe.reload()

		self.assertTrue(bool(qe.purchase_invoice))
		self.assertTrue(bool(qe.payment_entry))

		pi = frappe.get_doc("Purchase Invoice", qe.purchase_invoice)
		self.assertEqual(pi.docstatus, 1)
		self.assertEqual(pi.outstanding_amount, 0)

		pe = frappe.get_doc("Payment Entry", qe.payment_entry)
		self.assertEqual(pe.docstatus, 1)
		self.assertEqual(pe.paid_amount, 250.0)

		# Test Cancel rollback
		qe.cancel()
		pi.reload()
		pe.reload()
		self.assertEqual(pi.docstatus, 2)
		self.assertEqual(pe.docstatus, 2)

	def test_staff_bonus_creates_direct_payment_entry(self):
		qe = frappe.get_doc({
			"doctype": "Quick Expense",
			"company": self.company,
			"expense_category": "Staff Bonus",
			"amount": 150.0,
			"paid_from": self.cash_account,
			"party_type": "Employee",
			"party": self.emp,
			"description": "Sales target bonus"
		})
		qe.insert()
		qe.submit()
		qe.reload()

		self.assertTrue(bool(qe.payment_entry))
		self.assertFalse(bool(qe.purchase_invoice))

		pe = frappe.get_doc("Payment Entry", qe.payment_entry)
		self.assertEqual(pe.docstatus, 1)
		self.assertEqual(pe.paid_amount, 150.0)
		self.assertEqual(pe.party_type, "Employee")

		qe.cancel()
		pe.reload()
		self.assertEqual(pe.docstatus, 2)

	def test_petty_cash_store_supplies(self):
		qe = frappe.get_doc({
			"doctype": "Quick Expense",
			"company": self.company,
			"expense_category": "Store & Office Supplies",
			"amount": 75.0,
			"paid_from": self.cash_account,
			"beneficiary_name": "Corner Stationery Store",
			"description": "Tape and pens"
		})
		qe.insert()
		qe.submit()
		qe.reload()

		self.assertTrue(bool(qe.journal_entry))
		je = frappe.get_doc("Journal Entry", qe.journal_entry)
		self.assertEqual(je.docstatus, 1)
		self.assertEqual(je.total_debit, 75.0)

		qe.cancel()
		je.reload()
		self.assertEqual(je.docstatus, 2)


def run_manual_test():
	test_case = TestQuickExpense()
	test_case.setUp()
	print("Running test_utility_bill_creates_purchase_invoice_and_payment_entry...")
	test_case.test_utility_bill_creates_purchase_invoice_and_payment_entry()
	print("✓ PASSED: Utility bill (Purchase Invoice + Payment Entry)")

	print("Running test_staff_bonus_creates_direct_payment_entry...")
	test_case.test_staff_bonus_creates_direct_payment_entry()
	print("✓ PASSED: Staff Bonus (Direct Payment Entry to Employee)")

	print("Running test_petty_cash_store_supplies...")
	test_case.test_petty_cash_store_supplies()
	print("✓ PASSED: Petty Cash (Direct Payment Entry)")
	print("\nALL QUICK EXPENSE TESTS PASSED! 🎉")
