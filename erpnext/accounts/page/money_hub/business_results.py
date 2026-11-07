"""Permission-scoped posted results, not a second payroll/tax accounting system.

GL is the only recognized-income/expense source. Custom documents and their backing
vouchers are never added together. Invoice sales are a separate reconciliation view;
invoice-date analytical COGS must not be substituted for ledger-date COGS.
"""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

import frappe
from frappe import _
from frappe.utils import date_diff, get_first_day, getdate, today

from erpnext.accounts.utils import get_currency_precision
from erpnext.setup.retail_security import require_financial_access


def _required(row, fields):
	if any(row.get(field) is None for field in fields):
		frappe.throw(_("Required financial fields are not readable."), frappe.PermissionError)


def _ledger(company, start, end, finance_book, precision):
	for doctype in ("Account", "GL Entry"):
		if not frappe.has_permission(doctype, "read"):
			frappe.throw(_("Account and ledger read permission is required."), frappe.PermissionError)
	accounts = frappe.get_list("Account", filters={"company": company, "is_group": 0,
		"root_type": ["in", ["Income", "Expense"]]}, fields=["name", "root_type", "account_type", "account_currency"],
		order_by="name", limit_page_length=0)
	quantum = Decimal(1).scaleb(-precision)

	def number(value):
		return Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)

	by_account = {}
	for account in accounts:
		_required(account, ("name", "root_type", "account_currency"))
		# A hidden account type cannot silently reclassify COGS as operating expense.
		if "account_type" not in account:
			frappe.throw(_("Account classification read permission is required."), frappe.PermissionError)
		by_account[account.name] = dict(account=account, base=Decimal(0), original=Decimal(0), original_readable=True)
	names = sorted(by_account)
	for offset in range(0, len(names), 200):
		rows = frappe.get_list("GL Entry", filters={"company": company, "is_cancelled": 0,
			"posting_date": ["between", [start, end]], "account": ["in", names[offset:offset + 200]],
			"voucher_type": ["!=", "Period Closing Voucher"]},
			or_filters=[["finance_book", "in", list({"", finance_book or ""})], ["finance_book", "is", "not set"]],
			fields=["account", "debit", "credit", "account_currency", "debit_in_account_currency", "credit_in_account_currency"],
			limit_page_length=0)
		for row in rows:
			_required(row, ("account", "debit", "credit"))
			value = by_account[row.account]
			sign = 1 if value["account"].root_type == "Expense" else -1
			value["base"] += sign * (number(row.debit) - number(row.credit))
			if row.get("account_currency") != value["account"].account_currency or any(
				row.get(field) is None for field in ("debit_in_account_currency", "credit_in_account_currency")
			):
				value["original_readable"] = False
			else:
				value["original"] += sign * (number(row.debit_in_account_currency) - number(row.credit_in_account_currency))
	income = expenses = cogs = Decimal(0)
	result = []
	for name, value in by_account.items():
		account, amount = value["account"], value["base"]
		if account.root_type == "Income":
			income += amount
		else:
			expenses += amount
			if account.account_type == "Cost of Goods Sold":
				cogs += amount
		if amount or value["original"] or not value["original_readable"]:
			result.append(dict(account=name, root_type=account.root_type, account_type=account.account_type,
				account_currency=account.account_currency, base_amount=float(amount),
				account_amount=float(value["original"]) if value["original_readable"] else None))
	return dict(income=float(income), total_expenses=float(expenses), cogs=float(cogs),
		other_expenses=float(expenses - cogs), result=float(income - expenses), accounts=result)


def _sales(company, start, end):
	"""Posted SI only; unmerged POS is disclosed separately, never added twice."""
	result = dict(net_sales=None, sales_before_returns=None, returns=None, checks=None,
		by_currency=[], unmerged_pos_net_sales=None, unmerged_pos_count=None)
	for doctype in ("Sales Invoice", "POS Invoice"):
		if not frappe.has_permission(doctype, "read"):
			continue
		filters = dict(company=company, docstatus=1, posting_date=["between", [start, end]], is_opening="No")
		kwargs = {}
		if doctype == "POS Invoice":
			kwargs["or_filters"] = [["consolidated_invoice", "=", ""], ["consolidated_invoice", "is", "not set"]]
		rows = frappe.get_list(doctype, filters=filters,
			fields=["base_net_total", "net_total", "currency", "is_return"], limit_page_length=0, **kwargs)
		for row in rows:
			_required(row, ("base_net_total", "net_total", "currency", "is_return"))
		if doctype == "POS Invoice":
			result.update(unmerged_pos_count=len(rows), unmerged_pos_net_sales=float(sum(
				(Decimal(str(row.base_net_total)) for row in rows), Decimal(0))))
			continue
		currencies = defaultdict(lambda: [Decimal(0), Decimal(0)])
		sold = returned = Decimal(0)
		checks = 0
		for row in rows:
			base = Decimal(str(row.base_net_total))
			if row.is_return:
				returned -= base
			else:
				sold += base
				checks += 1
			currencies[row.currency][0] += Decimal(str(row.net_total))
			currencies[row.currency][1] += base
		result.update(net_sales=float(sold - returned), sales_before_returns=float(sold), returns=float(returned),
			checks=checks, by_currency=[dict(currency=code, net_total=float(values[0]), base_net_total=float(values[1]))
				for code, values in sorted(currencies.items())])
	return result


def read_results(company, from_date=None, to_date=None):
	require_financial_access(company)
	end = getdate(to_date or today())
	start = getdate(from_date or get_first_day(end))
	if start > end or end > getdate(today()) or date_diff(end, start) > 365:
		frappe.throw(_("Choose a reporting period of up to 366 days ending no later than today."))
	doc = frappe.get_doc("Company", company)
	doc.apply_fieldlevel_read_permissions()
	_required(doc.as_dict(), ("default_currency",))
	if "default_finance_book" not in doc.as_dict():
		frappe.throw(_("Company finance book read permission is required."), frappe.PermissionError)
	ledger = _ledger(company, start, end, doc.default_finance_book, get_currency_precision() or 2)
	sales = _sales(company, start, end)
	return dict(company=company, currency=doc.default_currency, from_date=str(start), to_date=str(end),
		basis="posted_general_ledger", finance_book=doc.default_finance_book or None,
		ledger=ledger, invoice_sales=sales,
		reconciliation=dict(income_less_invoice_sales=ledger["income"] - sales["net_sales"] if sales["net_sales"] is not None else None,
			invoice_date_cogs=None, invoice_date_gross_profit=None),
		completeness=dict(status="provisional", scope="native_permitted_accounts_and_ledger_rows", final_profit=False,
			limitations=["permission_scoped", "unposted_costs_not_included", "payroll_coverage_unverified",
				"tax_coverage_unverified", "offline_pos_unknown", "invoice_date_cogs_not_reconciled", "store_allocation_unconfigured"]),
		source_policy="GL only; custom expense/payroll totals and tax estimates are not added. "
			"Includes opening P&L entries and the default/blank finance books, excludes cancelled and period-closing GL.")
