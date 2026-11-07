# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and Contributors
# See license.txt

"""Native accounting integration; run only on a migrated, disposable test site.

Unlike the old tests this suite never names a business company or creates employee
payments. It uses ERPNext's _Test Company fixtures and native GL validation.
"""

import unittest
from uuid import uuid4

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import today

from erpnext.accounts.expense_services import commands

class TestQuickExpense(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		if not getattr(frappe.local, "site", None) or not frappe.conf.get("allow_tests"):
			raise unittest.SkipTest("A disposable test site with allow_tests enabled is required")
		from erpnext.accounts.expense_services.native_test_support import ensure_test_company
		ensure_test_company()
		super().setUpClass()

	def setUp(self):
		self.previous_user = frappe.session.user
		frappe.set_user("Administrator")
		self.addCleanup(frappe.set_user, self.previous_user)
		frappe.db.savepoint("quick_expense_test")
		self.addCleanup(lambda: frappe.db.rollback(save_point="quick_expense_test"))
		self.company = "_Test Company"
		if not frappe.db.exists("Company", self.company):
			self.skipTest("Load native Company and Fiscal Year test dependencies first")
		suffix = uuid4().hex[:8]
		self.cash_account = self.account(f"_Test Expense Safe {suffix}", "Cash In Hand - _TC", "Cash")
		self.expense_account = self.account(f"_Test Taxi Expense {suffix}", "Indirect Expenses - _TC")
		self.category = frappe.get_doc(dict(doctype="Quick Expense Category", category_name=f"_Test Taxi {suffix}",
			company_accounts=[dict(company=self.company, expense_account=self.expense_account)])).insert()
		frappe.get_doc(dict(doctype="Money Wallet", wallet_name=f"_Test Expense Safe {suffix}",
			wallet_type="Safe", company=self.company, enabled=1, account=self.cash_account,
			accept_in_pos=0, allow_desk_expenses=1)).insert()
		self.payload = dict(company=self.company, expense_category=self.category.name, amount=50,
			paid_from=self.cash_account, posting_date=today(), entry_context="Desk", client_request_id=uuid4().hex)

	def account(self, name, parent, account_type=None):
		return frappe.get_doc(dict(doctype="Account", account_name=name, parent_account=parent,
			company=self.company, is_group=0, account_type=account_type)).insert().name

	def test_native_journal_and_gl_are_created_once_and_cancel_together(self):
		first = commands.record(self.payload)
		retry = commands.record(self.payload)
		self.assertEqual(first["name"], retry["name"])
		je = frappe.get_doc("Journal Entry", first["journal_entry"])
		self.assertEqual(je.docstatus, 1)
		self.assertEqual(je.total_debit, 50)
		self.assertEqual(je.total_credit, 50)
		gl = frappe.get_all("GL Entry", filters=dict(voucher_type="Journal Entry", voucher_no=je.name, is_cancelled=0),
			fields=["account", "debit", "credit"])
		self.assertEqual(sum(row.credit for row in gl if row.account == self.cash_account), 50)
		self.assertEqual(sum(row.debit for row in gl if row.account == self.expense_account), 50)
		doc = frappe.get_doc("Quick Expense", first["name"])
		commands.cancel(doc.name, "Duplicate taxi receipt", str(doc.modified), uuid4().hex)
		self.assertEqual(frappe.get_doc("Journal Entry", je.name).docstatus, 2)
		self.assertEqual(frappe.get_doc("Quick Expense", doc.name).docstatus, 2)

	def test_party_payments_are_rejected_without_generated_financial_documents(self):
		for party_type in ("Employee", "Supplier"):
			with self.assertRaises(frappe.ValidationError):
				commands.record(dict(self.payload, client_request_id=uuid4().hex, party_type=party_type, party="Native workflow required"))
		self.assertFalse(frappe.db.exists("Quick Expense", {"client_request_id": self.payload["client_request_id"]}))

	def test_native_account_validation_is_not_bypassed(self):
		# A disabled source must fail before posting, with no expense persisted.
		frappe.db.set_value("Account", self.cash_account, "disabled", 1)
		frappe.clear_document_cache("Account", self.cash_account)
		with self.assertRaises(frappe.PermissionError):
			commands.record(self.payload)
		self.assertFalse(frappe.db.exists("Quick Expense", {"client_request_id": self.payload["client_request_id"]}))
