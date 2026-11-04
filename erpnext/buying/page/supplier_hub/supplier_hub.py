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
	sort_by="debt_desc", page=1, page_size=20,
):
	from erpnext.buying.page.supplier_hub.supplier_data import build_supplier_hub

	return build_supplier_hub(
		search, supplier_group, debt_filter, company, period,
		warehouse, stock_filter, stock_qty, sort_by, page, page_size,
	)


@frappe.whitelist()
def get_supplier_details(supplier, company=None):
	"""Returns product inventory, recent invoices, and recent payments for a single supplier."""
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
	"""Returns payment modes, Money Hub wallets with live balances, and cash/bank accounts for the payment dialog."""
	from erpnext.accounts.utils import get_balance_on
	from erpnext.accounts.page.money_hub.money_hub import import_existing_accounts

	company = company or get_default_company()
	default_cash = frappe.get_cached_value("Company", company, "default_cash_account") or "Cash - R"
	default_bank = frappe.get_cached_value("Company", company, "default_bank_account")
	default_payable = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - R"
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# Ensure Money Wallets are initialized
	try:
		import_existing_accounts(company)
	except Exception:
		pass

	wallets_raw = frappe.db.get_all(
		"Money Wallet",
		filters={"company": company, "enabled": 1},
		fields=["name", "wallet_name", "wallet_type", "account", "mode_of_payment", "icon", "color", "sort_order"],
		order_by="sort_order asc, creation asc",
	)
	wallets = []
	for w in wallets_raw:
		bal = flt(get_balance_on(w.account, company=company)) if w.account else 0.0
		wallets.append({
			"name": w.name,
			"wallet_name": w.wallet_name,
			"wallet_type": w.wallet_type,
			"account": w.account,
			"mode_of_payment": w.mode_of_payment,
			"icon": w.icon or ("💵" if w.wallet_type == "Till" else "🔐" if w.wallet_type == "Safe" else "📱" if w.wallet_type == "Mobile Wallet" else "🏦"),
			"color": w.color or "#3182ce",
			"balance": bal,
			"formatted_balance": f"{bal:,.2f} {currency}",
			"label": f"{w.icon or '💳'} {w.wallet_name} ({bal:,.2f} {currency})",
		})

	# Get active modes of payment
	mops = frappe.db.sql(
		"""
		SELECT mop.name, mop.type, COALESCE(mopa.default_account, '') as default_account
		FROM `tabMode of Payment` mop
		LEFT JOIN `tabMode of Payment Account` mopa ON mopa.parent = mop.name AND mopa.company = %(company)s
		WHERE mop.enabled = 1
		ORDER BY mop.idx ASC, mop.name ASC
		""",
		{"company": company},
		as_dict=True,
	)

	return {
		"wallets": wallets,
		"modes": mops,
		"default_cash_account": default_cash,
		"default_bank_account": default_bank,
		"default_payable_account": default_payable,
		"currency": currency,
	}


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


