import unittest
from copy import deepcopy
from unittest.mock import Mock, patch

import frappe
from redis.exceptions import TimeoutError as RedisTimeout

from erpnext.buying.page.supplier_hub import supplier_data as data
from erpnext.buying.page.supplier_hub import supplier_revision as revision
from erpnext.buying.page.supplier_detail import detail_data as detail


class TestSupplierLoading(unittest.TestCase):
	@patch("frappe.cache")
	def test_cache_outage_does_not_fail_a_committed_payment(self, cache):
		cache.return_value.set_value.side_effect = RedisTimeout
		revision.clear_supplier_revision()

	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_list")
	def test_batches_are_bounded_deterministic_and_permission_checked(self, query, permission):
		query.return_value = []
		values = [f"ITEM-{n:04d}" for n in range(603)]
		data.batched_rows("Item", {}, ["name"], "name", reversed(values), permitted=True)
		first = [deepcopy(c.kwargs) for c in query.call_args_list]
		self.assertEqual(len(first), 4)
		self.assertEqual(sum(len(c["filters"]["name"][1]) for c in first), 603)
		self.assertTrue(all(len(c["filters"]["name"][1]) <= 200 for c in first))
		query.reset_mock()
		data.batched_rows("Item", {}, ["name"], "name", values + values, permitted=True)
		self.assertEqual([c.kwargs for c in query.call_args_list], first)
		permission.return_value = False
		query.reset_mock()
		self.assertEqual(data.batched_rows("Item", {}, ["name"], "name", values, permitted=True), [])
		query.assert_not_called()

	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_all")
	@patch("frappe.get_list")
	def test_link_discovery_excludes_hidden_items_and_unrelated_siblings(self, permitted, children, permission):
		items = {
			"MODEL": frappe._dict(name="MODEL", has_variants=1, stock_uom="Nos"),
			"BLUE": frappe._dict(name="BLUE", variant_of="MODEL", stock_uom="Nos", disabled=1),
			"DIRECT": frappe._dict(name="DIRECT", variant_of="OTHER", stock_uom="Nos"),
			"OTHER": frappe._dict(name="OTHER", has_variants=1, stock_uom="Nos"),
			"SIBLING": frappe._dict(name="SIBLING", variant_of="OTHER", stock_uom="Nos"),
		}
		def query(doctype, filters, fields, **kwargs):
			if doctype == "Item":
				key = "name" if "name" in filters else "variant_of"
				return [i for i in items.values() if i.get(key) in filters[key][1]]
			if doctype == "Bin":
				self.assertNotIn("HIDDEN", filters["item_code"][1])
				self.assertNotIn("SIBLING", filters["item_code"][1])
				return [frappe._dict(item_code=c, qty=-1 if c == "BLUE" else 2, value=-10 if c == "BLUE" else 20)
					for c in filters["item_code"][1]]
			return []
		permitted.side_effect = query
		children.side_effect = lambda doctype, **kwargs: [frappe._dict(parent=c, default_supplier="S")
			for c in ("MODEL", "DIRECT", "HIDDEN")] if doctype == "Item Default" else []
		metadata, links, stock = data.linked_inventory(["S"], [], {}, "Company", ["Stores"], detailed=True)
		self.assertEqual(links["S"], {"BLUE", "DIRECT"})
		self.assertEqual(sum(r["value"] for r in stock.values()), 10)
		self.assertIn("OTHER", metadata)
		self.assertNotIn("SIBLING", metadata)
		self.assertTrue(all(c.kwargs["filters"] for c in permitted.call_args_list if c.args[0] == "Item"))

	@patch.object(data, "current_revision", return_value="REV")
	@patch.object(data, "load_supplier_context")
	@patch("frappe.get_cached_doc")
	@patch("frappe.has_permission", return_value=True)
	def test_list_revalidation_skips_calculations_and_still_checks_access(self, permission, company, context, current):
		self.assertEqual(data.build_supplier_hub(company="Company", known_revision="REV"), dict(unchanged=True, revision="REV"))
		company.return_value.check_permission.assert_called_once_with("read")
		context.assert_not_called()
		permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			data.build_supplier_hub(company="Company", known_revision="REV")

	@patch.object(detail, "current_revision", return_value="REV")
	@patch.object(detail, "load_supplier_context")
	@patch("frappe.get_doc")
	@patch("frappe.get_cached_doc")
	def test_detail_revalidation_checks_supplier_before_skipping_work(self, company, supplier, context, current):
		self.assertEqual(detail.build_detail("S", "Company", known_revision="REV"), dict(unchanged=True, revision="REV"))
		supplier.return_value.check_permission.assert_called_once_with("read")
		context.assert_not_called()
		supplier.return_value.check_permission.side_effect = frappe.PermissionError
		with self.assertRaises(frappe.PermissionError):
			detail.build_detail("S", "Company", known_revision="REV")

	@patch.object(revision, "clear_supplier_revision")
	def test_invalidation_waits_for_commit_and_deduplicates_stock_changes(self, clear):
		local = Mock(supplier_revision_pending=False)
		db = Mock()
		with patch.object(frappe, "local", local), patch.object(frappe, "db", db):
			revision.invalidate_supplier_pages(frappe._dict(doctype="Bin"))
			revision.invalidate_supplier_pages(frappe._dict(doctype="Payment Entry"))
			clear.assert_not_called()
			self.assertEqual(db.after_commit.add.call_count, 1)
			db.after_commit.add.call_args.args[0]()
			clear.assert_called_once()
			self.assertFalse(local.supplier_revision_pending)

	@patch.object(revision, "clear_supplier_revision")
	def test_rollback_and_unrelated_documents_do_not_invalidate(self, clear):
		local = Mock(supplier_revision_pending=False)
		db = Mock()
		with patch.object(frappe, "local", local), patch.object(frappe, "db", db):
			revision.invalidate_supplier_pages(frappe._dict(doctype="ToDo"))
			db.after_commit.add.assert_not_called()
			revision.invalidate_supplier_pages(frappe._dict(doctype="User Permission"))
			db.after_rollback.add.call_args.args[0]()
			clear.assert_not_called()
			self.assertFalse(local.supplier_revision_pending)

	@patch("frappe.core.doctype.user_permission.user_permission.get_user_permissions")
	@patch("frappe.get_roles", return_value=["Purchase User"])
	@patch("frappe.cache")
	@patch.object(revision, "today", return_value="2026-11-04")
	@patch.object(revision.time, "time", return_value=100)
	@patch("frappe.has_permission", return_value=True)
	@patch("frappe.get_cached_doc")
	def test_revision_changes_with_data_permissions_day_and_expiry(self, report, permission, clock, today, cache, roles, permissions):
		report.return_value.is_permitted.return_value = True
		permissions.return_value = {}
		cache.return_value.get_value.return_value = "A"
		with patch.object(frappe, "session", frappe._dict(user="owner")):
			initial = revision.current_revision()
			self.assertEqual(revision.current_revision(), initial)
			self.assertNotEqual(revision.current_revision(["Other Company", "month"]), initial)
			cache.return_value.get_value.return_value = "B"
			self.assertNotEqual(revision.current_revision(), initial)
			cache.return_value.get_value.return_value = "A"
			permissions.return_value = {"Warehouse": [dict(doc="Stores")]}
			self.assertNotEqual(revision.current_revision(), initial)
			permissions.return_value = {}
			permission.return_value = False
			self.assertNotEqual(revision.current_revision(), initial)
			permission.return_value = True
			clock.return_value = 120
			self.assertNotEqual(revision.current_revision(), initial)
			clock.return_value = 100
			today.return_value = "2026-11-05"
			self.assertNotEqual(revision.current_revision(), initial)

	def test_pagination_snapshot_is_bounded_and_never_exposes_internal_stock_codes(self):
		rows = [dict(name=str(n), supplier_name=str(n), supplier_group="", current_debt=1,
			overdue=0, purchases=2, credits=0, stock_qty=1, stock_value=10, stock_uom="Nos",
			in_stock=True, shared_products=0, _stock_codes={str(n)}) for n in range(501)]
		stock = {str(n): dict(value=10) for n in range(501)}
		large = data.filter_and_summarize(rows, stock, page_size=20)
		self.assertNotIn("matching_rows", large)
		small = data.filter_and_summarize(rows[:25], stock, page=2, page_size=20)
		self.assertEqual(len(small["suppliers"]), 5)
		self.assertEqual(len(small["matching_rows"]), 25)
		self.assertEqual(small["summary"]["total_stock_value"], 250)
		self.assertTrue(all("_stock_codes" not in r for r in small["matching_rows"]))
