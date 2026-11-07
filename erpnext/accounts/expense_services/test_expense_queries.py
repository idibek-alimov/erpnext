"""Read endpoints must never initialize accounts or categories."""

import unittest
from inspect import unwrap
from unittest.mock import Mock, patch

import frappe

from erpnext.accounts.page.expense_desk import expense_desk


class TestExpenseQueries(unittest.TestCase):
	def test_initialization_is_read_only_and_omits_cashier_staff_directory(self):
		fake = Mock(_dict=frappe._dict)
		fake.get_cached_value.return_value = "TJS"
		context = frappe._dict(company="Test", pos_profile="Register", pos_opening_shift="Shift", entry_context="POS")
		with patch.object(expense_desk, "frappe", fake), \
			patch.object(expense_desk, "_context", return_value=context), \
			patch.object(expense_desk.history, "list_expenses", return_value=dict(recent_expenses=[], summary={}, has_more=False, next_start=None)), \
			patch.object(expense_desk.history, "filter_options", return_value=dict(accounts=[], categories=[])), \
			patch.object(expense_desk, "get_categories", return_value=[]), \
			patch.object(expense_desk.policy, "get_sources", return_value=[]), \
			patch.object(expense_desk.policy, "is_manager", return_value=False):
			result = unwrap(expense_desk.get_expense_desk_init_data)("Test", "Register", "Shift", 1)
		self.assertEqual(result["employees"], [])
		self.assertFalse(result["can_cancel"])
		fake.get_list.assert_not_called()
		fake.new_doc.assert_not_called()
		fake.get_doc.assert_not_called()
		fake.db.commit.assert_not_called()
		fake.db.sql.assert_not_called()

	def test_pos_origin_flag_without_shift_is_rejected(self):
		fake = Mock()
		fake.throw.side_effect = frappe.ValidationError("Shift required")
		with patch.object(expense_desk, "frappe", fake), patch.object(expense_desk, "_", lambda s: s):
			with self.assertRaises(frappe.ValidationError):
				expense_desk._context("Test", from_pos=1)

	def test_desk_capabilities_require_native_permissions_and_optional_pos_adapter(self):
		fake = Mock(_dict=frappe._dict)
		fake.get_cached_value.return_value = "TJS"
		fake.has_permission.side_effect = lambda doctype, action: action in {"read", "create"}
		fake.get_hooks.return_value = []
		context = frappe._dict(company="Test", pos_profile=None, pos_opening_shift=None, entry_context="Desk")
		with patch.object(expense_desk, "frappe", fake), \
			patch.object(expense_desk, "_context", return_value=context), \
			patch.object(expense_desk.history, "list_expenses", return_value=dict(recent_expenses=[], summary={}, has_more=False, next_start=None)), \
			patch.object(expense_desk.history, "filter_options", return_value=dict(accounts=["Historic till"], categories=["Old category"])), \
			patch.object(expense_desk, "get_categories", return_value=[]), \
			patch.object(expense_desk.policy, "get_sources", return_value=[]), \
			patch.object(expense_desk.policy, "is_manager", return_value=True):
			result = unwrap(expense_desk.get_expense_desk_init_data)("Test", period="month")
			self.assertFalse(result["can_record"])
			self.assertFalse(result["can_cancel"])
			self.assertFalse(result["can_correct"])
			self.assertEqual(result["history_filters"]["accounts"], ["Historic till"])
			fake.db.commit.assert_not_called()
			fake.new_doc.assert_not_called()

	def test_detail_cancellation_capability_checks_native_permission_for_the_document(self):
		fake = Mock(_dict=frappe._dict)
		doc = Mock(docstatus=1, name="EXP1", amended_from=None, expense_category="Tea", description=None,
			beneficiary_name=None, receipt_attachment=None, correction_reason=None, cancellation_reason=None)
		fake.get_doc.return_value = doc
		fake.has_permission.return_value = False
		fake.get_hooks.return_value = []
		with patch.object(expense_desk, "frappe", fake), \
			patch.object(expense_desk.policy, "require_schema"), \
			patch.object(expense_desk.policy, "assert_read") as assert_read, \
			patch.object(expense_desk.policy, "is_manager", return_value=True), \
			patch.object(expense_desk.commands, "result", return_value=dict(name="EXP1", docstatus=1)):
			result = unwrap(expense_desk.get_expense_detail)("EXP1")
			self.assertFalse(result["can_cancel"])
			fake.has_permission.assert_called_once_with("Quick Expense", "cancel", doc=doc)
			assert_read.assert_called_once_with(doc)
			doc.check_permission.assert_called_once_with("read")

	def test_shift_links_are_optional_and_do_not_import_pos(self):
		fake = Mock()
		fake.get_hooks.return_value = []
		with patch.object(expense_desk, "frappe", fake):
			self.assertEqual(expense_desk._shift_links({}), {})
		fake.get_attr.assert_not_called()

	def test_shift_link_adapter_receives_only_the_authorized_expense(self):
		fake = Mock()
		fake.get_hooks.return_value = ["optional.owner.expense_links"]
		fake.get_attr.return_value.return_value = dict(reviews=[dict(name="REVIEW", status="Partially resolved")])
		doc = frappe._dict(doctype="Quick Expense", name="EXP", pos_opening_shift="OPEN")
		with patch.object(expense_desk, "frappe", fake):
			self.assertEqual(expense_desk._shift_links(doc)["reviews"][0]["status"], "Partially resolved")
		fake.get_attr.return_value.assert_called_once_with(doc)