@frappe.whitelist()
def make_quick_supplier_payment(supplier, amount, purchase_invoice, mode_of_payment=None, wallet=None, posting_date=None, reference_no=None, remarks=None, company=None):
	"""Explicit payment creation to a supplier against a chosen Purchase Invoice credit via Money Hub Wallet."""
	if not supplier:
		frappe.throw(_("Supplier is required"))

	if not purchase_invoice:
		frappe.throw(_("Пожалуйста, выберите накладную для оплаты"))

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Payment amount must be greater than zero"))

	company = company or get_default_company()
	posting_date = posting_date or today()

	# Validate specific Purchase Invoice
	inv = frappe.db.get_value(
		"Purchase Invoice",
		{"name": purchase_invoice, "supplier": supplier, "company": company, "docstatus": 1},
		["name", "grand_total", "outstanding_amount", "bill_no"],
		as_dict=True,
	)
	if not inv:
		frappe.throw(_("Накладная {0} не найдена или не принадлежит поставщику {1}").format(purchase_invoice, supplier))

	outstanding = flt(inv.outstanding_amount, 2)
	if outstanding <= 0:
		frappe.throw(_("Накладная {0} уже полностью оплачена").format(purchase_invoice))

	# User cannot pay more than the outstanding debt on this invoice
	if amount > (outstanding + 0.001):
		frappe.throw(
			_("Сумма оплаты ({0}) не может превышать остаток по накладной {1} ({2})").format(
				frappe.format(amount, {"fieldtype": "Currency"}),
				purchase_invoice,
				frappe.format(outstanding, {"fieldtype": "Currency"}),
			)
		)

	# Cap amount to exact outstanding if small float rounding discrepancy
	if amount > outstanding:
		amount = outstanding

	# Resolve Accounts
	paid_from = None
	wallet_name = None
	if wallet and frappe.db.exists("Money Wallet", wallet):
		w_data = frappe.db.get_value("Money Wallet", wallet, ["account", "mode_of_payment", "wallet_name"], as_dict=True)
		if w_data and w_data.account:
			paid_from = w_data.account
			wallet_name = w_data.wallet_name
			if not mode_of_payment and w_data.mode_of_payment:
				mode_of_payment = w_data.mode_of_payment

	if not paid_from and mode_of_payment:
		paid_from = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": mode_of_payment, "company": company},
			"default_account",
		)

	if not paid_from:
		paid_from = (
			frappe.get_cached_value("Company", company, "default_cash_account")
			or frappe.get_cached_value("Company", company, "default_bank_account")
			or "Cash - R"
		)

	if not mode_of_payment:
		mode_of_payment = frappe.db.get_value(
			"Mode of Payment Account",
			{"default_account": paid_from, "company": company},
			"parent"
		)
	if not mode_of_payment:
		mode_of_payment = "Cash"

	paid_to = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - R"

	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Pay"
	pe.party_type = "Supplier"
	pe.party = supplier
	pe.company = company
	pe.posting_date = posting_date
	pe.mode_of_payment = mode_of_payment
	pe.paid_from = paid_from
	pe.paid_to = paid_to
	pe.paid_amount = amount
	pe.received_amount = amount
	pe.reference_no = reference_no
	pe.reference_date = posting_date
	pe.custom_remarks = 1
	wallet_suffix = f" (через {wallet_name})" if wallet_name else ""
	pe.remarks = (remarks or "").strip() or _("Оплата по накладной {0}{1}").format(purchase_invoice, wallet_suffix)

	pe.setup_party_account_field()
	pe.set_missing_values()

	# Explicit allocation strictly to the chosen Purchase Invoice
	pe.append(
		"references",
		{
			"reference_doctype": "Purchase Invoice",
			"reference_name": inv.name,
			"total_amount": inv.grand_total,
			"outstanding_amount": inv.outstanding_amount,
			"allocated_amount": amount,
		},
	)

	pe.flags.ignore_permissions = True
	pe.insert()
	pe.submit()

	# Calculate new updated debt for supplier
	updated_debt = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabPurchase Invoice`
		WHERE supplier = %s AND docstatus = 1 AND company = %s
		""",
		(supplier, company),
	)[0][0]

	new_inv_outstanding = max(0.0, flt(outstanding - amount, 2))

	wallet_msg = f" через кошелёк «{wallet_name}»" if wallet_name else ""
	return {
		"success": True,
		"payment_entry": pe.name,
		"paid_amount": amount,
		"wallet": wallet_name,
		"purchase_invoice": purchase_invoice,
		"invoice_remaining_debt": new_inv_outstanding,
		"updated_debt": flt(updated_debt, 2),
		"message": _("Оплата {0} на сумму {1}{2} по накладной {3} успешно проведена").format(
			pe.name, frappe.format(amount, {"fieldtype": "Currency"}), wallet_msg, purchase_invoice
		),
	}


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
