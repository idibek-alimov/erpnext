# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_days, flt, get_first_day, getdate, now_datetime, today

from erpnext.stock.page.product_catalog.product_catalog import get_default_company


def can_see_profit():
	"""Shared admin/manager visibility; underlying native permissions still apply."""
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
	if period == "today":
		return t, t
	frappe.throw(frappe._("Choose a valid period and both custom dates."))


def _sales(company, start, end, until_time=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	if not frappe.has_permission("Sales Invoice", "read"):
		return None, None, None
	filters = dict(company=company, docstatus=1, is_opening="No", posting_date=["between", [start, end]])
	if until_time:
		filters["posting_time"] = ["<=", until_time]
	rows = frappe.get_list("Sales Invoice", filters=filters,
		fields=["base_net_total", "base_grand_total", "is_return"], limit_page_length=0)
	if any(row.get(field) is None for row in rows for field in ("base_net_total", "base_grand_total", "is_return")):
		frappe.throw(frappe._("Required sales fields are not readable."), frappe.PermissionError)
	return (sum(flt(row.base_net_total) for row in rows), sum(flt(row.base_grand_total) for row in rows),
		sum(not row.is_return for row in rows))


def _pnl(company, start, end):
	from erpnext.accounts.page.money_hub.business_results import read_results

	out = read_results(company, start, end)
	ledger = out["ledger"]
	# Legacy transport keys retained; these are now posted book figures, not final profit.
	return dict(revenue=ledger["income"], cogs=ledger["cogs"], expenses=ledger["other_expenses"],
		net=ledger["result"], salaries=None, taxes=None, gross=None,
		checks=out["invoice_sales"]["checks"], **out)


@frappe.whitelist()
def get_pnl(period="month", from_date=None, to_date=None, company=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	company = company or get_default_company()
	start, end = _range(period, from_date, to_date)
	out = _pnl(company, start, end)
	out["from"] = frappe.utils.formatdate(start, "dd.mm.yyyy")
	out["to"] = frappe.utils.formatdate(end, "dd.mm.yyyy")
	return out


def _children(doctype, parenttype, parents, fields):
	rows = []
	parents = sorted(set(parents))
	for offset in range(0, len(parents), 200):
		rows.extend(frappe.get_list(doctype, parent_doctype=parenttype,
			filters={"parent": ["in", parents[offset:offset + 200]], "parenttype": parenttype},
			fields=fields, limit_page_length=0))
	return rows


def _alerts(company):
	"""Retain the existing alerts, resolving native parent/item/warehouse scope first."""
	from collections import defaultdict

	alerts = []
	if frappe.has_permission("POS Closing Entry", "read"):
		closings = frappe.get_list("POS Closing Entry", filters={"company": company, "docstatus": 1,
			"posting_date": [">=", add_days(today(), -7)]}, fields=["name", "posting_date"],
			order_by="posting_date desc, name desc", limit_page_length=0)
		diffs = defaultdict(float)
		for row in _children("POS Closing Entry Detail", "POS Closing Entry", [doc.name for doc in closings], ["parent", "difference"]):
			if row.get("difference") is not None:
				diffs[row.parent] += flt(row.difference)
		for doc in [doc for doc in closings if abs(diffs[doc.name]) > 0.001][:5]:
			alerts.append(dict(level="red", icon="", text=f"{doc.name}: {diffs[doc.name]:,.2f}",
				route=["Form", "POS Closing Entry", doc.name]))

	if all(frappe.has_permission(kind, "read") for kind in ("Sales Invoice", "Item", "Warehouse", "Bin")):
		invoices = frappe.get_list("Sales Invoice", filters={"company": company, "docstatus": 1,
			"posting_date": ["between", [add_days(today(), -30), today()]]}, pluck="name", limit_page_length=0)
		sold = defaultdict(float)
		for row in _children("Sales Invoice Item", "Sales Invoice", invoices, ["item_code", "stock_qty"]):
			if row.get("item_code") and row.get("stock_qty") is not None:
				sold[row.item_code] += flt(row.stock_qty)
		warehouses = frappe.get_list("Warehouse", filters={"company": company, "is_group": 0}, pluck="name", limit_page_length=0)
		codes = sorted(code for code, qty in sold.items() if qty > 0)
		low = []
		for offset in range(0, len(codes), 200):
			items = frappe.get_list("Item", filters={"name": ["in", codes[offset:offset + 200]], "is_stock_item": 1},
				fields=["name", "item_name"], limit_page_length=0)
			qty = defaultdict(float)
			unknown = set()
			if items and warehouses:
				for row in frappe.get_list("Bin", filters={"item_code": ["in", [item.name for item in items]],
					"warehouse": ["in", warehouses]}, fields=["item_code", "actual_qty"], limit_page_length=0):
					if row.get("actual_qty") is not None:
						qty[row.item_code] += flt(row.actual_qty)
					else:
						unknown.add(row.item_code)
				low.extend(item.item_name for item in items if item.get("item_name") and item.name not in unknown and qty[item.name] < 3)
		if low:
			alerts.append(dict(level="yellow", icon="", text=frappe._("Low stock (less than 3): {0}").format(
				", ".join(low[:3])), route=["product-catalog"]))

	if frappe.has_permission("Purchase Invoice", "read"):
		rows = frappe.get_list("Purchase Invoice", filters={"company": company, "docstatus": 1,
			"outstanding_amount": [">", 0], "due_date": ["<=", add_days(today(), 2)]},
			fields=["name", "due_date", "outstanding_amount", "currency"],
			order_by="due_date, name", limit_page_length=5)
		alerts.extend(dict(level="red" if getdate(row.due_date) < getdate(today()) else "yellow", icon="",
			text=f"{row.name}: {flt(row.outstanding_amount):,.2f} {row.currency} — {frappe.utils.formatdate(row.due_date, 'dd.mm.yyyy')}",
			route=["Form", "Purchase Invoice", row.name]) for row in rows
			if row.get("due_date") and row.get("outstanding_amount") is not None and row.get("currency"))
	return alerts


@frappe.whitelist()
def get_business_pulse(company=None):
	from erpnext.accounts.page.money_hub.money_hub import get_money_hub_data

	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	company = company or get_default_company()
	require_financial_access(company)
	currency = frappe.get_doc("Company", company).default_currency
	t = getdate(today())
	now_time = now_datetime().strftime("%H:%M:%S")

	rev_today, _g, checks = _sales(company, t, t)
	rev_yday, _g2, _c2 = _sales(company, add_days(t, -1), add_days(t, -1), until_time=now_time)
	pnl_today = _pnl(company, t, t)
	pnl_month = _pnl(company, get_first_day(t), t)

	money = get_money_hub_data(company)["totals"]

	delta = None
	if rev_yday and rev_today is not None:
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
		"avg_check": round(rev_today / checks, 2) if checks else None,
		"net_profit_today": pnl_today["net"] if show_profit else None,
		"net_profit_month": pnl_month["net"] if show_profit else None,
		"money": {"cash": money["cash"], "non_cash": money["non_cash"], "total": money["total"]} if show_profit else None,
		"alerts": _alerts(company),
		"alerts_scope": "permitted_native_sources",
		"pnl": dict(pnl_month, **{"from": frappe.utils.formatdate(get_first_day(t), "dd.mm.yyyy"),
			"to": frappe.utils.formatdate(t, "dd.mm.yyyy")}) if show_profit else None,
	}
