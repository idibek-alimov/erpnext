"""Execute history SQL over isolated SQLite fixtures; native permissions are compiled separately.

This verifies actual filtering/union/aggregation/pagination, not native GL posting or
MariaDB's permission compiler. Those remain migrated disposable-site release checks.
"""
import re
import sqlite3
import unittest
from datetime import date, datetime
from unittest.mock import Mock, patch

import frappe
from erpnext.accounts.expense_services import history


class TestExpenseHistory(unittest.TestCase):
	def setUp(self):
		self.db = sqlite3.connect(":memory:")
		self.db.row_factory = sqlite3.Row
		self.fake = Mock()
		self.fake.db.escape.side_effect = lambda value: "'" + value.replace("'", "''") + "'"
		self.fake.db.sql.side_effect = self.sql
		self.fake.has_permission.return_value = True
		self.fake.throw.side_effect = lambda message, *args: (_ for _ in ()).throw(frappe.ValidationError(message))
		self.fake.get_all.return_value = []
		self.fake.get_list.side_effect = self.native_list
		self.context = frappe._dict(company="Test", pos_profile=None, pos_opening_shift=None)
		common = {f: f for f in history.FIELDS}
		self.legacy = dict(doctype="POS Cash Movement", filters={"movement_type": "Expense"}, fields=dict(common,
			expense_category="expense_account", paid_from="source_account", description="remarks", beneficiary_name="against_name"))
		for table, columns in (
			("tabQuick Expense", set(history.FIELDS)),
			("tabPOS Cash Movement", set(self.legacy['fields'].values()) | {"movement_type"}),
		):
			self.db.execute(f"create table `{table}` (" + ",".join(f"`{f}` " + ("integer" if f == "docstatus" else "numeric" if f == "amount" else "text") for f in columns) + ")")
		for table, columns in {
			"tabAccount": "name text, company text, account_type text",
			"tabMoney Wallet": "name text, company text, account text, wallet_type text",
			"tabPOS Profile": "name text, company text",
			"tabPOS Payment Method": "parent text, parenttype text, mode_of_payment text",
			"tabMode of Payment Account": "parent text, parenttype text, company text, default_account text",
		}.items():
			self.db.execute(f"create table `{table}` ({columns})")
		self.db.executemany("insert into `tabAccount` values (?, 'Test', ?)", [("Till", "Cash"), ("Wallet", "Bank"), ("Office", "Bank"), ("Hidden", "Cash")])
		self.db.executemany("insert into `tabMoney Wallet` values (?, 'Test', 'Wallet', 'Mobile Wallet')", [("Alif",), ("Alias",)])
		self.db.execute("insert into `tabPOS Profile` values ('Register', 'Test')")
		self.db.execute("insert into `tabPOS Profile` values ('Other', 'Test')")
		self.db.execute("insert into `tabPOS Payment Method` values ('Register', 'POS Profile', 'Cash')")
		self.db.execute("insert into `tabMode of Payment Account` values ('Cash', 'Mode of Payment', 'Test', 'Till')")
		for index in range(180):
			self.insert("Quick Expense", f"Q{index:03}", amount=1, source="Till")
		for index in range(30):
			self.insert("POS Cash Movement", f"L{index:03}", amount=2, source="Wallet")
		self.insert("POS Cash Movement", "Transfer", amount=999, movement_type="Deposit")
		self.insert("Quick Expense", "Cancelled", amount=999, docstatus=2)
		self.insert("Quick Expense", "Draft", amount=999, docstatus=0)
		self.insert("Quick Expense", "Forbidden account", amount=999, source="Hidden")
		self.insert("Quick Expense", "Other company", amount=999, company="Other")
		self.insert("Quick Expense", "Other register", amount=999, pos_profile="Other", pos_opening_shift="OtherShift")
		self.patches = [patch.object(history, "frappe", self.fake), patch.object(history, "sources", return_value=[history.QUICK_EXPENSE, self.legacy]),
			patch.object(history, "today", return_value="2026-11-05"), patch.object(history, "formatdate", side_effect=lambda value, *_: str(value))]
		for patcher in self.patches:
			patcher.start()
			self.addCleanup(patcher.stop)
		self.addCleanup(self.db.close)

	def insert(self, doctype, name, amount=1, source="Till", docstatus=1, company="Test", **kwargs):
		row = dict(name=name, company=company, amount=amount, posting_date="2026-11-05", creation="2026-11-05 10:00:00",
			modified="2026-11-05 10:00:00", docstatus=docstatus, owner="cashier", pos_profile="Register", pos_opening_shift="Shift")
		if doctype == "Quick Expense":
			row.update(paid_from=source, expense_category="Tea", entry_context="POS Correction", created_from_pos=0)
			row.pop("entry_context"); row.pop("created_from_pos")
		else:
			row.update(source_account=source, expense_account="Meals expense", movement_type="Expense")
		row.update(kwargs)
		columns = ", ".join(f"`{key}`" for key in row)
		self.db.execute(f"insert into `tab{doctype}` ({columns}) values ({', '.join('?' for _ in row)})", tuple(row.values()))

	def native_list(self, doctype, **kwargs):
		self.assertIs(kwargs.get("run"), False)
		self.assertNotIn("ignore_permissions", kwargs)
		self.assertEqual(kwargs["limit_page_length"], 0)
		# Stand-in for Frappe's native permission compiler: explicitly remove a forbidden
		# funding account before the outer aggregation, and honor stored register/shift.
		if doctype == "POS Profile":
			return "select name from `tabPOS Profile` where company = 'Test'"
		account = "paid_from" if doctype == "Quick Expense" else "source_account"
		conditions = [f"`{key}` = '{value}'" for key, value in kwargs["filters"].items()]
		conditions.append(f"`{account}` != 'Hidden'")
		return f"select * from `tab{doctype}` where " + " and ".join(conditions)

	def sql(self, query, values, as_dict=True):
		args = []
		def replace(match):
			value = values[match.group(1)]
			if isinstance(value, (list, tuple)):
				args.extend(value)
				return "(" + ",".join("?" for _ in value) + ")"
			args.append(str(value) if isinstance(value, date) else value)
			return "?"
		query = re.sub(r"%\((\w+)\)s", replace, query)
		result = [frappe._dict(dict(row)) for row in self.db.execute(query, args)]
		for row in result:
			if "creation" in row:
				row.creation = datetime.fromisoformat(row.creation)
		return result

	def load(self, **kwargs):
		return history.list_expenses(self.context, **dict(period="all", **kwargs))

	def test_full_totals_independent_of_page_and_alias_wallets(self):
		self.context.update(pos_profile="Register", pos_opening_shift="Shift")
		first = self.load(limit_page_length=50)
		second = self.load(limit_start=50, limit_page_length=50)
		self.assertEqual(len(first["recent_expenses"]), 50)
		self.assertTrue(first["has_more"])
		self.assertEqual(first["summary"], second["summary"])
		self.assertEqual(first["summary"]["period_total"], 240)
		self.assertEqual(first["summary"]["period_count"], 210)
		self.assertEqual(first["summary"]["cash_total"], 180)
		self.assertEqual(first["summary"]["bank_total"], 60)
		self.assertEqual(first["summary"]["mobile_total"], 60)
		self.assertEqual(sum(row['total'] for row in first['summary']['category_breakdown']), 240)
		ids = []
		for offset in range(0, 210, 50):
			ids.extend(row.source_id for row in self.load(limit_start=offset)["recent_expenses"])
		self.assertEqual(len(ids), len(set(ids)))
		self.assertEqual(len(ids), 210)

	def test_original_sources_and_amendment_links_preserved(self):
		self.insert("POS Cash Movement", "Original", amended_from="Old cancelled", journal_entry="JE-Evidence")
		row = self.load(search="Original")["recent_expenses"][0]
		self.assertEqual(row.source_id, "POS Cash Movement:Original")
		self.assertEqual(row.amended_from, "Old cancelled")
		self.assertEqual(row.journal_entry, "JE-Evidence")
		self.assertEqual(row.category_id, "legacy:Meals expense")

	def test_transfer_draft_cancelled_and_hidden_account_not_in_posted_totals(self):
		result = self.load()
		self.assertEqual(result["summary"]["period_total"], 1239)  # Other permitted register included in Desk.
		all_statuses = self.load(status="all")
		self.assertEqual(all_statuses["summary"]["period_total"], 1239)
		self.assertEqual(all_statuses["summary"]["matching_count"], result['summary']['matching_count'] + 2)
		self.assertEqual(self.load(status="cancelled")["summary"]["period_total"], 0)
		self.assertEqual(self.load(search="Transfer")["summary"]["matching_count"], 0)

	def test_manager_records_use_relationship_not_origin_and_unassigned_stays_out_of_shift(self):
		self.insert("Quick Expense", "Unassigned", pos_profile=None, pos_opening_shift=None)
		self.context.update(pos_profile="Register", pos_opening_shift="Shift")
		self.assertEqual(self.load()["summary"]["period_count"], 210)
		self.context.update(pos_profile=None, pos_opening_shift=None)
		result = self.load(search="Unassigned")
		self.assertEqual(result['summary']['unassigned_count'], 1)
		self.assertEqual(result['recent_expenses'][0].attribution_status, "Unassigned")
		self.assertIsNone(result['recent_expenses'][0].pos_opening_shift)

	def test_identical_search_category_source_and_date_scope_for_rows_and_totals(self):
		self.context.update(pos_profile="Register", pos_opening_shift="Shift")
		result = self.load(category="legacy:Meals expense", source_id="bank", search="L00")
		self.assertEqual(result['summary']['period_total'], 20)
		self.assertEqual(len(result['recent_expenses']), 10)
		self.assertEqual(self.load(source_id="cash")['summary']['period_total'], 180)
		self.assertEqual(history.list_expenses(self.context, period="custom", from_date="2026-11-01", to_date="2026-11-04")['summary']['period_total'], 0)
		self.assertEqual(self.load(search="' OR 1=1 --")['summary']['period_total'], 0)

	def test_employee_filter_matches_historical_party_after_name_change_and_legacy_recipient(self):
		self.insert("Quick Expense", "PartyOld", party_type="Employee", party="HR-1", beneficiary_name="Former name")
		self.insert("POS Cash Movement", "RecipientNew", against_name="Current name")
		self.fake.get_list.side_effect = lambda doctype, **kw: [frappe._dict(employee_name="Current name")] if doctype == "Employee" else self.native_list(doctype, **kw)
		result = self.load(employee="HR-1", search="name")
		self.assertEqual(result['summary']['period_count'], 2)
		self.assertEqual(result['summary']['period_total'], 2)

	def test_typed_identity_does_not_collide_between_sources(self):
		self.insert("Quick Expense", "SAME")
		self.insert("POS Cash Movement", "SAME")
		rows = self.load(search="SAME")['recent_expenses']
		self.assertEqual({row.source_id for row in rows}, {"Quick Expense:SAME", "POS Cash Movement:SAME"})

	def test_unsupported_status_and_missing_explicit_shift_fail(self):
		for kwargs in ({'status': 'unknown'}, {'period': 'shift'}):
			with self.assertRaises(frappe.ValidationError):
				history.list_expenses(self.context, **kwargs)

	def test_optional_pos_adapter_and_native_permissions(self):
		with patch.object(history, "sources", return_value=[history.QUICK_EXPENSE]):
			result = self.load()
		self.assertEqual({row.source_doctype for row in result['recent_expenses']}, {'Quick Expense'})
		self.fake.has_permission.return_value = False
		self.assertEqual(self.load()['summary']['period_total'], 0)

	def test_no_setup_or_business_writes(self):
		self.load()
		for method in (self.fake.new_doc, self.fake.get_doc, self.fake.db.commit, self.fake.db.set_value):
			method.assert_not_called()

	def test_desk_history_does_not_expand_beyond_native_register_permissions(self):
		self.fake.has_permission.side_effect = lambda dt, *args: dt != "POS Profile"
		self.assertEqual(self.load()["summary"]["period_total"], 0)
		self.insert("Quick Expense", "OfficeOnly", pos_profile=None, pos_opening_shift=None, source="Office")
		self.assertEqual(self.load()["summary"]["period_total"], 1)

	def test_historical_choices_follow_native_scope_and_keep_legacy_identity(self):
		self.context.update(pos_profile="Register", pos_opening_shift="Shift")
		self.insert("Quick Expense", "Retired category", expense_category="Old category", source="Office")
		options = history.filter_options(self.context)
		self.assertEqual(options["accounts"], ["Office", "Till", "Wallet"])
		self.assertEqual(options["categories"], ["Old category", "Tea", "legacy:Meals expense"])
		self.fake.has_permission.side_effect = lambda doctype, *_: doctype != "POS Cash Movement"
		self.assertNotIn("legacy:Meals expense", history.filter_options(self.context)["categories"])

	def test_account_history_filter_is_read_only_and_keeps_other_filters(self):
		self.fake.get_cached_doc.return_value = frappe._dict(name="Wallet", company="Test", disabled=1)
		with patch.object(history.policy, "check_user_scope") as check:
			result = self.load(source_id="account:Wallet", category="legacy:Meals expense", search="L00")
			self.assertEqual(result["summary"]["period_total"], 20)
			self.assertEqual(result["summary"]["matching_count"], 10)
			check.assert_called_once_with("Account", "Wallet")
		self.fake.db.commit.assert_not_called()
		self.fake.new_doc.assert_not_called()

	def test_account_history_filter_rejects_foreign_company_and_user_scope(self):
		self.fake.get_cached_doc.return_value = frappe._dict(name="Hidden", company="Other")
		with self.assertRaises(frappe.ValidationError):
			self.load(source_id="account:Hidden")
		self.fake.get_cached_doc.return_value.company = "Test"
		with patch.object(history.policy, "check_user_scope", side_effect=frappe.PermissionError):
			with self.assertRaises(frappe.PermissionError):
				self.load(source_id="account:Hidden")

	def test_month_dates_returned_with_full_period_totals(self):
		self.insert("Quick Expense", "Old month", posting_date="2026-10-31", amount=999)
		result = history.list_expenses(self.context, period="month")
		self.assertEqual(result["period_from"], "2026-11-01")
		self.assertEqual(result["period_to"], "2026-11-30")
		self.assertEqual(result["summary"]["period_total"], 1239)
