import unittest
from unittest.mock import patch

import frappe
from frappe.utils import getdate

from erpnext.buying.page.supplier_hub.supplier_data import (
	SupplierPayables, expand_links, filter_and_summarize, financial_rows, inventory_rows,
	linked_product_profit, profit_rows,
)


class TestSupplierHub(unittest.TestCase):
	def setUp(self):
		if not getattr(frappe.local, "qb", None):
			from frappe.query_builder import get_query_builder
			frappe.local.qb = get_query_builder("mariadb")
		self.suppliers = [frappe._dict(name=name, supplier_name=name, supplier_group="Local",
			mobile_no="123" if name == "A" else "", email_id="", disabled=0) for name in ("A", "B")]
		self.start, self.end = getdate("2026-11-01"), getdate("2026-11-04")

	def rows(self, invoices=(), payments=(), payables=(), permissions=(True, True, True)):
		return financial_rows(self.suppliers, invoices, payments, payables, self.start, self.end, *permissions)

	def invoice(self, name, amount, date, **extra):
		return frappe._dict(name=name, supplier="A", base_grand_total=amount, posting_date=date,
			creation=date + " 12:00:00", is_return=amount < 0, is_opening="No", **extra)

	def test_returns_base_currency_opening_and_deterministic_latest_purchase(self):
		invoices = [self.invoice("OLD", 500, "2026-10-30"), self.invoice("NEW-A", 200, "2026-11-03"),
			self.invoice("NEW-B", 300, "2026-11-03"), self.invoice("RETURN", -100, "2026-11-04")]
		opening = self.invoice("OPENING", 1000, "2026-11-04")
		opening.is_opening = "Yes"
		row = self.rows(invoices + [opening])[0]
		self.assertEqual(row["purchases"], 400)
		self.assertEqual(row["total_purchased"], 900)
		self.assertEqual(row["last_purchase_invoice"], "NEW-B")
		self.assertEqual(row["invoice_count"], 3)

	def test_credits_are_separate_and_due_today_is_not_overdue(self):
		payables = [dict(party="A", outstanding=80, due_date="2026-11-03"),
			dict(party="A", outstanding=20, due_date="2026-11-04"),
			dict(party="A", outstanding=-30, due_date="2026-10-01"),
			dict(party="RESTRICTED", outstanding=999, due_date="2026-10-01")]
		row = self.rows(payables=payables)[0]
		self.assertEqual((row["current_debt"], row["overdue"], row["credits"]), (100, 80, 30))

	def test_payment_entries_are_cash_activity_not_purchases_less_debt(self):
		payments = [frappe._dict(party="A", posting_date="2026-11-03", payment_type="Pay", base_paid_amount=55),
			frappe._dict(party="A", posting_date="2026-11-04", payment_type="Receive", base_received_amount=10),
			frappe._dict(party="A", posting_date="2026-10-31", payment_type="Pay", base_paid_amount=900)]
		row = self.rows([self.invoice("PI", 200, "2026-11-03")], payments)[0]
		self.assertEqual(row["net_payments"], 45)
		self.assertEqual(row["current_debt"], 0)

	def test_period_changes_activity_but_not_current_balances(self):
		invoices = [self.invoice("PI", 200, "2026-11-02")]
		payables = [dict(party="A", outstanding=50, due_date="2026-11-01")]
		monthly = self.rows(invoices, payables=payables)[0]
		today = financial_rows(self.suppliers, invoices, [], payables, self.end, self.end, True, True, True)[0]
		self.assertEqual(monthly["current_debt"], today["current_debt"])
		self.assertEqual(monthly["overdue"], today["overdue"])
		self.assertEqual((monthly["purchases"], today["purchases"]), (200, 0))

	def inventory(self):
		items = {i.name: i for i in [frappe._dict(name="MODEL", has_variants=1),
			frappe._dict(name="BLUE", variant_of="MODEL", has_variants=0, stock_uom="Nos"),
			frappe._dict(name="RED", variant_of="MODEL", has_variants=0, stock_uom="Nos"),
			frappe._dict(name="METRES", has_variants=0, stock_uom="Metre")]}
		links = expand_links({"A": {"MODEL", "METRES"}, "B": {"BLUE", "HIDDEN"}}, items)
		stock = {"BLUE": dict(qty=10, value=100), "RED": dict(qty=-2, value=-20), "METRES": dict(qty=3.5, value=35)}
		return inventory_rows(self.rows(), links, items, stock, True), stock

	def test_shared_inventory_unique_summary_negative_stock_and_pagination(self):
		rows, stock = self.inventory()
		full = filter_and_summarize(rows, stock)
		page = filter_and_summarize(rows, stock, page=2, page_size=1)
		self.assertEqual(full["summary"], page["summary"])
		self.assertEqual(full["summary"]["total_stock_value"], 115)
		self.assertEqual(sum(r["stock_value"] for r in rows), 215)
		self.assertEqual(next(r for r in rows if r["name"] == "B")["skus_count"], 1)

	def test_filtered_summary_uses_only_matching_suppliers(self):
		rows, stock = self.inventory()
		result = filter_and_summarize(rows, stock, search="123")
		self.assertEqual(result["total"], 1)
		self.assertEqual(result["summary"]["total_stock_value"], 115)
		self.assertTrue(result["summary"]["has_shared_products"])
		self.assertEqual(filter_and_summarize(rows, stock, supplier_group="Missing")["total"], 0)

	def test_numeric_filter_does_not_add_incompatible_units(self):
		rows, stock = self.inventory()
		self.assertIsNone(next(r for r in rows if r["name"] == "A")["stock_uom"])
		result = filter_and_summarize(rows, stock, stock_filter="gte", stock_qty=5)
		self.assertEqual([r["name"] for r in result["suppliers"]], ["B"])

	def test_profit_follows_filtered_products_without_double_counting_shared_skus(self):
		rows, stock = self.inventory()
		profits = {"BLUE": 50, "RED": -20, "METRES": 10}
		profit_rows(rows, profits)
		self.assertEqual([r["gross_profit"] for r in rows], [40, 50])
		full = filter_and_summarize(rows, stock, profits=profits)
		self.assertEqual(full["summary"]["gross_profit"], 40)
		self.assertEqual(filter_and_summarize(rows, stock, page=2, page_size=1, profits=profits)["summary"], full["summary"])
		filtered = filter_and_summarize(rows, stock, search="B", profits=profits)
		self.assertEqual(filtered["summary"]["gross_profit"], 50)
		self.assertEqual(filter_and_summarize(rows, stock, supplier_group="Missing", profits=profits)["summary"]["gross_profit"], 0)
		self.assertEqual(filter_and_summarize(rows, stock, sort_by="profit_desc", profits=profits)["suppliers"][0]["name"], "B")

	def test_profit_unavailable_is_not_zero(self):
		rows, stock = self.inventory()
		profit_rows(rows, None)
		self.assertTrue(all(r["gross_profit"] is None for r in rows))
		self.assertIsNone(filter_and_summarize(rows, stock)["summary"]["gross_profit"])
		profit_rows(rows, {"BLUE": None})
		self.assertTrue(all(r["gross_profit"] is None for r in rows))
		self.assertIsNone(filter_and_summarize(rows, stock, profits={"BLUE": None})["summary"]["gross_profit"])

	@patch("frappe.has_permission", return_value=False)
	@patch("erpnext.buying.page.supplier_hub.supplier_data.readable")
	def test_profit_denied_before_invoice_query(self, query, permission):
		self.assertIsNone(linked_product_profit({"A": {"BLUE"}}, "Company", ["Stores"], self.start, self.end))
		query.assert_not_called()

	@patch("frappe.has_permission", return_value=True)
	@patch("erpnext.buying.page.supplier_hub.supplier_data.readable")
	@patch("erpnext.accounts.report.gross_profit.gross_profit.GrossProfitGenerator.prepare_invoice_query")
	@patch("erpnext.stock.page.product_detail.product_detail.ProductCostLookup")
	def test_profit_uses_historical_cost_returns_and_revenue_only_debit_notes(self, lookup, prepare, invoices, permission):
		invoices.return_value = [frappe._dict(name="PERMITTED")]
		query = prepare.return_value
		query.where.return_value = query
		query.run.return_value = [frappe._dict(item_code="BLUE", base_net_amount=200, is_debit_note=0),
			frappe._dict(item_code="BLUE", base_net_amount=-50, is_debit_note=0),
			frappe._dict(item_code="BLUE", base_net_amount=10, is_debit_note=1),
			frappe._dict(item_code="UNLINKED", base_net_amount=999, is_debit_note=0)]
		lookup.return_value.cost.side_effect = [120, -30]
		profits = linked_product_profit({"A": {"BLUE"}}, "Company", ["Stores"], self.start, self.end)
		self.assertEqual(profits, {"BLUE": 70})
		self.assertEqual(lookup.return_value.cost.call_count, 2)
		invoices.assert_called_once_with("Sales Invoice", dict(company="Company", docstatus=1,
			posting_date=["between", [self.start, self.end]], is_opening="No"), ["name"])
		conditions = [str(c.args[0]) for c in query.where.call_args_list]
		self.assertTrue(any("PERMITTED" in c and "name" in c for c in conditions))
		self.assertTrue(any("Stores" in c and "warehouse" in c for c in conditions))
		self.assertNotIn("UNLINKED", profits)
		self.assertTrue(all(row.item_code == "BLUE" for row in lookup.call_args.args[0]))

	def test_missing_permissions_are_unavailable_not_zero_or_settled(self):
		rows = inventory_rows(self.rows(permissions=(False, False, False)), {}, {}, {}, False)
		result = filter_and_summarize(rows, {})
		self.assertIsNone(result["summary"]["total_debt"])
		self.assertIsNone(result["summary"]["total_stock_value"])
		self.assertIsNone(result["suppliers"][0]["net_payments"])
		self.assertEqual(filter_and_summarize(rows, {}, debt_filter="settled")["total"], 0)

	def test_stock_presence_does_not_net_incompatible_units(self):
		items = {"A": frappe._dict(name="A", stock_uom="Nos"),
			"B": frappe._dict(name="B", stock_uom="Metre")}
		stock = {"A": dict(qty=-100, value=-100), "B": dict(qty=10, value=100)}
		rows = inventory_rows(self.rows(), {"A": {"A", "B"}}, items, stock, True)
		self.assertEqual(filter_and_summarize(rows, stock, stock_filter="zero")["suppliers"][0]["name"], "B")
		self.assertEqual(filter_and_summarize(rows, stock, debt_filter="in_stock")["suppliers"][0]["name"], "A")

	@patch("frappe.get_system_settings", return_value="Banker's Rounding")
	def test_native_payment_terms_allocate_partial_payment_and_credit(self, _settings):
		report = SupplierPayables.__new__(SupplierPayables)
		report.filters = frappe._dict()
		report.company_currency = "TJS"
		report.allowed_invoices = {"PI": frappe._dict(currency="TJS", party_account_currency="TJS", total_advance=0, is_return=0)}
		report.schedules = {"PI": [frappe._dict(due_date="2026-11-01", base_payment_amount=60, base_paid_amount=0, discounted_amount=0),
			frappe._dict(due_date="2026-12-01", base_payment_amount=40, base_paid_amount=0, discounted_amount=0)]}
		row = frappe._dict(voucher_type="Purchase Invoice", voucher_no="PI", invoiced=100, paid=20, credit_note=10, outstanding=70)
		report.allocate_outstanding_based_on_payment_terms(row)
		self.assertEqual([term.outstanding for term in row.payment_terms], [30, 40])
		self.assertEqual(sum(t.outstanding for t in row.payment_terms), 70)

	def test_restricted_source_vouchers_are_excluded_from_payable_rows(self):
		report = SupplierPayables.__new__(SupplierPayables)
		report.allowed_invoices, report.allowed_journals, report.allowed_payments = {"OK": {}}, {}, {}
		report.voucher_balance = {"ok": frappe._dict(voucher_type="Purchase Invoice", voucher_no="OK"),
			"hidden": frappe._dict(voucher_type="Purchase Invoice", voucher_no="HIDDEN"),
			"advance": frappe._dict(voucher_type="Payment Entry", voucher_no="HIDDEN-PAYMENT")}
		with patch.object(SupplierPayables.__bases__[0], "build_data"):
			report.build_data()
		self.assertEqual(list(report.voucher_balance), ["ok"])
