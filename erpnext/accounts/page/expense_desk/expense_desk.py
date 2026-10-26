# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, today, nowdate, getdate, formatdate

from erpnext.stock.page.product_catalog.product_catalog import get_default_company


DEFAULT_RETAIL_CATEGORIES = [
	{"category_name": "Упаковка и пакеты", "icon": "📦", "default_account": None},
	{"category_name": "Курьер и доставка", "icon": "🚚", "default_account": None},
	{"category_name": "Питание и чай", "icon": "☕", "default_account": None},
	{"category_name": "Уборка и хозтовары", "icon": "🧹", "default_account": None},
	{"category_name": "Коммуналка и интернет", "icon": "💡", "default_account": None},
	{"category_name": "Ремонт и обслуживание", "icon": "🔧", "default_account": None},
	{"category_name": "Аванс сотруднику", "icon": "👤", "default_account": None},
	{"category_name": "Аренда помещения", "icon": "🏢", "default_account": None},
	{"category_name": "Такси и транспорт", "icon": "🚕", "default_account": None},
	{"category_name": "Прочие расходы", "icon": "🏷️", "default_account": None},
]


def ensure_default_payment_accounts(company):
	"""Ensure standard retail Cash In Safe and Bank accounts exist in Chart of Accounts."""
	try:
		# 1. Safe Account under Cash In Hand
		cash_parent = frappe.db.get_value(
			"Account", {"company": company, "account_name": "Cash In Hand", "is_group": 1}, "name"
		)
		if cash_parent:
			safe_exists = frappe.db.get_value(
				"Account",
				{
					"company": company,
					"account_name": ["in", ["Safe", "Сейф", "Сейф (Safe)", "Сейф магазина", "Касса Сейф"]],
					"is_group": 0,
				},
				"name",
			)
			if not safe_exists:
				safe_doc = frappe.get_doc({
					"doctype": "Account",
					"company": company,
					"account_name": "Сейф (Safe)",
					"account_type": "Cash",
					"parent_account": cash_parent,
					"is_group": 0,
				})
				safe_doc.flags.ignore_permissions = True
				safe_doc.insert()
				frappe.db.commit()

		# 2. Bank Account under Bank Accounts
		bank_parent = frappe.db.get_value(
			"Account", {"company": company, "account_name": "Bank Accounts", "is_group": 1}, "name"
		)
		if bank_parent:
			bank_exists = frappe.db.get_value(
				"Account", {"company": company, "account_type": "Bank", "is_group": 0}, "name"
			)
			if not bank_exists:
				bank_doc = frappe.get_doc({
					"doctype": "Account",
					"company": company,
					"account_name": "Банковский счет (Карта)",
					"account_type": "Bank",
					"parent_account": bank_parent,
					"is_group": 0,
				})
				bank_doc.flags.ignore_permissions = True
				bank_doc.insert()
				frappe.db.commit()
	except Exception as e:
		frappe.log_error(f"Error ensuring payment accounts: {e}")


def ensure_default_categories(company):
	"""Ensure standard retail categories in Russian exist in Quick Expense Category."""
	existing = frappe.db.get_all("Quick Expense Category", pluck="category_name")
	
	# If old English categories are present, clear them so Russian takes over
	old_english = {"Packaging & Bags", "Courier & Delivery", "Food & Tea", "Cleaning & Supplies", "Utilities & Internet", "Repairs & Maintenance", "Staff Advance", "Rent"}
	if any(e in old_english for e in existing):
		frappe.db.sql(
			"DELETE FROM `tabQuick Expense Category` WHERE category_name IN ('Packaging & Bags', 'Courier & Delivery', 'Food & Tea', 'Cleaning & Supplies', 'Utilities & Internet', 'Repairs & Maintenance', 'Staff Advance', 'Rent')"
		)
		frappe.db.commit()
		existing = frappe.db.get_all("Quick Expense Category", pluck="category_name")

	if existing:
		return

	from erpnext.accounts.doctype.quick_expense.quick_expense import CATEGORY_ACCOUNT_MAP

	for cat in DEFAULT_RETAIL_CATEGORIES:
		name = cat["category_name"]
		default_acc = None
		candidates = CATEGORY_ACCOUNT_MAP.get(name, [])
		for candidate in candidates:
			acc = frappe.db.get_value(
				"Account",
				{"company": company, "account_name": candidate, "is_group": 0, "root_type": "Expense"},
				"name",
			)
			if acc:
				default_acc = acc
				break

		doc = frappe.get_doc({
			"doctype": "Quick Expense Category",
			"category_name": name,
			"icon": cat["icon"],
			"default_account": default_acc,
			"is_pinned": 1,
		})
		doc.flags.ignore_permissions = True
		doc.insert()
	frappe.db.commit()


