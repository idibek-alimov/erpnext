# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import (
	flt,
	cint,
	today,
	getdate,
	add_days,
	add_months,
	get_first_day,
	get_last_day,
	formatdate,
	now_datetime,
)

from erpnext.accounts.utils import get_balance_on
from erpnext.stock.page.product_catalog.product_catalog import get_default_company

ALLOWED_ROLES = {"Accounts Manager", "Stock Manager", "System Manager", "Administrator", "Accounts User"}

DEFAULT_TAX_RATE = 6.0
DEFAULT_TAX_SUPPLIER = "Налоговый комитет"

RU_MONTHS = [
	"", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
	"Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
]

TG_MONTHS = [
	"", "Январ", "Феврал", "Март", "Апрел", "Май", "Июн",
	"Июл", "Август", "Сентябр", "Октябр", "Ноябр", "Декабр"
]


def _check_permission():
	if not ALLOWED_ROLES.intersection(frappe.get_roles()):
		frappe.throw(_("Only Accounts and Store Managers have access to Tax Desk."))


def get_tax_account(company):
	"""Locate or return the default simplified tax liability account."""
	# 1. Search by exact or known names
	account = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"account_name": ["in", ["Simplified Tax 6%", "Упрощенный налог 6%", "Упрощенный налог", "Налог с продаж 6%"]],
			"is_group": 0,
		},
		"name",
	)
	if account:
		return account

	# 2. Search for any leaf account of type Tax or under Duties and Taxes
	tax_accs = frappe.db.sql(
		"""SELECT name FROM `tabAccount`
		WHERE company = %s AND is_group = 0 AND (account_type = 'Tax' OR account_name LIKE '%%Tax%%' OR account_name LIKE '%%Налог%%')
		ORDER BY CASE WHEN account_name LIKE '%%Simplified%%' OR account_name LIKE '%%6%%' THEN 0 ELSE 1 END, creation ASC
		LIMIT 1""",
		(company,),
	)
	if tax_accs:
		return tax_accs[0][0]

	# 3. Fallback: parent Duties and Taxes leaf
	parent = frappe.db.get_value("Account", {"company": company, "account_name": "Duties and Taxes", "is_group": 1}, "name")
	if parent:
		acc = frappe.db.get_value("Account", {"company": company, "parent_account": parent, "is_group": 0}, "name")
		if acc:
			return acc

	return None


def ensure_tax_supplier(company):
	"""Ensure standard Tax Authority Supplier exists in ERPNext."""
	supplier_name = DEFAULT_TAX_SUPPLIER
	if not frappe.db.exists("Supplier", supplier_name):
		# Ensure Supplier Group
		sg = "Government" if frappe.db.exists("Supplier Group", "Government") else "Services"
		if not frappe.db.exists("Supplier Group", sg):
			sg = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"

		doc = frappe.get_doc({
			"doctype": "Supplier",
			"supplier_name": supplier_name,
			"supplier_group": sg,
			"supplier_type": "Company",
			"country": "Tajikistan",
		})
		doc.flags.ignore_permissions = True
		doc.insert()
		frappe.db.commit()
	return supplier_name


def _resolve_period_dates(period="month", from_date=None, to_date=None):
	t = getdate(today())
	if period == "today":
		return t, t
	elif period == "yesterday":
		y = add_days(t, -1)
		return y, y
	elif period == "week":
		start = add_days(t, -t.weekday())
		return start, t
	elif period == "month":
		return get_first_day(t), get_last_day(t)
	elif period == "last_month":
		prev_end = add_days(get_first_day(t), -1)
		return get_first_day(prev_end), prev_end
	elif period == "quarter":
		current_quarter = (t.month - 1) // 3
		q_start_month = current_quarter * 3 + 1
		q_start = getdate(f"{t.year}-{q_start_month:02d}-01")
		q_end = get_last_day(add_months(q_start, 2))
		return q_start, q_end
	elif period == "year":
		return getdate(f"{t.year}-01-01"), getdate(f"{t.year}-12-31")
	elif period == "custom" and from_date and to_date:
		return getdate(from_date), getdate(to_date)
	return get_first_day(t), get_last_day(t)


