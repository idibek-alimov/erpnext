# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import re
import frappe
from frappe import _
from frappe.utils import (
	add_days,
	add_months,
	cint,
	flt,
	formatdate,
	get_first_day,
	get_last_day,
	getdate,
	now_datetime,
	today,
)
from frappe.utils.password import check_password

from erpnext.accounts.doctype.retail_tax_settings.retail_tax_settings import (
	DEFAULT_TAX_SUPPLIER,
	ensure_tax_supplier,
	get_effective_rate_for_date,
	get_retail_tax_settings,
)
from erpnext.accounts.utils import get_balance_on
from erpnext.stock.page.product_catalog.product_catalog import get_default_company

ALLOWED_ROLES = {"Accounts Manager", "Stock Manager", "System Manager", "Administrator", "Accounts User"}

RU_MONTHS = [
	"", "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
	"Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
]

TG_MONTHS = [
	"", "Январ", "Феврал", "Март", "Апрел", "Май", "Июн",
	"Июл", "Август", "Сентябр", "Октябр", "Ноябр", "Декабр"
]

PERIOD_TAG_RE = re.compile(r"(?:за месяц|барои моҳи|\[PERIOD:)\s*(\d{4}-\d{2})\)?")
WALLET_NAME_RE = re.compile(r"из кошелька\s+'([^']+)'")
REGIME_TAG_RE = re.compile(r"\((УСН[^)]+|НДС[^)]+|ААИ[^)]+)\)")


def _check_permission():
	if not ALLOWED_ROLES.intersection(frappe.get_roles()):
		frappe.throw(_("Only Accounts and Store Managers have access to Tax Desk."))


def get_tax_account(company, settings=None):
	"""Locate or return the active regime's tax liability account."""
	settings = settings or get_retail_tax_settings(company)
	if settings.get("active_tax_account"):
		return settings["active_tax_account"]

	account = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"account_name": [
				"in",
				[
					"Упрощенный налог",
					"Simplified Tax 6%",
					"Упрощенный налог 6%",
					"Налог с продаж 6%",
					"НДС к уплате",
				],
			],
			"is_group": 0,
		},
		"name",
	)
	return account


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


def _format_month_key(month_key):
	"""Converts '2026-10' into {'ru': 'Октябрь 2026', 'tg': 'Октябр 2026'}."""
	try:
		parts = str(month_key).split("-")
		y = int(parts[0])
		m = int(parts[1])
		if 1 <= m <= 12:
			return {
				"ru": f"{RU_MONTHS[m]} {y}",
				"tg": f"{TG_MONTHS[m]} {y}",
			}
	except Exception:
		pass
	return {"ru": str(month_key), "tg": str(month_key)}


def _fetch_all_tax_payment_entries(tax_account):
	"""Fetches all non-cancelled tax payment GL entries with their target period (YYYY-MM)."""
	if not tax_account:
		return []

	rows = frappe.db.sql(
		"""
		SELECT
			gle.name,
			gle.posting_date,
			gle.creation,
			(gle.debit - gle.credit) AS amount,
			gle.voucher_type,
			gle.voucher_no,
			gle.owner,
			gle.remarks,
			gle.against,
			je.cheque_no,
			je.user_remark
		FROM `tabGL Entry` gle
		LEFT JOIN `tabJournal Entry` je
			ON gle.voucher_type = 'Journal Entry' AND gle.voucher_no = je.name
		WHERE gle.account = %(acc)s
			AND gle.debit > 0
			AND gle.is_cancelled = 0
			AND gle.voucher_type IN ('Journal Entry', 'Payment Entry')
		ORDER BY gle.posting_date DESC, gle.creation DESC
		""",
		{"acc": tax_account},
		as_dict=True,
	)

	out = []
	for r in rows:
		remark_text = (r.user_remark or r.remarks or "").strip()
		m = PERIOD_TAG_RE.search(remark_text)
		if m:
			target_month = m.group(1)
			has_explicit_period = True
		else:
			pdate = getdate(r.posting_date)
			target_month = f"{pdate.year}-{pdate.month:02d}"
			has_explicit_period = False

		r["target_month"] = target_month
		r["has_explicit_period"] = has_explicit_period
		r["full_remark"] = remark_text
		out.append(r)

	return out