@frappe.whitelist()
def get_expense_desk_init_data(company=None):
	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	ensure_default_payment_accounts(company)
	ensure_default_categories(company)

	# 1. Discover Payment Sources (POS Tills, Safe, Bank)
	payment_sources = get_payment_sources(company)

	# 2. Fetch Pinned / Active Categories in Russian
	categories = frappe.db.get_all(
		"Quick Expense Category",
		fields=["name", "category_name", "icon", "default_account", "is_pinned"],
		order_by="is_pinned desc, creation asc",
	)

	# 3. Fetch Expense Accounts for Custom Picker
	expense_accounts = frappe.db.get_all(
		"Account",
		filters={"company": company, "root_type": "Expense", "is_group": 0},
		fields=["name", "account_name"],
		order_by="account_name asc",
	)

	# 4. Fetch Employees for Staff Advance
	employees = frappe.db.get_all(
		"Employee",
		filters={"status": "Active", "company": company},
		fields=["name", "employee_name"],
		order_by="employee_name asc",
	)

	# 5. Fetch Today's & Recent Expenses
	recent_expenses, summary = get_expenses_and_summary(company, period="today")

	return {
		"company": company,
		"currency": currency,
		"payment_sources": payment_sources,
		"categories": categories,
		"expense_accounts": expense_accounts,
		"employees": employees,
		"recent_expenses": recent_expenses,
		"summary": summary,
	}


def get_payment_sources(company):
	from erpnext.accounts.utils import get_balance_on

	sources = []
	seen_accounts = set()

	# A. Active POS Profiles (Tills)
	pos_profiles = frappe.db.get_all(
		"POS Profile",
		filters={"company": company, "disabled": 0},
		fields=["name", "warehouse", "posa_cash_mode_of_payment"],
	)

	for prof in pos_profiles:
		cash_mop = prof.posa_cash_mode_of_payment or "Cash"
		account = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": cash_mop, "company": company},
			"default_account",
		)
		if not account:
			account = frappe.db.get_value(
				"Account",
				{"company": company, "account_type": "Cash", "is_group": 0},
				"name",
			)

		balance = 0.0
		if account:
			balance = flt(get_balance_on(account))
			seen_accounts.add(account)

		sources.append({
			"id": f"pos:{prof.name}",
			"type": "pos",
			"pos_profile": prof.name,
			"account": account,
			"label": f"💵 Касса: {prof.name}",
			"balance": balance,
		})

	# B. Safe / General Cash in Hand accounts
	cash_accounts = frappe.db.get_all(
		"Account",
		filters={"company": company, "account_type": "Cash", "is_group": 0},
		fields=["name", "account_name"],
	)

	for acc in cash_accounts:
		if acc.name in seen_accounts:
			continue
		balance = flt(get_balance_on(acc.name))
		sources.append({
			"id": f"safe:{acc.name}",
			"type": "safe",
			"pos_profile": None,
			"account": acc.name,
			"label": f"🔐 {acc.account_name}",
			"balance": balance,
		})
		seen_accounts.add(acc.name)

	# If all cash accounts were assigned to POS, ensure an explicit Safe source option
	if not any(s["type"] == "safe" for s in sources):
		default_cash = frappe.get_cached_value("Company", company, "default_cash_account") or "Cash - R"
		balance = flt(get_balance_on(default_cash)) if default_cash else 0.0
		sources.append({
			"id": f"safe:{default_cash}",
			"type": "safe",
			"pos_profile": None,
			"account": default_cash,
			"label": "🔐 Сейф магазина (Safe)",
			"balance": balance,
		})

	# C. Bank Accounts
	bank_accounts = frappe.db.get_all(
		"Account",
		filters={"company": company, "account_type": "Bank", "is_group": 0},
		fields=["name", "account_name"],
	)

	for acc in bank_accounts:
		balance = flt(get_balance_on(acc.name))
		sources.append({
			"id": f"bank:{acc.name}",
			"type": "bank",
			"pos_profile": None,
			"account": acc.name,
			"label": f"💳 {acc.account_name}",
			"balance": balance,
		})

	return sources


