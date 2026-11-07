"""Small native fixtures for the disposable-site expense/review integration suites."""

import unittest

import frappe
from frappe.utils import getdate, today


def ensure_test_company():
	if not getattr(frappe.local, "site", None) or not frappe.conf.get("allow_tests"):
		raise unittest.SkipTest("A disposable migrated site with allow_tests is required")
	frappe.set_user("Administrator")
	company = "_Test Company"
	# The setup wizard normally creates this standard master before Company creates
	# its Transit warehouse. A freshly installed disposable site may not have run it.
	if not frappe.db.exists("Warehouse Type", "Transit"):
		frappe.get_doc(dict(doctype="Warehouse Type", name="Transit")).insert()
	if not frappe.db.exists("Company", company):
		frappe.get_doc(dict(doctype="Company", company_name=company, abbr="_TC",
			country="India", default_currency="INR", chart_of_accounts="Standard",
			create_chart_of_accounts_based_on="Standard Template", enable_perpetual_inventory=0)).insert()
	# Complete only this test company's native defaults if an earlier fixture setup
	# stopped after chart creation (which has its own native commit boundary).
	test_company = frappe.get_doc("Company", company)
	if not frappe.db.exists("Warehouse", {"company": company}):
		test_company.create_default_warehouses()
	if not test_company.cost_center:
		test_company.create_default_cost_center()
	frappe.clear_document_cache("Company", company)
	year = getdate(today()).year
	if not frappe.db.exists("Fiscal Year", str(year)):
		frappe.get_doc(dict(doctype="Fiscal Year", year=str(year),
			year_start_date=f"{year}-01-01", year_end_date=f"{year}-12-31")).insert()
	frappe.db.commit()
