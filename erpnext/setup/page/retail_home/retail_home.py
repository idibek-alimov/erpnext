# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, flt, get_first_day, get_last_day, getdate, now_datetime, today

from erpnext.stock.page.product_catalog.product_catalog import get_default_company

# Quick Expense categories that are staff advances (covered via Staff Settlement instead)
EXCLUDED_EXPENSE_CATEGORIES = ("Аванс сотруднику", "Staff Advance")


def can_see_profit():
	"""Profit figures are hidden from retail staff who are not Retail Owner / System Manager."""
	from erpnext.setup.retail_security import can_see_financials

	return can_see_financials()


def _range(period, from_date=None, to_date=None):
	t = getdate(today())
	if period == "yesterday":
		y = add_days(t, -1)
		return y, y
	if period == "week":
		return add_days(t, -t.weekday()), t
	if period == "month":
		return get_first_day(t), t
	if period == "custom" and from_date and to_date:
		return getdate(from_date), getdate(to_date)
	return t, t


def _sales(company, start, end, until_time=None):
	cond = "AND posting_time <= %(until)s" if until_time else ""
	row = frappe.db.sql(
		f"""SELECT COALESCE(SUM(base_net_total), 0), COALESCE(SUM(base_grand_total), 0),
			SUM(CASE WHEN is_return = 0 THEN 1 ELSE 0 END)
		FROM `tabSales Invoice`
		WHERE docstatus = 1 AND company = %(company)s AND posting_date BETWEEN %(start)s AND %(end)s {cond}""",
		{"company": company, "start": start, "end": end, "until": until_time},
	)[0]
	return flt(row[0]), flt(row[1]), int(row[2] or 0)


def _cogs(company, start, end):
	return flt(frappe.db.sql(
		"""SELECT COALESCE(SUM(sii.qty * sii.incoming_rate), 0)
		FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE si.docstatus = 1 AND si.company = %s AND si.posting_date BETWEEN %s AND %s""",
		(company, start, end),
	)[0][0])


def _expenses(company, start, end):
	return flt(frappe.db.sql(
		"""SELECT COALESCE(SUM(amount), 0) FROM `tabQuick Expense`
		WHERE docstatus = 1 AND company = %s AND posting_date BETWEEN %s AND %s
		AND expense_category NOT IN %s""",
		(company, start, end, EXCLUDED_EXPENSE_CATEGORIES),
	)[0][0])


def _salaries(company, start, end):
	return flt(frappe.db.sql(
		"""SELECT COALESCE(SUM(base_salary + commission_amount + bonuses_total - penalties_total), 0)
		FROM `tabStaff Settlement`
		WHERE docstatus = 1 AND company = %s AND posting_date BETWEEN %s AND %s""",
		(company, start, end),
	)[0][0])


def _taxes(company, start, end):
	from erpnext.accounts.page.money_hub.money_hub import tax_for_range

	try:
		return flt(tax_for_range(company, start, end))
	except Exception:
		return 0.0


def _pnl(company, start, end):
	revenue, _gt, checks = _sales(company, start, end)
	cogs = _cogs(company, start, end)
	expenses = _expenses(company, start, end)
	salaries = _salaries(company, start, end)
	taxes = _taxes(company, start, end)
	gross = revenue - cogs
	net = gross - expenses - salaries - taxes
	return {
		"revenue": revenue, "cogs": cogs, "gross": gross, "expenses": expenses,
		"salaries": salaries, "taxes": taxes, "net": net, "checks": checks,
	}


@frappe.whitelist()
def get_pnl(period="month", from_date=None, to_date=None, company=None):
	if not can_see_profit():
		frappe.throw(frappe._("Only the Retail Owner can view profit."), frappe.PermissionError)
	company = company or get_default_company()
	start, end = _range(period, from_date, to_date)
	out = _pnl(company, start, end)
	out["from"] = frappe.utils.formatdate(start, "dd.mm.yyyy")
	out["to"] = frappe.utils.formatdate(end, "dd.mm.yyyy")
	return out


