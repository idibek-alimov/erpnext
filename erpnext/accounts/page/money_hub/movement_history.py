"""Read-only cash-account history. Ledger legs and business transfers are distinct.

Native GL and source permissions apply before filtering, counting or aggregation.
Queries are batched; there is deliberately no pre-filter history truncation.
"""
from collections import defaultdict
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

SOURCE_FIELDS = {
	"Payment Entry": ["payment_type", "party_type", "party", "party_name", "remarks"],
	"Journal Entry": ["voucher_type", "user_remark"],
	"Sales Invoice": ["customer", "customer_name", "is_return"],
	"POS Invoice": ["customer", "customer_name", "is_return"],
	"Purchase Invoice": ["supplier", "supplier_name", "is_return"],
}


def _sum(values):
	return float(sum((Decimal(str(value)) for value in values), Decimal(0)))


def _sources(rows, company):
	"""Batch native list/field permissions; never fetch denied voucher metadata."""
	names = defaultdict(set)
	for row in rows:
		if row.voucher_type in SOURCE_FIELDS:
			names[row.voucher_type].add(row.voucher_no)
	permitted = {}
	for doctype, identifiers in names.items():
		if not frappe.has_permission(doctype, "read"):
			continue
		identifiers = sorted(identifiers)
		for offset in range(0, len(identifiers), 200):
			for doc in frappe.get_list(doctype, filters={"company": company, "docstatus": 1,
				"name": ["in", identifiers[offset:offset + 200]]},
				fields=["name", "owner"] + SOURCE_FIELDS[doctype], limit_page_length=0):
				permitted[(doctype, doc.name)] = doc
	return permitted


def _expenses(sources, company):
	"""A permitted typed expense link can classify a voucher; remarks cannot."""
	result = {}
	if not frappe.has_permission("Quick Expense", "read"):
		return result
	for field, doctype in (("payment_entry", "Payment Entry"), ("journal_entry", "Journal Entry")):
		names = sorted(name for kind, name in sources if kind == doctype)
		for offset in range(0, len(names), 200):
			for expense in frappe.get_list("Quick Expense", filters={"company": company,
				"docstatus": 1, field: ["in", names[offset:offset + 200]]},
				fields=[field, "expense_category"], limit_page_length=0):
				if expense.get(field):
					result[(doctype, expense[field])] = expense.get("expense_category") or ""
	return result


OWNER_LABELS = {
	"contribution": ("Средства владельца: внесение", "Маблағи соҳиб: воридкунӣ"),
	"withdrawal": ("Средства владельца: изъятие", "Маблағи соҳиб: гирифтан"),
	"loan_received": ("Заём от владельца", "Қарз аз соҳиб"),
	"loan_repayment": ("Возврат займа владельцу", "Баргардонидани қарз ба соҳиб"),
}


def _owner_sources(sources, company):
	"""Classify only permitted typed receipts whose native JE is already readable."""
	names = sorted(name for kind, name in sources if kind == "Journal Entry")
	if not names or not frappe.db.has_table("Owner Money Movement") or not frappe.has_permission("Owner Money Movement", "read"):
		return {}
	result = {}
	for offset in range(0, len(names), 200):
		for row in frappe.get_list("Owner Money Movement", filters={"company": company,
			"journal_entry": ["in", names[offset:offset + 200]]}, fields=["journal_entry", "operation"], limit_page_length=0):
			if row.get("operation") in OWNER_LABELS and row.get("journal_entry"):
				result[("Journal Entry", row.journal_entry)] = row.operation
	return result