@frappe.whitelist()
def get_tax_desk_data(period="month", from_date=None, to_date=None, company=None):
	"""Aggregates all tax desk statistics, KPIs, monthly timeline, and wallet options."""
	_check_permission()
	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	tax_account = get_tax_account(company)
	ensure_tax_supplier(company)

	start_date, end_date = _resolve_period_dates(period, from_date, to_date)

	# 1. Period Metrics: Sales Invoices & Returns
	sales_summary = frappe.db.sql(
		"""
		SELECT
			COALESCE(SUM(CASE WHEN is_return = 0 THEN base_grand_total ELSE 0 END), 0) AS gross_sales,
			COALESCE(SUM(CASE WHEN is_return = 1 THEN base_grand_total ELSE 0 END), 0) AS returns,
			SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END) AS invoice_count,
			SUM(CASE WHEN is_return = 1 THEN 1 ELSE 0 END) AS return_count
		FROM `tabSales Invoice`
		WHERE docstatus = 1 AND company = %(company)s AND posting_date BETWEEN %(start)s AND %(end)s
		""",
		{"company": company, "start": start_date, "end": end_date},
		as_dict=True,
	)[0]

	gross_sales = flt(sales_summary.gross_sales)
	returns = abs(flt(sales_summary.returns))
	net_turnover = max(0.0, gross_sales - returns)
	invoice_count = cint(sales_summary.invoice_count)
	return_count = cint(sales_summary.return_count)

	# 2. Tax Accrued
	# Check GL entries booked against tax account by Sales Invoices
	tax_accrued = 0.0
	if tax_account:
		tax_gl = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(credit - debit), 0)
			FROM `tabGL Entry`
			WHERE account = %(acc)s AND is_cancelled = 0
				AND voucher_type IN ('Sales Invoice', 'POS Invoice')
				AND posting_date BETWEEN %(start)s AND %(end)s
			""",
			{"acc": tax_account, "start": start_date, "end": end_date},
		)[0][0]
		tax_accrued = flt(tax_gl)

	# Fallback if no GL entry booked on tax account yet
	calc_tax = round(net_turnover * (DEFAULT_TAX_RATE / 100.0), 2)
	if tax_accrued <= 0.0 and net_turnover > 0:
		tax_accrued = calc_tax

	# 3. Tax Paid for the selected period
	tax_paid = 0.0
	if tax_account:
		paid_gl = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(debit - credit), 0)
			FROM `tabGL Entry`
			WHERE account = %(acc)s AND is_cancelled = 0
				AND voucher_type IN ('Journal Entry', 'Payment Entry')
				AND posting_date BETWEEN %(start)s AND %(end)s
			""",
			{"acc": tax_account, "start": start_date, "end": end_date},
		)[0][0]
		tax_paid = max(0.0, flt(paid_gl))

	balance_due = max(0.0, tax_accrued - tax_paid)

	# 4. Total Current Outstanding Balance across all periods
	total_outstanding = 0.0
	if tax_account:
		tot_gl = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(credit - debit), 0)
			FROM `tabGL Entry`
			WHERE account = %s AND is_cancelled = 0
			""",
			(tax_account,),
		)[0][0]
		total_outstanding = max(0.0, flt(tot_gl))

	# 5. Monthly Timeline Breakdown (Last 12 Months)
	timeline = _build_monthly_timeline(company, tax_account)

	# 6. Money Wallets for payment
	wallets = _get_payment_wallets(company)

	# 7. Recent Tax Payments Log
	payments_history = _get_recent_tax_payments(company, tax_account, limit=30)

	company_doc = frappe.db.get_value("Company", company, ["company_name", "tax_id"], as_dict=True)

	return {
		"company": company,
		"company_name": company_doc.company_name if company_doc else company,
		"tax_id": company_doc.tax_id if company_doc else "",
		"currency": currency,
		"tax_rate": DEFAULT_TAX_RATE,
		"tax_account": tax_account,
		"tax_supplier": DEFAULT_TAX_SUPPLIER,
		"period": period,
		"start_date": str(start_date),
		"end_date": str(end_date),
		"metrics": {
			"gross_sales": gross_sales,
			"returns": returns,
			"net_turnover": net_turnover,
			"invoice_count": invoice_count,
			"return_count": return_count,
			"tax_accrued": tax_accrued,
			"tax_paid": tax_paid,
			"balance_due": balance_due,
			"total_outstanding": total_outstanding,
		},
		"timeline": timeline,
		"wallets": wallets,
		"payments_history": payments_history,
	}


def _build_monthly_timeline(company, tax_account):
	"""Builds month-by-month financial breakdown for the last 12 calendar months."""
	timeline = []
	t = getdate(today())
	curr_month_first = get_first_day(t)

	for i in range(12):
		m_first = add_months(curr_month_first, -i)
		m_last = get_last_day(m_first)
		m_year = m_first.year
		m_month = m_first.month
		m_key = f"{m_year}-{m_month:02d}"

		ru_label = f"{RU_MONTHS[m_month]} {m_year}"
		tg_label = f"{TG_MONTHS[m_month]} {m_year}"

		# Sales & returns
		row = frappe.db.sql(
			"""
			SELECT
				COALESCE(SUM(CASE WHEN is_return = 0 THEN base_grand_total ELSE 0 END), 0) AS gross,
				COALESCE(SUM(CASE WHEN is_return = 1 THEN base_grand_total ELSE 0 END), 0) AS rets,
				COUNT(*) AS cnt
			FROM `tabSales Invoice`
			WHERE docstatus = 1 AND company = %s AND posting_date BETWEEN %s AND %s
			""",
			(company, m_first, m_last),
			as_dict=True,
		)[0]

		gross = flt(row.gross)
		rets = abs(flt(row.rets))
		net = max(0.0, gross - rets)

		# Accrued tax
		accrued = 0.0
		if tax_account:
			tax_gl = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(credit - debit), 0)
				FROM `tabGL Entry`
				WHERE account = %s AND is_cancelled = 0
					AND voucher_type IN ('Sales Invoice', 'POS Invoice')
					AND posting_date BETWEEN %s AND %s
				""",
				(tax_account, m_first, m_last),
			)[0][0]
			accrued = flt(tax_gl)

		if accrued <= 0.0 and net > 0:
			accrued = round(net * (DEFAULT_TAX_RATE / 100.0), 2)

		# Paid tax
		paid = 0.0
		if tax_account:
			paid_gl = frappe.db.sql(
				"""
				SELECT COALESCE(SUM(debit - credit), 0)
				FROM `tabGL Entry`
				WHERE account = %s AND is_cancelled = 0
					AND voucher_type IN ('Journal Entry', 'Payment Entry')
					AND posting_date BETWEEN %s AND %s
				""",
				(tax_account, m_first, m_last),
			)[0][0]
			paid = max(0.0, flt(paid_gl))

		bal = max(0.0, accrued - paid)

		if accrued <= 0 and paid <= 0:
			status = "zero"
		elif bal <= 0:
			status = "paid"
		elif paid > 0:
			status = "partially_paid"
		else:
			status = "unpaid"

		timeline.append({
			"key": m_key,
			"month_number": m_month,
			"year": m_year,
			"ru_label": ru_label,
			"tg_label": tg_label,
			"start_date": str(m_first),
			"end_date": str(m_last),
			"gross_sales": gross,
			"returns": rets,
			"net_turnover": net,
			"tax_accrued": accrued,
			"tax_paid": paid,
			"balance_due": bal,
			"status": status,
		})

	return timeline


