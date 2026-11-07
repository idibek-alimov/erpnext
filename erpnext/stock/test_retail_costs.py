"""Cost evidence regressions, independent of database setup."""
import unittest
from collections import defaultdict
from unittest.mock import Mock, patch

import frappe

from erpnext.stock import retail_costs as costs


class TestRetailCosts(unittest.TestCase):
	def setUp(self):
		clock = patch.object(costs, "today", return_value="2026-11-07")
		clock.start()
		self.addCleanup(clock.stop)
		self.lookup = costs.HistoricalCostLookup.__new__(costs.HistoricalCostLookup)
		self.lookup.headers = {"SI": frappe._dict(posting_date="2026-11-07", posting_time="12:00:00", update_stock=1,
			is_return=0, is_debit_note=0)}
		self.lookup.reasons = {}
		self.lookup.items = {"A": frappe._dict(is_stock_item=1), "N": frappe._dict(is_stock_item=0)}
		self.lookup.warehouses = {"WH"}
		self.lookup.stock = defaultdict(list)
		self.lookup.stock[("Sales Invoice", "SI", "ROW", "A", "WH")] = [frappe._dict(actual_qty=-5, stock_value_difference=-200)]
		self.lookup.packed = defaultdict(list)
		self.lookup.delivery_by_name = {}
		self.lookup.delivery_by_invoice_row = defaultdict(list)
		self.lookup.original_rows = defaultdict(list)
		self.lookup.purchases = defaultdict(list)
		self.row = frappe._dict(parent="SI", item_row="ROW", item_code="A", warehouse="WH", qty=2, project=None, cost_center=None)

	def test_exact_native_stock_difference_scales_stock_qty(self):
		self.assertEqual(self.lookup.cost(self.row), 80)
		self.row.qty = 6
		self.assertIsNone(self.lookup.cost(self.row))

	def test_recorded_zero_cost_is_known_and_missing_evidence_is_not_zero(self):
		self.lookup.stock[("Sales Invoice", "SI", "ROW", "A", "WH")][0].stock_value_difference = 0
		self.assertEqual(self.lookup.cost(self.row), 0)
		self.lookup.stock.clear()
		self.assertIsNone(self.lookup.cost(self.row))

	def test_hidden_amount_warehouse_item_and_header_are_unknown(self):
		for action in (lambda: self.lookup.warehouses.clear(), lambda: self.lookup.items.clear(), lambda: self.lookup.headers.clear(),
			lambda: self.lookup.stock[("Sales Invoice", "SI", "ROW", "A", "WH")][0].pop("stock_value_difference")):
			self.setUp()
			action()
			self.assertIsNone(self.lookup.cost(self.row))

	def test_packed_components_require_each_readable_valuation(self):
		self.lookup.items["BUNDLE"] = frappe._dict(is_stock_item=0)
		self.row.item_code = "BUNDLE"
		self.lookup.packed[("Sales Invoice", "SI", "ROW")] = [frappe._dict(name="PACKED", item_code="A", warehouse="WH", qty=4)]
		self.lookup.stock[("Sales Invoice", "SI", "ROW", "A", "WH")] = [frappe._dict(actual_qty=-4, stock_value_difference=-160)]
		self.assertEqual(self.lookup.cost(self.row), 160)
		self.lookup.packed[("Sales Invoice", "SI", "ROW")][0].qty = None
		self.assertIsNone(self.lookup.cost(self.row))

	def test_nonstock_latest_net_base_purchase_as_of_sale_and_matching_cost_center(self):
		self.row.item_code = "N"
		self.lookup.headers["SI"].update_stock = 0
		self.row.cost_center = "CC"
		for name, date, time, amount, cc in (("OLD", "2026-11-06", "10:00:00", 80, "CC"),
			("CURRENT", "2026-11-07", "11:00:00", 100, "CC"), ("FUTURE", "2026-11-07", "13:00:00", 999, "CC"),
			("OTHER_CC", "2026-11-07", "11:30:00", 888, "OTHER")):
			self.lookup.purchases["N"].append(frappe._dict(name=name, parent=name, posting_date=date, posting_time=time,
				stock_qty=4, base_net_amount=amount, cost_center=cc, project=None))
		self.assertEqual(self.lookup.cost(self.row), 50)
		del self.row["cost_center"]
		self.assertIsNone(self.lookup.cost(self.row))

	def test_revenue_only_debit_note_needs_no_stock_movement(self):
		self.lookup.headers["SI"].is_debit_note = 1
		self.lookup.stock.clear()
		self.assertEqual(self.lookup.cost(self.row), 0)

	def test_denied_type_never_queries_its_records(self):
		with patch.object(costs.frappe, "has_permission", return_value=False), patch.object(costs.frappe, "get_list") as query:
			self.assertEqual(costs.readable("Purchase Invoice", {}, ["name"]), [])
			query.assert_not_called()

	def test_voucher_batches_apply_company_status_today_and_native_list_permissions(self):
		with patch.object(costs.frappe, "has_permission", return_value=True), patch.object(costs.frappe, "get_list", return_value=[]) as query:
			costs.vouchers("Delivery Note", "Company", [str(value) for value in range(401)], ["name"])
			self.assertEqual([len(call.kwargs["filters"]["name"][1]) for call in query.call_args_list], [200, 200, 1])
			for call in query.call_args_list:
				self.assertEqual(call.kwargs["filters"]["company"], "Company")
				self.assertEqual(call.kwargs["filters"]["docstatus"], 1)
				self.assertEqual(call.kwargs["filters"]["posting_date"][0], "<=")

	def test_partial_cost_is_not_a_complete_profit_and_header_difference_is_explicit(self):
		rows = [frappe._dict(base_net_amount=100), frappe._dict(base_net_amount=50)]
		lookup = Mock(reasons={})
		lookup.cost.side_effect = [40, None]
		with patch.object(costs, "invoice_rows", return_value=(rows, [])), patch.object(costs, "HistoricalCostLookup", return_value=lookup), patch.object(costs.frappe, "has_permission", return_value=True):
			out = costs.invoice_costs("Company", "2026-11-01", "2026-11-07", 200)
			self.assertIsNone(out["cogs"])
			self.assertIsNone(out["gross_profit"])
			self.assertEqual(out["known_cogs"], 40)
			self.assertEqual(out["unknown_rows"], 1)
			self.assertIn("invoice_lines_not_reconciled", out["reasons"])

	def test_missing_zero_revenue_quantity_cannot_make_cost_appear_complete(self):
		rows = [frappe._dict(parent="SI", document_qty=2, base_net_amount=100)]
		lookup = Mock(reasons={})
		lookup.cost.return_value = 40
		with patch.object(costs, "invoice_rows", return_value=(rows, [frappe._dict(name="SI", total_qty=3)])), patch.object(costs, "HistoricalCostLookup", return_value=lookup), patch.object(costs.frappe, "has_permission", return_value=True):
			out = costs.invoice_costs("Company", "2026-11-01", "2026-11-07", 100)
			self.assertIsNone(out["gross_profit"])
			self.assertIn("invoice_lines_not_reconciled", out["reasons"])
