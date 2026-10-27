# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate, nowdate
from erpnext.stock.page.product_catalog.product_catalog import get_default_company
from erpnext.setup.page.staff_hub.staff_hub import get_date_range_for_period
from erpnext.accounts.page.expense_desk.expense_desk import get_payment_sources


def get_wallet_payment_sources(company):
	"""Money Hub wallets in the same shape as get_payment_sources (account/label/balance)."""
	from erpnext.accounts.utils import get_balance_on
	from erpnext.accounts.page.money_hub.money_hub import import_existing_accounts

	try:
		import_existing_accounts(company)
	except Exception:
		pass

	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	wallets = frappe.db.get_all(
		"Money Wallet",
		filters={"company": company, "enabled": 1},
		fields=["name", "wallet_name", "wallet_type", "account", "icon"],
		order_by="sort_order asc, creation asc",
	)
	sources = []
	for w in wallets:
		if not w.account:
			continue
		bal = flt(get_balance_on(w.account, company=company))
		icon = w.icon or ("💵" if w.wallet_type == "Till" else "🔐" if w.wallet_type == "Safe" else "📱" if w.wallet_type == "Mobile Wallet" else "🏦")
		sources.append({
			"id": f"wallet:{w.name}",
			"type": "wallet",
			"wallet": w.name,
			"account": w.account,
			"label": f"{icon} {w.wallet_name} · {bal:,.2f} {currency}",
			"balance": bal,
		})
	return sources