def _get_paid_amount_for_date_range(payment_entries, start_date, end_date):
	"""Sums tax payments belonging to the selected [start_date, end_date] period."""
	start_d = getdate(start_date)
	end_d = getdate(end_date)

	total = 0.0
	is_sub_month = (start_d != get_first_day(start_d)) or (end_d != get_last_day(end_d))

	for p in payment_entries:
		amt = flt(p.get("amount"))
		if amt <= 0:
			continue

		tm = p.get("target_month")
		has_explicit = bool(p.get("has_explicit_period"))

		if is_sub_month and not has_explicit:
			pdate = getdate(p.get("posting_date"))
			if start_d <= pdate <= end_d:
				total += amt
		else:
			try:
				tm_date = getdate(f"{tm}-01")
				if get_first_day(start_d) <= tm_date <= get_last_day(end_d):
					if is_sub_month:
						pdate = getdate(p.get("posting_date"))
						if start_d <= pdate <= end_d:
							total += amt
					else:
						total += amt
			except Exception:
				pdate = getdate(p.get("posting_date"))
				if start_d <= pdate <= end_d:
					total += amt

	return round(max(0.0, total), 2)


def _get_input_vat_for_period(company, input_vat_account, start_date, end_date):
	"""Computes deductible Input VAT accrued on Purchases during [start_date, end_date]."""
	input_vat = 0.0
	if input_vat_account:
		gle_val = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(debit - credit), 0)
			FROM `tabGL Entry`
			WHERE account = %(acc)s AND is_cancelled = 0
				AND voucher_type IN ('Purchase Invoice', 'Journal Entry')
				AND posting_date BETWEEN %(start)s AND %(end)s
			""",
			{"acc": input_vat_account, "start": start_date, "end": end_date},
		)[0][0]
		input_vat = max(0.0, flt(gle_val))

	if input_vat <= 0.0:
		pi_taxes = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(base_total_taxes_and_charges), 0)
			FROM `tabPurchase Invoice`
			WHERE docstatus = 1 AND company = %(company)s
				AND posting_date BETWEEN %(start)s AND %(end)s
			""",
			{"company": company, "start": start_date, "end": end_date},
		)[0][0]
		input_vat = max(0.0, flt(pi_taxes))

	return round(input_vat, 2)


@frappe.whitelist()
def get_tax_desk_data(period="month", from_date=None, to_date=None, company=None):
	"""Aggregates all tax desk statistics, KPIs, monthly timeline, settings, and wallet options."""
	_check_permission()
	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	settings = get_retail_tax_settings(company, auto_provision=True)
	tax_regime = settings["tax_regime"]
	is_vat_regime = settings["is_vat_regime"]
	tax_rate = flt(settings["active_tax_rate"])
	tax_account = settings["active_tax_account"]
	input_vat_account = settings.get("input_vat_account")
	tax_supplier = ensure_tax_supplier(settings.get("tax_authority_supplier") or DEFAULT_TAX_SUPPLIER)

	start_date, end_date = _resolve_period_dates(period, from_date, to_date)
	effective_period_rate = get_effective_rate_for_date(end_date, settings)

	all_payment_entries = _fetch_all_tax_payment_entries(tax_account)

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

	# 2. Output Tax Accrued (Simplified Tax or Output VAT from Sales Invoices)
	output_tax_accrued = 0.0
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
		output_tax_accrued = flt(tax_gl)

	calc_tax = round(net_turnover * (effective_period_rate / 100.0), 2)
	if output_tax_accrued <= 0.0 and net_turnover > 0:
		output_tax_accrued = calc_tax

	# 3. Input VAT Credit (only applicable in General VAT regime)
	input_vat_credit = 0.0
	if is_vat_regime:
		input_vat_credit = _get_input_vat_for_period(company, input_vat_account, start_date, end_date)

	tax_accrued = (
		max(0.0, round(output_tax_accrued - input_vat_credit, 2))
		if is_vat_regime
		else round(output_tax_accrued, 2)
	)

	# 4. Tax Paid for the selected period (respecting target month tags!)
	tax_paid = _get_paid_amount_for_date_range(all_payment_entries, start_date, end_date)
	balance_due = max(0.0, round(tax_accrued - tax_paid, 2))

	# 5. Monthly Timeline Breakdown (Last 12 Months)
	timeline = _build_monthly_timeline(company, tax_account, settings, all_payment_entries)

	# 6. Total Current Outstanding Balance across all 12 months
	total_outstanding = round(sum(flt(m["balance_due"]) for m in timeline), 2)

	# 7. Money Wallets for payment
	wallets = _get_payment_wallets(company)

	# 8. Recent Tax Payments Log (enriched with human-friendly wallet & period columns)
	payments_history = _get_recent_tax_payments(company, all_payment_entries, wallets, settings, limit=200)

	company_doc = frappe.db.get_value("Company", company, ["company_name", "tax_id"], as_dict=True)

	return {
		"company": company,
		"company_name": company_doc.company_name if company_doc else company,
		"tax_id": company_doc.tax_id if company_doc else "",
		"currency": currency,
		"tax_regime": tax_regime,
		"is_vat_regime": is_vat_regime,
		"tax_rate": tax_rate,
		"effective_period_rate": effective_period_rate,
		"tax_account": tax_account,
		"input_vat_account": input_vat_account,
		"tax_supplier": tax_supplier,
		"tax_settings": settings,
		"period": period,
		"start_date": str(start_date),
		"end_date": str(end_date),
		"metrics": {
			"gross_sales": gross_sales,
			"returns": returns,
			"net_turnover": net_turnover,
			"invoice_count": invoice_count,
			"return_count": return_count,
			"output_tax_accrued": output_tax_accrued,
			"input_vat_credit": input_vat_credit,
			"tax_accrued": tax_accrued,
			"tax_paid": tax_paid,
			"balance_due": balance_due,
			"total_outstanding": total_outstanding,
		},
		"timeline": timeline,
		"wallets": wallets,
		"payments_history": payments_history,
	}


