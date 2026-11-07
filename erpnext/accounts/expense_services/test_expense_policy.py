"""Database-free permission/policy regressions. No business site is connected."""

import unittest
from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import Mock, patch

import frappe

from erpnext.accounts.doctype.quick_expense import quick_expense as controller
from erpnext.accounts.doctype.quick_expense.quick_expense import QuickExpense
from erpnext.accounts.expense_services import policy


def expense(**values):
	# Use the real controller with only metadata loading isolated.
	doc = object.__new__(QuickExpense)
	fields = ("name company posting_date expense_category amount paid_from expense_account cost_center bill_no "
		"pos_profile pos_opening_shift entry_context correction_reason created_from_pos party_type party "
		"receipt_attachment journal_entry payment_entry purchase_invoice amended_from owner "
		"client_request_id request_fingerprint cancellation_request_id cancellation_fingerprint "
		"cancellation_reason cancelled_by mode_of_payment description beneficiary_name").split()
	doc.__dict__.update({key: None for key in fields})
	doc.__dict__.update(dict(doctype="Quick Expense", docstatus=0, flags=frappe._dict(), _doc_before_save=None,
		company="Test", posting_date="2026-11-05", expense_category="Taxi", amount=50,
		paid_from="Safe", entry_context="Desk", owner="cashier"))
	doc.__dict__.update(values)
	return doc


