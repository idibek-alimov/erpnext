"""Paid expense history. Native permission queries scope each source before aggregation.

Backing accounting documents are evidence, never additional expense adapters. Installed
apps register trusted descriptors; no client can supply a DocType or SQL expression.
"""

import re
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import add_days, cint, formatdate, get_first_day, get_last_day, getdate, today

from erpnext.accounts.expense_services import policy

FIELDS = (
	"name", "posting_date", "creation", "modified", "company", "pos_profile", "pos_opening_shift",
	"expense_category", "amount", "paid_from", "party_type", "party", "beneficiary_name", "description",
	"receipt_attachment", "journal_entry", "payment_entry", "purchase_invoice", "docstatus", "owner", "amended_from",
)
QUICK_EXPENSE = dict(doctype="Quick Expense", fields={field: field for field in FIELDS}, filters={})


def sources():
	adapters = [QUICK_EXPENSE]
	for hook in frappe.get_hooks("expense_history_adapters"):
		adapters.extend(frappe.get_attr(hook)())
	# A repeated registration must never double the economic effect.
	return list({adapter["doctype"]: adapter for adapter in adapters}.values())


def date_range(period, from_date=None, to_date=None):
	start = end = getdate(today())
	if period in {"all", "shift"}:
		return None, None
	if period == "custom":
		if not from_date or not to_date or getdate(from_date) > getdate(to_date):
			frappe.throw(_("Select a valid date range."))
		return getdate(from_date), getdate(to_date)
	if period == "yesterday":
		start = end = add_days(start, -1)
	elif period == "week":
		start = add_days(start, -6)
	elif period == "month":
		start, end = get_first_day(start), get_last_day(end)
	elif period != "today":
		frappe.throw(_("Select a valid expense period."))
	return start, end


def permitted_sources(context):
	queries = []
	profile_query = None
	if not context.pos_profile and frappe.has_permission("POS Profile", "read"):
		profile_query = frappe.get_list("POS Profile", filters={"company": context.company},
			fields=["name"], order_by="", limit_page_length=0, run=False)
	for adapter in sources():
		doctype = adapter["doctype"]
		if not frappe.has_permission(doctype, "read"):
			continue
		mapping = adapter["fields"]
		if any(not re.fullmatch(r"[a-z_]+", field) for field in mapping.values()):
			raise ValueError("History adapters must map native field names")
		filters = dict(adapter["filters"], company=context.company)
		if context.pos_profile:
			filters["pos_profile"] = context.pos_profile
			if context.pos_opening_shift:
				# POS history always uses an explicit shift. Manager-entered records
				# participate through their relationship, regardless of origin flag.
				filters["pos_opening_shift"] = context.pos_opening_shift
		# Compile the actual native list query: role, company/account User Permissions,
		# shares, permission-query hooks and field permissions all remain in force.
		query = frappe.get_list(doctype, filters=filters, fields=list(set(mapping.values())),
			order_by="", limit_page_length=0, run=False)
		if not isinstance(query, str):
			continue  # No readable fields; never fall back to unrestricted SQL.
		columns = [f"scoped.`{mapping[field]}` as `{field}`" if field in mapping else f"NULL as `{field}`" for field in FIELDS]
		columns.append(f"{frappe.db.escape(doctype)} as source_doctype")
		profile_scope = "1=1"
		if not context.pos_profile:
			profile_scope = "(coalesce(scoped.pos_profile, '') = '' and coalesce(scoped.pos_opening_shift, '') = '')"
			if isinstance(profile_query, str):
				profile_scope += f" or scoped.pos_profile in ({profile_query})"
		queries.append("select " + ", ".join(columns) + f" from ({query}) scoped where ({profile_scope})")
	return " union all ".join(queries)