def _get_payment_wallets(company):
	"""Retrieves enabled Money Wallets with current live balances."""
	from erpnext.accounts.page.money_hub.money_hub import import_existing_accounts

	try:
		import_existing_accounts(company)
	except Exception:
		pass

	wallets_raw = frappe.db.get_all(
		"Money Wallet",
		filters={"company": company, "enabled": 1},
		fields=["name", "wallet_name", "wallet_type", "account", "icon", "color"],
		order_by="sort_order asc, creation asc",
	)

	out = []
	for w in wallets_raw:
		bal = 0.0
		if w.account:
			bal = flt(get_balance_on(w.account))
		out.append({
			"name": w.name,
			"wallet_name": w.wallet_name,
			"wallet_type": w.wallet_type,
			"account": w.account,
			"icon": w.icon or "💰",
			"color": w.color or "#3182ce",
			"balance": bal,
		})
	return out


def _get_recent_tax_payments(company, tax_account, limit=30):
	"""Returns the audit feed of tax payment entries from GL entries."""
	if not tax_account:
		return []

	rows = frappe.db.sql(
		"""
		SELECT
			gle.name, gle.posting_date, gle.creation, gle.debit AS amount,
			gle.voucher_type, gle.voucher_no, gle.owner, gle.remarks, gle.against
		FROM `tabGL Entry` gle
		WHERE gle.account = %(acc)s AND gle.debit > 0 AND gle.is_cancelled = 0
			AND gle.voucher_type IN ('Journal Entry', 'Payment Entry')
		ORDER BY gle.posting_date DESC, gle.creation DESC
		LIMIT %(limit)s
		""",
		{"acc": tax_account, "limit": limit},
		as_dict=True,
	)

	results = []
	for r in rows:
		# Extract reference or cheque no if Journal Entry
		ref_no = ""
		user_remark = ""
		if r.voucher_type == "Journal Entry":
			je = frappe.db.get_value("Journal Entry", r.voucher_no, ["cheque_no", "user_remark"], as_dict=True)
			if je:
				ref_no = je.cheque_no or ""
				user_remark = je.user_remark or ""
		elif r.voucher_type == "Payment Entry":
			pe = frappe.db.get_value("Payment Entry", r.voucher_no, ["reference_no", "remarks"], as_dict=True)
			if pe:
				ref_no = pe.reference_no or ""
				user_remark = pe.remarks or ""

		results.append({
			"name": r.name,
			"posting_date": str(r.posting_date),
			"formatted_date": formatdate(r.posting_date),
			"amount": flt(r.amount),
			"voucher_type": r.voucher_type,
			"voucher_no": r.voucher_no,
			"ref_no": ref_no,
			"remarks": user_remark or r.remarks,
			"paid_from_account": r.against,
			"user": frappe.utils.get_fullname(r.owner),
		})
	return results


