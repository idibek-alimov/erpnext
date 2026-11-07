"""Full history, native query scope, transfer accounting and currency regressions."""
import unittest
from contextlib import ExitStack
from inspect import unwrap
from unittest.mock import Mock, patch

import frappe

from . import money_hub, movement_history as history


class MovementTests(unittest.TestCase):
	def setUp(self):
		self.stack = ExitStack()
		self.addCleanup(self.stack.close)
		self.f = Mock(_dict=frappe._dict, PermissionError=frappe.PermissionError)
		self.f.throw.side_effect = lambda msg, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(msg))
		self.f.has_permission.return_value = True
		self.f.db.has_table.return_value = False
		self.f.get_cached_value.return_value = "TJS"
		self.f.utils.formatdate.side_effect = lambda value, fmt: str(value)
		self.stack.enter_context(patch.object(history, "frappe", self.f))
		self.stack.enter_context(patch.object(history, "_", lambda value: value))
		self.wallets = [frappe._dict(name="Till", wallet_name="Till", account="Cash"),
			frappe._dict(name="Alias", wallet_name="Cash alias", account="Cash"),
			frappe._dict(name="USD", wallet_name="USD Bank", account="Bank")]
		self.read_wallets = self.stack.enter_context(patch.object(money_hub, "_read_wallets", return_value=self.wallets))
		self.rows, self.sources, self.expenses = [], {}, []
		self.f.get_list.side_effect = self.get_list

	def get_list(self, doctype, **kwargs):
		filters = kwargs["filters"]
		self.assertEqual(filters["company"], "Test")
		if doctype == "GL Entry":
			self.assertEqual(filters["is_cancelled"], 0)
			return self.rows
		self.assertEqual(filters["docstatus"], 1)
		if doctype == "Quick Expense":
			field = "payment_entry" if "payment_entry" in filters else "journal_entry"
			return [e for e in self.expenses if e.get(field) in filters[field][1]]
		return [doc for (kind, name), doc in self.sources.items()
			if kind == doctype and name in filters["name"][1]]

	def add(self, name, amount, account="Cash", kind="Payment Entry", voucher=None, **doc):
		voucher = voucher or name
		self.rows.append(frappe._dict(name=name, account=account, posting_date="2026-11-07",
			creation="2026-11-07 09:00:00", debit=max(amount, 0), credit=max(-amount, 0),
			debit_in_account_currency=max(amount, 0), credit_in_account_currency=max(-amount, 0),
			account_currency="TJS", voucher_type=kind, voucher_no=voucher))
		self.sources[(kind, voucher)] = frappe._dict(name=voucher, owner="Recorder", **doc)

	def query(self, **kwargs):
		return history.query_movements(company="Test", period="all", **kwargs)

	def test_all_matching_totals_and_old_search_beyond_500(self):
		for i in range(601):
			self.add(f"PE{i}", 10, party_type="Customer", party_name="Old match" if i == 600 else "Recent")
		page = self.query()
		self.assertEqual((page["total_count"], len(page["rows"])), (601, 50))
		self.assertEqual(page["summary"]["debit"], 6010)
		last = self.query(start=600)
		self.assertEqual(len(last["rows"]), 1)
		self.assertFalse(last["has_more"])
		self.assertEqual(last["summary"], page["summary"])
		old = self.query(search="old MATCH", op_type="sales", direction="in")
		self.assertEqual(old["total_count"], 1)
		self.assertEqual(old["rows"][0]["voucher_no"], "PE600")
		queries = [c for c in self.f.get_list.call_args_list if c.args[0] == "Payment Entry"]
		self.assertTrue(all(len(c.kwargs["filters"]["name"][1]) <= 200 for c in queries))

	def test_native_gl_source_and_expense_permissions_precede_summary(self):
		self.add("Allowed", 10)
		self.add("Denied source", 900)
		del self.sources[("Payment Entry", "Denied source")]
		result = self.query(search="Denied")
		self.assertEqual(result["total_count"], 0)
		self.assertEqual(result["summary"]["debit"], 0)
		self.assertNotIn("Denied source", str(result))
		query = self.f.get_list.call_args_list[0].kwargs
		self.assertEqual(query["order_by"], "posting_date desc, creation desc, name desc")
		self.assertEqual(query["filters"]["account"][1], ["Bank", "Cash"])
		self.assertEqual(query["limit_page_length"], 0)
		self.f.db.sql.assert_not_called()
		self.f.db.get_all.assert_not_called()
		self.f.get_doc.assert_not_called()
		self.f.db.commit.assert_not_called()

	def test_denied_source_doctype_never_queried(self):
		self.add("V1", 500)
		self.f.has_permission.side_effect = lambda kind, action: kind != "Payment Entry"
		self.assertEqual(self.query()["total_count"], 0)
		self.assertFalse(any(c.args[0] == "Payment Entry" for c in self.f.get_list.call_args_list))

	def test_supported_only_and_cancelled_source_filter(self):
		self.add("Unknown", 90, kind="Employee")
		self.assertEqual(self.query()["total_count"], 0)
		self.assertFalse(any(c.args[0] == "Employee" for c in self.f.get_list.call_args_list))

	def test_transfer_one_event_no_inflated_income_or_spending(self):
		self.add("T1", -100, voucher="Transfer", payment_type="Internal Transfer")
		self.add("T2", 100, account="Bank", voucher="Transfer", payment_type="Internal Transfer")
		self.add("Sale", 50, party_type="Customer")
		self.add("Cost", -20, party_type="Supplier")
		result = self.query()
		self.assertEqual(result["total_count"], 3)
		self.assertEqual(result["summary"], dict(debit=50, credit=20, net=30, transfer_amount=100, ledger_in=150, ledger_out=120))
		transfer = result["rows"][0]
		self.assertEqual(len(transfer["movements"]), 2)
		self.assertEqual(transfer["transfer_from"], ["Till / Cash alias"])
		self.assertEqual(transfer["transfer_to"], ["USD Bank"])
		self.assertEqual(transfer["amount"], 0)
		self.assertEqual(self.query(direction="in")["total_count"], 1)
		self.assertEqual(self.query(op_type="transfer")["summary"]["transfer_amount"], 100)

	def test_single_account_and_alias_preserve_leg_and_do_not_duplicate(self):
		self.add("T1", -100, voucher="Transfer", payment_type="Internal Transfer")
		self.add("T2", 100, account="Bank", voucher="Transfer", payment_type="Internal Transfer")
		for wallet in ("Till", "Alias"):
			result = self.query(wallet=wallet)
			self.assertEqual(result["total_count"], 1)
			self.assertEqual(result["summary"]["credit"], 100)
			self.assertEqual(result["scope"], "account")
		self.assertEqual(self.query()["summary"]["transfer_amount"], 100)

	def test_partially_visible_transfer_and_fx_difference_reconcile(self):
		self.add("T1", -1100, voucher="Transfer", payment_type="Internal Transfer")
		# Only a visible outgoing leg: no destination name/amount inference.
		result = self.query()
		self.assertEqual(result["summary"]["net"], -1100)
		self.assertEqual(result["summary"]["transfer_amount"], 0)
		self.add("T2", 1090, account="Bank", voucher="Transfer", payment_type="Internal Transfer")
		result = self.query()
		self.assertEqual(result["summary"]["credit"], 10)
		self.assertEqual(result["summary"]["transfer_amount"], 1090)
		self.assertEqual(result["summary"]["net"], result["summary"]["ledger_in"] - result["summary"]["ledger_out"])

	def test_party_classification_and_no_tax_or_owner_guess_from_remarks(self):
		for name, party in (("C", "Customer"), ("S", "Supplier"), ("E", "Employee"), ("O", None)):
			self.add(name, -10, party_type=party, payment_type="Pay", remarks="owner tax налог")
		self.add("JE", -20, kind="Journal Entry", user_remark="MONEYHUB_TAX tax налог owner")
		self.assertEqual([r["op_type"] for r in self.query()["rows"]], ["sales", "supplier", "employee", "other", "other"])

	def test_typed_expense_only_when_visible(self):
		self.add("JE", -20, kind="Journal Entry")
		self.expenses = [frappe._dict(journal_entry="JE", expense_category="Rent")]
		self.assertEqual(self.query()["rows"][0]["op_type"], "expense")
		self.f.has_permission.side_effect = lambda kind, action: kind != "Quick Expense"
		result = self.query()
		self.assertEqual(result["rows"][0]["op_type"], "other")
		self.assertNotIn("Rent", str(result))

	def test_returns_negative_debits_and_usd_keep_booked_base(self):
		self.add("Return", -1100, kind="Sales Invoice", is_return=1)
		self.rows[0].update(debit=-1100, credit=0, account_currency="USD", debit_in_account_currency=-100, credit_in_account_currency=0)
		result = self.query()
		self.assertEqual(result["summary"]["credit"], 1100)
		self.assertEqual(result["rows"][0]["account_amount"], -100)
		self.assertEqual(result["currency"], "TJS")
		self.assertEqual(result["rows"][0]["account_currency"], "USD")

	def test_empty_wallets_never_query_global_ledger(self):
		self.read_wallets.return_value = []
		self.assertEqual(self.query()["total_count"], 0)
		self.f.get_list.assert_not_called()

	def test_denied_wallet_and_company_fail_before_any_history(self):
		with self.assertRaises(frappe.PermissionError):
			self.query(wallet="Other company")
		self.f.get_list.assert_not_called()
		self.read_wallets.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			self.query()

	def test_validated_dates_and_page_bounds(self):
		with self.assertRaises(frappe.ValidationError):
			self.query(from_date="2026-11-07", to_date="2026-11-01")
		self.add("V1", 1)
		self.query(from_date="2026-11-01", to_date="2026-11-07")
		query = next(c for c in self.f.get_list.call_args_list if c.args[0] == "GL Entry")
		self.assertEqual(query.kwargs["filters"]["posting_date"][0], "between")
		result = self.query(start=999999, page_length=999999)
		self.assertEqual((result["start"], result["page_length"]), (0, 100))

	def test_exact_seven_inclusive_days(self):
		with patch.object(money_hub, "today", return_value="2026-11-07"):
			first, last = money_hub._feed_period("week")
		self.assertEqual((last - first).days, 6)

	def test_legacy_array_filters_before_limit_and_keeps_transfer_legs(self):
		self.add("T1", -20, voucher="Transfer", payment_type="Internal Transfer")
		self.add("T2", 20, account="Bank", voucher="Transfer", payment_type="Internal Transfer")
		with patch.object(history, "query_movements", wraps=history.query_movements):
			rows = unwrap(money_hub.get_money_feed)(company="Test", period="all", limit=1, direction="in")
		self.assertIsInstance(rows, list)
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0]["gl_name"], "T2")

	def test_restricted_amount_fields_are_missing_not_zero(self):
		self.add("Restricted", 900)
		del self.rows[0]["debit"]
		self.assertEqual(self.query()["total_count"], 0)
		self.rows[0].debit = 900
		del self.rows[0]["debit_in_account_currency"]
		self.assertIsNone(self.query()["rows"][0]["account_amount"])

	def test_decimal_transfer_sums_do_not_leave_phantom_residual(self):
		for name, amount, account in (("T1", -0.3, "Cash"), ("T2", 0.1, "Bank"), ("T3", 0.2, "Bank")):
			self.add(name, amount, account=account, voucher="Transfer", payment_type="Internal Transfer")
		result = self.query()
		self.assertEqual(result["summary"]["net"], 0)
		self.assertEqual(result["summary"]["debit"], 0)
		self.assertEqual(result["summary"]["credit"], 0)
		self.assertEqual(result["summary"]["transfer_amount"], 0.3)

	def test_ui_hidden_scope_is_passed_to_native_wallet_query(self):
		self.query(include_hidden=0)
		self.assertFalse(self.read_wallets.call_args.kwargs["include_hidden"])
		self.query(include_hidden=1)
		self.assertTrue(self.read_wallets.call_args.kwargs["include_hidden"])

	def test_owner_receipt_classification_is_separate_from_expenses_and_searchable(self):
		self.add("Owner JE", 100, kind="Journal Entry", user_remark="Owner funds")
		with patch.object(history, "_owner_sources", return_value={("Journal Entry", "Owner JE"): "contribution"}):
			result = self.query(op_type="owner")
		self.assertEqual(result["total_count"], 1)
		self.assertEqual(result["summary"]["debit"], 100)
		self.assertEqual(result["rows"][0]["label_tg"], "Маблағи соҳиб: воридкунӣ")

	def test_owner_words_in_remarks_do_not_classify_an_untyped_journal(self):
		self.add("Unclassified JE", -50, kind="Journal Entry", user_remark="Owner loan repayment")
		self.assertEqual(self.query(op_type="owner")["total_count"], 0)
		self.assertEqual(self.query()["rows"][0]["op_type"], "other")

	def test_owner_receipts_are_batched_after_native_source_scope_and_require_read(self):
		self.f.db.has_table.return_value = True
		self.f.get_list.side_effect = None
		self.f.get_list.return_value = [frappe._dict(journal_entry="Allowed", operation="loan_received")]
		sources = {("Journal Entry", "Allowed"): {}, **{("Journal Entry", f"JE{i}"): {} for i in range(400)}}
		self.assertEqual(history._owner_sources(sources, "Test"), {("Journal Entry", "Allowed"): "loan_received"})
		self.assertEqual(self.f.get_list.call_count, 3)
		for call in self.f.get_list.call_args_list:
			self.assertEqual(call.args[0], "Owner Money Movement")
			self.assertLessEqual(len(call.kwargs["filters"]["journal_entry"][1]), 200)
		self.f.get_list.reset_mock();self.f.has_permission.return_value = False
		self.assertEqual(history._owner_sources(sources, "Test"), {})
		self.f.get_list.assert_not_called()
