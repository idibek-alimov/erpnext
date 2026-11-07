"""Native posting construction and transaction ownership, without a business site."""

import unittest
from unittest.mock import Mock, patch

import frappe
from erpnext.accounts.expense_services import shift_adjustments as posting
from erpnext.accounts.doctype.pos_invoice_merge_log import pos_invoice_merge_log as merge


class TestClosingConsolidationTransaction(unittest.TestCase):
    def setUp(self):
        self.f = Mock()
        self.f.message_log = []
        self.doc = Mock()
        self.f.new_doc.return_value = self.doc
        self.groups = {"Customer": {"dimensions": [dict(pos_invoice="POS-1")]}}

    def run_merge(self, **kwargs):
        with patch.object(merge, "frappe", self.f), patch.object(merge, "nowdate", return_value="2026-11-06"), patch.object(merge, "nowtime", return_value="12:00:00"), patch.object(merge, "split_invoices", side_effect=lambda rows: [rows]):
            merge.create_merge_logs(self.groups, **kwargs)

    def test_atomic_closing_does_not_commit_and_defers_notification(self):
        self.run_merge(commit=False)
        self.doc.submit.assert_called_once()
        self.f.db.commit.assert_not_called()
        self.f.db.rollback.assert_not_called()
        self.assertTrue(self.f.publish_realtime.call_args.kwargs["after_commit"])

    def test_failure_propagates_to_closing_transaction_without_committing(self):
        self.doc.submit.side_effect = frappe.ValidationError("Native consolidation failed")
        with patch.object(merge, "get_error_message", return_value="Native consolidation failed"):
            with self.assertRaises(frappe.ValidationError):
                self.run_merge(commit=False)
        self.f.db.commit.assert_not_called()
        self.f.db.rollback.assert_not_called()

    def test_native_default_keeps_its_original_transaction_boundary(self):
        self.run_merge()
        self.f.db.commit.assert_called_once()

    def test_atomic_caller_never_queues_the_financial_work(self):
        closing = Mock()
        with patch.object(merge, "frappe", self.f), patch.object(merge, "get_invoice_customer_map", return_value=self.groups), patch.object(merge, "create_merge_logs") as create, patch.object(merge, "enqueue_job") as queue:
            merge.consolidate_pos_invoices([dict(pos_invoice=f"POS-{i}") for i in range(10)], closing, commit=False)
        queue.assert_not_called()
        create.assert_called_once_with(self.groups, closing, commit=False)


class TestAdjustmentSetup(unittest.TestCase):
    def setUp(self):
        self.f = Mock()
        self.f.throw.side_effect = lambda message, exception=frappe.ValidationError: (_ for _ in ()).throw(exception(message))
        self.f.get_cached_value.return_value = "TJS"
        self.accounts = {
            "Loss": frappe._dict(name="Loss", company="Test", root_type="Expense", account_currency="TJS", is_group=0, disabled=0),
            "Surplus": frappe._dict(name="Surplus", company="Test", root_type="Income", account_currency="TJS", is_group=0, disabled=0),
        }
        self.f.get_cached_doc.side_effect = lambda dt, name: self.accounts[name]
        self.setup = dict(company="Test", shortage_account="Loss", surplus_account="Surplus")

    def validate(self):
        with patch.object(posting, "frappe", self.f), patch.object(posting, "_", lambda s: s), patch.object(posting.policy, "check_company"), patch.object(posting.policy, "check_user_scope"), patch("erpnext.accounts.doctype.accounting_dimension.accounting_dimension.get_accounting_dimensions", return_value=[]):
            return posting.validate_setup(self.setup)

    def test_setup_is_explicit_and_read_only(self):
        self.assertEqual(self.validate(), {})
        self.f.db.commit.assert_not_called()
        self.f.db.set_value.assert_not_called()

    def test_cross_company_disabled_and_foreign_accounts_fail(self):
        for field, value in (("company", "Other"), ("disabled", 1), ("account_currency", "USD"), ("root_type", "Asset")):
            original = self.accounts["Loss"][field]
            self.accounts["Loss"][field] = value
            with self.assertRaises(frappe.ValidationError):
                self.validate()
            self.accounts["Loss"][field] = original

    def test_arbitrary_dimension_names_fail(self):
        self.setup["dimensions_json"] = '{"account": "Surplus"}'
        with self.assertRaises(frappe.ValidationError):
            self.validate()