@frappe.whitelist()
def get_tax_audit_invoices(period="month", from_date=None, to_date=None, search=None, is_return=None, company=None, limit=50, page=1):
	"""Detailed reconciliation list of Sales Invoices and Returns in the period."""
	_check_permission()
	company = company or get_default_company()
	start_date, end_date = _resolve_period_dates(period, from_date, to_date)
	limit = cint(limit) or 50
	page = cint(page) or 1
	offset = (page - 1) * limit

	conds = ["docstatus = 1", "company = %(company)s", "posting_date BETWEEN %(start)s AND %(end)s"]
	vals = {"company": company, "start": start_date, "end": end_date}

	if is_return is not None and is_return != "":
		conds.append("is_return = %(is_return)s")
		vals["is_return"] = cint(is_return)

	if search and search.strip():
		conds.append("(name LIKE %(s)s OR customer_name LIKE %(s)s OR remarks LIKE %(s)s)")
		vals["s"] = f"%{search.strip()}%"

	where = " AND ".join(conds)

	total_count = frappe.db.sql(f"SELECT COUNT(*) FROM `tabSales Invoice` WHERE {where}", vals)[0][0]

	invoices = frappe.db.sql(
		f"""
		SELECT
			name, posting_date, posting_time, customer_name,
			base_grand_total AS grand_total, base_net_total AS net_total,
			total_taxes_and_charges AS tax_amount, is_return,
			pos_profile, remarks
		FROM `tabSales Invoice`
		WHERE {where}
		ORDER BY posting_date DESC, posting_time DESC
		LIMIT {limit} OFFSET {offset}
		""",
		vals,
		as_dict=True,
	)

	# Format dates and numbers
	for inv in invoices:
		inv.formatted_date = formatdate(inv.posting_date)
		inv.grand_total = flt(inv.grand_total)
		inv.tax_amount = flt(inv.tax_amount)
		if inv.is_return:
			inv.grand_total = -abs(inv.grand_total)
			inv.tax_amount = -abs(inv.tax_amount)

	return {
		"invoices": invoices,
		"total_count": total_count,
		"page": page,
		"page_count": (total_count + limit - 1) // limit if limit else 1,
	}


