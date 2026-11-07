"""Snapshot accounting and scope regressions; database-free native-query fixtures."""
import unittest
from contextlib import ExitStack
from inspect import unwrap
from unittest.mock import Mock, patch

import frappe

from . import account_balances, money_hub


class SnapshotTests(unittest.TestCase):
	def setUp(self):
		self.stack = ExitStack()
		self.addCleanup(self.stack.close)
		self.f = Mock(PermissionError=frappe.PermissionError)
		self.f.throw.side_effect = lambda msg, exc: (_ for _ in ()).throw(exc(msg))
		self.stack.enter_context(patch.object(account_balances, "frappe", self.f))
		self.stack.enter_context(patch.object(account_balances, "_", lambda text: text))
		self.rows = []
		self.f.get_list.side_effect = lambda kind, **kwargs: self.rows

	def add(self, date, debit=0, credit=0, original_debit=None, original_credit=None):
		self.rows.append(frappe._dict(account="Bank", posting_date=date, debit=debit, credit=credit,
			debit_in_account_currency=debit if original_debit is None else original_debit,
			credit_in_account_currency=credit if original_credit is None else original_credit))

	def read(self, accounts=("Bank",)):
		return account_balances.read_balances("Test", accounts, "2026-11-07", 2)

	def test_opening_plus_today_net_equals_closing_with_original_usd(self):
		self.add("2026-11-06", 1100, original_debit=100)
		self.add("2026-11-07", credit=220, original_credit=20)
		self.add("2026-11-07", 55, original_debit=5)
		value = self.read()["Bank"]
		self.assertEqual(value["balance"], 935)
		self.assertEqual(value["account_balance"], 85)
		self.assertEqual(value["opening_balance"], 1100)
		self.assertEqual(value["today_in"], 55)
		self.assertEqual(value["today_out"], 220)
		self.assertEqual(value["opening_balance"]+value["today_in"]-value["today_out"], value["balance"])

	def test_native_query_has_company_cancellation_and_explicit_future_cutoff(self):
		self.read(accounts=["Bank", "Bank"])
		query = self.f.get_list.call_args
		self.assertEqual(query.args, ("GL Entry",))
		self.assertEqual(query.kwargs["filters"], dict(company="Test", account=["in", ["Bank"]], is_cancelled=0, posting_date=["<=", "2026-11-07"]))
		self.assertEqual(query.kwargs["limit_page_length"], 0)
		self.f.db.sql.assert_not_called(); self.f.db.get_all.assert_not_called()
		self.f.db.commit.assert_not_called(); self.f.get_doc.assert_not_called()

	def test_per_row_rounding_matches_native_balance_half_away_from_zero(self):
		self.add("2026-11-07", 0.005)
		self.add("2026-11-07", 0.005)
		self.add("2026-11-07", credit=0.005)
		self.assertEqual(self.read()["Bank"]["balance"], 0.01)

	def test_negative_debit_and_credit_have_cash_direction(self):
		self.add("2026-11-07", -10)
		self.add("2026-11-07", credit=-4)
		value = self.read()["Bank"]
		self.assertEqual((value["today_in"], value["today_out"], value["balance"]), (4, 10, -6))

	def test_missing_base_amount_invalidates_account_instead_of_partial_sum(self):
		self.add("2026-11-06", 100)
		self.add("2026-11-07", 50)
		del self.rows[1]["debit"]
		value = self.read()["Bank"]
		for field in ("balance", "opening_balance", "today_in", "today_out"):
			self.assertIsNone(value[field])
		self.assertFalse(value["base_readable"])

	def test_missing_original_does_not_invent_zero_or_hide_permitted_base(self):
		self.add("2026-11-07", 1100, original_debit=100)
		del self.rows[0]["credit_in_account_currency"]
		value = self.read()["Bank"]
		self.assertIsNone(value["account_balance"])
		self.assertEqual(value["balance"], 1100)

	def test_restricted_identity_or_date_fails_closed(self):
		self.add("2026-11-07", 1)
		for field in ("account", "posting_date"):
			with self.subTest(field=field):
				original = self.rows[0][field]; self.rows[0][field] = None
				with self.assertRaises(frappe.PermissionError): self.read()
				self.rows[0][field] = original

	def test_batches_account_scope_without_duplicate_queries(self):
		self.read(accounts=[f"Account {i}" for i in range(401)])
		self.assertEqual(self.f.get_list.call_count, 3)
		self.assertTrue(all(len(call.kwargs["filters"]["account"][1]) <= 200 for call in self.f.get_list.call_args_list))

	def test_empty_scope_never_queries_global_ledger(self):
		self.assertEqual(self.read(accounts=[]), {})
		self.f.get_list.assert_not_called()

	def test_visible_empty_account_is_zero_and_denied_rows_cannot_contribute(self):
		value = self.read()["Bank"]
		self.assertEqual(value["balance"], 0)
		self.assertEqual(value["opening_balance"], 0)


class OverviewTests(unittest.TestCase):
	def test_hidden_policy_and_native_account_type_determine_totals(self):
		f = Mock(_dict=frappe._dict)
		f.get_cached_value.return_value = "TJS"
		wallets = [frappe._dict(name="SafeAlias", wallet_name="Safe alias", account="A", account_type="Bank", wallet_type="Safe", account_currency="USD", enabled=0),
			frappe._dict(name="Active", wallet_name="Active", account="A", account_type="Bank", wallet_type="Till", account_currency="USD", enabled=1)]
		value = dict(balance=1100, account_balance=100, opening_balance=1000, today_in=100, today_out=0, base_readable=True, original_readable=True)
		with patch.object(money_hub, "frappe", f), patch.object(money_hub, "today", return_value="2026-11-07"), \
			patch.object(money_hub, "_read_wallets", return_value=wallets) as scope, \
			patch.object(account_balances, "read_balances", return_value={"A": value}), \
			patch("erpnext.accounts.utils.get_currency_precision", return_value=2), \
			patch("frappe.model.meta.get_field_precision", return_value=2):
			data = unwrap(money_hub.get_money_hub_data)("Test", include_hidden=1)
			value["balance"] = None
			restricted = unwrap(money_hub.get_money_hub_data)("Test", include_hidden=1)
		self.assertIsNone(restricted["totals"]["total"])
		self.assertIsNone(restricted["totals"]["non_cash"])
		self.assertTrue(scope.call_args.args[1])
		self.assertEqual(data["totals"]["total"], 1100)
		self.assertEqual(data["totals"]["cash"], 0)
		self.assertEqual(data["totals"]["non_cash"], 1100)
		self.assertEqual(data["accounts"][0]["primary_wallet"], "Active")
		self.assertEqual(data["accounts"][0]["wallets"], ["SafeAlias", "Active"])
		self.assertEqual(data["as_of"], "2026-11-07")

	def test_company_permission_precedes_currency_and_snapshot_reads(self):
		f = Mock()
		with patch.object(money_hub, "frappe", f), patch.object(money_hub, "_read_wallets", side_effect=frappe.PermissionError):
			with self.assertRaises(frappe.PermissionError): unwrap(money_hub.get_money_hub_data)("Other")
		f.get_cached_value.assert_not_called()