def _classify(kind, doc, expense, owner_operation=None):
	party = doc.get("party_name") or doc.get("party") or doc.get("customer_name") or doc.get("customer") or doc.get("supplier_name") or doc.get("supplier") or ""
	if expense is not None:
		return "expense", "Расход", "Хароҷот", expense
	if owner_operation in OWNER_LABELS:
		ru, tg = OWNER_LABELS[owner_operation]
		return "owner", ru, tg, ""
	if kind == "Payment Entry":
		if doc.get("payment_type") == "Internal Transfer":
			return "transfer", "Перевод между счетами", "Интиқол байни суратҳисобҳо", ""
		if doc.get("party_type") == "Customer":
			return "sales", "Платёж клиента / возврат", "Пардохти муштарӣ / бозгашт", party
		if doc.get("party_type") == "Supplier":
			return "supplier", "Платёж поставщику / возврат", "Пардохти таъминкунанда / бозгашт", party
		if doc.get("party_type") == "Employee":
			return "employee", "Платёж сотруднику / возврат", "Пардохти корманд / бозгашт", party
		return "other", "Платёж", "Пардохт", party
	if kind in ("Sales Invoice", "POS Invoice"):
		return "sales", "Возврат покупателя" if doc.get("is_return") else "Оплата покупки", "Бозгашти муштарӣ" if doc.get("is_return") else "Пардохти харид", party
	if kind == "Purchase Invoice":
		return "supplier", "Возврат поставщику" if doc.get("is_return") else "Оплата закупки", "Бозгашт ба таъминкунанда" if doc.get("is_return") else "Пардохти харид аз таъминкунанда", party
	if doc.get("voucher_type") == "Opening Entry":
		return "other", "Начальный остаток", "Бақияи ибтидоӣ", ""
	return "other", "Бухгалтерская проводка", "Сабти муҳосибӣ", ""