def _alerts(company):
	alerts = []
	t = getdate(today())

	# 1. Shift cash differences (POS Closing Entry, last 7 days)
	diffs = frappe.db.sql(
		"""SELECT pce.name, pce.user, pce.posting_date, SUM(d.difference) AS diff
		FROM `tabPOS Closing Entry` pce JOIN `tabPOS Closing Entry Detail` d ON d.parent = pce.name
		WHERE pce.docstatus = 1 AND pce.company = %s AND pce.posting_date >= %s
		GROUP BY pce.name HAVING ABS(SUM(d.difference)) > 0.001
		ORDER BY pce.posting_date DESC LIMIT 5""",
		(company, add_days(t, -7)),
		as_dict=True,
	)
	for d in diffs:
		kind = "недостача" if d.diff < 0 else "излишек"
		alerts.append({
			"level": "red", "icon": "🔴",
			"text": f"При закрытии смены {frappe.utils.formatdate(d.posting_date, 'dd.mm')} — {kind} {abs(flt(d.diff)):,.2f}",
			"route": ["Form", "POS Closing Entry", d.name],
		})

	# 2. Fast-moving items running out (sold in last 30 days, stock < 3)
	low = frappe.db.sql(
		"""SELECT b.item_code, i.item_name, SUM(b.actual_qty) AS qty
		FROM `tabBin` b JOIN `tabItem` i ON i.name = b.item_code
		WHERE b.item_code IN (
			SELECT sii.item_code FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 1 AND si.posting_date >= %s GROUP BY sii.item_code HAVING SUM(sii.qty) > 0
		)
		GROUP BY b.item_code HAVING SUM(b.actual_qty) < 3
		ORDER BY qty ASC LIMIT 20""",
		(add_days(t, -30),),
		as_dict=True,
	)
	if low:
		names = ", ".join(r.item_name for r in low[:3])
		more = f" и ещё {len(low) - 3}" if len(low) > 3 else ""
		alerts.append({
			"level": "yellow", "icon": "🟡",
			"text": f"Заканчиваются ходовые товары (остаток < 3 шт): {names}{more}",
			"route": ["product-catalog"],
		})

	# 3. Supplier invoices due within 48 hours (or overdue)
	due = frappe.db.sql(
		"""SELECT supplier, SUM(outstanding_amount) AS amt, MIN(due_date) AS due_date
		FROM `tabPurchase Invoice`
		WHERE docstatus = 1 AND company = %s AND outstanding_amount > 0 AND due_date <= %s
		GROUP BY supplier ORDER BY due_date ASC LIMIT 5""",
		(company, add_days(t, 2)),
		as_dict=True,
	)
	for d in due:
		overdue = getdate(d.due_date) < t
		alerts.append({
			"level": "red" if overdue else "yellow", "icon": "🔴" if overdue else "🟡",
			"text": f"{'Просрочена оплата' if overdue else 'Срок оплаты подходит'} поставщику {d.supplier}: {flt(d.amt):,.2f} (до {frappe.utils.formatdate(d.due_date, 'dd.mm')})",
			"route": ["supplier-hub"],
		})
	return alerts


@frappe.whitelist()
def get_business_pulse(company=None):
	from erpnext.accounts.page.money_hub.money_hub import get_money_hub_data

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	t = getdate(today())
	now_time = now_datetime().strftime("%H:%M:%S")

	rev_today, _g, checks = _sales(company, t, t)
	rev_yday, _g2, _c2 = _sales(company, add_days(t, -1), add_days(t, -1), until_time=now_time)
	pnl_today = _pnl(company, t, t)
	pnl_month = _pnl(company, get_first_day(t), t)

	money = get_money_hub_data(company)["totals"]

	delta = None
	if rev_yday:
		delta = round((rev_today - rev_yday) / rev_yday * 100, 1)

	show_profit = can_see_profit()

	return {
		"hide_profit": not show_profit,
		"company": company,
		"currency": currency,
		"revenue_today": rev_today,
		"revenue_yesterday_same_time": rev_yday,
		"revenue_delta_percent": delta,
		"checks": checks,
		"avg_check": round(rev_today / checks, 2) if checks else 0,
		"net_profit_today": pnl_today["net"] if show_profit else None,
		"net_profit_month": pnl_month["net"] if show_profit else None,
		"money": {"cash": money["cash"], "non_cash": money["non_cash"], "total": money["total"]} if show_profit else None,
		"alerts": _alerts(company),
		"pnl": get_pnl("month", company=company) if show_profit else None,
	}