@frappe.whitelist()
def get_staff_detail(employee, period="this_month", from_date=None, to_date=None, company=None):
	if not employee:
		frappe.throw(_("Employee ID is required"))

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	start_date, end_date = get_date_range_for_period(period, from_date, to_date)

	# 1. Fetch Employee Profile
	emp = frappe.db.get_value(
		"Employee",
		employee,
		[
			"name", "employee_name", "status", "department", "designation",
			"cell_number", "image", "user_id", "date_of_joining",
			"custom_base_salary", "custom_salary_frequency",
			"custom_commission_scheme", "custom_default_cash_account"
		],
		as_dict=True,
	)
	if not emp:
		frappe.throw(_("Employee {0} not found").format(employee))

	emp["base_salary"] = flt(emp.custom_base_salary)
	emp["salary_frequency"] = emp.custom_salary_frequency or "Monthly"

	# 2. Fetch Scheme Information
	scheme_info = None
	if emp.custom_commission_scheme:
		try:
			s_doc = frappe.get_doc("Staff Commission Scheme", emp.custom_commission_scheme)
			scheme_info = {
				"name": s_doc.name,
				"basis": s_doc.basis,
				"calculation_type": s_doc.calculation_type,
				"fixed_rate": flt(s_doc.fixed_rate),
				"tier_method": s_doc.tier_method,
				"tiers": [
					{
						"from_amount": flt(t.from_amount),
						"to_amount": flt(t.to_amount),
						"commission_percent": flt(t.commission_percent),
					}
					for t in (s_doc.tiers or [])
				],
			}
		except Exception:
			scheme_info = None

	# 3. Fetch Sales Invoices for this Employee
	user_filter = "si.owner = %(user_id)s" if emp.user_id else "1=0"
	sales_filter = f"""
		({user_filter} OR si.name IN (
			SELECT DISTINCT parent FROM `tabSales Team`
			WHERE sales_person = %(emp_id)s
			   OR sales_person = %(emp_full_name)s
			   OR sales_person IN (
			       SELECT name FROM `tabSales Person` 
			       WHERE employee = %(emp_id)s OR sales_person_name = %(emp_full_name)s OR name = %(emp_full_name)s
			   )
		))
	"""
	invoices = frappe.db.sql(
		f"""
		SELECT 
			si.name, si.posting_date, si.customer_name, si.grand_total,
			si.base_net_total, si.owner
		FROM `tabSales Invoice` si
		WHERE si.docstatus = 1 
		  AND si.company = %(company)s
		  AND si.posting_date BETWEEN %(start_date)s AND %(end_date)s
		  AND {sales_filter}
		ORDER BY si.posting_date DESC, si.creation DESC
		""",
		{"company": company, "start_date": start_date, "end_date": end_date, "user_id": emp.user_id, "emp_id": employee, "emp_full_name": emp.employee_name},
		as_dict=True,
	)

	# Fetch item level gross profit for these invoices
	inv_names = [inv.name for inv in invoices]
	gp_map = {}
	if inv_names:
		gp_rows = frappe.db.sql(
			"""
			SELECT 
				parent,
				COALESCE(SUM(base_net_amount - (stock_qty * incoming_rate)), 0) as profit
			FROM `tabSales Invoice Item`
			WHERE parent IN %(inv_names)s
			GROUP BY parent
			""",
			{"inv_names": inv_names},
			as_dict=True,
		)
		for row in gp_rows:
			gp_map[row.parent] = flt(row.profit)

	sales_volume = 0.0
	gross_profit_total = 0.0
	for inv in invoices:
		inv["gross_profit"] = max(0.0, gp_map.get(inv.name, 0.0))
		inv["grand_total"] = flt(inv.grand_total)
		sales_volume += inv["grand_total"]
		gross_profit_total += inv["gross_profit"]

	# 4. Commission Calculation
	commission_rate = 0.0
	commission_amount = 0.0
	if emp.custom_commission_scheme and scheme_info:
		try:
			s_doc = frappe.get_doc("Staff Commission Scheme", emp.custom_commission_scheme)
			basis_amt = gross_profit_total if s_doc.basis == "Gross Profit Margin" else sales_volume
			commission_rate, commission_amount = s_doc.calculate_commission(basis_amt)
		except Exception:
			pass

	# 5. Fetch Quick Expenses (Company-paid Lunch, Taxi, etc.)
	expenses = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, expense_category, amount,
			paid_from, mode_of_payment, description
		FROM `tabQuick Expense`
		WHERE docstatus = 1 
		  AND company = %(company)s
		  AND party_type = 'Employee'
		  AND party = %(emp_name)s
		  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
		ORDER BY posting_date DESC, creation DESC
		""",
		{"company": company, "emp_name": employee, "start_date": start_date, "end_date": end_date},
		as_dict=True,
	)
	total_expenses = sum([flt(e.amount) for e in expenses])

	# 6. Fetch Staff Incentives (Bonuses & Penalties)
	incentives = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, type, category, amount, reason, status, settlement_ref
		FROM `tabStaff Incentive`
		WHERE employee = %(emp_name)s
		  AND company = %(company)s
		  AND status != 'Cancelled'
		  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
		ORDER BY posting_date DESC, creation DESC
		""",
		{"company": company, "emp_name": employee, "start_date": start_date, "end_date": end_date},
		as_dict=True,
	)
	bonuses_total = sum([flt(i.amount) for i in incentives if i.type == "Bonus"])
	penalties_total = sum([flt(i.amount) for i in incentives if i.type == "Penalty"])

	# 7. Fetch Staff Advances
	advances = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, amount, paid_from, mode_of_payment, status, reason, settlement_ref
		FROM `tabStaff Advance`
		WHERE employee = %(emp_name)s
		  AND company = %(company)s
		  AND docstatus = 1
		  AND status != 'Cancelled'
		  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
		ORDER BY posting_date DESC, creation DESC
		""",
		{"company": company, "emp_name": employee, "start_date": start_date, "end_date": end_date},
		as_dict=True,
	)
	advances_total = sum([flt(a.amount) for a in advances])

	# 8. Fetch Past Settlements
	settlements = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, start_date, end_date, net_payable,
			commission_amount, bonuses_total, advances_deducted,
			paid_from, status
		FROM `tabStaff Settlement`
		WHERE employee = %(emp_name)s
		  AND company = %(company)s
		  AND docstatus = 1
		ORDER BY posting_date DESC, creation DESC
		""",
		{"company": company, "emp_name": employee},
		as_dict=True,
	)

	# 9. Net Balance Calculation
	net_payable = flt((emp["base_salary"] + commission_amount + bonuses_total) - (penalties_total + advances_total), 2)

	# 10. Metadata for Modals
	payment_sources = get_wallet_payment_sources(company) or get_payment_sources(company)
	categories = frappe.db.get_all(
		"Quick Expense Category",
		fields=["name", "category_name", "icon", "default_account"],
		order_by="is_pinned desc, creation asc",
	)
	schemes_list = frappe.db.get_all(
		"Staff Commission Scheme",
		filters={"is_active": 1},
		fields=["name", "basis", "calculation_type", "fixed_rate"],
		order_by="name asc",
	)

	return {
		"employee": emp,
		"scheme_info": scheme_info,
		"invoices": invoices,
		"expenses": expenses,
		"incentives": incentives,
		"advances": advances,
		"settlements": settlements,
		"summary": {
			"currency": currency,
			"period": period,
			"start_date": str(start_date),
			"end_date": str(end_date),
			"sales_volume": sales_volume,
			"gross_profit": gross_profit_total,
			"commission_rate": commission_rate,
			"commission_amount": commission_amount,
			"bonuses_total": bonuses_total,
			"penalties_total": penalties_total,
			"advances_total": advances_total,
			"expenses_total": total_expenses,
			"base_salary": emp["base_salary"],
			"net_payable": net_payable,
		},
		"payment_sources": payment_sources,
		"categories": categories,
		"schemes_list": schemes_list,
	}


