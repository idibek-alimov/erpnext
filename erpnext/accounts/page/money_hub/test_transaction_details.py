"""Read-only transaction detail permissions and original/base currency regressions.

Database-free fixtures exercise the public method. Native-site checks are recorded
separately; these fixtures never connect to or post into a business database.
"""

import unittest
from contextlib import ExitStack
from inspect import unwrap
from unittest.mock import Mock, patch

import frappe

from . import money_hub


class DetailTests(unittest.TestCase):

	def setUp(self):
		self.stack = ExitStack()
		self.addCleanup(self.stack.close)
		self.f = Mock(_dict=frappe._dict, PermissionError=frappe.PermissionError)
		self.f.throw.side_effect = lambda message, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(message))
		self.f.get_cached_value.return_value = "TJS"
		self.f.has_permission.return_value = True
		self.f.utils.formatdate.side_effect = lambda value, fmt: str(value)
		self.f.utils.get_fullname.return_value = "Recorder"
		self.doc = frappe._dict(company="Test", docstatus=1, owner="recorder", name="V1",
			posting_date="2026-11-07", posting_time="09:20:00", currency="USD", customer="C1",
			customer_name="Customer", grand_total=100, net_total=90, is_return=0,
			items=[frappe._dict(item_code="ITEM", item_name="Product", qty=2, rate=50, amount=100, uom="Nos")])
		self.doc.check_permission = Mock()
		self.doc.apply_fieldlevel_read_permissions = Mock()
		self.f.get_doc.return_value = self.doc
		self.movements = [frappe._dict(name="GL1", account="USD Bank", account_currency="USD",
			debit=1100, credit=0, debit_in_account_currency=100, credit_in_account_currency=0)]
		self.accounts = ["USD Bank", "Supplier Payable"]
		self.references = ["INV1"]
		def get_list(doctype, **kwargs):
			if doctype == "GL Entry":
				return self.movements
			if doctype == "Account":
				return self.accounts
			return self.references
		self.f.get_list.side_effect = get_list
		self.stack.enter_context(patch.object(money_hub, "frappe", self.f))
		self.stack.enter_context(patch.object(money_hub, "_", lambda text: text))
		self.wallets = self.stack.enter_context(patch.object(money_hub, "_read_wallets", return_value=[
			frappe._dict(account="USD Bank", wallet_name="USD wallet")]))

	def read(self, doctype="Sales Invoice", **kwargs):
		return unwrap(money_hub.get_transaction_details)(doctype, "V1", company="Test", **kwargs)

	def test_arbitrary_doctypes_rejected_before_loading(self):
		for doctype in ("User", "Employee", "DocType", None, [], {}):
			with self.subTest(doctype=doctype), self.assertRaises(frappe.ValidationError):
				self.read(doctype)
		self.wallets.assert_not_called()
		self.f.get_doc.assert_not_called()

	def test_empty_voucher_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			unwrap(money_hub.get_transaction_details)("Journal Entry", "", company="Test")
		self.f.get_doc.assert_not_called()

	def test_wallet_company_ledger_permission_required_before_document_loading(self):
		self.wallets.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			self.read()
		self.f.get_doc.assert_not_called()

	def test_denied_source_document_never_serialized(self):
		self.doc.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			self.read()
		self.f.get_list.assert_not_called()
		self.doc.apply_fieldlevel_read_permissions.assert_not_called()

	def test_wrong_company_rejected_before_ledger_details(self):
		self.doc.company = "Other"
		with self.assertRaises(frappe.PermissionError):
			self.read()
		self.f.get_list.assert_not_called()

	def test_draft_and_cancelled_source_rejected(self):
		for status in (0, 2):
			self.doc.docstatus = status
			with self.subTest(status=status), self.assertRaises(frappe.ValidationError):
				self.read()
		self.f.get_list.assert_not_called()

	def test_no_permitted_cash_leg_rejected(self):
		self.movements.clear()
		with self.assertRaises(frappe.PermissionError):
			self.read()

	def test_no_wallet_scope_rejected_without_global_ledger_query(self):
		self.wallets.return_value = []
		with self.assertRaises(frappe.PermissionError):
			self.read()
		self.f.get_list.assert_not_called()

	def test_native_ledger_scope_and_read_only_contract(self):
		out = self.read()
		self.doc.check_permission.assert_called_once_with("read")
		self.doc.apply_fieldlevel_read_permissions.assert_called_once()
		query = self.f.get_list.call_args_list[0]
		self.assertEqual(query.args, ("GL Entry",))
		self.assertEqual(query.kwargs["filters"], dict(company="Test", voucher_type="Sales Invoice",
			voucher_no="V1", account=["in", ["USD Bank"]], is_cancelled=0))
		self.assertEqual(out["movements"][0]["gl_name"], "GL1")
		self.f.db.sql.assert_not_called()
		self.f.db.commit.assert_not_called()
		self.f.db.set_value.assert_not_called()

	def test_original_invoice_and_account_currencies_are_not_relabelled(self):
		out = self.read()
		self.assertEqual(out["currency"], "USD")
		self.assertEqual(out["company_currency"], "TJS")
		self.assertEqual(out["items"][0]["currency"], "USD")
		self.assertEqual(out["items"][0]["amount"], 100)
		self.assertEqual(out["movements"][0]["debit"], 1100)
		self.assertEqual(out["movements"][0]["account_debit"], 100)
		self.assertEqual(out["movements"][0]["account_currency"], "USD")

	def test_removed_high_permission_fields_stay_missing_not_zero(self):
		def strip_fields():
			self.doc.get("items")[0].pop("rate")
			self.doc.pop("grand_total")
		self.doc.apply_fieldlevel_read_permissions.side_effect = strip_fields
		out = self.read()
		self.assertIsNone(out["grand_total"])
		self.assertIsNone(out["items"][0]["rate"])

	def test_return_payment_keeps_negative_amount(self):
		self.doc.payments = [frappe._dict(mode_of_payment="Card", amount=-100)]
		self.doc.is_return = 1
		out = self.read("POS Invoice")
		self.assertEqual(out["payments"], [dict(mode_of_payment="Card", amount=-100, currency="USD")])

	def test_purchase_original_amount_and_supplier_identity(self):
		self.doc.update(supplier="S1", supplier_name="Supplier")
		out = self.read("Purchase Invoice")
		self.assertEqual(out["party_type"], "Supplier")
		self.assertEqual(out["party_name"], "Supplier")
		self.assertEqual(out["grand_total"], 100)
		self.assertEqual(out["currency"], "USD")

	def payment(self, payment_type="Pay"):
		self.doc.update(payment_type=payment_type, party_type="Supplier", party="S1", party_name="Supplier",
			paid_from="USD Bank", paid_to="Supplier Payable", paid_amount=100, received_amount=1100,
			paid_from_account_currency="USD", paid_to_account_currency="TJS", references=[
				frappe._dict(reference_doctype="Purchase Invoice", reference_name="INV1", total_amount=1100, allocated_amount=1100),
				frappe._dict(reference_doctype="Purchase Invoice", reference_name="DENIED", total_amount=999, allocated_amount=999),
			])

	def test_payment_and_allocation_use_their_account_currencies(self):
		self.payment()
		out = self.read("Payment Entry")
		self.assertEqual(out["paid_from_account_currency"], "USD")
		self.assertEqual(out["paid_amount"], 100)
		self.assertEqual(out["paid_to_account_currency"], "TJS")
		self.assertEqual(out["received_amount"], 1100)
		self.assertEqual(out["references"][0]["currency"], "TJS")
		self.assertEqual(len(out["references"]), 1)
		self.assertTrue(out["references_restricted"])

	def test_receive_allocations_use_paid_from_account_currency(self):
		self.payment("Receive")
		out = self.read("Payment Entry")
		self.assertEqual(out["references"][0]["currency"], "USD")

	def test_denied_reference_type_and_records_not_exposed(self):
		self.payment()
		self.f.has_permission.return_value = False
		out = self.read("Payment Entry")
		self.assertEqual(out["references"], [])
		self.assertTrue(out["references_restricted"])
		self.assertNotIn("DENIED", str(out))

	def test_denied_payment_account_amount_is_not_exposed(self):
		self.payment()
		self.accounts = ["USD Bank"]
		out = self.read("Payment Entry")
		self.assertIsNone(out["paid_to"])
		self.assertIsNone(out["received_amount"])
		self.assertIsNone(out["paid_to_account_currency"])
		self.assertTrue(out["accounts_restricted"])

	def test_journal_original_account_amounts_and_restricted_rows(self):
		self.doc.accounts = [
			frappe._dict(account="USD Bank", account_currency="USD", debit_in_account_currency=100, credit_in_account_currency=0),
			frappe._dict(account="Hidden Account", account_currency="TJS", debit_in_account_currency=0, credit_in_account_currency=1100),
		]
		out = self.read("Journal Entry")
		self.assertEqual(out["accounts"], [dict(account="USD Bank", currency="USD", debit=100, credit=0)])
		self.assertTrue(out["accounts_restricted"])
		self.assertNotIn("Hidden Account", str(out))

	def test_reference_queries_are_batched_by_type(self):
		self.payment()
		self.read("Payment Entry")
		calls = [call for call in self.f.get_list.call_args_list if call.args[0] == "Purchase Invoice"]
		self.assertEqual(len(calls), 1)
		self.assertEqual(set(calls[0].kwargs["filters"]["name"][1]), {"INV1", "DENIED"})
