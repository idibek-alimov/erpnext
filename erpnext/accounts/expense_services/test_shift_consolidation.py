"""The caller-owned closing transaction must survive no inner commit/rollback."""

import unittest
from unittest.mock import Mock, patch
from erpnext.accounts.doctype.pos_invoice_merge_log import pos_invoice_merge_log as merge


class TestClosingTransaction(unittest.TestCase):
    def setUp(self):
        for name, value in (("nowdate", "2026-11-06"), ("nowtime", "12:00:00")):
            context=patch.object(merge,name,return_value=value);context.start();self.addCleanup(context.stop)

    def test_atomic_consolidation_does_not_commit_and_publishes_after_commit(self):
        fake=Mock();fake.message_log=[]
        with patch.object(merge,"frappe",fake),patch.object(merge,"split_invoices",return_value=[[{}]]):
            merge.create_merge_logs({"Customer":{"dimensions":[{}]}},commit=False)
        fake.new_doc.return_value.submit.assert_called_once()
        fake.db.commit.assert_not_called();fake.db.rollback.assert_not_called()
        self.assertTrue(fake.publish_realtime.call_args.kwargs["after_commit"])

    def test_atomic_failure_propagates_without_destroying_caller_savepoints(self):
        fake=Mock();fake.message_log=[];fake.new_doc.return_value.submit.side_effect=ValueError("Posting failed")
        with patch.object(merge,"frappe",fake),patch.object(merge,"split_invoices",return_value=[[{}]]),patch.object(merge,"get_error_message",return_value="Posting failed"):
            with self.assertRaises(ValueError):merge.create_merge_logs({"Customer":{"dimensions":[{}]}},commit=False)
        fake.db.commit.assert_not_called();fake.db.rollback.assert_not_called()
        self.assertTrue(fake.publish_realtime.call_args.kwargs["after_commit"])

    def test_ordinary_native_default_preserves_existing_commit_behavior(self):
        fake=Mock();fake.message_log=[]
        with patch.object(merge,"frappe",fake):merge.create_merge_logs({})
        fake.db.commit.assert_called_once();self.assertFalse(fake.publish_realtime.call_args.kwargs["after_commit"])

    def test_atomic_call_stays_synchronous_even_with_large_closing(self):
        fake=Mock();fake.flags.in_test=False
        with patch.object(merge,"frappe",fake),patch.object(merge,"get_invoice_customer_map",return_value={}),patch.object(merge,"create_merge_logs") as create,patch.object(merge,"enqueue_job") as enqueue:
            merge.consolidate_pos_invoices(pos_invoices=[{}]*20,closing_entry=Mock(),commit=False)
        create.assert_called_once();self.assertFalse(create.call_args.kwargs["commit"]);enqueue.assert_not_called()
