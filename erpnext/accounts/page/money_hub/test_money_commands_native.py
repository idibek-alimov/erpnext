"""Real permissions, Payment Entries, GL and rollback on an allow_tests site only."""

import unittest
from inspect import unwrap
from unittest.mock import patch
from uuid import uuid4

import frappe
from frappe.tests.utils import FrappeTestCase

from . import money_commands as commands, money_hub


class TestMoneyCommandsNative(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		if not getattr(frappe.local, "site", None) or not frappe.conf.get("allow_tests"):
			raise unittest.SkipTest("A disposable allow_tests site with the receipt schema is required")
		from erpnext.accounts.expense_services.native_test_support import ensure_test_company
		ensure_test_company()
		for name, abbr in (("_Test Money TJS", "MHT"), ("_Test Money Other", "MHO")):
			if not frappe.db.exists("Company", name):
				frappe.get_doc(dict(doctype="Company", company_name=name, abbr=abbr, country="Tajikistan",
					default_currency="TJS", chart_of_accounts="Standard", create_chart_of_accounts_based_on="Standard Template",
					enable_perpetual_inventory=0)).insert()
		frappe.db.commit()
		super().setUpClass()

	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.savepoint("money_native_case")
		self.addCleanup(lambda: frappe.db.rollback(save_point="money_native_case"))
		self.addCleanup(frappe.set_user, "Administrator")
		self.company = "_Test Money TJS"
		self.suffix = uuid4().hex[:10]
		self.cash = self.account("Cash", "Cash")
		self.bank = self.account("Bank", "Bank")
		self.usd = self.account("USD", "Bank", "USD")
		self.source = self.wallet(self.cash, "Source")
		self.target = self.wallet(self.bank, "Target")
		self.foreign = self.wallet(self.usd, "USD")
		self.args = dict(company=self.company, from_wallet=self.source, to_wallet=self.target,
			amount=100, client_request_id=uuid4().hex)

	def account(self, label, kind, currency="TJS"):
		parent = frappe.db.get_value("Account", dict(company=self.company, is_group=1,
			account_name="Cash In Hand" if kind == "Cash" else "Bank Accounts"), "name")
		return frappe.get_doc(dict(doctype="Account", account_name="_Test MHT " + label + self.suffix,
			company=self.company, parent_account=parent, account_type=kind, account_currency=currency, is_group=0)).insert().name

	def wallet(self, account, label):
		return frappe.get_doc(dict(doctype="Money Wallet", wallet_name="_Test MHT " + label + self.suffix,
			company=self.company, account=account, wallet_type="Till" if account == self.cash else "Bank", enabled=1)).insert().name

	def user(self, *roles):
		email = "mht-" + self.suffix + "-" + str(len(roles)) + "@example.invalid"
		frappe.get_doc(dict(doctype="User", email=email, first_name="Native Money Test", send_welcome_email=0,
			roles=[dict(role=role) for role in roles])).insert()
		return email

	def transfer(self, **args):
		return unwrap(money_hub.transfer_money)(**dict(self.args, **args))

	def test_native_tjs_transfer_retry_and_cancel_reconcile(self):
		first = self.transfer()
		self.assertEqual(self.transfer()["name"], first["name"])
		self.assertEqual(commands.outcome(self.args["client_request_id"], self.company)["name"], first["name"])
		gl = frappe.get_all("GL Entry", filters=dict(voucher_type="Payment Entry", voucher_no=first["name"], is_cancelled=0),
			fields=["account", "debit", "credit", "debit_in_account_currency", "credit_in_account_currency"])
		self.assertEqual(sum(row.credit for row in gl if row.account == self.cash), 100)
		self.assertEqual(sum(row.debit for row in gl if row.account == self.bank), 100)
		frappe.get_doc("Payment Entry", first["name"]).cancel()
		self.assertEqual(self.transfer()["status"], "cancelled")
		self.assertEqual(commands.outcome(self.args["client_request_id"], self.company)["docstatus"], 2)
		self.assertEqual(frappe.db.count("Payment Entry", {"reference_no": first["request"]}), 1)
		with self.assertRaises(frappe.LinkExistsError):
			frappe.delete_doc("Payment Entry", first["name"])

	def test_usd_to_tjs_uses_original_and_booked_amounts(self):
		result = self.transfer(from_wallet=self.foreign, amount=10, received_amount=110,
			source_exchange_rate=11, target_exchange_rate=1)
		doc = frappe.get_doc("Payment Entry", result["name"])
		self.assertEqual((doc.paid_amount, doc.received_amount, doc.base_paid_amount, doc.base_received_amount), (10, 110, 110, 110))
		gl = frappe.get_all("GL Entry", filters=dict(voucher_type="Payment Entry", voucher_no=doc.name, account=self.usd), fields=["credit", "credit_in_account_currency", "account_currency"])
		self.assertEqual((gl[0].credit, gl[0].credit_in_account_currency, gl[0].account_currency), (110, 10, "USD"))

	def test_tjs_to_usd(self):
		result = self.transfer(to_wallet=self.foreign, amount=110, received_amount=10, source_exchange_rate=1, target_exchange_rate=11)
		self.assertEqual((result["paid_amount"], result["received_amount"], result["target_currency"]), (110, 10, "USD"))

	def test_same_foreign_currency_requires_rate_and_equal_amounts(self):
		other = self.account("USD Two", "Bank", "USD")
		other_wallet = self.wallet(other, "USD Two")
		with self.assertRaises(frappe.ValidationError):
			self.transfer(from_wallet=self.foreign, to_wallet=other_wallet)
		result = self.transfer(from_wallet=self.foreign, to_wallet=other_wallet, source_exchange_rate=11)
		self.assertEqual(result["target_exchange_rate"], 11)

	def test_aliases_cannot_transfer_to_same_account(self):
		alias = self.wallet(self.cash, "Alias")
		with self.assertRaises(frappe.ValidationError): self.transfer(to_wallet=alias)
		self.assertFalse(frappe.db.exists("Money Hub Transfer", commands.request_name(self.args["client_request_id"])))

	def test_invalid_amounts_rates_and_unbalanced_fx_never_claim_request(self):
		for args in (dict(amount=0), dict(amount=-1), dict(amount="NaN"), dict(amount="Infinity"), dict(amount="0.001"),
				dict(source_exchange_rate=2), dict(received_amount=90),
				dict(to_wallet=self.foreign, received_amount=10, target_exchange_rate=12),
				dict(to_wallet=self.foreign, received_amount=10, target_exchange_rate=0)):
			with self.subTest(args=args), self.assertRaises(frappe.ValidationError): self.transfer(**args)
		self.assertFalse(frappe.db.exists("Money Hub Transfer", commands.request_name(self.args["client_request_id"])))

	def test_stable_request_is_required_and_changed_intent_rejected(self):
		self.assertIs(money_hub.record_money_transfer, money_hub.transfer_money)
		with self.assertRaises(frappe.ValidationError): self.transfer(client_request_id=None)
		self.transfer()
		with self.assertRaises(frappe.PermissionError): self.transfer(amount=200)
		self.assertEqual(self.transfer(amount="100.00")["status"], "submitted")

	def test_disabled_wallet_and_account_denied(self):
		frappe.db.set_value("Money Wallet", self.source, "enabled", 0)
		with self.assertRaises(frappe.ValidationError): self.transfer()
		frappe.db.set_value("Money Wallet", self.source, "enabled", 1)
		frappe.db.set_value("Account", self.bank, "disabled", 1)
		with self.assertRaises(frappe.PermissionError): self.transfer()

	def test_cross_company_wallet_and_corrupt_link_denied(self):
		frappe.db.set_value("Money Wallet", self.target, "company", "_Test Money Other")
		with self.assertRaises(frappe.PermissionError): self.transfer()
		frappe.db.set_value("Money Wallet", self.target, "company", self.company)
		foreign_account = frappe.db.get_value("Account", dict(company="_Test Money Other", account_type="Cash", is_group=0), "name")
		frappe.db.set_value("Money Wallet", self.target, "account", foreign_account)
		with self.assertRaises(frappe.PermissionError): self.transfer()

	def test_accounts_manager_native_posting_and_lost_authority(self):
		user = self.user("Accounts Manager")
		frappe.set_user(user)
		result = self.transfer()
		self.assertEqual(result["docstatus"], 1)
		# Read-only recovery rechecks native source permissions after a role change.
		frappe.set_user("Administrator")
		doc = frappe.get_doc("User", user); doc.set("roles", [dict(role="Stock Manager")]); doc.save()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): self.transfer()
		with self.assertRaises(frappe.PermissionError): commands.outcome(self.args["client_request_id"], self.company)

	def test_read_only_stock_manager_cannot_post_or_edit_wallets(self):
		user = self.user("Stock Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): self.transfer()
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.update_wallet)(self.source, enabled=0, company=self.company)
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.create_wallet)("_Test Denied " + self.suffix, "Safe", company=self.company)

	def test_native_submit_failure_rolls_back_receipt_entry_and_gl(self):
		from erpnext.accounts.doctype.payment_entry.payment_entry import PaymentEntry
		before = frappe.db.count("Payment Entry")
		with patch.object(PaymentEntry, "on_submit", side_effect=frappe.ValidationError("Native failure")):
			with self.assertRaises(frappe.ValidationError): self.transfer()
		self.assertEqual(frappe.db.count("Payment Entry"), before)
		self.assertFalse(frappe.db.exists("Money Hub Transfer", commands.request_name(self.args["client_request_id"])))
		self.assertEqual(self.transfer()["status"], "submitted")

	def test_receipt_cannot_be_forged_edited_or_deleted(self):
		from erpnext.accounts.doctype.money_hub_transfer.money_hub_transfer import MoneyHubTransfer
		with self.assertRaises(frappe.PermissionError):
			frappe.get_doc(dict(doctype="Money Hub Transfer", actor="Administrator", company=self.company,
				fingerprint="fake", intent="{}")).insert()
		result = self.transfer()
		doc = frappe.get_doc("Money Hub Transfer", result["request"])
		doc.fingerprint = "fake"
		with self.assertRaises(frappe.PermissionError): doc.save()
		with self.assertRaises(frappe.ValidationError): frappe.delete_doc("Money Hub Transfer", result["request"])
		self.assertTrue(issubclass(MoneyHubTransfer, frappe.model.document.Document))

	def test_recovery_after_wallet_renamed_or_disabled_still_returns_original(self):
		result = self.transfer()
		frappe.rename_doc("Money Wallet", self.source, "_Test Renamed " + self.suffix)
		frappe.db.set_value("Money Wallet", self.target, "enabled", 0)
		self.assertEqual(self.transfer()["name"], result["name"])

	def test_request_cannot_be_recovered_by_another_actor(self):
		self.transfer()
		user = self.user("Accounts Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): self.transfer()
		with self.assertRaises(frappe.PermissionError): commands.outcome(self.args["client_request_id"], self.company)

	def test_wallet_creation_and_opening_are_native_and_atomic(self):
		name = "_Test Created " + self.suffix
		result = unwrap(money_hub.create_wallet)(name, "Safe", opening_balance=25, company=self.company)
		wallet = frappe.get_doc("Money Wallet", result["wallet"])
		self.assertEqual(frappe.db.get_value("Account", wallet.account, "company"), self.company)
		self.assertEqual(frappe.db.get_value("GL Entry", {"account": wallet.account, "is_cancelled": 0}, "debit"), 25)
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.update_wallet)(wallet.name, enabled=0, company="_Test Money Other")

	def test_tax_payment_requires_native_scope_and_explicit_account(self):
		settings = frappe.get_single("Money Hub Settings")
		settings.company = self.company; settings.tax_regime = "Turnover Tax"; settings.tax_account = None; settings.save()
		with self.assertRaises(frappe.ValidationError): unwrap(money_hub.pay_tax)(self.source, 10, self.company)
		settings.tax_account = frappe.db.get_value("Account", {"company": self.company, "account_type": "Tax", "is_group": 0}, "name")
		if not settings.tax_account:
			settings.tax_account = frappe.db.get_value("Account", {"company": self.company, "account_name": "Stock Received But Not Billed", "is_group": 0}, "name")
		settings.save()
		result = unwrap(money_hub.pay_tax)(self.source, 10, self.company)
		self.assertEqual(frappe.get_doc("Journal Entry", result["journal_entry"]).docstatus, 1)
		with self.assertRaises(frappe.ValidationError): unwrap(money_hub.pay_tax)(self.foreign, 10, self.company)
		settings.tax_account = self.bank; settings.save()
		with self.assertRaises(frappe.ValidationError): unwrap(money_hub.pay_tax)(self.source, 10, self.company)

	def profile(self, mode):
		company = frappe.get_doc("Company", self.company)
		return frappe.get_doc(dict(doctype="POS Profile", name="_Test MHT Profile " + self.suffix,
			company=self.company, currency="TJS", cost_center=company.cost_center,
			write_off_account=frappe.db.get_value("Account", {"company": self.company, "account_name": "Write Off", "is_group": 0}, "name"),
			write_off_cost_center=company.cost_center,
			warehouse=frappe.db.get_value("Warehouse", {"company": self.company, "is_group": 0}, "name"),
			payments=[dict(mode_of_payment=mode, default=1)])).insert()

	def mode(self, label, account):
		return frappe.get_doc(dict(doctype="Mode of Payment", mode_of_payment="_Test MHT " + label + self.suffix,
			type="Cash", accounts=[dict(company=self.company, default_account=account)])).insert().name

	def test_pos_sync_preserves_unrelated_methods_and_shared_aliases(self):
		unrelated = self.mode("Unrelated", self.cash)
		profile = self.profile(unrelated)
		result = unwrap(money_hub.create_wallet)("_Test POS " + self.suffix, "Till", accept_in_pos=1, company=self.company)
		wallet = frappe.get_doc("Money Wallet", result["wallet"])
		profile.reload()
		self.assertEqual([row.mode_of_payment for row in profile.payments], [unrelated, wallet.mode_of_payment])
		alias = self.wallet(wallet.account, "POS Alias")
		frappe.db.set_value("Money Wallet", alias, {"accept_in_pos": 1, "mode_of_payment": wallet.mode_of_payment})
		unwrap(money_hub.update_wallet)(wallet.name, enabled=0, company=self.company)
		profile.reload(); self.assertEqual(len(profile.payments), 2)
		unwrap(money_hub.update_wallet)(alias, enabled=0, company=self.company)
		profile.reload(); self.assertEqual([row.mode_of_payment for row in profile.payments], [unrelated])
		self.assertEqual(profile.payments[0].default, 1)

	def test_denied_pos_profile_aborts_wallet_creation_with_no_orphan_account(self):
		from erpnext.accounts.doctype.pos_profile.pos_profile import POSProfile
		self.profile(self.mode("Unrelated", self.cash))
		name = "_Test POS Denied " + self.suffix
		original = POSProfile.check_permission
		def deny(doc, ptype="read", *args, **kwargs):
			if ptype == "write": raise frappe.PermissionError("Native profile write denied")
			return original(doc, ptype, *args, **kwargs)
		with patch.object(POSProfile, "check_permission", deny):
			with self.assertRaises(frappe.PermissionError):
				unwrap(money_hub.create_wallet)(name, "Till", opening_balance=25, accept_in_pos=1, company=self.company)
		self.assertFalse(frappe.db.exists("Money Wallet", name))
		self.assertFalse(frappe.db.exists("Account", {"account_name": name, "company": self.company}))
		self.assertFalse(frappe.db.exists("Mode of Payment", name))

	def test_native_company_and_account_user_restrictions(self):
		user = self.user("Accounts Manager")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Company", for_value="_Test Money Other", apply_to_all_doctypes=1)).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): self.transfer()
		frappe.set_user("Administrator")
		frappe.db.delete("User Permission", {"user": user}); frappe.clear_cache(user=user)
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Account", for_value=self.cash, apply_to_all_doctypes=1)).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): self.transfer()

	def test_no_tax_write_authority_from_money_visibility(self):
		user = self.user("Stock Manager")
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.save_tax_settings)("VAT", company=self.company)
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.pay_tax)(self.source, 10, self.company)

	def test_setting_other_company_is_not_silently_reassigned(self):
		settings = frappe.get_single("Money Hub Settings"); settings.company = "_Test Money Other"; settings.save()
		with self.assertRaises(frappe.PermissionError): unwrap(money_hub.save_tax_settings)("VAT", company=self.company)
		with self.assertRaises(frappe.ValidationError): unwrap(money_hub.pay_tax)(self.source, 10, self.company)

	def test_name_and_commission_edit_does_not_rewrite_pos_methods(self):
		mode = self.mode("Configured", self.cash)
		unrelated = self.mode("Unrelated", self.bank)
		profile = self.profile(unrelated)
		frappe.db.set_value("Money Wallet", self.source, {"accept_in_pos": 1, "mode_of_payment": mode})
		new_name = "_Test MHT Renamed " + self.suffix
		result = unwrap(money_hub.update_wallet)(self.source, wallet_name=new_name, commission_percent=2, company=self.company)
		self.assertEqual(result["wallet"], new_name)
		wallet = frappe.get_doc("Money Wallet", new_name)
		self.assertEqual((wallet.wallet_name, wallet.commission_percent, wallet.account, wallet.mode_of_payment), (new_name, 2, self.cash, mode))
		profile.reload(); self.assertEqual([row.mode_of_payment for row in profile.payments], [unrelated])

	def test_conflicting_existing_payment_method_cannot_be_repointed(self):
		name = "_Test MHT Conflict " + self.suffix
		frappe.get_doc(dict(doctype="Mode of Payment", mode_of_payment=name, type="Cash",
			accounts=[dict(company=self.company, default_account=self.cash)])).insert()
		with self.assertRaises(frappe.ValidationError):
			unwrap(money_hub.create_wallet)(name, "Till", accept_in_pos=1, company=self.company)
		self.assertFalse(frappe.db.exists("Account", {"account_name": name, "company": self.company}))
		self.assertEqual(frappe.get_doc("Mode of Payment", name).accounts[0].default_account, self.cash)
