import unittest
from unittest.mock import Mock, patch

import frappe
from frappe.utils import getdate

from erpnext.buying.page.supplier_detail import detail_data as sd


class TestSupplierDetail(unittest.TestCase):
	def context(self):
		return dict(currency="TJS", end=getdate("2026-11-04"), can_payables=True,
			invoices=[frappe._dict(name="OLD", posting_date="2026-09-01", due_date="2026-12-01",
				bill_no="REF", base_grand_total=100, currency="TJS", party_account_currency="TJS", is_return=0)],
			payables=[dict(voucher_type="Purchase Invoice", voucher_no="OLD", outstanding=30, due_date="2026-11-01"),
				dict(voucher_type="Purchase Invoice", voucher_no="OLD", outstanding=40, due_date="2026-12-01"),
				dict(voucher_type="Payment Entry", voucher_no="ADVANCE", outstanding=-25),
				dict(voucher_type="Journal Entry", voucher_no="OPEN", posting_date="2026-09-01", outstanding=15, due_date="2026-11-04")])

	def test_terms_and_opening_vouchers_reconcile_without_netting_advances(self):
		rows = sd.invoice_rows(self.context())
		self.assertEqual(sum(r["outstanding"] for r in rows), 85)
		self.assertEqual((rows[0]["due_date"], rows[0]["days_overdue"], rows[0]["outstanding"]), ("2026-11-01", 3, 70))
		self.assertFalse(next(r for r in rows if r["name"] == "OPEN")["can_pay"])

	def test_old_unpaid_not_hidden_by_month_but_history_is_scoped(self):
		rows = sd.invoice_rows(self.context())
		start, end = getdate("2026-11-01"), getdate("2026-11-04")
		self.assertEqual(len(sd.filter_rows(rows, "invoices", "", "unpaid", start, end)), 2)
		self.assertEqual(sd.filter_rows(rows, "invoices", "", "all", start, end), [])
		self.assertEqual(len(sd.filter_rows(rows, "invoices", "REF", "overdue", start, end)), 1)
		self.assertEqual(sd.filter_rows(rows, "invoices", "", "unpaid", start, end, "2026-10-01"), [])

	def test_missing_payable_permission_does_not_mean_settled(self):
		context = self.context()
		context.update(can_payables=False, payables=[])
		rows = sd.invoice_rows(context)
		self.assertIsNone(rows[0]["outstanding"])
		self.assertFalse(rows[0]["can_pay"])
		self.assertEqual(sd.filter_rows(rows, "invoices", "", "settled", getdate("2026-01-01"), context["end"]), [])

	def test_refund_cash_is_negative_and_search_includes_reference(self):
		context = self.context()
		context["payments"] = [frappe._dict(name="PAY", posting_date="2026-11-01", payment_type="Pay", base_paid_amount=50, paid_from="Cash", reference_no="Cheque"),
			frappe._dict(name="REFUND", posting_date="2026-11-04", payment_type="Receive", base_received_amount=10, paid_to="Bank")]
		rows = sd.payment_rows(context)
		self.assertEqual(sum(r["amount"] for r in rows), 40)
		self.assertEqual(sd.filter_rows(rows, "payments", "cheque", "all", getdate("2026-11-01"), context["end"])[0]["name"], "PAY")

	def test_pagination_can_reach_older_history_and_clamps_invalid_pages(self):
		rows = list(range(251))
		self.assertEqual(sd.paginate(rows, 13)["rows"], list(range(240, 251)))
		self.assertEqual(sd.paginate(rows, 999)["page"], 13)
		self.assertEqual(sd.paginate(rows, -2, 999)["page_size"], 100)

	def test_partial_payment_caps_terms_without_changing_their_metadata(self):
		payment = Mock(references=[frappe._dict(due_date="2026-12-01", idx=2, allocated_amount=40, payment_term="Later"),
			frappe._dict(due_date="2026-11-01", idx=1, allocated_amount=60, payment_term="Now")])
		sd.allocate_references(payment, 75)
		rows = payment.set.call_args.args[1]
		self.assertEqual([(r.payment_term, r.allocated_amount) for r in rows], [("Now", 60), ("Later", 15)])

	def test_products_only_include_linked_variants_and_never_sum_mixed_units(self):
		context = self.context()
		context.update(items={"MODEL": frappe._dict(name="MODEL", item_name="Shirt"),
			"BLUE": frappe._dict(name="BLUE", variant_of="MODEL", stock_uom="Nos"),
			"RED": frappe._dict(name="RED", variant_of="MODEL", stock_uom="Nos"),
			"METRE": frappe._dict(name="METRE", stock_uom="Metre", item_name="Fabric")},
			links={"S": {"BLUE", "METRE"}}, stock={"BLUE": dict(qty=2, value=20), "RED": dict(qty=99, value=990), "METRE": dict(qty=1.5, value=15)})
		rows = sd.product_rows(context, "S")
		self.assertEqual(sum(r["stock_value"] for r in rows), 35)
		self.assertEqual(next(r for r in rows if r["name"] == "MODEL")["variants"], 1)

	@patch.object(sd, "current_revision", return_value="REV")
	@patch.object(sd, "load_supplier_context")
	@patch.object(sd, "linked_product_profit", return_value={"BLUE": 50, "RED": -10})
	@patch.object(sd, "supplier_profile", return_value={"name": "S"})
	@patch.object(sd, "doc_permission", return_value=True)
	@patch("frappe.get_list", return_value=[])
	@patch("frappe.get_cached_value", return_value="TJS")
	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_doc")
	@patch("frappe.get_cached_doc")
	def test_profit_shares_hub_scope_respects_access_and_skips_partial_refresh(self,
		cached, doc, permission, currency, listing, doc_permission, profile, profits, context, revision):
		start, end = getdate("2026-11-01"), getdate("2026-11-04")
		context.return_value = dict(company="Company", start=start, end=end,
			rows=[dict(name="S", _stock_codes={"BLUE", "RED"})], links={"S": {"BLUE", "RED"}},
			warehouse_names=["Stores", "Other"], can_stock=True, can_payables=True,
			can_purchases=True, can_payments=True)
		full = sd.build_detail("S", "Company", warehouse="Stores", tab="details")
		self.assertEqual(full["summary"]["gross_profit"], 40)
		self.assertTrue(full["permissions"]["profit"])
		self.assertNotIn("_stock_codes", full["summary"])
		profits.assert_called_once_with({"S": {"BLUE", "RED"}}, "Company", ["Stores"], start, end)
		profits.reset_mock()
		partial = sd.build_detail("S", "Company", tab="details", summary_revision="REV")
		self.assertTrue(partial["partial"])
		self.assertNotIn("summary", partial)
		profits.assert_not_called()
		permission.side_effect = lambda doctype, *args, **kwargs: doctype != "Sales Invoice"
		denied = sd.build_detail("S", "Company", tab="details")
		self.assertIsNone(denied["summary"]["gross_profit"])
		self.assertFalse(denied["permissions"]["profit"])
		profits.assert_not_called()

	@patch("frappe.has_permission", side_effect=frappe.PermissionError)
	@patch("frappe.get_doc")
	@patch("frappe.get_cached_doc")
	def test_payment_requires_explicit_payment_permissions_before_construction(self, cached, doc, permission):
		with self.assertRaises(frappe.PermissionError):
			sd.record_payment("S", "PI", "Company", 50)
		permission.assert_called_once_with("Payment Entry", "create", throw=True)

	@patch("frappe.get_cached_value", return_value="TJS")
	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_doc")
	@patch("frappe.get_cached_doc")
	def test_payment_rejects_overpayment_and_wrong_supplier_before_write(self, cached, doc, permission, currency):
		invoice = Mock(company="Company", supplier="S", docstatus=1, is_return=0,
			currency="TJS", party_account_currency="TJS", outstanding_amount=25)
		invoice.invoice_is_blocked.return_value = False
		doc.side_effect = [Mock(), invoice]
		with self.assertRaises(frappe.ValidationError):
			with patch("frappe.throw", side_effect=frappe.ValidationError):
				sd.record_payment("S", "PI", "Company", 50)
		invoice.insert.assert_not_called()
		invoice.supplier = "OTHER"
		doc.side_effect = [Mock(), invoice]
		with self.assertRaises(frappe.ValidationError):
			with patch("frappe.throw", side_effect=frappe.ValidationError):
				sd.record_payment("S", "PI", "Company", 10)

	@patch("frappe.throw", side_effect=frappe.ValidationError)
	@patch("frappe.get_cached_value", return_value="TJS")
	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_doc")
	@patch("frappe.get_cached_doc")
	def test_payment_rejects_foreign_currency_and_cross_company_sources(self, cached, doc, permission, currency, throw):
		invoice = Mock(company="Company", supplier="S", docstatus=1, is_return=0,
			currency="USD", party_account_currency="USD", outstanding_amount=100)
		invoice.invoice_is_blocked.return_value = False
		doc.side_effect = [Mock(), invoice]
		with self.assertRaises(frappe.ValidationError):
			sd.record_payment("S", "PI", "Company", 10, account="BANK")
		invoice.currency = invoice.party_account_currency = "TJS"
		wallet = Mock(company="OTHER", enabled=1)
		doc.side_effect = [Mock(), invoice, wallet]
		with self.assertRaises(frappe.ValidationError):
			sd.record_payment("S", "PI", "Company", 10, wallet="WALLET")
		bank = Mock(company="OTHER", is_group=0, disabled=0, account_type="Bank", account_currency="TJS")
		doc.side_effect = [Mock(), invoice, bank]
		with self.assertRaises(frappe.ValidationError):
			sd.record_payment("S", "PI", "Company", 10, account="BANK")
