import frappe
from frappe import _
from frappe.model.document import Document


class OwnerMoneyMovement(Document):
	def validate(self):
		from erpnext.accounts.page.money_hub.owner_money import _SERVICE
		if self.flags.get("_owner_money_service") is not _SERVICE:
			frappe.throw(_("Owner money movements are managed by Money Hub."), frappe.PermissionError)

	def on_trash(self):
		frappe.throw(_("Owner money movement history cannot be deleted."))

	def before_rename(self, *args, **kwargs):
		frappe.throw(_("Owner money movement history cannot be renamed."))
