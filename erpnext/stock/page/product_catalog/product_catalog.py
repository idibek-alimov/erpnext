# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe


def get_default_company():
	return (
		frappe.defaults.get_user_default("Company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Company", {}, "name")
	)


def get_stores_warehouse(company):
	if not company:
		company = get_default_company()

	# 1. Configured global default warehouse in Stock Settings
	stock_settings_wh = frappe.db.get_single_value("Stock Settings", "default_warehouse")
	if stock_settings_wh:
		wh_company, is_group = frappe.db.get_value("Warehouse", stock_settings_wh, ["company", "is_group"]) or (None, 1)
		if (not wh_company or wh_company == company) and not is_group:
			return stock_settings_wh

	# 2. Company default warehouse
	company_wh = frappe.db.get_value("Company", company, "default_warehouse")
	if company_wh and not frappe.db.get_value("Warehouse", company_wh, "is_group"):
		return company_wh

	# 3. User default warehouse
	user_wh = frappe.defaults.get_user_default("default_warehouse")
	if user_wh and not frappe.db.get_value("Warehouse", user_wh, "is_group"):
		return user_wh

	# 4. Fallback search
	return (
		frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "warehouse_name": "Stores"},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "name": ["like", "%Stores%"]},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "name": ["like", "%Store%"]},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0},
			"name",
		)
	)


@frappe.whitelist()
def get_catalog(search=None, item_group=None, status_filter=None, sort_by=None, page=1,
	page_size=20, company=None, period="month", warehouse=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	from erpnext.stock.page.product_catalog.catalog_data import build_catalog

	return build_catalog(search=search, item_group=item_group, status_filter=status_filter,
		sort_by=sort_by, page=page, page_size=page_size, company=company,
		period=period, warehouse=warehouse)
