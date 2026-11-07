"""Owner-money native posting/permissions on an upgraded disposable allow_tests site."""
import unittest
from inspect import unwrap
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests.utils import FrappeTestCase

from . import money_hub
from . import owner_money as owner
from .test_money_commands_native import TestMoneyCommandsNative


class TestOwnerMoneyNative(FrappeTestCase):
	setUp = TestMoneyCommandsNative.setUp
	account = TestMoneyCommandsNative.account
	wallet = TestMoneyCommandsNative.wallet
	user = TestMoneyCommandsNative.user

	@classmethod
	def setUpClass(cls):
		if not getattr(frappe.local, "site", None) or not frappe.conf.get("allow_tests"):
			raise unittest.SkipTest("An upgraded disposable allow_tests site is required")
		from erpnext.accounts.expense_services.native_test_support import ensure_test_company
		ensure_test_company()
		for name, abbr in (("_Test Money TJS", "MHT"), ("_Test Money Other", "MHO")):
			if not frappe.db.exists("Company", name):
				frappe.get_doc(dict(doctype="Company", company_name=name, abbr=abbr, country="Tajikistan",
					default_currency="TJS", chart_of_accounts="Standard", create_chart_of_accounts_based_on="Standard Template",
					enable_perpetual_inventory=0)).insert()
		super().setUpClass()

	def configure(self):
		return owner.configure(self.company, create_accounts=True)

	def record(self, operation="contribution", amount=100, key=None, **kwargs):
		return owner.record(self.company, operation, kwargs.pop("wallet", self.source), amount,
			key or uuid4().hex, **kwargs)

	def test_setup_is_explicit_native_and_idempotent(self):
		self.assertFalse(owner.context(self.company)["configured"])
		with self.assertRaises(frappe.ValidationError):
			owner.configure(self.company)
		first = self.configure()
		self.assertEqual(self.configure(), first)
		doc = frappe.get_doc("Owner Money Settings", self.company)
		self.assertEqual(len({doc.contribution_account, doc.withdrawal_account, doc.loan_account}), 3)
		self.assertEqual(frappe.get_doc("Account", doc.loan_account).root_type, "Liability")
		self.assertTrue(owner.context(self.company)["can_record"])

	def test_all_four_operations_use_native_accounts_without_profit_posting(self):
		self.configure()
		for operation, incoming in (("contribution", True), ("withdrawal", False), ("loan_received", True), ("loan_repayment", False)):
			result = self.record(operation)
			je = frappe.get_doc("Journal Entry", result["name"])
			self.assertEqual((je.docstatus, je.total_debit, je.total_credit), (1, 100, 100))
			self.assertEqual(frappe.db.get_value("GL Entry", {"voucher_no": je.name, "account": self.cash, "is_cancelled": 0}, "debit" if incoming else "credit"), 100)
			roots = {frappe.get_cached_value("Account", row.account, "root_type") for row in je.accounts}
			self.assertNotIn("Expense", roots)
			self.assertNotIn("Income", roots)
		self.assertEqual(owner.context(self.company)["loan_balance"], 0)

	def test_loan_balance_partial_repayment_and_overpayment_rejection(self):
		self.configure()
		self.record("loan_received", 150)
		self.record("loan_repayment", 40)
		self.assertEqual(owner.context(self.company)["loan_balance"], 110)
		with self.assertRaises(frappe.ValidationError):
			self.record("loan_repayment", 111)
		self.record("loan_repayment", 110)
		self.assertEqual(owner.context(self.company)["loan_balance"], 0)

	def test_foreign_wallet_uses_native_multi_currency_and_booked_base(self):
		self.configure()
		result = self.record(amount=10, wallet=self.foreign, exchange_rate=11)
		je = frappe.get_doc("Journal Entry", result["name"])
		self.assertEqual((je.multi_currency, je.total_debit, je.total_credit), (1, 110, 110))
		gl = frappe.get_all("GL Entry", filters={"voucher_no": je.name, "account": self.usd, "is_cancelled": 0}, fields=["debit", "debit_in_account_currency", "account_currency"])
		self.assertEqual((gl[0].debit, gl[0].debit_in_account_currency, gl[0].account_currency), (110, 10, "USD"))

	def test_retry_changed_intent_cancellation_and_native_source_retention(self):
		self.configure()
		key = uuid4().hex
		first = self.record(key=key)
		self.assertEqual(self.record(key=key, amount="100.00")["name"], first["name"])
		with self.assertRaises(frappe.PermissionError):
			self.record(key=key, operation="withdrawal")
		frappe.get_doc("Journal Entry", first["name"]).cancel()
		self.assertEqual(self.record(key=key)["status"], "cancelled")
		self.assertEqual(owner.outcome(self.company, key)["status"], "cancelled")
		with self.assertRaises(frappe.LinkExistsError):
			frappe.delete_doc("Journal Entry", first["name"])

	def test_invalid_values_sources_and_unconfigured_posting_fail_closed(self):
		with self.assertRaises(frappe.ValidationError):
			self.record()
		self.configure()
		for kwargs in [dict(amount=0), dict(amount=-1), dict(amount="NaN"), dict(amount="Infinity"), dict(amount="0.001"), dict(exchange_rate=2), dict(wallet=self.foreign), dict(wallet=self.foreign, exchange_rate=-1)]:
			with self.subTest(kwargs=kwargs), self.assertRaises(frappe.ValidationError):
				self.record(**kwargs)
		with self.assertRaises(frappe.ValidationError):
			self.record(operation="expense")
		frappe.db.set_value("Money Wallet", self.source, "company", "_Test Money Other")
		with self.assertRaises(frappe.PermissionError):
			self.record()

	def test_owner_mapping_root_currency_company_and_alias_checks(self):
		self.configure()
		doc = frappe.get_doc("Owner Money Settings", self.company)
		doc.contribution_account = self.cash
		with self.assertRaises(frappe.ValidationError):
			doc.save()
		doc.reload()
		doc.withdrawal_account = doc.contribution_account
		with self.assertRaises(frappe.ValidationError):
			doc.save()
		doc.reload()
		doc.company = "_Test Money Other"
		with self.assertRaises((frappe.PermissionError, frappe.ValidationError)):
			doc.save()

	def test_used_account_mapping_and_configuration_history_cannot_be_deleted(self):
		self.configure()
		self.record()
		doc = frappe.get_doc("Owner Money Settings", self.company)
		doc.contribution_account, doc.withdrawal_account = doc.withdrawal_account, doc.contribution_account
		with self.assertRaises(frappe.ValidationError):
			doc.save()
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc("Owner Money Settings", self.company)

	def test_receipt_cannot_be_forged_edited_or_deleted(self):
		self.configure()
		result = self.record()
		doc = frappe.get_doc("Owner Money Movement", result["request"])
		doc.operation = "withdrawal"
		with self.assertRaises(frappe.PermissionError):
			doc.save()
		with self.assertRaises(frappe.ValidationError):
			frappe.delete_doc("Owner Money Movement", doc.name)

	def test_manager_can_read_context_but_not_post_or_configure(self):
		self.configure()
		self.record("loan_received", 70)
		user = self.user("Retail Manager")
		frappe.set_user(user)
		context = unwrap(money_hub.get_owner_money_context)(self.company)
		self.assertEqual(context["loan_balance"], 70)
		self.assertFalse(context["can_record"])
		self.assertFalse(context["can_configure"])
		with self.assertRaises(frappe.PermissionError):
			self.record()
		with self.assertRaises(frappe.PermissionError):
			self.configure()

	def test_accounting_user_requires_explicit_owner_authority_in_addition_to_native_je(self):
		self.configure()
		user = self.user("Accounts User", "Stock Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			self.record()

	def test_accounts_manager_native_posting_and_revoked_read_scope(self):
		self.configure()
		user = self.user("Accounts Manager")
		frappe.set_user(user)
		key = uuid4().hex
		result = self.record(key=key)
		self.assertEqual(result["docstatus"], 1)
		frappe.set_user("Administrator")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Company", for_value="_Test Money Other", apply_to_all_doctypes=1)).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			owner.outcome(self.company, key)

	def test_other_actor_cannot_reuse_request_or_recover_outcome(self):
		self.configure()
		key = uuid4().hex
		self.record(key=key)
		user = self.user("Accounts Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			self.record(key=key)
		with self.assertRaises(frappe.PermissionError):
			owner.outcome(self.company, key)

	def test_native_submit_failure_rolls_back_receipt_and_journal(self):
		from erpnext.accounts.doctype.journal_entry.journal_entry import JournalEntry
		self.configure()
		key = uuid4().hex
		before = frappe.db.count("Journal Entry")
		with patch.object(JournalEntry, "on_submit", side_effect=frappe.ValidationError("Native failed")):
			with self.assertRaises(frappe.ValidationError):
				self.record(key=key)
		self.assertEqual(frappe.db.count("Journal Entry"), before)
		self.assertFalse(frappe.db.exists("Owner Money Movement", owner.request_name(key)))
		self.assertEqual(self.record(key=key)["status"], "submitted")

	def test_context_cashier_denied_and_getters_never_provision(self):
		before = frappe.db.count("Account")
		owner.context(self.company)
		self.assertEqual(frappe.db.count("Account"), before)
		self.assertFalse(frappe.db.exists("Owner Money Settings", self.company))
		user = self.user("Retail Cashier")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			unwrap(money_hub.get_owner_money_context)(self.company)

	def test_typed_history_labels_and_filters_owner_funds_separately(self):
		self.configure()
		first = self.record()
		self.record("loan_received", 50)
		data = unwrap(money_hub.get_money_movements)(company=self.company, period="all", op_type="owner", wallet=self.source)
		self.assertEqual(data["total_count"], 2)
		self.assertEqual(data["summary"]["debit"], 150)
		self.assertTrue(all(row["op_type"] == "owner" for row in data["rows"]))
		self.assertIn(first["name"], [row["voucher_no"] for row in data["rows"]])

	def test_reimbursement_cannot_be_misrepresented_as_an_owner_operation(self):
		self.configure()
		for operation in ("reimbursement", "salary", "supplier", "tax", "expense"):
			with self.assertRaises(frappe.ValidationError):
				self.record(operation=operation)

	def test_explicit_foreign_rate_one_is_not_replaced_or_downloaded(self):
		self.configure()
		with patch("erpnext.accounts.doctype.journal_entry.journal_entry.get_exchange_rate", side_effect=AssertionError("No rate lookup")):
			result = self.record(wallet=self.foreign, amount=10, exchange_rate=1)
		self.assertEqual(frappe.get_doc("Journal Entry", result["name"]).total_debit, 10)

	def test_optional_loan_mapping_does_not_block_normal_owner_funds(self):
		self.configure()
		doc = frappe.get_doc("Owner Money Settings", self.company)
		doc.loan_account = None
		doc.save()
		self.assertEqual(self.record()["docstatus"], 1)
		self.assertFalse(owner.context(self.company)["loans_enabled"])
		with self.assertRaises(frappe.ValidationError):
			self.record("loan_received")

	def test_disabled_historical_accounts_allow_recovery_but_not_new_posting(self):
		self.configure()
		key = uuid4().hex
		first = self.record(key=key)
		frappe.db.set_value("Money Wallet", self.source, "enabled", 0)
		doc = frappe.get_doc("Owner Money Settings", self.company)
		frappe.db.set_value("Account", doc.contribution_account, "disabled", 1)
		self.assertTrue(owner.context(self.company)["configured"])
		self.assertEqual(self.record(key=key)["name"], first["name"])
		with self.assertRaises(frappe.PermissionError):
			self.record()

	def test_account_read_restrictions_prevent_posting_before_receipt_creation(self):
		self.configure()
		user = self.user("Accounts Manager")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Account", for_value=self.cash, apply_to_all_doctypes=1)).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			self.record()

	def test_full_book_validation_follows_native_posting_authorization(self):
		self.configure()
		with patch.object(owner.commands, "native_permissions", side_effect=frappe.PermissionError("Native submit denied")), patch.object(owner, "_loan_owed_current") as balance:
			with self.assertRaises(frappe.PermissionError):
				self.record("loan_repayment")
			balance.assert_not_called()