@frappe.whitelist()
def add_staff_expense(employee, expense_category, amount, paid_from, description=None, posting_date=None, company=None):
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than zero."))

	doc = frappe.new_doc("Quick Expense")
	doc.company = company
	doc.posting_date = posting_date or today()
	doc.expense_category = expense_category
	doc.amount = amount
	doc.paid_from = paid_from
	doc.description = description or _("Expense allowance for {0}").format(employee)
	doc.party_type = "Employee"
	doc.party = employee

	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()

	return {"success": True, "name": doc.name}


@frappe.whitelist()
def add_staff_incentive(employee, type, amount, reason=None, category=None, posting_date=None, company=None):
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than zero."))

	doc = frappe.new_doc("Staff Incentive")
	doc.company = company
	doc.employee = employee
	doc.posting_date = posting_date or today()
	doc.type = type or "Bonus"
	valid_cats = ["Daily Sales Target", "Weekly Performance", "Monthly Award", "Attendance / Punctuality", "Customer Compliment", "Disciplinary", "Other"]
	doc.category = category if category in valid_cats else "Other"
	doc.amount = amount
	doc.reason = reason or ""

	doc.flags.ignore_permissions = True
	doc.insert()

	return {"success": True, "name": doc.name}


@frappe.whitelist()
def add_staff_advance(employee, amount, paid_from, reason=None, mode_of_payment=None, posting_date=None, company=None):
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Advance amount must be greater than zero."))

	doc = frappe.new_doc("Staff Advance")
	doc.company = company
	doc.employee = employee
	doc.posting_date = posting_date or today()
	doc.amount = amount
	doc.paid_from = paid_from
	doc.mode_of_payment = mode_of_payment
	doc.reason = reason or ""

	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()

	return {"success": True, "name": doc.name}


@frappe.whitelist()
def settle_staff_balance(
	employee, start_date, end_date, base_salary, sales_volume,
	gross_profit, commission_amount, bonuses_total, penalties_total,
	advances_deducted, expenses_company_paid, net_payable,
	paid_from, mode_of_payment=None, remarks=None, company=None
):
	company = company or get_default_company()
	net_payable = flt(net_payable)

	doc = frappe.new_doc("Staff Settlement")
	doc.company = company
	doc.employee = employee
	doc.posting_date = today()
	doc.start_date = start_date
	doc.end_date = end_date
	doc.base_salary = flt(base_salary)
	doc.sales_volume = flt(sales_volume)
	doc.gross_profit = flt(gross_profit)
	doc.commission_amount = flt(commission_amount)
	doc.bonuses_total = flt(bonuses_total)
	doc.penalties_total = flt(penalties_total)
	doc.advances_deducted = flt(advances_deducted)
	doc.expenses_company_paid = flt(expenses_company_paid)
	doc.net_payable = net_payable
	doc.paid_from = paid_from
	doc.mode_of_payment = mode_of_payment
	doc.remarks = remarks or ""

	doc.flags.ignore_permissions = True
	doc.insert()
	doc.submit()

	return {"success": True, "name": doc.name}


@frappe.whitelist()
def save_staff_settings(employee, custom_base_salary, custom_salary_frequency, custom_commission_scheme, custom_default_cash_account):
	if not employee:
		frappe.throw(_("Employee ID is required"))

	frappe.db.set_value(
		"Employee",
		employee,
		{
			"custom_base_salary": flt(custom_base_salary),
			"custom_salary_frequency": custom_salary_frequency or "Monthly",
			"custom_commission_scheme": custom_commission_scheme or None,
			"custom_default_cash_account": custom_default_cash_account or None,
		},
	)
	frappe.db.commit()
	return {"success": True}
