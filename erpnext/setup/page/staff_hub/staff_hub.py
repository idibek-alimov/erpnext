# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate, add_days, get_first_day, get_last_day
from erpnext.stock.page.product_catalog.product_catalog import get_default_company


def get_date_range_for_period(period="this_month", from_date=None, to_date=None):
	today_d = getdate(today())
	if period == "today":
		return today_d, today_d
	elif period == "this_week":
		start = add_days(today_d, -today_d.weekday())
		return start, today_d
	elif period == "this_month":
		start = get_first_day(today_d)
		return start, today_d
	elif period == "last_month":
		prev_month_end = add_days(get_first_day(today_d), -1)
		start = get_first_day(prev_month_end)
		return start, prev_month_end
	elif period == "custom" and from_date and to_date:
		return getdate(from_date), getdate(to_date)
	return get_first_day(today_d), today_d


@frappe.whitelist()
def get_staff_hub_data(search=None, status="Active", period="this_month", from_date=None, to_date=None, company=None):
	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	start_date, end_date = get_date_range_for_period(period, from_date, to_date)

	conds = ["1=1"]
	vals = {
		"company": company,
		"start_date": start_date,
		"end_date": end_date,
	}

	if status and status != "All":
		conds.append("e.status = %(status)s")
		vals["status"] = status

	if search:
		vals["search_term"] = f"%{search.strip()}%"
		conds.append(
			"(e.name LIKE %(search_term)s OR e.employee_name LIKE %(search_term)s OR e.designation LIKE %(search_term)s OR e.department LIKE %(search_term)s OR e.cell_number LIKE %(search_term)s)"
		)

	where_clause = " AND ".join(conds)

	employees_raw = frappe.db.sql(
		f"""
		SELECT 
			e.name, e.employee_name, e.status, e.department, e.designation,
			e.cell_number, e.image, e.user_id,
			COALESCE(e.custom_base_salary, 0) as base_salary,
			COALESCE(e.custom_salary_frequency, 'Monthly') as salary_frequency,
			e.custom_commission_scheme as commission_scheme,
			e.custom_default_cash_account as default_cash_account
		FROM `tabEmployee` e
		WHERE {where_clause}
		ORDER BY e.status ASC, e.employee_name ASC
		""",
		vals,
		as_dict=True,
	)

	# Pre-load schemes to compute commissions fast
	scheme_names = list(set([emp.commission_scheme for emp in employees_raw if emp.commission_scheme]))
	schemes_map = {}
	for sname in scheme_names:
		try:
			schemes_map[sname] = frappe.get_doc("Staff Commission Scheme", sname)
		except Exception:
			schemes_map[sname] = None

	staff_list = []
	summary = {
		"total_staff": len(employees_raw),
		"active_staff": len([e for e in employees_raw if e.status == "Active"]),
		"total_sales": 0.0,
		"total_gross_profit": 0.0,
		"total_commission": 0.0,
		"total_bonuses": 0.0,
		"total_penalties": 0.0,
		"total_expenses": 0.0,
		"total_advances": 0.0,
		"total_net_payable": 0.0,
		"currency": currency,
		"period": period,
		"start_date": str(start_date),
		"end_date": str(end_date),
	}

	for emp in employees_raw:
		emp_id = emp.name
		emp_name = emp_id
		emp_full_name = emp.employee_name
		user_id = emp.user_id

		# 1. Calculate Sales and Gross Profit from Sales Invoices and POS Invoices
		user_filter = "si.owner = %(user_id)s" if user_id else "1=0"
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
		sales_data = frappe.db.sql(
			f"""
			SELECT 
				COALESCE(SUM(si.grand_total), 0) as sales_volume,
				COALESCE(SUM(si.base_net_total), 0) as net_sales,
				COUNT(si.name) as invoice_count
			FROM `tabSales Invoice` si
			WHERE si.docstatus = 1 
			  AND si.company = %(company)s
			  AND si.posting_date BETWEEN %(start_date)s AND %(end_date)s
			  AND {sales_filter}
			""",
			{"company": company, "start_date": start_date, "end_date": end_date, "user_id": user_id, "emp_id": emp_id, "emp_full_name": emp_full_name},
			as_dict=True,
		)
		sales_volume = flt(sales_data[0].sales_volume) if sales_data else 0.0
		invoice_count = cint(sales_data[0].invoice_count) if sales_data else 0

		# Gross Profit: calculate from items
		gp_data = frappe.db.sql(
			f"""
			SELECT 
				COALESCE(SUM(sii.base_net_amount - (sii.stock_qty * sii.incoming_rate)), 0) as gross_profit
			FROM `tabSales Invoice Item` sii
			JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE si.docstatus = 1 
			  AND si.company = %(company)s
			  AND si.posting_date BETWEEN %(start_date)s AND %(end_date)s
			  AND {sales_filter}
			""",
			{"company": company, "start_date": start_date, "end_date": end_date, "user_id": user_id, "emp_id": emp_id, "emp_full_name": emp_full_name},
			as_dict=True,
		)
		gross_profit = flt(gp_data[0].gross_profit) if gp_data else 0.0
		if gross_profit < 0:
			gross_profit = 0.0

		# 2. Commission Calculation
		scheme_doc = schemes_map.get(emp.commission_scheme)
		commission_rate = 0.0
		commission_amount = 0.0
		basis_type = "Total Sales Revenue"

		if scheme_doc:
			basis_type = scheme_doc.basis or "Total Sales Revenue"
			basis_amt = gross_profit if basis_type == "Gross Profit Margin" else sales_volume
			commission_rate, commission_amount = scheme_doc.calculate_commission(basis_amt)

		# 3. Company Paid Daily Expenses (Lunch, Taxi, Phone) from Quick Expense
		expenses_data = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(amount), 0) as total_expenses, COUNT(name) as expense_count
			FROM `tabQuick Expense`
			WHERE docstatus = 1 
			  AND company = %(company)s
			  AND party_type = 'Employee' 
			  AND party = %(emp_name)s
			  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
			""",
			{"company": company, "emp_name": emp_name, "start_date": start_date, "end_date": end_date},
			as_dict=True,
		)
		expenses_amount = flt(expenses_data[0].total_expenses) if expenses_data else 0.0
		expenses_count = cint(expenses_data[0].expense_count) if expenses_data else 0

		# 4. Bonuses & Penalties from Staff Incentive
		incentives_data = frappe.db.sql(
			"""
			SELECT 
				COALESCE(SUM(CASE WHEN type = 'Bonus' THEN amount ELSE 0 END), 0) as bonuses,
				COALESCE(SUM(CASE WHEN type = 'Penalty' THEN amount ELSE 0 END), 0) as penalties
			FROM `tabStaff Incentive`
			WHERE employee = %(emp_name)s
			  AND company = %(company)s
			  AND status != 'Cancelled'
			  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
			""",
			{"company": company, "emp_name": emp_name, "start_date": start_date, "end_date": end_date},
			as_dict=True,
		)
		bonuses = flt(incentives_data[0].bonuses) if incentives_data else 0.0
		penalties = flt(incentives_data[0].penalties) if incentives_data else 0.0

		# 5. Cash Advances from Staff Advance
		advances_data = frappe.db.sql(
			"""
			SELECT COALESCE(SUM(amount), 0) as advances
			FROM `tabStaff Advance`
			WHERE employee = %(emp_name)s
			  AND company = %(company)s
			  AND docstatus = 1
			  AND status != 'Cancelled'
			  AND posting_date BETWEEN %(start_date)s AND %(end_date)s
			""",
			{"company": company, "emp_name": emp_name, "start_date": start_date, "end_date": end_date},
			as_dict=True,
		)
		advances = flt(advances_data[0].advances) if advances_data else 0.0

		# 6. Net Payable
		base_salary = flt(emp.base_salary)
		net_payable = flt((base_salary + commission_amount + bonuses) - (penalties + advances), 2)

		staff_record = {
			"name": emp_name,
			"employee_name": emp.employee_name,
			"status": emp.status,
			"department": emp.department or "",
			"designation": emp.designation or _("Staff"),
			"cell_number": emp.cell_number or "",
			"image": emp.image or "",
			"user_id": user_id or "",
			"base_salary": base_salary,
			"salary_frequency": emp.salary_frequency,
			"commission_scheme": emp.commission_scheme or "",
			"commission_rate": commission_rate,
			"commission_amount": commission_amount,
			"sales_volume": sales_volume,
			"invoice_count": invoice_count,
			"gross_profit": gross_profit,
			"expenses_amount": expenses_amount,
			"expenses_count": expenses_count,
			"bonuses": bonuses,
			"penalties": penalties,
			"advances": advances,
			"net_payable": net_payable,
			"currency": currency,
		}
		staff_list.append(staff_record)

		# Aggregate summary metrics
		if emp.status == "Active":
			summary["total_sales"] += sales_volume
			summary["total_gross_profit"] += gross_profit
			summary["total_commission"] += commission_amount
			summary["total_bonuses"] += bonuses
			summary["total_penalties"] += penalties
			summary["total_expenses"] += expenses_amount
			summary["total_advances"] += advances
			summary["total_net_payable"] += net_payable

	# Sort staff list by net payable or sales
	staff_list.sort(key=lambda x: (0 if x["status"] == "Active" else 1, -x["net_payable"]))

	return {
		"staff": staff_list,
		"summary": summary,
		"total": len(staff_list),
	}
