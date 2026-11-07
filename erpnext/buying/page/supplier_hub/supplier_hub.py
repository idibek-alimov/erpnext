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
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# 1. Supplier Doc info
	supp = frappe.db.get_value(
		"Supplier",
		supplier,
		["name", "supplier_name", "supplier_group", "mobile_no", "email_id", "country"],
		as_dict=True,
	)
	if not supp:
		frappe.throw(_("Supplier {0} not found").format(supplier))

	# 2. Invoices list
	invoices = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, bill_no, grand_total, outstanding_amount, status
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 50
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	# 3. Payments list
	payments = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, mode_of_payment, paid_amount, reference_no, reference_date, status
		FROM `tabPayment Entry`
		WHERE party_type = 'Supplier' AND party = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 50
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	# 4. Products list
	# Items from PI, PR, and Item Default
	item_rows = frappe.db.sql(
		"""
		SELECT DISTINCT pii.item_code
		FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pi.supplier = %(supplier)s AND pi.docstatus = 1 AND pi.company = %(company)s AND pii.item_code IS NOT NULL
		UNION
		SELECT DISTINCT pri.item_code
		FROM `tabPurchase Receipt Item` pri
		JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
		WHERE pr.supplier = %(supplier)s AND pr.docstatus = 1 AND pr.company = %(company)s AND pri.item_code IS NOT NULL
		UNION
		SELECT DISTINCT parent as item_code
		FROM `tabItem Default`
		WHERE default_supplier = %(supplier)s
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	direct_items = [r.item_code for r in item_rows if r.item_code]
	all_items = set(direct_items)

	if direct_items:
		variants = frappe.db.sql(
			"SELECT name, variant_of FROM `tabItem` WHERE variant_of IN %(items)s AND disabled = 0",
			{"items": direct_items},
			as_dict=True,
		)
		for v in variants:
			all_items.add(v.name)

		parents = frappe.db.sql(
			"SELECT variant_of FROM `tabItem` WHERE name IN %(items)s AND variant_of IS NOT NULL AND variant_of != ''",
			{"items": direct_items},
			as_dict=True,
		)
		for p in parents:
			all_items.add(p.variant_of)

	products = []
	if all_items:
		items_data = frappe.db.sql(
			"""
			SELECT 
				i.name as item_code, i.item_name, i.item_group, i.image, i.custom_short_code,
				i.has_variants, i.variant_of, i.stock_uom,
				COALESCE(b.actual_qty, 0) as stock_qty,
				COALESCE(b.stock_value, 0) as stock_value,
				COALESCE(b.valuation_rate, 0) as valuation_rate
			FROM `tabItem` i
			LEFT JOIN (
				SELECT item_code, SUM(actual_qty) as actual_qty, SUM(stock_value) as stock_value,
				       AVG(valuation_rate) as valuation_rate
				FROM `tabBin`
				WHERE item_code IN %(items)s
				GROUP BY item_code
			) b ON b.item_code = i.name
			WHERE i.name IN %(items)s AND i.disabled = 0
			ORDER BY b.actual_qty DESC, i.item_name ASC
			""",
			{"items": list(all_items)},
			as_dict=True,
		)

		# Fetch selling prices
		selling_prices = frappe.db.sql(
			"""
			SELECT item_code, price_list_rate
			FROM `tabItem Price`
			WHERE item_code IN %(items)s AND price_list = 'Standard Selling'
			""",
			{"items": list(all_items)},
			as_dict=True,
		)
		sp_map = {p.item_code: flt(p.price_list_rate) for p in selling_prices}

		for it in items_data:
			it["selling_price"] = sp_map.get(it["item_code"], 0.0)
			products.append(it)

	return {
		"supplier": supp,
		"invoices": invoices,
		"payments": payments,
		"products": products,
		"currency": currency,
	}


@frappe.whitelist()
def get_payment_options(company=None):
	from erpnext.buying.page.supplier_detail.detail_data import payment_options

	return payment_options(company or get_default_company())


@frappe.whitelist()
def get_unpaid_invoices(supplier, company=None):
	"""Returns list of submitted purchase invoices with outstanding debt for a supplier."""
	if not supplier:
		return []

	company = company or get_default_company()
	invoices = frappe.db.sql(
		"""
		SELECT name, posting_date, bill_no, grand_total, outstanding_amount
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s AND outstanding_amount > 0
		ORDER BY posting_date DESC, creation DESC
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)
	for inv in invoices:
		inv["grand_total"] = flt(inv["grand_total"], 2)
		inv["outstanding_amount"] = flt(inv["outstanding_amount"], 2)
	return invoices


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