@frappe.whitelist()
def record_tax_payment(wallet, amount, posting_date=None, reference_no=None, remarks=None, company=None):
	"""1-Click Tax Payment: Creates and submits a Journal Entry paying tax from wallet to tax authority."""
	_check_permission()
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Payment amount must be greater than 0"))

	wallet_doc = frappe.db.get_value("Money Wallet", wallet, ["account", "wallet_type", "wallet_name"], as_dict=True)
	if not wallet_doc or not wallet_doc.account:
		frappe.throw(_("Selected wallet or account not found"))

	tax_account = get_tax_account(company)
	if not tax_account:
		frappe.throw(_("Tax liability account not found in Chart of Accounts"))

	supplier_name = ensure_tax_supplier(company)
	pay_date = getdate(posting_date or today())

	voucher_type = "Cash Entry" if wallet_doc.wallet_type in ("Till", "Safe") else "Bank Entry"
	ref_str = reference_no.strip() if reference_no else f"TAX-{now_datetime().strftime('%Y%m%d%H%M')}"
	custom_note = f"Оплата налога (УСН 6%) в {supplier_name} из кошелька '{wallet_doc.wallet_name}'."
	if remarks:
		custom_note += f" {remarks}"

	je = frappe.get_doc({
		"doctype": "Journal Entry",
		"voucher_type": voucher_type,
		"company": company,
		"posting_date": pay_date,
		"cheque_no": ref_str,
		"cheque_date": pay_date,
		"pay_to_recd_from": supplier_name,
		"user_remark": custom_note,
		"accounts": [
			{
				"account": tax_account,
				"debit_in_account_currency": amount,
				"credit_in_account_currency": 0,
				"user_remark": f"Погашение налога ({supplier_name})",
			},
			{
				"account": wallet_doc.account,
				"debit_in_account_currency": 0,
				"credit_in_account_currency": amount,
				"user_remark": f"Списание с {wallet_doc.wallet_name}",
			},
		],
	})

	je.flags.ignore_permissions = True
	je.insert()
	je.submit()
	frappe.db.commit()

	return {
		"status": "success",
		"voucher_no": je.name,
		"message": _("Tax payment {0} for {1} TJS recorded successfully").format(je.name, amount),
	}


@frappe.whitelist()
def get_tax_declaration_data(period="month", from_date=None, to_date=None, company=None):
	"""Returns comprehensive structured declaration data for official print preview."""
	_check_permission()
	desk_data = get_tax_desk_data(period, from_date, to_date, company)
	company = desk_data["company"]

	company_details = frappe.db.get_value(
		"Company",
		company,
		["company_name", "tax_id", "phone_no", "email", "registration_details", "country"],
		as_dict=True,
	) or {}

	return {
		"company_details": company_details,
		"desk_data": desk_data,
		"declaration_date": formatdate(today()),
		"current_user_fullname": frappe.utils.get_fullname(frappe.session.user),
	}
