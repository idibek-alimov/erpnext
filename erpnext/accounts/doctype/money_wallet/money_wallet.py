# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class MoneyWallet(Document):
	def validate(self):
		if self.commission_percent and not (0 <= self.commission_percent <= 100):
			frappe.throw(_("Commission must be between 0 and 100"))

	def on_trash(self):
		if self.account and frappe.db.exists("GL Entry", {"account": self.account, "is_cancelled": 0}):
			frappe.throw(_("Wallet has transactions and cannot be deleted. Hide it instead."))
