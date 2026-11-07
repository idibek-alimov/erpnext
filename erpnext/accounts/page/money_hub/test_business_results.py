"""Database-free edge cases for the posted-results contract."""
import unittest
from unittest.mock import Mock, patch

import frappe

from . import business_results as results


class TestBusinessResults(unittest.TestCase):
	def setUp(self):
		self.accounts = [frappe._dict(name="Sales", root_type="Income", account_type="", account_currency="TJS"),
			frappe._dict(name="COGS", root_type="Expense", account_type="Cost of Goods Sold", account_currency="TJS"),
			frappe._dict(name="Rent", root_type="Expense", account_type="", account_currency="USD")]
		self.rows = []
		self.sales = []
		self.pos = []
		self.f = Mock(PermissionError=frappe.PermissionError)
		self.f.throw.side_effect = lambda message, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(message))
		self.f.has_permission.return_value = True
		self.f.get_list.side_effect = lambda kind, **kw: dict(Account=self.accounts, **{"GL Entry": self.rows,
			"Sales Invoice": self.sales, "POS Invoice": self.pos})[kind]
		self.patch = patch.object(results, "frappe", self.f)
		self.patch.start()
		self.addCleanup(self.patch.stop)
		self.translation = patch.object(results, "_", lambda text: text)
		self.translation.start()
		self.addCleanup(self.translation.stop)

	def add(self, account, debit=0, credit=0, currency="TJS", original=None):
		self.rows.append(frappe._dict(account=account, debit=debit, credit=credit, account_currency=currency,
			debit_in_account_currency=debit if original is None else original,
			credit_in_account_currency=credit if original is None else 0))

	def ledger(self):
		return results._ledger("Company", "2026-11-01", "2026-11-07", "Default", 2)

	def test_recognition_signs_returns_and_original_currency(self):
		self.add("Sales", credit=1000)
		self.add("Sales", debit=100)
		self.add("COGS", debit=500)
		self.add("COGS", credit=50)
		self.add("Rent", debit=110, currency="USD", original=10)
		out = self.ledger()
		self.assertEqual([out[key] for key in ("income", "cogs", "other_expenses", "total_expenses", "result")], [900, 450, 110, 560, 340])
		self.assertEqual(out["accounts"][-1]["account_amount"], 10)
		query = next(call.kwargs for call in self.f.get_list.call_args_list if call.args == ("GL Entry",))
		self.assertEqual(query["filters"]["is_cancelled"], 0)
		self.assertEqual(query["filters"]["voucher_type"], ["!=", "Period Closing Voucher"])
		self.assertEqual(query["filters"]["posting_date"], ["between", ["2026-11-01", "2026-11-07"]])
		self.assertEqual(query["limit_page_length"], 0)
		self.f.db.sql.assert_not_called()
		self.f.db.commit.assert_not_called()

	def test_missing_financial_fields_fail_closed(self):
		self.add("Sales", credit=100)
		del self.rows[0]["credit"]
		with self.assertRaises(frappe.PermissionError):
			self.ledger()

	def test_missing_account_classification_fails_closed(self):
		del self.accounts[1]["account_type"]
		with self.assertRaises(frappe.PermissionError):
			self.ledger()

	def test_original_missing_does_not_invalidate_booked_base(self):
		self.add("Rent", debit=110, currency="USD", original=10)
		del self.rows[0]["credit_in_account_currency"]
		out = self.ledger()
		self.assertEqual(out["result"], -110)
		self.assertIsNone(out["accounts"][0]["account_amount"])

	def test_native_row_precision_and_negative_values(self):
		self.add("Rent", debit=0.005)
		self.add("Rent", debit=0.005)
		self.add("Rent", credit=0.005)
		self.assertEqual(self.ledger()["other_expenses"], 0.01)

	def test_batches_are_bounded_and_do_not_truncate(self):
		self.accounts = [frappe._dict(name=str(i), root_type="Expense", account_type="", account_currency="TJS") for i in range(401)]
		self.ledger()
		queries = [call.kwargs for call in self.f.get_list.call_args_list if call.args == ("GL Entry",)]
		self.assertEqual([len(query["filters"]["account"][1]) for query in queries], [200, 200, 1])

	def test_invoice_tax_exclusion_returns_base_and_original_separate_from_pos(self):
		self.sales = [frappe._dict(base_net_total=1100, net_total=100, currency="USD", is_return=0),
			frappe._dict(base_net_total=-220, net_total=-20, currency="USD", is_return=1)]
		self.pos = [frappe._dict(base_net_total=200, net_total=200, currency="TJS", is_return=0)]
		out = results._sales("Company", "2026-11-01", "2026-11-07")
		self.assertEqual((out["net_sales"], out["returns"], out["checks"], out["unmerged_pos_net_sales"]), (880, 220, 1, 200))
		self.assertEqual(out["by_currency"], [dict(currency="USD", net_total=80, base_net_total=880)])
		query = self.f.get_list.call_args.kwargs
		self.assertIn(["consolidated_invoice", "is", "not set"], query["or_filters"])

	def test_denied_sales_are_unknown_rather_than_zero(self):
		self.f.has_permission.return_value = False
		self.assertIsNone(results._sales("Company", "2026-11-01", "2026-11-07")["net_sales"])
		self.f.get_list.assert_not_called()
		with self.assertRaises(frappe.PermissionError):
			self.ledger()

	def test_future_reversed_and_unbounded_ranges_rejected_before_queries(self):
		with patch.object(results, "require_financial_access"), patch.object(results, "today", return_value="2026-11-07"):
			for start, end in (("2026-11-08", "2026-11-08"), ("2026-11-07", "2026-11-01"), ("2020-01-01", "2026-11-07")):
				with self.subTest(start=start, end=end), self.assertRaises(frappe.ValidationError):
					results.read_results("Company", start, end)
		self.f.get_list.assert_not_called()