class PolicyFixture(unittest.TestCase):
	def setUp(self):
		self.stack = ExitStack()
		self.addCleanup(self.stack.close)
		self.f = Mock()
		self.f._dict = frappe._dict
		for key in ("PermissionError", "ValidationError", "DoesNotExistError"):
			setattr(self.f, key, getattr(frappe, key))
		self.f.session.user = "cashier"
		self.roles = ["Retail Manager"]
		self.f.get_roles.side_effect = lambda user=None: self.roles
		self.f.has_permission.return_value = True
		self.f.throw.side_effect = lambda message, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(message))
		self.records = {
			("Account", "Safe"): frappe._dict(name="Safe", company="Test", is_group=0, disabled=0, account_type="Cash", account_currency="TJS"),
			("Account", "Till"): frappe._dict(name="Till", company="Test", is_group=0, disabled=0, account_type="Cash", account_currency="TJS"),
			("Account", "Taxi Expense"): frappe._dict(name="Taxi Expense", company="Test", is_group=0, disabled=0, root_type="Expense", account_currency="TJS"),
			("Quick Expense Category", "Taxi"): frappe._dict(default_account="Taxi Expense", company_accounts=[]),
			("Money Wallet", "Office"): frappe._dict(name="Office", wallet_name="Office", wallet_type="Safe", company="Test", enabled=1, account="Safe", allow_desk_expenses=1, expense_profiles=[], accept_in_pos=0, pos_profile=None, mode_of_payment=None),
		}
		self.f.get_cached_doc.side_effect = lambda dt, name: self.records[(dt, name)]
		self.f.db.exists.return_value = True
		self.f.db.sql.return_value = []
		self.f.get_all.return_value = [frappe._dict(name="Office")]
		self.f.get_hooks.return_value = []
		def cached(dt, name, field):
			if dt == "Company":
				return {"default_currency": "TJS", "cost_center": None}.get(field)
			return self.records[(dt, name)].get(field)
		self.f.get_cached_value.side_effect = cached
		self.stack.enter_context(patch.object(policy, "frappe", self.f))
		self.stack.enter_context(patch.object(controller, "frappe", self.f))
		self.stack.enter_context(patch.object(controller, "_", lambda text: text))
		self.stack.enter_context(patch.object(policy, "_", lambda text: text))
		self.stack.enter_context(patch.object(policy, "get_user_permissions", return_value={}))
		self.user_scope = self.stack.enter_context(patch.object(policy, "has_user_permission", return_value=True))
		self.stack.enter_context(patch.object(policy, "currency_precision", return_value=2))
		self.stack.enter_context(patch.object(policy, "today", return_value="2026-11-05"))

	def test_nonfinite_negative_and_excess_precision_fail(self):
		for value in [None, "nan", "NaN", "inf", "-inf", 0, -1, "abc", "50.001"]:
			with self.subTest(value=value), self.assertRaises(frappe.ValidationError):
				policy.positive_amount(value)
		self.assertEqual(policy.positive_amount("50.10"), Decimal("50.10"))
		self.assertEqual(policy.positive_amount("50.001", 3), Decimal("50.001"))

	def test_office_expense_uses_explicit_category_and_source(self):
		doc = expense()
		doc.validate()
		self.assertEqual(doc.expense_account, "Taxi Expense")
		self.assertEqual(doc.entry_context, "Desk")
		self.assertEqual(doc.created_from_pos, 0)

	def test_receipt_requires_native_file_read_permission(self):
		self.f.has_permission.side_effect = lambda dt, *args, **kwargs: dt != "File"
		with self.assertRaises(frappe.PermissionError):
			policy.validate_expense(expense(receipt_attachment="/private/files/other-person.jpg"))
		self.f.has_permission.side_effect = None
		self.f.has_permission.return_value = True
		policy.validate_expense(expense(receipt_attachment="/private/files/own-receipt.jpg"))

	def test_receipt_permission_does_not_authorize_spending(self):
		wallet = self.records[("Money Wallet", "Office")]
		wallet.allow_desk_expenses = 0
		wallet.accept_in_pos = 1
		self.assertEqual(policy.get_sources(policy.get_context("Test")), [])
		with self.assertRaises(frappe.PermissionError):
			expense().validate()

	def test_pos_receipt_account_cannot_be_office_source(self):
		self.f.db.sql.return_value = [("Register",)]
		self.assertEqual(policy.get_sources(policy.get_context("Test")), [])

	def test_cashier_profile_spoof_does_not_grant_desk_access(self):
		self.roles = ["Retail Cashier", "Sales User"]
		with self.assertRaises(frappe.PermissionError):
			policy.get_context("Test")
		with self.assertRaises(frappe.ValidationError):
			policy.get_context("Test", "Other Register", "Other Shift")

	def test_pos_validator_unavailable_fails_closed(self):
		with self.assertRaises(frappe.ValidationError):
			policy.get_context("Test", "Register", "Shift")

	def test_manager_correction_is_explicit_and_reasoned(self):
		self.f.get_hooks.return_value = ["validator"]
		self.f.get_attr.return_value.return_value = dict(pos_profile="Register", pos_opening_shift="Shift", source_accounts=["Till"])
		with self.assertRaises(frappe.ValidationError):
			policy.get_context("Test", "Register", "Shift", "POS Correction")
		context = policy.get_context("Test", "Register", "Shift", "POS Correction", "Forgotten taxi")
		self.assertEqual(context.entry_context, "POS Correction")
		self.roles = ["Retail Cashier"]
		with self.assertRaises(frappe.PermissionError):
			policy.get_context("Test", "Register", "Shift", "POS Correction", "Fake approval")

	def test_company_and_account_user_permissions_apply(self):
		self.f.has_permission.return_value = False
		with self.assertRaises(frappe.PermissionError):
			policy.get_context("Other Company")
		self.f.has_permission.return_value = True
		self.user_scope.return_value = False
		with self.assertRaises(frappe.PermissionError):
			policy.validate_account("Safe", "Test")

	def test_disabled_group_crosscompany_and_foreign_accounts_fail(self):
		for key, value in [("disabled", 1), ("is_group", 1), ("company", "Other"), ("account_currency", "USD"), ("account_type", "Receivable")]:
			with self.subTest(key=key):
				account = self.records[("Account", "Safe")]
				old = account[key]
				account[key] = value
				with self.assertRaises(frappe.ValidationError):
					policy.validate_account("Safe", "Test")
				account[key] = old

	def test_category_company_mapping_wins_over_legacy_default(self):
		category = self.records[("Quick Expense Category", "Taxi")]
		category.default_account = "Missing Account"
		category.company_accounts = [frappe._dict(company="Test", expense_account="Taxi Expense", cost_center=None)]
		self.assertEqual(policy.category_mapping("Taxi", "Test").expense_account, "Taxi Expense")

	def test_missing_category_mapping_never_guesses(self):
		self.records[("Quick Expense Category", "Taxi")].default_account = None
		with self.assertRaises(frappe.ValidationError):
			expense().validate()
		self.f.db.get_value.assert_not_called()

	def test_supplied_expense_account_cannot_bypass_category(self):
		with self.assertRaises(frappe.ValidationError):
			expense(expense_account="Other Expense").validate()

	def test_employee_and_supplier_payments_use_native_handoff(self):
		for party_type in ("Employee", "Supplier"):
			with self.subTest(party_type=party_type), self.assertRaises(frappe.ValidationError):
				expense(party_type=party_type, party="Someone").validate()
		expense(beneficiary_name="Someone").validate()

	def test_generated_links_cannot_be_injected(self):
		for field in ("journal_entry", "payment_entry", "purchase_invoice", "cancelled_by", "cancellation_request_id"):
			with self.subTest(field=field), self.assertRaises(frappe.ValidationError):
				expense(**{field: "Existing Document"}).validate()

	def test_cashier_cannot_cancel_even_own_expense(self):
		self.roles = ["Retail Cashier"]
		with self.assertRaises(frappe.PermissionError):
			expense().before_cancel()

	def test_submitted_history_cannot_be_edited_or_deleted(self):
		with self.assertRaises(frappe.ValidationError):
			expense(docstatus=1).before_update_after_submit()
		with self.assertRaises(frappe.ValidationError):
			expense(docstatus=2).on_trash()

	def test_office_source_discovery_exposes_no_balances(self):
		sources = policy.get_sources(policy.get_context("Test"))
		self.assertEqual(sources[0]["account"], "Safe")
		self.assertNotIn("balance", sources[0])

	def test_profile_sources_require_both_explicit_permission_and_register_membership(self):
		wallet = self.records[("Money Wallet", "Office")]
		wallet.expense_profiles = [frappe._dict(pos_profile="Register")]
		context = frappe._dict(company="Test", entry_context="POS", pos_profile="Register", source_accounts=["Safe"])
		self.assertEqual(len(policy.get_sources(context)), 1)
		context.pos_profile = "Another Register"
		self.assertEqual(policy.get_sources(context), [])
		context.pos_profile = "Register"
		context.source_accounts = ["Till"]
		self.assertEqual(policy.get_sources(context), [])

	def test_alias_wallets_produce_one_source(self):
		other = frappe._dict(self.records[("Money Wallet", "Office")], name="Alias")
		self.records[("Money Wallet", "Alias")] = other
		self.f.get_all.return_value.append(frappe._dict(name="Alias"))
		self.assertEqual(len(policy.get_sources(policy.get_context("Test"))), 1)

	def test_permission_hook_denies_direct_read_outside_scope(self):
		self.f.has_permission.return_value = False
		self.assertFalse(policy.has_permission(expense(), "read"))

	def test_cashier_query_scope_uses_stored_shift_owner(self):
		self.roles = ["Retail Cashier"]
		self.f.get_hooks.return_value = ["adapter"]
		self.f.db.escape.return_value = "'cashier'"
		condition = policy.permission_query_conditions()
		self.assertIn("s.user = 'cashier'", condition)
		self.assertIn("s.docstatus = 1", condition)
		self.assertIn("POS Profile User", condition)

	def test_native_journal_construction_uses_expense_and_real_funding_legs(self):
		doc = expense(name="EXP-1", expense_account="Taxi Expense", beneficiary_name="Staff member")
		journal = Mock()
		journal.flags = frappe._dict()
		self.f.new_doc.return_value = journal
		self.f.get_cached_value.side_effect = lambda dt, name, field: "Bank" if field == "account_type" else "TJS"
		doc.db_set = Mock()
		doc.on_submit()
		self.assertEqual(journal.voucher_type, "Bank Entry")
		legs = [call.args[1] for call in journal.append.call_args_list]
		self.assertEqual(legs[0]["account"], "Taxi Expense")
		self.assertEqual(legs[0]["debit_in_account_currency"], 50)
		self.assertEqual(legs[1]["account"], "Safe")
		self.assertEqual(legs[1]["credit_in_account_currency"], 50)
		self.assertNotIn("party_type", legs[0])
		self.assertNotIn("ignore_mandatory", journal.flags)
		journal.insert.assert_called_once()
		journal.submit.assert_called_once()

	def test_cancellation_preserves_legacy_employee_supplier_posting_links(self):
		doc = expense(journal_entry="JE-1", payment_entry="PE-1", purchase_invoice="PI-1")
		generated = {key: Mock(docstatus=1) for key in ("JE-1", "PE-1", "PI-1")}
		self.f.get_doc.side_effect = lambda dt, name: generated[name]
		doc.on_cancel()
		for backing in generated.values():
			backing.cancel.assert_called_once()

	def test_native_cancel_cannot_replace_the_journal_link(self):
		original = expense(name="EXP-1", docstatus=1, journal_entry="JE-ORIGINAL")
		self.f.get_doc.return_value = original
		doc = expense(name="EXP-1", docstatus=2, journal_entry="JE-VICTIM", cancellation_reason="Fraudulent replacement")
		with self.assertRaises(frappe.ValidationError):
			doc.before_cancel()

	def test_native_cancel_requires_reason(self):
		original = expense(name="EXP-1", docstatus=1)
		self.f.get_doc.return_value = original
		with self.assertRaises(frappe.ValidationError):
			expense(name="EXP-1", docstatus=2).before_cancel()

	def test_expense_specific_account_user_permission_filters_sources(self):
		with patch.object(policy, "get_user_permissions", return_value={
			"Account": [frappe._dict(doc="Till", applicable_for="Quick Expense")]
		}):
			self.assertEqual(policy.get_sources(policy.get_context("Test")), [])

	def test_unmigrated_site_fails_with_setup_message(self):
		self.f.get_meta.return_value.has_field.return_value = False
		with self.assertRaisesRegex(frappe.ValidationError, "site migration"):
			policy.get_context("Test")

	def test_native_cancel_accepts_equivalent_serialized_date_amount_and_empty_values(self):
		from datetime import date
		original = expense(name="EXP-1", docstatus=1, posting_date=date(2026, 11, 5), amount=50.0)
		self.f.get_doc.return_value = original
		doc = expense(name="EXP-1", docstatus=2, posting_date="2026-11-05", amount="50", cancellation_reason="Duplicate receipt", description="")
		doc.before_cancel()
		self.assertEqual(doc.cancelled_by, "cashier")

	def test_direct_native_write_cannot_forge_service_request_fingerprint(self):
		doc = expense(client_request_id="forged-request", request_fingerprint="forged-hash")
		doc.flags._expense_service = True
		with self.assertRaises(frappe.ValidationError):
			doc.validate()
		doc.flags._expense_service = policy._SERVICE_REQUEST
		doc.validate()

	def test_explicit_register_mobile_wallet_can_pay_in_company_currency(self):
		self.records[("Account", "Alif")] = frappe._dict(name="Alif", company="Test", is_group=0, disabled=0,
			account_type="Bank", account_currency="TJS")
		self.records[("Mode of Payment", "Alif")] = frappe._dict(enabled=1)
		wallet = self.records[("Money Wallet", "Office")]
		wallet.account = "Alif"
		wallet.wallet_type = "Mobile Wallet"
		wallet.mode_of_payment = "Alif"
		wallet.expense_profiles = [frappe._dict(pos_profile="Register")]
		self.f.db.get_value.return_value = "Alif"
		sources = policy.get_sources(frappe._dict(company="Test", entry_context="POS", pos_profile="Register", source_accounts=["Alif"]))
		self.assertEqual(sources[0]["account_type"], "Bank")
		self.assertEqual(sources[0]["source_type"], "Mobile Wallet")
