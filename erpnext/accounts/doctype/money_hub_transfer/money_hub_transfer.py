"""Immutable service receipts; financial authority stays on native Payment Entry."""

import frappe
from frappe import _
from frappe.model.document import Document


class MoneyHubTransfer(Document):
	def validate(self):
		from erpnext.accounts.page.money_hub.money_commands import _REQUEST_SERVICE
		if self.flags.get("_money_transfer_service") is not _REQUEST_SERVICE:
			frappe.throw(_("Transfer requests are managed by Money Hub."), frappe.PermissionError)

	def on_trash(self):
		frappe.throw(_("Transfer request history cannot be deleted."))

	def before_rename(self, *args, **kwargs):
		frappe.throw(_("Transfer request history cannot be renamed."))
