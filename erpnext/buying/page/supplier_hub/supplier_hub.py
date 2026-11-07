# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, today

from erpnext.stock.page.product_catalog.product_catalog import get_default_company


@frappe.whitelist()
def get_supplier_hub_data(
	search=None, supplier_group=None, debt_filter="all", company=None,
	period="month", warehouse=None, stock_filter="all", stock_qty=0,
	sort_by="debt_desc", page=1, page_size=20, known_revision=None,
):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	from erpnext.buying.page.supplier_hub.supplier_data import build_supplier_hub

	return build_supplier_hub(
		search, supplier_group, debt_filter, company, period,
		warehouse, stock_filter, stock_qty, sort_by, page, page_size, known_revision,
	)


@frappe.whitelist()
def get_supplier_details(supplier, company=None):
	"""Returns product inventory, recent invoices, and recent payments for a single supplier."""
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	if not supplier:
		return {}
	company = company or get_default_company()
	require_financial_access(company)
	doc = frappe.get_doc("Supplier", supplier)
	doc.check_permission("read")
	doc.apply_fieldlevel_read_permissions()
	from erpnext.buying.page.supplier_hub.supplier_data import load_supplier_context, readable

	context = load_supplier_context(company, "month", None, supplier, include_stock=True, include_payables=False)
	invoices = readable("Purchase Invoice", {"company": company, "supplier": supplier, "docstatus": 1},
		["name", "posting_date", "bill_no", "grand_total", "outstanding_amount", "status", "currency"])
	payments = readable("Payment Entry", {"company": company, "party_type": "Supplier", "party": supplier, "docstatus": 1},
		["name", "posting_date", "mode_of_payment", "paid_amount", "reference_no", "reference_date", "status", "paid_from_account_currency"])
	products = [dict(item, item_code=code,
		stock_qty=flt(context["stock"].get(code, {}).get("qty")) if context["can_stock"] else None,
		stock_value=flt(context["stock"].get(code, {}).get("value")) if context["can_stock"] else None,
		valuation_rate=(flt(context["stock"].get(code, {}).get("value")) / flt(context["stock"].get(code, {}).get("qty"))
			if flt(context["stock"].get(code, {}).get("qty")) else None), selling_price=None)
		for code, item in context["items"].items()]
	if products and frappe.has_permission("Item Price", "read"):
		prices = readable("Item Price", {"item_code": ["in", [row["item_code"] for row in products]],
			"price_list": "Standard Selling", "currency": frappe.get_cached_value("Company", company, "default_currency")},
			["item_code", "price_list_rate"])
		by_code = {row.item_code: row.get("price_list_rate") for row in prices}
		for row in products:
			row["selling_price"] = by_code.get(row["item_code"])
	return dict(supplier={field: doc.get(field) for field in ("name", "supplier_name", "supplier_group", "mobile_no", "email_id", "country")},
		invoices=sorted(invoices, key=lambda row: (str(row.get("posting_date") or ""), row.name), reverse=True)[:50],
		payments=sorted(payments, key=lambda row: (str(row.get("posting_date") or ""), row.name), reverse=True)[:50],
		products=products, currency=frappe.get_cached_value("Company", company, "default_currency"))


@frappe.whitelist()
def get_payment_options(company=None):
	from erpnext.buying.page.supplier_detail.detail_data import payment_options

	return payment_options(company or get_default_company())


@frappe.whitelist()
def get_unpaid_invoices(supplier, company=None):
	"""Returns list of submitted purchase invoices with outstanding debt for a supplier."""
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	if not supplier:
		return []
	company = company or get_default_company()
	require_financial_access(company)
	frappe.get_doc("Supplier", supplier).check_permission("read")
	return frappe.get_list("Purchase Invoice", filters={"supplier": supplier, "company": company,
		"docstatus": 1, "outstanding_amount": [">", 0]},
		fields=["name", "posting_date", "grand_total", "outstanding_amount", "due_date", "currency"],
		order_by="posting_date asc, name asc", limit_page_length=0)


@frappe.whitelist(methods=["POST"])
def make_quick_supplier_payment(supplier, amount, purchase_invoice, mode_of_payment=None, wallet=None,
	posting_date=None, reference_no=None, remarks=None, company=None):
	from erpnext.buying.page.supplier_detail.detail_data import record_payment

	company = company or get_default_company()
	account = frappe.db.get_value("Mode of Payment Account",
		{"parent": mode_of_payment, "company": company}, "default_account") if mode_of_payment else None
	return record_payment(supplier, purchase_invoice, company, amount, account, wallet,
		posting_date, reference_no, remarks, mode_of_payment)


@frappe.whitelist()
def create_quick_supplier(supplier_name, supplier_group="All Supplier Groups", mobile_no=None, email_id=None):
	"""Fast modal supplier creation."""
	supplier_name = (supplier_name or "").strip()
	if not supplier_name:
		frappe.throw(_("Supplier Name is required"))

	if frappe.db.exists("Supplier", supplier_name):
		frappe.throw(_("Supplier with name '{0}' already exists").format(supplier_name))

	supp = frappe.new_doc("Supplier")
	supp.supplier_name = supplier_name
	supp.supplier_group = supplier_group or "All Supplier Groups"
	supp.mobile_no = mobile_no
	supp.email_id = email_id
	supp.flags.ignore_permissions = True
	supp.insert()

	return {"success": True, "name": supp.name, "supplier_name": supp.supplier_name}
