"""Native permission-scoped cash/bank balances through a stated posting date."""
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

import frappe
from frappe import _
from frappe.utils import getdate


def read_balances(company, accounts, as_of, precision):
	"""One bounded query per account batch; no source-document metadata or writes.

	Balances include all visible noncancelled GL vouchers, independently of the five
	source types in movement history. Every sum uses the same date/row/field scope.
	"""
	quantum = Decimal(1).scaleb(-precision)
	cutoff = getdate(as_of)

	def number(value):
		return Decimal(str(value)).quantize(quantum, rounding=ROUND_HALF_UP)

	result = defaultdict(lambda: dict(balance=Decimal(0), opening_balance=Decimal(0),
		today_in=Decimal(0), today_out=Decimal(0), account_balance=Decimal(0),
		base_readable=True, original_readable=True))
	accounts = sorted(set(accounts))
	for offset in range(0, len(accounts), 200):
		for row in frappe.get_list("GL Entry", filters={"company": company,
			"account": ["in", accounts[offset:offset + 200]], "is_cancelled": 0,
			"posting_date": ["<=", as_of]}, fields=["account", "posting_date", "debit", "credit",
			"debit_in_account_currency", "credit_in_account_currency"], limit_page_length=0):
			if not row.get("account") or not row.get("posting_date"):
				frappe.throw(_("Ledger account and posting-date read permission is required."), frappe.PermissionError)
			value = result[row.account]
			if any(row.get(key) is None for key in ("debit", "credit", "posting_date")):
				value["base_readable"] = False
			else:
				change = number(row.debit) - number(row.credit)
				value["balance"] += change
				if getdate(row.posting_date) < cutoff:
					value["opening_balance"] += change
				else:
					value["today_in"] += max(change, 0)
					value["today_out"] += max(-change, 0)
			if any(row.get(key) is None for key in ("debit_in_account_currency", "credit_in_account_currency")):
				value["original_readable"] = False
			else:
				value["account_balance"] += number(row.debit_in_account_currency) - number(row.credit_in_account_currency)
	for account in accounts:
		value = result[account]
		for field in ("balance", "opening_balance", "today_in", "today_out"):
			value[field] = float(value[field]) if value["base_readable"] else None
		value["account_balance"] = float(value["account_balance"]) if value["original_readable"] else None
	return dict(result)
