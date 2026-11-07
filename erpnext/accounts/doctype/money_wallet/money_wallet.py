# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MoneyWallet(Document):
	def validate(self):
		if self.commission_percent and not (0 <= self.commission_percent <= 100):
			frappe.throw(_("Commission must be between 0 and 100"))

		if self.get("allow_desk_expenses") or self.get("expense_profiles"):
			from erpnext.accounts.expense_services.policy import validate_account

			if not self.account:
				frappe.throw(_("Link an account before enabling expense payments."))
			validate_account(self.account, self.company)
		seen = set()
		for row in self.get("expense_profiles", []):
			profile = frappe.get_cached_doc("POS Profile", row.pos_profile)
			if profile.company != self.company or row.pos_profile in seen:
				frappe.throw(_("Expense registers must be unique and belong to the wallet company."))
			seen.add(row.pos_profile)

	def on_trash(self):
		if self.account and frappe.db.exists("GL Entry", {"account": self.account, "is_cancelled": 0}):
			frappe.throw(_("Wallet has transactions and cannot be deleted. Hide it instead."))