@frappe.whitelist()
def save_retail_tax_settings(
	tax_regime,
	simplified_tax_rate=6.0,
	vat_rate=14.0,
	password=None,
	enable_cashless_split=0,
	simplified_cashless_rate=0.0,
	vat_cashless_rate=0.0,
	company=None,
):
	"""Saves updated Retail Tax Settings after verifying the user's password."""
	_check_permission()
	company = company or get_default_company()

	if not password or not str(password).strip():
		frappe.throw(_("Для изменения налогового режима необходимо ввести пароль от вашего аккаунта."))

	try:
		check_password(frappe.session.user, str(password))
	except frappe.AuthenticationError:
		frappe.throw(_("Неверный пароль. Изменение налогового режима отклонено."))

	doc = frappe.get_single("Retail Tax Settings")
	doc.company = company
	doc.tax_regime = tax_regime if tax_regime in ("Simplified", "General (VAT)") else "Simplified"
	doc.simplified_tax_rate = flt(simplified_tax_rate)
	doc.vat_rate = flt(vat_rate)
	doc.enable_cashless_split = cint(enable_cashless_split)
	doc.simplified_cashless_rate = flt(simplified_cashless_rate)
	doc.vat_cashless_rate = flt(vat_cashless_rate)
	doc.flags.ignore_permissions = True
	doc.save()
	frappe.db.commit()

	updated = get_retail_tax_settings(company, auto_provision=False)
	return {
		"status": "success",
		"settings": updated,
		"message": _("Tax regime and rate settings saved and synced with POS Profiles."),
	}


def _compute_month_tax_row(company, tax_account, settings, m_year, m_month, paid_by_month):
	"""Computes tax metrics (turnover, accrued, paid, balance_due, status) for a single calendar month."""
	is_vat_regime = settings.get("is_vat_regime")
	input_vat_account = settings.get("input_vat_account")

	m_key = f"{m_year}-{m_month:02d}"
	m_first = getdate(f"{m_key}-01")
	m_last = get_last_day(m_first)

	ru_label = f"{RU_MONTHS[m_month]} {m_year}" if 1 <= m_month <= 12 else m_key
	tg_label = f"{TG_MONTHS[m_month]} {m_year}" if 1 <= m_month <= 12 else m_key

	eff_rate = get_effective_rate_for_date(m_last, settings)

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

	output_accrued = 0.0
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
		output_accrued = flt(tax_gl)

	if output_accrued <= 0.0 and net > 0:
		output_accrued = round(net * (eff_rate / 100.0), 2)

	input_vat = (
		_get_input_vat_for_period(company, input_vat_account, m_first, m_last)
		if is_vat_regime
		else 0.0
	)

	accrued = (
		max(0.0, round(output_accrued - input_vat, 2))
		if is_vat_regime
		else round(output_accrued, 2)
	)

	paid = flt(paid_by_month.get(m_key, 0.0))
	bal = max(0.0, round(accrued - paid, 2))

	if accrued <= 0 and paid <= 0:
		status = "zero"
	elif bal <= 0:
		status = "paid"
	elif paid > 0:
		status = "partially_paid"
	else:
		status = "unpaid"

	return {
		"key": m_key,
		"month_number": m_month,
		"year": m_year,
		"ru_label": ru_label,
		"tg_label": tg_label,
		"start_date": str(m_first),
		"end_date": str(m_last),
		"effective_rate": eff_rate,
		"gross_sales": gross,
		"returns": rets,
		"net_turnover": net,
		"output_tax_accrued": output_accrued,
		"input_vat_credit": input_vat,
		"tax_accrued": accrued,
		"tax_paid": paid,
		"balance_due": bal,
		"status": status,
	}


