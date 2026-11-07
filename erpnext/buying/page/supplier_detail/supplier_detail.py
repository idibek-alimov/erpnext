# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

from erpnext.buying.page.supplier_detail.detail_data import (
	build_detail,
	get_invoice_items as invoice_items,
	payment_options,
	payment_invoice,
	record_payment,
)


@frappe.whitelist()
def get_supplier_detail(supplier, company=None, period="month", warehouse=None,
	tab="invoices", search=None, status="unpaid", date_from=None, date_to=None, page=1, page_size=20,
	summary_revision=None, known_revision=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	return build_detail(supplier, company, period, warehouse, tab, search, status, date_from, date_to, page, page_size,
		summary_revision, known_revision)


@frappe.whitelist()
def get_invoice_items(supplier, invoice, company):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	return invoice_items(supplier, invoice, company)


@frappe.whitelist()
def get_payment_options(company):
	return payment_options(company)


@frappe.whitelist()
def get_payment_invoice(supplier, purchase_invoice, company):
	return payment_invoice(supplier, purchase_invoice, company)


@frappe.whitelist(methods=["POST"])
def make_payment(supplier, purchase_invoice, company, amount, account=None, wallet=None,
	posting_date=None, reference_no=None, remarks=None):
	return record_payment(supplier, purchase_invoice, company, amount, account, wallet,
		posting_date, reference_no, remarks)
