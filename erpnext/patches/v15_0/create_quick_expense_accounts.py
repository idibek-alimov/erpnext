import frappe


def execute():
	"""
	Ensure that essential expense accounts for Quick Expense (Electricity, Internet,
	Staff Bonuses, Store Supplies) exist for all companies.
	"""
	companies = frappe.get_all("Company", fields=["name", "abbr", "default_currency"])

	accounts_to_create = [
		{"name": "Electricity Expenses", "account_type": ""},
		{"name": "Internet and Communications", "account_type": ""},
		{"name": "Staff Bonuses and Incentives", "account_type": ""},
		{"name": "Store Supplies and Consumables", "account_type": ""},
	]

	for company in companies:
		# Find Indirect Expenses parent account
		parent_account = frappe.db.get_value(
			"Account",
			{"company": company.name, "account_name": "Indirect Expenses", "is_group": 1},
			"name",
		)

		if not parent_account:
			# Fallback to any top-level or group Expense account
			parent_account = frappe.db.get_value(
				"Account",
				{"company": company.name, "root_type": "Expense", "is_group": 1},
				"name",
			)

		if not parent_account:
			continue

		for acc in accounts_to_create:
			account_exists = frappe.db.exists(
				"Account",
				{"company": company.name, "account_name": acc["name"]},
			)
			if not account_exists:
				doc = frappe.get_doc(
					{
						"doctype": "Account",
						"account_name": acc["name"],
						"parent_account": parent_account,
						"company": company.name,
						"root_type": "Expense",
						"account_type": acc.get("account_type") or None,
						"account_currency": company.default_currency,
					}
				)
				doc.flags.ignore_permissions = True
				doc.flags.ignore_mandatory = True
				doc.insert()