def _build_monthly_timeline(company, tax_account, settings, all_payment_entries=None):
	"""Builds month-by-month financial breakdown for the last 12 calendar months with target-month payment matching."""
	timeline = []
	t = getdate(today())
	curr_month_first = get_first_day(t)

	if all_payment_entries is None:
		all_payment_entries = _fetch_all_tax_payment_entries(tax_account)

	paid_by_month = {}
	for p in all_payment_entries:
		tm = p.get("target_month")
		paid_by_month[tm] = round(paid_by_month.get(tm, 0.0) + max(0.0, flt(p.get("amount"))), 2)

	for i in range(12):
		m_first = add_months(curr_month_first, -i)
		timeline.append(
			_compute_month_tax_row(
				company,
				tax_account,
				settings,
				m_first.year,
				m_first.month,
				paid_by_month,
			)
		)

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


def _get_recent_tax_payments(company, all_payment_entries, wallets, settings, limit=200):
	"""Returns user-friendly tax payment records for ordinary store owners."""
	account_to_wallet = {}
	name_to_wallet = {}
	for w in wallets or []:
		if w.get("account"):
			account_to_wallet[w["account"]] = w
		if w.get("wallet_name"):
			name_to_wallet[w["wallet_name"]] = w

	default_regime = (
		f"НДС {flt(settings.get('active_tax_rate', 14)):g}%"
		if settings.get("is_vat_regime")
		else f"УСН {flt(settings.get('active_tax_rate', 6)):g}%"
	)

	results = []
	for r in (all_payment_entries or [])[:limit]:
		remark = r.get("full_remark") or ""
		target_month = r.get("target_month") or ""
		month_labels = _format_month_key(target_month)

		# Resolve human-friendly wallet name and icon
		wallet_obj = account_to_wallet.get(r.get("against"))
		if not wallet_obj:
			wm = WALLET_NAME_RE.search(remark)
			if wm and wm.group(1) in name_to_wallet:
				wallet_obj = name_to_wallet[wm.group(1)]

		if wallet_obj:
			wallet_name = wallet_obj.get("wallet_name") or ""
			wallet_display = f"{wallet_obj.get('icon') or '💰'} {wallet_name}"
		else:
			wm = WALLET_NAME_RE.search(remark)
			wallet_name = wm.group(1) if wm else (r.get("against") or "Касса / Банк")
			wallet_display = wallet_name

		rm = REGIME_TAG_RE.search(remark)
		regime_display = rm.group(1) if rm else default_regime

		vtype = r.voucher_type or "Journal Entry"
		vno = r.voucher_no or ""
		slug = frappe.scrub(vtype).replace("_", "-")
		voucher_route = f"/app/{slug}/{vno}" if vno else ""

		results.append({
			"name": r.name,
			"posting_date": str(r.posting_date),
			"formatted_date": formatdate(r.posting_date),
			"target_month": target_month,
			"period_ru": month_labels["ru"],
			"period_tg": month_labels["tg"],
			"regime_label": regime_display,
			"wallet_name": wallet_name,
			"wallet_display": wallet_display,
			"amount": flt(r.amount),
			"voucher_type": vtype,
			"voucher_no": vno,
			"voucher_route": voucher_route,
			"ref_no": r.get("cheque_no") or "",
			"remarks": remark,
			"paid_from_account": r.against,
			"user": frappe.utils.get_fullname(r.owner),
		})
	return results


