"""Read-only whole-account balances, currencies and shared-wallet scope in fixtures."""
import unittest
from inspect import unwrap
from unittest.mock import Mock, patch
import frappe
from . import money_hub, movement_history


class BalanceTests(unittest.TestCase):
    def setUp(self):
        self.f = Mock(_dict=frappe._dict, PermissionError=frappe.PermissionError)
        self.f.throw.side_effect = lambda message, exception=frappe.ValidationError: (_ for _ in ()).throw(exception(message))
        self.f.db.get_value.return_value = "TJS"
        self.f.get_cached_value.return_value = "TJS"
        self.wallets = [frappe._dict(name="Till", account="Cash", wallet_type="Till", enabled=1, account_currency="TJS", account_type="Cash"),
            frappe._dict(name="Shared alias", account="Cash", wallet_type="Till", enabled=1, account_currency="TJS", account_type="Cash"),
            frappe._dict(name="USD", account="Bank", wallet_type="Bank", enabled=1, account_currency="USD", account_type="Bank"),
            frappe._dict(name="Hidden", account="Old", wallet_type="Safe", enabled=0, account_currency="TJS", account_type="Cash")]
        self.patch = patch.object(money_hub, "frappe", self.f); self.patch.start(); self.addCleanup(self.patch.stop)
        history_patch = patch.object(movement_history, "frappe", self.f)
        history_patch.start(); self.addCleanup(history_patch.stop)

    def test_company_totals_use_base_currency_and_count_shared_account_once(self):
        balances = {account: dict(balance=1100 if account == "Bank" else 100,
            opening_balance=1085 if account == "Bank" else 85 if account == "Cash" else 100,
            today_in=0 if account == "Old" else 20, today_out=0 if account == "Old" else 5,
            account_balance=100, base_readable=True, original_readable=True) for account in ("Cash", "Bank", "Old")}
        with patch.object(money_hub, "_read_wallets", return_value=self.wallets), \
            patch.object(money_hub, "today", return_value="2026-11-07"), \
            patch("frappe.model.meta.get_field_precision", side_effect=lambda field, currency: 3 if currency == "TJS" else 2), \
            patch("erpnext.accounts.page.money_hub.account_balances.read_balances", return_value=balances) as balance, \
            patch("erpnext.accounts.utils.get_currency_precision", return_value=2), \
            patch.object(money_hub, "import_existing_accounts") as provision:
            data = unwrap(money_hub.get_money_hub_data)("Test", include_hidden=1)
        self.assertEqual(data["totals"], dict(total=1300, cash=200, non_cash=1100, today_in=40, today_out=10, net_today=30, opening_balance=1270))
        self.assertEqual(len(data["accounts"]), 3)
        self.assertEqual(data["wallets"][2]["balance"], 1100)
        self.assertEqual(data["wallets"][2]["account_balance"], 100)
        self.assertEqual(data["wallets"][2]["account_currency"], "USD")
        self.assertEqual(data["currency_precisions"], dict(TJS=3, USD=2))
        self.assertEqual(balance.call_count, 1)
        provision.assert_not_called(); self.f.db.commit.assert_not_called(); self.f.get_doc.assert_not_called()

    def test_wallet_and_linked_account_native_permissions_are_used(self):
        self.f.get_list.side_effect = lambda doctype, **kwargs: self.wallets if doctype == "Money Wallet" else [frappe._dict(name="Bank", account_currency="USD", account_type="Bank")]
        with patch.object(money_hub, "_check_permission"):
            rows = money_hub._read_wallets("Test")
        self.assertEqual([row.name for row in rows], ["USD"])
        self.f.get_doc.return_value.check_permission.assert_called_once_with("read")
        self.assertEqual(self.f.get_list.call_args_list[0].kwargs["filters"], dict(company="Test", enabled=1))
        self.f.db.get_all.assert_not_called(); self.f.db.commit.assert_not_called()

    def test_ledger_permission_required_before_balance_reads(self):
        self.f.has_permission.return_value = False
        with patch.object(money_hub, "_check_permission"):
            with self.assertRaises(frappe.PermissionError): money_hub._read_wallets("Test")
        self.f.get_list.assert_not_called()

    def test_cross_company_or_denied_wallet_feed_is_rejected(self):
        with patch.object(money_hub, "_read_wallets", return_value=self.wallets):
            with self.assertRaises(frappe.PermissionError): unwrap(money_hub.get_money_feed)(wallet="Foreign", company="Test")
        self.f.db.sql.assert_not_called()

    def test_shared_account_feed_uses_explicit_company_and_unique_accounts(self):
        self.f.get_list.return_value = []
        with patch.object(money_hub, "_read_wallets", return_value=self.wallets):
            unwrap(money_hub.get_money_feed)(company="Test", period="all")
        query = self.f.get_list.call_args.kwargs
        self.assertEqual(query["filters"]["company"], "Test")
        self.assertEqual(query["filters"]["account"][1].count("Cash"), 1)
        self.f.db.sql.assert_not_called()