def scope(context, period, from_date, to_date, source_id, category, employee, search, status):
	conditions, values = [], {}
	start, end = date_range(period, from_date, to_date)
	if period == "shift" and not context.pos_opening_shift:
		frappe.throw(_("Select the POS Opening Shift for this expense."))
	if start:
		conditions.append("posting_date between %(start)s and %(end)s")
		values.update(start=start, end=end)
	statuses = {"submitted": 1, "cancelled": 2, "draft": 0}
	if status in statuses:
		conditions.append("docstatus = %(docstatus)s")
		values["docstatus"] = statuses[status]
	elif status != "all":
		frappe.throw(_("Select a valid expense status."))
	if category != "all":
		if category.startswith("legacy:"):
			conditions.append("source_doctype = 'POS Cash Movement' and expense_category = %(category)s")
			values["category"] = category[len("legacy:"):]
		else:
			conditions.append("source_doctype = 'Quick Expense' and expense_category = %(category)s")
			values["category"] = category
	if source_id in {"cash", "bank", "mobile"}:
		conditions.append("source_type " + ("in ('Bank', 'Mobile Wallet')" if source_id == "bank" else "= %(source_type)s"))
		values["source_type"] = "Cash" if source_id == "cash" else "Mobile Wallet"
	elif source_id != "all":
		if source_id.startswith("account:"):
			account = frappe.get_cached_doc("Account", source_id[len("account:"):])
			if account.company != context.company:
				frappe.throw(_("Select an authorized expense source."), frappe.PermissionError)
			account_name = account.name
		elif source_id.startswith("wallet:"):
			wallet = frappe.get_cached_doc("Money Wallet", source_id[len("wallet:"):])
			if wallet.company != context.company:
				frappe.throw(_("Select an authorized expense source."), frappe.PermissionError)
			account_name = wallet.account
		else:
			frappe.throw(_("Select an authorized expense source."), frappe.PermissionError)
		# Reading historic sources does not grant permission to spend from them.
		policy.check_user_scope("Account", account_name)
		conditions.append("paid_from = %(account)s")
		values["account"] = account_name
	if employee != "all":
		recipients = [employee]
		if frappe.has_permission("Employee", "read"):
			matches = frappe.get_list("Employee", filters={"name": employee, "company": context.company},
				fields=["employee_name"], limit_page_length=1)
			if matches:
				recipients.append(matches[0].employee_name)
		conditions.append("(beneficiary_name in %(recipients)s or (party_type = 'Employee' and party = %(employee)s))")
		values.update(recipients=recipients, employee=employee)
	if search and search.strip():
		conditions.append("(" + " or ".join(f"{field} like %(search)s" for field in
			("name", "expense_category", "description", "beneficiary_name", "party", "paid_from")) + ")")
		values["search"] = "%" + search.strip() + "%"
	return " and ".join(f"({condition})" for condition in conditions) or "1=1", values


def filter_options(context):
	"""Historical choices from readable records, independent of today's spending grants."""
	base = permitted_sources(context)
	if not base:
		return dict(accounts=[], categories=[])
	rows = frappe.db.sql(f"""select distinct paid_from, expense_category, source_doctype
		from ({base}) permitted_history""", {}, as_dict=True)
	accounts = sorted({row.paid_from for row in rows if row.paid_from})
	categories = sorted({("legacy:" if row.source_doctype == "POS Cash Movement" else "") + row.expense_category
		for row in rows if row.expense_category})
	return dict(accounts=accounts, categories=categories)


def empty_summary():
	return dict(period_total=0, period_count=0, today_total=0, cash_total=0, bank_total=0,
		mobile_total=0, other_total=0, category_breakdown=[], matching_count=0, unassigned_count=0,
		report_basis="Paid expenses", supported_sources=[])


def summarize(groups, icons):
	summary = empty_summary()
	totals = {key: Decimal(0) for key in ("period_total", "today_total", "cash_total", "bank_total", "mobile_total", "other_total")}
	categories = {}
	for row in groups:
		summary["matching_count"] += row.record_count
		if row.docstatus != 1:
			continue
		amount = Decimal(str(row.total or 0))
		totals["period_total"] += amount
		summary["period_count"] += row.record_count
		summary["unassigned_count"] += row.record_count if row.unassigned else 0
		if getdate(row.posting_date) == getdate(today()):
			totals["today_total"] += amount
		if row.source_type == "Cash":
			totals["cash_total"] += amount
		elif row.source_type in {"Bank", "Mobile Wallet"}:
			totals["bank_total"] += amount
			if row.source_type == "Mobile Wallet":
				totals["mobile_total"] += amount
		else:
			totals["other_total"] += amount
		category_id = ("legacy:" if row.source_doctype == "POS Cash Movement" else "") + (row.expense_category or "")
		categories[category_id] = categories.get(category_id, Decimal(0)) + amount
	summary.update({key: float(value) for key, value in totals.items()})
	total = totals["period_total"]
	summary["category_breakdown"] = [dict(category=key.removeprefix("legacy:"), category_id=key,
		icon=icons.get(key, ""), total=float(value), percent=round(float(value / total * 100), 1) if total else 0)
		for key, value in sorted(categories.items(), key=lambda entry: (-entry[1], entry[0]))]
	return summary


