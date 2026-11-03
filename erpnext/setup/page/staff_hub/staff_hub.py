# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import re
import frappe
from frappe import _
from frappe.utils import flt, cint, today, getdate, add_days, get_first_day, get_last_day
from frappe.utils.nestedset import get_root_of
from frappe.utils.password import update_password
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

		sales_person_name = frappe.db.get_value("Sales Person", {"employee": emp_name}, "name") or ""

		staff_record = {
			"name": emp_name,
			"employee_name": emp.employee_name,
			"status": emp.status,
			"department": emp.department or "",
			"designation": emp.designation or _("Staff"),
			"cell_number": emp.cell_number or "",
			"image": emp.image or "",
			"user_id": user_id or "",
			"sales_person": sales_person_name,
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


@frappe.whitelist()
def get_staff_onboarding_context(company=None):
	from erpnext.setup.page.staff_detail.staff_detail import get_wallet_payment_sources
	from erpnext.accounts.page.expense_desk.expense_desk import get_payment_sources

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	schemes = frappe.db.get_all(
		"Staff Commission Scheme",
		filters={"is_active": 1},
		fields=["name", "basis", "calculation_type", "fixed_rate"],
		order_by="name asc",
	)

	payment_sources = get_wallet_payment_sources(company) or get_payment_sources(company)

	pos_profiles = frappe.db.get_all(
		"POS Profile",
		filters={"disabled": 0, "company": company},
		fields=["name", "company", "warehouse"],
		order_by="name asc",
	)
	if not pos_profiles:
		pos_profiles = frappe.db.get_all(
			"POS Profile",
			filters={"disabled": 0},
			fields=["name", "company", "warehouse"],
			order_by="name asc",
		)

	return {
		"company": company,
		"currency": currency,
		"schemes": schemes,
		"payment_sources": payment_sources,
		"pos_profiles": pos_profiles,
	}


def _ensure_designation(designation_name: str) -> str:
	designation_name = (designation_name or "").strip()
	if not designation_name:
		return ""
	if not frappe.db.exists("Designation", designation_name):
		doc = frappe.get_doc({"doctype": "Designation", "designation_name": designation_name})
		doc.flags.ignore_permissions = True
		doc.insert()
	return designation_name


def _ensure_default_gender() -> str:
	existing = frappe.db.get_value("Gender", {}, "name")
	if existing:
		return existing
	doc = frappe.get_doc({"doctype": "Gender", "gender": "Not Specified"})
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def _ensure_sales_person_root() -> str:
	root = get_root_of("Sales Person")
	if root:
		return root
	root_name = "All Sales Persons"
	if frappe.db.exists("Sales Person", root_name):
		return root_name
	doc = frappe.get_doc({
		"doctype": "Sales Person",
		"sales_person_name": root_name,
		"is_group": 1,
		"enabled": 1,
	})
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def _resolve_login_credentials(login_id: str) -> tuple[str, str]:
	raw = (login_id or "").strip()
	if not raw:
		frappe.throw(_("Login email or username is required for this role."))

	if "@" in raw:
		email = raw.lower()
		username = raw.split("@")[0].strip()
		return email, username

	sanitized = re.sub(r"[^a-zA-Z0-9_.-]", "", raw).lower()
	if not sanitized:
		frappe.throw(_("Login username must contain letters or numbers."))
	email = f"{sanitized}@staff.local"
	return email, raw


def _provision_pos_user(
	first_name: str,
	last_name: str,
	cell_number: str | None,
	role_type: str,
	login_id: str,
	pos_pin: str,
	pos_profile: str,
) -> str:
	pin = (pos_pin or "").strip()
	if not pin or not pin.isdigit() or not (4 <= len(pin) <= 8):
		frappe.throw(_("POS PIN must be 4 to 8 digits."))

	pos_profile = (pos_profile or "").strip()
	if not pos_profile or not frappe.db.exists("POS Profile", pos_profile):
		frappe.throw(_("Please select a valid POS Profile."))

	email, username = _resolve_login_credentials(login_id)

	existing_user = frappe.db.exists("User", email)
	if not existing_user and username:
		existing_user = frappe.db.get_value("User", {"username": username}, "name")

	if existing_user:
		linked_emp = frappe.db.get_value(
			"Employee",
			{"user_id": existing_user, "status": "Active"},
			["name", "employee_name"],
			as_dict=True,
		)
		if linked_emp:
			frappe.throw(
				_("User {0} is already linked to active Employee {1} ({2}).").format(
					existing_user, linked_emp.employee_name, linked_emp.name
				)
			)
		user_doc = frappe.get_doc("User", existing_user)
		user_doc.enabled = 1
		user_doc.user_type = "System User"
		if not user_doc.first_name:
			user_doc.first_name = first_name
		if last_name and not user_doc.last_name:
			user_doc.last_name = last_name
	else:
		user_doc = frappe.get_doc({
			"doctype": "User",
			"email": email,
			"first_name": first_name,
			"last_name": last_name or "",
			"username": username,
			"enabled": 1,
			"user_type": "System User",
			"send_welcome_mail_to_user": 0,
		})
		if cell_number and not frappe.db.exists("User", {"mobile_no": cell_number}):
			user_doc.mobile_no = cell_number
		user_doc.flags.ignore_permissions = True
		user_doc.flags.no_welcome_mail = True
		user_doc.flags.ignore_password_policy = True
		user_doc.insert(ignore_permissions=True)

	# Ensure POS Awesome Supervisor role exists if needed
	if role_type == "Manager" and not frappe.db.exists("Role", "POS Awesome Supervisor"):
		role_doc = frappe.get_doc({"doctype": "Role", "role_name": "POS Awesome Supervisor", "desk_access": 1})
		role_doc.flags.ignore_permissions = True
		role_doc.insert(ignore_permissions=True)

	desired_roles = ["Employee", "Sales User", "Stock User", "Accounts User", "POS User"]
	if role_type == "Manager":
		desired_roles.extend([
			"POS Awesome Supervisor",
			"Sales Manager",
			"Stock Manager",
			"Accounts Manager",
			"POS Manager",
		])

	valid_roles = [r for r in desired_roles if frappe.db.exists("Role", r)]
	existing_roles = {d.role for d in (user_doc.get("roles") or [])}
	for role_name in valid_roles:
		if role_name not in existing_roles:
			user_doc.append("roles", {"role": role_name})

	user_doc.set("posa_pos_pin", pin)
	user_doc.flags.ignore_permissions = True
	user_doc.flags.no_welcome_mail = True
	user_doc.flags.ignore_password_policy = True
	user_doc.save(ignore_permissions=True)

	update_password(user_doc.name, pin)

	# Assign User to POS Profile
	profile_doc = frappe.get_doc("POS Profile", pos_profile)
	existing_profile_users = {d.user for d in (profile_doc.get("applicable_for_users") or []) if d.user}
	if user_doc.name not in existing_profile_users:
		is_default = 0 if existing_profile_users else 1
		profile_doc.append("applicable_for_users", {
			"user": user_doc.name,
			"default": is_default,
		})
		profile_doc.flags.ignore_permissions = True
		profile_doc.save(ignore_permissions=True)

	return user_doc.name


def _provision_sales_person(
	emp_doc,
	commission_scheme: str | None = None,
	pos_profile: str | None = None,
) -> str:
	root_sp = _ensure_sales_person_root()

	fixed_rate = None
	if commission_scheme and frappe.db.exists("Staff Commission Scheme", commission_scheme):
		scheme_info = frappe.db.get_value(
			"Staff Commission Scheme",
			commission_scheme,
			["calculation_type", "fixed_rate"],
			as_dict=True,
		)
		if scheme_info and scheme_info.calculation_type == "Fixed Percentage":
			fixed_rate = str(flt(scheme_info.fixed_rate))

	existing_for_emp = frappe.db.get_value("Sales Person", {"employee": emp_doc.name}, "name")
	if existing_for_emp:
		updates = {"enabled": 1}
		if fixed_rate is not None:
			updates["commission_rate"] = fixed_rate
		frappe.db.set_value("Sales Person", existing_for_emp, updates)
		sp_name = existing_for_emp
	else:
		candidate_name = (emp_doc.employee_name or emp_doc.first_name or emp_doc.name).strip()
		if frappe.db.exists("Sales Person", candidate_name):
			other_emp = frappe.db.get_value("Sales Person", candidate_name, "employee")
			if not other_emp or other_emp == emp_doc.name:
				updates = {"employee": emp_doc.name, "enabled": 1}
				if fixed_rate is not None:
					updates["commission_rate"] = fixed_rate
				frappe.db.set_value("Sales Person", candidate_name, updates)
				sp_name = candidate_name
			else:
				candidate_name = f"{candidate_name} ({emp_doc.name})"
				sp_doc = frappe.get_doc({
					"doctype": "Sales Person",
					"sales_person_name": candidate_name,
					"parent_sales_person": root_sp,
					"is_group": 0,
					"enabled": 1,
					"employee": emp_doc.name,
					"commission_rate": fixed_rate,
				})
				sp_doc.flags.ignore_permissions = True
				sp_doc.insert(ignore_permissions=True)
				sp_name = sp_doc.name
		else:
			sp_doc = frappe.get_doc({
				"doctype": "Sales Person",
				"sales_person_name": candidate_name,
				"parent_sales_person": root_sp,
				"is_group": 0,
				"enabled": 1,
				"employee": emp_doc.name,
				"commission_rate": fixed_rate,
			})
			sp_doc.flags.ignore_permissions = True
			sp_doc.insert(ignore_permissions=True)
			sp_name = sp_doc.name

	# If POS Profile restricts allowed sales persons (posa_sales_persons is non-empty), append this Sales Person
	if pos_profile and frappe.db.exists("POS Profile", pos_profile):
		profile_doc = frappe.get_doc("POS Profile", pos_profile)
		allowed_rows = profile_doc.get("posa_sales_persons") or []
		if allowed_rows:
			allowed_names = {d.sales_person for d in allowed_rows if d.sales_person}
			if sp_name not in allowed_names:
				profile_doc.append("posa_sales_persons", {"sales_person": sp_name})
				profile_doc.flags.ignore_permissions = True
				profile_doc.save(ignore_permissions=True)

	return sp_name


@frappe.whitelist()
def create_staff_member(
	first_name,
	last_name=None,
	cell_number=None,
	role_type="Sales Person",
	custom_designation=None,
	base_salary=0,
	salary_frequency="Monthly",
	commission_scheme=None,
	default_cash_account=None,
	login_id=None,
	pos_pin=None,
	pos_profile=None,
	company=None,
):
	first_name = (first_name or "").strip()
	last_name = (last_name or "").strip()
	cell_number = (cell_number or "").strip()
	role_type = (role_type or "Sales Person").strip()

	if not first_name:
		frappe.throw(_("First Name is required."))

	valid_roles = {"Sales Person", "Cashier", "Manager", "Non-Sales"}
	if role_type not in valid_roles:
		frappe.throw(_("Invalid staff role selected."))

	company = company or get_default_company()
	if not company:
		frappe.throw(_("Default Company is not configured."))

	role_designation_map = {
		"Sales Person": "Продавец",
		"Cashier": "Кассир",
		"Manager": "Менеджер",
		"Non-Sales": (custom_designation or "").strip() or "Техперсонал",
	}
	designation_label = (custom_designation or "").strip() or role_designation_map[role_type]
	designation = _ensure_designation(designation_label)

	# Ensure HR Settings has naming method configured
	if not frappe.db.get_single_value("HR Settings", "emp_created_by"):
		frappe.db.set_single_value("HR Settings", "emp_created_by", "Naming Series")

	# 1. Provision User & POS Profile if Cashier or Manager
	user_id = None
	if role_type in ("Cashier", "Manager"):
		user_id = _provision_pos_user(
			first_name=first_name,
			last_name=last_name,
			cell_number=cell_number,
			role_type=role_type,
			login_id=login_id,
			pos_pin=pos_pin,
			pos_profile=pos_profile,
		)

	# 2. Create Employee
	default_gender = _ensure_default_gender()
	emp_doc = frappe.get_doc({
		"doctype": "Employee",
		"naming_series": "HR-EMP-",
		"first_name": first_name,
		"last_name": last_name,
		"company": company,
		"status": "Active",
		"gender": default_gender,
		"date_of_birth": "1995-01-01",
		"date_of_joining": today(),
		"designation": designation,
		"cell_number": cell_number or None,
		"user_id": user_id,
		"create_user_permission": 0,
		"custom_base_salary": flt(base_salary),
		"custom_salary_frequency": salary_frequency or "Monthly",
		"custom_commission_scheme": (commission_scheme or None) if role_type != "Non-Sales" else None,
		"custom_default_cash_account": default_cash_account or None,
	})
	emp_doc.flags.ignore_permissions = True
	emp_doc.flags.ignore_mandatory = True
	emp_doc.insert(ignore_permissions=True)

	# 3. Create & Link Sales Person if Sales Person, Cashier, or Manager
	sales_person_name = None
	if role_type in ("Sales Person", "Cashier", "Manager"):
		sales_person_name = _provision_sales_person(
			emp_doc=emp_doc,
			commission_scheme=commission_scheme,
			pos_profile=pos_profile if role_type in ("Cashier", "Manager") else None,
		)

	return {
		"success": True,
		"employee": emp_doc.name,
		"employee_name": emp_doc.employee_name,
		"role_type": role_type,
		"designation": designation,
		"sales_person": sales_person_name,
		"user_id": user_id,
		"pos_profile": pos_profile if role_type in ("Cashier", "Manager") else None,
	}