@frappe.whitelist()
def get_tax_audit_invoices(
	period="month",
	from_date=None,
	to_date=None,
	search=None,
	is_return=None,
	pos_profile=None,
	sort_field="posting_date",
	sort_order="desc",
	company=None,
	limit=50,
	page=1,
):
	"""Detailed reconciliation list of Sales Invoices and Returns in the period, with filtered totals and sorting."""
	_check_permission()
	company = company or get_default_company()
	settings = get_retail_tax_settings(company, auto_provision=False)
	start_date, end_date = _resolve_period_dates(period, from_date, to_date)
	limit = cint(limit) or 50
	page = cint(page) or 1
	offset = (page - 1) * limit

	conds = ["docstatus = 1", "company = %(company)s", "posting_date BETWEEN %(start)s AND %(end)s"]
	vals = {"company": company, "start": start_date, "end": end_date}

	if is_return is not None and is_return != "":
		conds.append("is_return = %(is_return)s")
		vals["is_return"] = cint(is_return)

	if pos_profile and str(pos_profile).strip():
		conds.append("pos_profile = %(pos_profile)s")
		vals["pos_profile"] = str(pos_profile).strip()

	if search and search.strip():
		conds.append("(name LIKE %(s)s OR customer_name LIKE %(s)s OR remarks LIKE %(s)s)")
		vals["s"] = f"%{search.strip()}%"

	where = " AND ".join(conds)

	all_matching = frappe.db.sql(
		f"""
		SELECT
			name, posting_date, posting_time, customer_name,
			base_grand_total AS grand_total, base_net_total AS net_total,
			base_total_taxes_and_charges AS tax_amount, is_return,
			pos_profile, remarks
		FROM `tabSales Invoice`
		WHERE {where}
		ORDER BY posting_date DESC, posting_time DESC
		""",
		vals,
		as_dict=True,
	)

	total_count = len(all_matching)
	sum_grand_total = 0.0
	sum_net_total = 0.0
	sum_tax_amount = 0.0
	sales_count = 0
	returns_count = 0

	for inv in all_matching:
		inv.formatted_date = formatdate(inv.posting_date)
		inv.grand_total = flt(inv.grand_total)
		inv.net_total = flt(inv.net_total)
		inv.tax_amount = flt(inv.tax_amount)
		if inv.tax_amount == 0 and inv.grand_total != 0:
			eff_rate = get_effective_rate_for_date(inv.posting_date, settings)
			inv.tax_amount = round(abs(inv.grand_total) * (eff_rate / 100.0), 2)
			inv.net_total = round(abs(inv.grand_total) - inv.tax_amount, 2)
		if inv.is_return:
			inv.grand_total = -abs(inv.grand_total)
			inv.net_total = -abs(inv.net_total)
			inv.tax_amount = -abs(inv.tax_amount)
			returns_count += 1
		else:
			sales_count += 1

		sum_grand_total += inv.grand_total
		sum_net_total += inv.net_total
		sum_tax_amount += inv.tax_amount

	# Handle sorting
	sort_order_rev = str(sort_order or "").lower() == "desc"
	valid_sort_fields = {
		"name": lambda x: x.name or "",
		"posting_date": lambda x: (str(x.posting_date), str(x.posting_time or "")),
		"customer_name": lambda x: (x.customer_name or "").lower(),
		"grand_total": lambda x: flt(x.grand_total),
		"net_total": lambda x: flt(x.net_total),
		"tax_amount": lambda x: flt(x.tax_amount),
	}

	if sort_field in valid_sort_fields:
		all_matching.sort(key=valid_sort_fields[sort_field], reverse=sort_order_rev)

	invoices = all_matching[offset : offset + limit]

	pos_profiles = frappe.db.sql(
		"""
		SELECT DISTINCT pos_profile
		FROM `tabSales Invoice`
		WHERE docstatus = 1 AND company = %(company)s AND IFNULL(pos_profile, '') != ''
		ORDER BY pos_profile ASC
		""",
		{"company": company},
		pluck=True,
	)

	return {
		"invoices": invoices,
		"total_count": total_count,
		"sales_count": sales_count,
		"returns_count": returns_count,
		"page": page,
		"page_count": (total_count + limit - 1) // limit if limit else 1,
		"pos_profiles": list(pos_profiles or []),
		"totals": {
			"grand_total": round(sum_grand_total, 2),
			"net_total": round(sum_net_total, 2),
			"tax_amount": round(sum_tax_amount, 2),
		},
	}


