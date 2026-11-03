import unittest
from unittest.mock import patch

import frappe
from frappe.utils import date_diff, getdate

from erpnext.stock.page.product_catalog.catalog_data import _model_price, period_dates, stock_attention


class TestProductCatalog(unittest.TestCase):
	def test_calendar_month_and_rolling_periods(self):
		with patch("erpnext.stock.page.product_catalog.catalog_data.today", return_value="2026-11-03"):
			self.assertEqual(period_dates("month"), (getdate("2026-11-01"), getdate("2026-11-03")))
			for period, days in (("today", 1), ("7d", 7), ("30d", 30)):
				start, end = period_dates(period)
				self.assertEqual(date_diff(end, start) + 1, days)

	def test_healthy_total_still_warns_about_depleted_variants(self):
		status = stock_attention([40, 0, 3], True)
		self.assertEqual(status["status"], "in_stock")
		self.assertTrue(status["needs_attention"])
		self.assertEqual(status["out_variant_count"], 1)
		self.assertEqual(status["low_variant_count"], 1)

	def test_fully_depleted_products_have_separate_status(self):
		status = stock_attention([0, 0], True)
		self.assertEqual(status["status"], "out_of_stock")
		self.assertFalse(status["needs_attention"])

	def test_standalone_low_stock(self):
		status = stock_attention([2], False)
		self.assertTrue(status["needs_attention"])
		self.assertEqual(status["out_variant_count"], 0)

	@patch("frappe.get_system_settings", return_value="Banker's Rounding")
	def test_variant_promotion_does_not_discount_other_variants(self, _settings):
		model = frappe._dict(name="MODEL", item_group="Clothes")
		variants = [frappe._dict(name="BLUE"), frappe._dict(name="RED")]
		rules = [frappe._dict(item_code="BLUE", item_group=None,
			rate_or_discount="Discount Percentage", discount_percentage=10)]
		price = _model_price(model, variants, {"BLUE": 200, "RED": 100}, {}, rules)
		self.assertEqual(price["discounted_price"], 100)
		self.assertTrue(price["price_varies"])
		self.assertTrue(price["on_sale"])

	def test_missing_price_is_not_presented_as_free(self):
		price = _model_price(frappe._dict(name="ITEM", item_group="Clothes"), [], {}, {}, [])
		self.assertIsNone(price["discounted_price"])
