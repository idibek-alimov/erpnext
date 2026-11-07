import frappe
from frappe import _
from frappe.model.document import Document


class OwnerMoneySettings(Document):
	def validate(self):
		from erpnext.accounts.page.money_hub.owner_money import validate_settings
		validate_settings(self)
		old = self.get_doc_before_save()
		if old:
			if old.company != self.company:
				frappe.throw(_("Owner money settings cannot move to another company."))
			for field in ("contribution_account", "withdrawal_account", "loan_account"):
				if old.get(field) != self.get(field) and old.get(field) and frappe.db.get_value("GL Entry", {
					"company": self.company, "account": old.get(field)}, "name", for_update=True):
					frappe.throw(_("An owner account with ledger history cannot be remapped. Use an accounting migration."))

	def on_trash(self):
		frappe.throw(_("Owner money settings retain their accounting mapping and cannot be deleted."))

	def before_rename(self, *args, **kwargs):
		frappe.throw(_("Owner money settings cannot be renamed."))