def list_expenses(context, period="today", from_date=None, to_date=None, source_id="all", category="all",
		employee="all", search=None, status="submitted", limit_start=0, limit_page_length=50):
	base = permitted_sources(context)
	if not base:
		return dict(recent_expenses=[], summary=empty_summary(), has_more=False, next_start=None)
	# Classification uses the actual ledger account and wallet, including disabled
	# historic sources. EXISTS avoids multiplying one expense by wallet aliases.
	classified = f"""select e.*,
		case when a.account_type = 'Cash' then 'Cash'
		when a.account_type = 'Bank' and exists (select w.name from `tabMoney Wallet` w
			where w.account = e.paid_from and w.company = e.company and w.wallet_type = 'Mobile Wallet') then 'Mobile Wallet'
		when a.account_type = 'Bank' then 'Bank' else 'Other' end as source_type,
		case when coalesce(e.pos_opening_shift, '') = '' and
			(coalesce(e.pos_profile, '') != '' or exists (
				select p.name from `tabPOS Profile` p
				join `tabPOS Payment Method` pm on pm.parent = p.name and pm.parenttype = 'POS Profile'
				join `tabMode of Payment Account` ma on ma.parent = pm.mode_of_payment
					and ma.parenttype = 'Mode of Payment' and ma.company = p.company
				where p.company = e.company and ma.default_account = e.paid_from
			)) then 1 else 0 end as unassigned
		from ({base}) e left join `tabAccount` a on a.name = e.paid_from and a.company = e.company"""
	# ERPNext also works without POS Awesome. POS Profile itself belongs to ERPNext;
	# opening-shift tables are only referenced by the installed adapter's permissions.
	where, values = scope(context, period, from_date, to_date, source_id, category, employee, search, status)
	scoped = f"from ({classified}) history where {where}"
	groups = frappe.db.sql(f"""select source_doctype, expense_category, posting_date, docstatus, source_type,
		unassigned, count(*) as record_count, sum(amount) as total {scoped}
		group by source_doctype, expense_category, posting_date, docstatus, source_type, unassigned""", values, as_dict=True)
	icons = {row.name: row.icon for row in frappe.get_all("Quick Expense Category", fields=["name", "icon"])}
	summary = summarize(groups, icons)
	summary["supported_sources"] = [source["doctype"] for source in sources() if frappe.has_permission(source["doctype"], "read")]
	offset, length = max(0, cint(limit_start)), min(200, max(1, cint(limit_page_length)))
	rows = frappe.db.sql(f"select * {scoped} order by creation desc, source_doctype desc, name desc limit %(length)s offset %(offset)s",
		dict(values, length=length, offset=offset), as_dict=True)
	for row in rows:
		row.source_id = f"{row.source_doctype}:{row.name}"
		row.category_id = ("legacy:" if row.source_doctype == "POS Cash Movement" else "") + (row.expense_category or "")
		row.icon = icons.get(row.category_id, "")
		row.formatted_date = formatdate(row.posting_date, "dd.mm.yyyy")
		row.formatted_time = row.creation.strftime("%H:%M") if row.creation else ""
		row.attribution_status = "Unassigned" if row.unassigned else "Assigned" if row.pos_opening_shift else "Office"
		row.amount = float(row.amount)
	more = offset + len(rows) < summary["matching_count"]
	start, end = date_range(period, from_date, to_date)
	return dict(recent_expenses=rows, summary=summary, has_more=more, next_start=offset + len(rows) if more else None,
		period_from=str(start) if start else None, period_to=str(end) if end else None)