@frappe.whitelist()
def record_tax_payment(
	wallet,
	amount,
	posting_date=None,
	reference_no=None,
	remarks=None,
	target_month=None,
	company=None,
):
	"""1-Click Tax Payment: Creates and submits a Journal Entry paying tax from wallet to tax authority."""
	_check_permission()
	company = company or get_default_company()
	amount = round(flt(amount), 2)
	if amount <= 0:
		frappe.throw(_("Сумма оплаты должна быть больше 0"))

	wallet_doc = frappe.db.get_value("Money Wallet", wallet, ["account", "wallet_type", "wallet_name"], as_dict=True)
	if not wallet_doc or not wallet_doc.account:
		frappe.throw(_("Selected wallet or account not found"))

	settings = get_retail_tax_settings(company, auto_provision=True)
	tax_account = settings.get("active_tax_account") or get_tax_account(company, settings)
	if not tax_account:
		frappe.throw(_("Tax liability account not found in Chart of Accounts"))

	supplier_name = ensure_tax_supplier(settings.get("tax_authority_supplier") or DEFAULT_TAX_SUPPLIER)
	pay_date = getdate(posting_date or today())

	if not target_month:
		m = PERIOD_TAG_RE.search(str(remarks or ""))
		if m:
			target_month = m.group(1)
		else:
			target_month = f"{pay_date.year}-{pay_date.month:02d}"

	target_month = str(target_month).strip()
	if not re.match(r"^\d{4}-\d{2}$", target_month):
		target_month = f"{pay_date.year}-{pay_date.month:02d}"

	# Validate against double-payment or overpayment for target_month
	t_parts = target_month.split("-")
	t_year, t_month = int(t_parts[0]), int(t_parts[1])
	all_payment_entries = _fetch_all_tax_payment_entries(tax_account)
	paid_by_month = {}
	for p in all_payment_entries:
		tm = p.get("target_month")
		paid_by_month[tm] = round(paid_by_month.get(tm, 0.0) + max(0.0, flt(p.get("amount"))), 2)

	month_info = _compute_month_tax_row(company, tax_account, settings, t_year, t_month, paid_by_month)
	month_label_ru = month_info["ru_label"]
	balance_due = flt(month_info["balance_due"])
	tax_accrued = flt(month_info["tax_accrued"])
	tax_paid = flt(month_info["tax_paid"])

	if balance_due <= 0.009:
		frappe.throw(
			_(
				"Налог за {0} уже полностью оплачен (начислено: {1}, уплачено: {2}). Повторная оплата не допускается."
			).format(month_label_ru, f"{tax_accrued:,.2f}", f"{tax_paid:,.2f}")
		)

	if amount > balance_due + 0.01:
		frappe.throw(
			_(
				"Сумма оплаты ({0}) превышает остаток налога к уплате за {1} ({2}). Переплата не допускается."
			).format(f"{amount:,.2f}", month_label_ru, f"{balance_due:,.2f}")
		)

	regime_short = (
		f"НДС {flt(settings['active_tax_rate']):g}%"
		if settings.get("is_vat_regime")
		else f"УСН {flt(settings['active_tax_rate']):g}%"
	)
	voucher_type = "Cash Entry" if wallet_doc.wallet_type in ("Till", "Safe") else "Bank Entry"
	ref_str = reference_no.strip() if reference_no else f"TAX-{now_datetime().strftime('%Y%m%d%H%M')}"
	custom_note = (
		f"Оплата налога ({regime_short}) в {supplier_name} из кошелька '{wallet_doc.wallet_name}' "
		f"за месяц {target_month}."
	)
	if remarks and f"за месяц {target_month}" not in remarks:
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
				"user_remark": f"Погашение налога {regime_short} за месяц {target_month} ({supplier_name})",
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
		"target_month": target_month,
		"message": _("Оплата налога {0} на сумму {1} за {2} успешно проведена").format(
			je.name, f"{amount:,.2f}", month_label_ru
		),
	}


@frappe.whitelist()
def cancel_tax_payment(voucher_no):
	"""Allows store owner to cancel an erroneous tax payment Journal Entry from Tax Desk."""
	_check_permission()
	if not voucher_no or not frappe.db.exists("Journal Entry", voucher_no):
		frappe.throw(_("Payment entry not found"))

	je = frappe.get_doc("Journal Entry", voucher_no)
	if je.docstatus != 1:
		frappe.throw(_("This payment entry is already cancelled"))

	je.flags.ignore_permissions = True
	je.cancel()
	frappe.db.commit()
	return {"status": "success"}


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
