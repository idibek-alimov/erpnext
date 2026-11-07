"""Command transaction/retry regressions; database and native posting are isolated."""

import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from unittest.mock import Mock, patch

import frappe

from erpnext.accounts.expense_services import commands, policy
from erpnext.accounts.expense_services.test_expense_policy import expense


class TestExpenseCommands(unittest.TestCase):
	def setUp(self):
		self.stack = ExitStack()
		self.addCleanup(self.stack.close)
		self.f = Mock()
		self.f.session.user = "cashier"
		self.f.PermissionError = frappe.PermissionError
		self.f.ValidationError = frappe.ValidationError
		self.f.TimestampMismatchError = frappe.TimestampMismatchError
		self.f.throw.side_effect = lambda message, exc=frappe.ValidationError: (_ for _ in ()).throw(exc(message))
		self.stack.enter_context(patch.object(commands, "frappe", self.f))
		self.stack.enter_context(patch.object(commands, "_", lambda text: text))
		self.stack.enter_context(patch.object(commands, "check_company"))
		self.stack.enter_context(patch.object(commands, "currency_precision", return_value=2))
		self.stack.enter_context(patch.object(commands, "assert_read"))
		self.stack.enter_context(patch.object(commands, "require_manager"))
		self.stack.enter_context(patch.object(commands, "require_schema"))
		self.validate = self.stack.enter_context(patch.object(policy, "validate_expense"))
		self.stack.enter_context(patch.object(commands, "today", return_value="2026-11-05"))
		self.lock = threading.RLock()
		self.records = {}
		self.posting_count = 0
		self.fail_submit = False
		self.f.db.get_value.side_effect = self.get_value
		self.f.get_doc.side_effect = self.get_doc
		self.f.get_cached_value.return_value = "TJS"
		self.payload = dict(company="Test", amount=50, expense_category="Taxi", paid_from="Safe",
			posting_date=None, entry_context="Desk", client_request_id="request-000001")

	def get_value(self, dt, filters, field, **kwargs):
		if dt == "User":
			self.lock.acquire()
			return "cashier"
		if isinstance(filters, dict):
			return next((name for name, doc in self.records.items() if all(doc.get(k) == v for k, v in filters.items())), None)
		return filters if filters in self.records else None

	def get_doc(self, *args, **kwargs):
		if len(args) == 2:
			return self.records[args[1]]
		data = args[0]
		doc = expense(**{k: v for k, v in data.items() if k != "doctype"})
		doc.check_permission = Mock()
		doc.name = "EXP-1"
		doc.modified = "2026-11-05 10:00:00.000000"
		doc.insert = Mock(side_effect=lambda: self.records.update({doc.name: doc}))
		def submit():
			if self.fail_submit:
				raise frappe.ValidationError("native accounting period validation")
			doc.docstatus = 1
			doc.journal_entry = "JE-1"
			self.posting_count += 1
		doc.submit = Mock(side_effect=submit)
		def cancel():
			doc.docstatus = 2
			doc.cancelled_by = "cashier"
		doc.cancel = Mock(side_effect=cancel)
		return doc

	def run_transaction(self, fn, *args, **kwargs):
		try:
			return fn(*args, **kwargs)
		finally:
			# Frappe releases database row locks at outer transaction completion.
			self.lock.release()

	def test_timeout_retry_returns_one_expense_and_one_posting(self):
		first = self.run_transaction(commands.record, self.payload)
		second = self.run_transaction(commands.record, dict(self.payload, amount=50.0))
		self.assertEqual(first, second)
		self.assertEqual(self.posting_count, 1)
		self.assertEqual(len(self.records), 1)
		self.f.db.commit.assert_not_called()

	def test_concurrent_duplicate_requests_serialize(self):
		with ThreadPoolExecutor(max_workers=2) as pool:
			results = list(pool.map(lambda _: self.run_transaction(commands.record, dict(self.payload)), range(2)))
		self.assertEqual(results[0]["name"], results[1]["name"])
		self.assertEqual(self.posting_count, 1)

	def test_same_id_changed_amount_is_rejected(self):
		self.run_transaction(commands.record, self.payload)
		with self.assertRaises(frappe.PermissionError):
			self.run_transaction(commands.record, dict(self.payload, amount=51))
		self.assertEqual(self.posting_count, 1)

	def test_another_actor_cannot_recover_existing_operation(self):
		self.run_transaction(commands.record, self.payload)
		self.f.session.user = "intruder"
		with self.assertRaises(frappe.PermissionError):
			self.run_transaction(commands.outcome, self.payload["client_request_id"])

	def test_missing_id_is_rejected_before_any_posting(self):
		with self.assertRaises(frappe.ValidationError):
			commands.record(dict(self.payload, client_request_id=None))
		self.assertEqual(self.posting_count, 0)

	def test_failed_native_submit_rolls_back_to_savepoint_without_commit(self):
		self.fail_submit = True
		with self.assertRaises(frappe.ValidationError):
			self.run_transaction(commands.record, self.payload)
		self.f.db.rollback.assert_called_once_with(save_point="quick_expense_record")
		self.f.db.commit.assert_not_called()
		self.assertEqual(self.posting_count, 0)

	def test_get_outcome_after_response_loss(self):
		self.run_transaction(commands.record, self.payload)
		outcome = self.run_transaction(commands.outcome, "request-000001")
		self.assertEqual(outcome["status"], "submitted")
		self.assertEqual(outcome["journal_entry"], "JE-1")

	def test_cancellation_reason_and_version_are_required(self):
		with self.assertRaises(frappe.ValidationError):
			commands.cancel("EXP-1", "", None, "cancel-000001")

	def test_cancel_uses_target_scope_and_protects_cross_shift_requests(self):
		self.run_transaction(commands.record, self.payload)
		with self.assertRaises(frappe.PermissionError):
			self.run_transaction(commands.cancel, "EXP-1", "Wrong taxi", "2026-11-05 10:00:00.000000", "cancel-000001", pos_opening_shift="Someone Else's Shift")
		self.records["EXP-1"].cancel.assert_not_called()

	def test_cancel_is_idempotent_and_versions_are_checked(self):
		self.run_transaction(commands.record, self.payload)
		with self.assertRaises(frappe.TimestampMismatchError):
			self.run_transaction(commands.cancel, "EXP-1", "Wrong taxi", "old version", "cancel-000001")
		args = ("EXP-1", "Wrong taxi", "2026-11-05 10:00:00.000000", "cancel-000001")
		first = self.run_transaction(commands.cancel, *args)
		second = self.run_transaction(commands.cancel, *args)
		self.assertEqual(first["status"], "cancelled")
		self.assertEqual(first, second)
		self.records["EXP-1"].cancel.assert_called_once()

	def test_cancellation_failure_has_no_intermediate_commit(self):
		self.run_transaction(commands.record, self.payload)
		self.records["EXP-1"].cancel.side_effect = frappe.ValidationError("closed period")
		with self.assertRaises(frappe.ValidationError):
			self.run_transaction(commands.cancel, "EXP-1", "Wrong taxi", "2026-11-05 10:00:00.000000", "cancel-000001")
		self.f.db.rollback.assert_called_once_with(save_point="quick_expense_cancel")
		self.f.db.commit.assert_not_called()
