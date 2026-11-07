# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class QuickExpenseCategory(Document):
	def validate(self):
		from erpnext.accounts.expense_services.policy import validate_account

		seen = set()
		for row in self.get("company_accounts", []):
			if row.company in seen:
				frappe.throw(_("Configure one category account per company."))
			seen.add(row.company)
			validate_account(row.expense_account, row.company, expense=True)
			if row.cost_center:
				cc = frappe.get_cached_doc("Cost Center", row.cost_center)
				if cc.company != row.company or cc.is_group or cc.disabled:
					frappe.throw(_("Select an enabled company cost center."))
		if self.default_account:
			company = frappe.get_cached_value("Account", self.default_account, "company")
			validate_account(self.default_account, company, expense=True)
