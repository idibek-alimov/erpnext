import unittest

import frappe

from erpnext.stock.page.product_detail.product_detail import summarize_product_sales


class TestProductSalesSummary(unittest.TestCase):
	def test_return_reverses_cost_and_revenue_on_its_own_date(self):
		rows = [
			frappe._dict(posting_date="2026-11-01", parent="SALE-1", qty=3,
				base_net_amount=270, buying_amount=180),
			frappe._dict(posting_date="2026-11-03", parent="RETURN-1", qty=-1,
				base_net_amount=-90, buying_amount=-60),
		]
		daily = summarize_product_sales(rows)
		self.assertEqual(daily[0]["date"], "2026-11-03")
		self.assertEqual(daily[0]["returned"], 1)
		self.assertEqual(daily[0]["profit"], -30)
		self.assertEqual(sum(d["revenue"] for d in daily), 180)
		self.assertEqual(sum(d["profit"] for d in daily), 60)

	def test_multiple_lines_group_without_duplicate_invoice_links(self):
		rows = [frappe._dict(posting_date="2026-11-01", parent="SALE-1", qty=1,
			base_net_amount=80, buying_amount=50) for _ in range(2)]
		daily = summarize_product_sales(rows)
		self.assertEqual(len(daily), 1)
		self.assertEqual(daily[0]["invoices"], ["SALE-1"])
		self.assertEqual(daily[0]["sold"], 2)
		self.assertEqual(daily[0]["profit"], 60)

	def test_empty_period(self):
		self.assertEqual(summarize_product_sales([]), [])