def query_movements(wallet=None, period="week", from_date=None, to_date=None,
	op_type=None, direction=None, search=None, start=0, page_length=50, company=None, legacy=False, include_hidden=1):
	from erpnext.accounts.page.money_hub.money_hub import _feed_period, _read_wallets, get_default_company

	company = company or get_default_company()
	wallets = _read_wallets(company, include_hidden=bool(cint(include_hidden)))
	aliases = defaultdict(list)
	for row in wallets:
		aliases[row.account].append(row)
	selected = next((row for row in wallets if row.name == wallet), None) if wallet else None
	if wallet and not selected:
		frappe.throw(_("The selected wallet is outside your permitted company and accounts."), frappe.PermissionError)
	start, page_length = max(0, cint(start)), max(1, cint(page_length) or 50)
	if not legacy:
		page_length = min(page_length, 100)
	if from_date or to_date:
		first, last = getdate(from_date) if from_date else None, getdate(to_date) if to_date else None
	else:
		if period not in (None, "", "all", "today", "yesterday", "week", "month", "quarter"):
			frappe.throw(_("Invalid reporting period."))
		first, last = _feed_period(period)
	if first and last and first > last:
		frappe.throw(_("From date must be before or equal to To date."))
	currency = frappe.get_cached_value("Company", company, "default_currency")
	filters = {"company": company, "account": ["in", sorted(aliases)], "is_cancelled": 0}
	if first and last:
		filters["posting_date"] = ["between", [first, last]]
	elif first:
		filters["posting_date"] = [">=", first]
	elif last:
		filters["posting_date"] = ["<=", last]
	rows = frappe.get_list("GL Entry", filters=filters, fields=["name", "posting_date", "creation",
		"account", "account_currency", "debit", "credit", "debit_in_account_currency",
		"credit_in_account_currency", "voucher_type", "voucher_no"],
		order_by="posting_date desc, creation desc, name desc", limit_page_length=0) if aliases else []
	sources = _sources(rows, company)
	expenses = _expenses(sources, company)
	owner_sources = _owner_sources(sources, company)
	feed, transfers = [], {}
	for row in rows:
		if any(row.get(key) is None for key in ("debit", "credit", "account", "name", "posting_date")):
			# Field-level restrictions must not become fabricated zero movements.
			continue
		doc = sources.get((row.voucher_type, row.voucher_no))
		if not doc:
			continue
		if selected and row.account != selected.account:
			continue
		operation, ru, tg, party = _classify(row.voucher_type, doc, expenses.get((row.voucher_type, row.voucher_no)),
			owner_sources.get((row.voucher_type, row.voucher_no)))
		amount = flt(row.debit) - flt(row.credit)
		account_aliases = aliases[row.account]
		label = selected.wallet_name if selected else " / ".join(w.wallet_name for w in account_aliases)
		item = dict(gl_name=row.name, date=frappe.utils.formatdate(row.posting_date, "dd.mm.yyyy"),
			raw_date=str(row.posting_date), time="", wallet=label, account=row.account,
			wallet_aliases=[w.name for w in account_aliases], label=ru, label_tg=tg, op_type=operation,
			party=party, notes=doc.get("remarks") or doc.get("user_remark") or "",
			debit=max(amount, 0), credit=max(-amount, 0), amount=amount,
			currency=currency, account_currency=row.account_currency,
			account_amount=(flt(row.debit_in_account_currency) - flt(row.credit_in_account_currency)
				if row.get("debit_in_account_currency") is not None and row.get("credit_in_account_currency") is not None else None),
			voucher_type=row.voucher_type, voucher_no=row.voucher_no, user=doc.get("owner") or "",
			is_transfer=operation == "transfer", transfer_amount=0,
			ledger_in=max(amount, 0), ledger_out=max(-amount, 0), movements=[])
		leg = dict(gl_name=row.name, account=row.account, wallet=label, debit=item["debit"],
			credit=item["credit"], account_amount=item["account_amount"], account_currency=row.account_currency)
		if operation == "transfer" and not selected and not legacy:
			key = (row.voucher_type, row.voucher_no)
			if key in transfers:
				event = transfers[key]
				event["movements"].append(leg)
				event["wallet"] = " / ".join(dict.fromkeys(m["wallet"] for m in event["movements"]))
				event["ledger_in"] += item["ledger_in"]
				event["ledger_out"] += item["ledger_out"]
				continue
			transfers[key] = item
		item["movements"].append(leg)
		feed.append(item)
	for item in transfers.values():
		item["transfer_from"] = list(dict.fromkeys(leg["wallet"] for leg in item["movements"] if leg["credit"] > 0))
		item["transfer_to"] = list(dict.fromkeys(leg["wallet"] for leg in item["movements"] if leg["debit"] > 0))
		item["ledger_in"] = _sum(leg["debit"] for leg in item["movements"])
		item["ledger_out"] = _sum(leg["credit"] for leg in item["movements"])
		matched = min(item["ledger_in"], item["ledger_out"])
		item.update(transfer_amount=matched, debit=_sum([item["ledger_in"], -matched]),
			credit=_sum([item["ledger_out"], -matched]), amount=_sum([item["ledger_in"], -item["ledger_out"]]),
			account_currency=None, account_amount=None)
	if op_type and op_type != "all":
		feed = [row for row in feed if row["op_type"] == op_type]
	if direction in ("in", "out"):
		feed = [row for row in feed if row["debit" if direction == "in" else "credit"] > 0]
	elif direction not in (None, "", "all"):
		frappe.throw(_("Invalid movement direction."))
	if search and search.strip():
		needle = search.strip().casefold()
		feed = [row for row in feed if any(needle in str(row[key]).casefold() for key in
			("label", "label_tg", "wallet", "account", "voucher_no", "party", "notes", "user"))]
	summary = {key: _sum(row[key] for row in feed) for key in ("debit", "credit", "transfer_amount", "ledger_in", "ledger_out")}
	summary["net"] = _sum([summary["debit"], -summary["credit"]])
	count = len(feed)
	# Keep a valid last page if rows disappeared while paging.
	start = min(start, ((count - 1) // page_length) * page_length if count else 0)
	return dict(company=company, currency=currency, rows=feed[start:start + page_length],
		total_count=count, summary=summary, start=start, page_length=page_length,
		has_more=start + page_length < count, scope="account" if selected else "permitted_accounts",
		from_date=str(first) if first else None, to_date=str(last) if last else None,
		permission_limited=True, supported_source_types=sorted(SOURCE_FIELDS))