@frappe.whitelist()
def get_filtered_expenses(
	period="today",
	from_date=None,
	to_date=None,
	source_id="all",
	category="all",
	search=None,
	company=None,
):
	company = company or get_default_company()
	recent_expenses, summary = get_expenses_and_summary(
		company,
		period=period,
		from_date=from_date,
		to_date=to_date,
		source_id=source_id,
		category=category,
		search=search,
	)
	return {"recent_expenses": recent_expenses, "summary": summary}


def get_expenses_and_summary(
	company,
	period="today",
	from_date=None,
	to_date=None,
	source_id="all",
	category="all",
	search=None,
):
	from frappe.utils import add_days, get_first_day, get_last_day

	today_d = getdate(today())
	start_date = today_d
	end_date = today_d

	if period == "custom" and from_date and to_date:
		start_date = getdate(from_date)
		end_date = getdate(to_date)
	elif period == "yesterday":
		start_date = add_days(today_d, -1)
		end_date = start_date
	elif period == "week":
		start_date = add_days(today_d, -7)
		end_date = today_d
	elif period == "month":
		start_date = get_first_day(today_d)
		end_date = get_last_day(today_d)
	elif period == "all":
		start_date = None
		end_date = None

	conds = ["company = %(company)s", "docstatus < 2"]
	vals = {"company": company}

	if start_date and end_date:
		conds.append("posting_date BETWEEN %(start_date)s AND %(end_date)s")
		vals["start_date"] = start_date
		vals["end_date"] = end_date

	if category and category != "all":
		conds.append("expense_category = %(category)s")
		vals["category"] = category

	if source_id and source_id != "all":
		if source_id.startswith("pos:"):
			pos_name = source_id.split(":", 1)[1]
			conds.append("pos_profile = %(pos_profile)s")
			vals["pos_profile"] = pos_name
		elif source_id.startswith("safe:") or source_id.startswith("bank:"):
			acc_name = source_id.split(":", 1)[1]
			conds.append("paid_from = %(paid_from)s")
			vals["paid_from"] = acc_name

	if search and search.strip():
		vals["search_term"] = f"%{search.strip()}%"
		conds.append(
			"(name LIKE %(search_term)s OR description LIKE %(search_term)s OR beneficiary_name LIKE %(search_term)s OR party LIKE %(search_term)s)"
		)

	where_str = " AND ".join(conds)

	expenses = frappe.db.sql(
		f"""
		SELECT 
			name, posting_date, creation, expense_category, amount,
			paid_from, pos_profile, party_type, party, beneficiary_name,
			description, receipt_attachment, journal_entry, payment_entry,
			purchase_invoice, docstatus, owner
		FROM `tabQuick Expense`
		WHERE {where_str}
		ORDER BY creation DESC
		LIMIT 150
		""",
		vals,
		as_dict=True,
	)

	icon_map = dict(
		frappe.db.sql("SELECT category_name, icon FROM `tabQuick Expense Category`")
	)

	for exp in expenses:
		exp["icon"] = icon_map.get(exp["expense_category"], "🏷️")
		exp["formatted_time"] = exp["creation"].strftime("%H:%M") if exp.get("creation") else ""
		exp["formatted_date"] = formatdate(exp["posting_date"], "dd.mm.yyyy")
		exp["amount"] = flt(exp["amount"])

	# Calculate summary for this filtered period
	total_amount = sum(e["amount"] for e in expenses)
	total_count = len(expenses)

	cat_totals = {}
	for e in expenses:
		cat = e["expense_category"] or "Прочие"
		cat_totals[cat] = cat_totals.get(cat, 0.0) + e["amount"]

	category_breakdown = [
		{
			"category": cat,
			"icon": icon_map.get(cat, "🏷️"),
			"total": round(amt, 2),
			"percent": round((amt / total_amount * 100), 1) if total_amount > 0 else 0,
		}
		for cat, amt in sorted(cat_totals.items(), key=lambda x: x[1], reverse=True)
	]

	# Today's overall total (unfiltered)
	today_total_all = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(amount), 0)
		FROM `tabQuick Expense`
		WHERE company = %s AND posting_date = %s AND docstatus = 1
		""",
		(company, today()),
	)[0][0]

	summary = {
		"period_total": round(total_amount, 2),
		"period_count": total_count,
		"today_total": round(flt(today_total_all), 2),
		"category_breakdown": category_breakdown,
	}

	return expenses, summary


@frappe.whitelist()
def record_quick_expense(
	category,
	amount,
	paid_from=None,
	pos_profile=None,
	description=None,
	beneficiary_name=None,
	expense_account=None,
	posting_date=None,
	party_type=None,
	party=None,
	receipt_attachment=None,
	pin_category=False,
	icon="🏷️",
	company=None,
):
	"""Instantly create and submit a Quick Expense from the Expense Desk."""
	roles = frappe.get_roles()
	allowed_roles = {"Accounts Manager", "Stock Manager", "System Manager", "Administrator"}
	if not allowed_roles.intersection(roles):
		frappe.throw(_("Only Store Managers and Owners can log expenses from the Expense Desk."))

	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than 0"))

	doc = frappe.new_doc("Quick Expense")
	doc.company = company
	doc.posting_date = posting_date or today()
	doc.expense_category = category
	doc.amount = amount
	doc.pos_profile = pos_profile
	doc.paid_from = paid_from
	doc.description = description
	doc.beneficiary_name = beneficiary_name
	doc.expense_account = expense_account
	doc.party_type = party_type
	doc.party = party
	doc.receipt_attachment = receipt_attachment

	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()

	if pin_category and category:
		if not frappe.db.exists("Quick Expense Category", category):
			cat_doc = frappe.get_doc({
				"doctype": "Quick Expense Category",
				"category_name": category,
				"icon": icon or "🏷️",
				"default_account": expense_account,
				"is_pinned": 1,
			})
			cat_doc.flags.ignore_permissions = True
			cat_doc.insert()
			frappe.db.commit()

	return get_expense_desk_init_data(company)


@frappe.whitelist()
def cancel_quick_expense(expense_name, company=None):
	"""Void/Cancel an expense and its underlying Journal or Payment Entry."""
	roles = frappe.get_roles()
	allowed_roles = {"Accounts Manager", "Stock Manager", "System Manager", "Administrator"}
	if not allowed_roles.intersection(roles):
		frappe.throw(_("Only Store Managers and Owners can cancel expenses."))

	company = company or get_default_company()
	doc = frappe.get_doc("Quick Expense", expense_name)
	if doc.docstatus == 1:
		doc.flags.ignore_permissions = True
		doc.cancel()

	return get_expense_desk_init_data(company)
