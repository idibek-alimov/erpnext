# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class QuickExpense(Document):
	def validate(self):
		from erpnext.accounts.expense_services.policy import validate_expense

		if not self.company:
			self.company = frappe.defaults.get_user_default("Company")
		validate_expense(self)

	def before_submit(self):
		# Revalidate at submission, including native forms and direct REST writes.
		from erpnext.accounts.expense_services.policy import validate_expense

		validate_expense(self)

	def on_submit(self):
		self.create_journal_entry()
		self.copy_attachment_to_accounting_docs()

	def before_cancel(self):
		from erpnext.accounts.expense_services.policy import (
			_SERVICE_REQUEST, assert_read, require_manager, require_schema, same_stored_value,
		)

		require_schema()
		require_manager()
		if (self.cancellation_request_id or self.cancellation_fingerprint) and self.flags.get("_expense_service") is not _SERVICE_REQUEST:
			frappe.throw(_("Cancellation request identity is set by the shared expense service."))
		original = frappe.get_doc("Quick Expense", self.name)
		assert_read(original)
		for key in ("owner", "company", "posting_date", "expense_category", "amount", "paid_from",
				"expense_account", "cost_center", "pos_profile", "pos_opening_shift", "entry_context",
				"journal_entry", "payment_entry", "purchase_invoice", "client_request_id", "request_fingerprint",
				"mode_of_payment", "party_type", "party", "description", "beneficiary_name", "bill_no",
				"receipt_attachment", "correction_reason", "created_from_pos", "amended_from"):
			if not same_stored_value(key, original.get(key), self.get(key)):
				frappe.throw(_("Cancel the original expense without changing its accounting or shift links."))
		if not (self.cancellation_reason or "").strip():
			frappe.throw(_("Enter a reason before cancelling this expense."))
		self.cancelled_by = frappe.session.user

	def before_update_after_submit(self):
		frappe.throw(_("Submitted expenses must be cancelled and corrected through the authorized workflow."))

	def on_trash(self):
		if self.docstatus != 0:
			frappe.throw(_("Posted expense history cannot be deleted."))

	def create_journal_entry(self):
		"""One paid expense, one native GL posting; recipient text does not create a liability."""
		je = frappe.new_doc("Journal Entry")
		account_type = frappe.get_cached_value("Account", self.paid_from, "account_type")
		je.voucher_type = "Bank Entry" if account_type == "Bank" else "Cash Entry"
		je.company = self.company
		je.posting_date = self.posting_date
		je.mode_of_payment = self.mode_of_payment
		je.cheque_no = self.bill_no or self.name
		je.cheque_date = self.posting_date

		remarks_text = _("Quick Expense {0}: {1}").format(self.name, self.expense_category)
		if self.beneficiary_name:
			remarks_text += f" ({_('Beneficiary')}: {self.beneficiary_name})"
		if self.description:
			remarks_text += f" - {self.description}"
		je.user_remark = remarks_text

		# Debit: Expense Account
		je.append(
			"accounts",
			{
				"account": self.expense_account,
				"debit_in_account_currency": self.amount,
				"cost_center": self.cost_center,
			},
		)

		# Credit: Paid From Account (Cash / Bank)
		je.append(
			"accounts",
			{
				"account": self.paid_from,
				"credit_in_account_currency": self.amount,
				"cost_center": self.cost_center,
			},
		)

		je.flags.ignore_permissions = True
		je.insert()
		je.submit()

		self.db_set("journal_entry", je.name)

	def copy_attachment_to_accounting_docs(self):
		if not self.receipt_attachment:
			return

		target_docs = [("Quick Expense", self.name)]
		if self.payment_entry:
			target_docs.append(("Payment Entry", self.payment_entry))
		if self.purchase_invoice:
			target_docs.append(("Purchase Invoice", self.purchase_invoice))
		if self.journal_entry:
			target_docs.append(("Journal Entry", self.journal_entry))

		for dt, dn in target_docs:
			try:
				# Native Attach handling already links the receipt to Quick Expense.
				# Retain that private File rather than adding a second identical attachment.
				if frappe.db.exists("File", {"file_url": self.receipt_attachment,
						"attached_to_doctype": dt, "attached_to_name": dn, "is_private": 1}):
					continue
				attachment = frappe.get_doc(
					{
						"doctype": "File",
						"file_url": self.receipt_attachment,
						"attached_to_doctype": dt,
						"attached_to_name": dn,
						"folder": "Home/Attachments",
						"is_private": 1,
					}
				)
				attachment.insert(ignore_permissions=True)
			except Exception:
				# Non-fatal if attachment copy fails
				frappe.log_error(f"Failed to copy attachment to {dt} {dn}")

	def on_cancel(self):
		if self.payment_entry:
			pe = frappe.get_doc("Payment Entry", self.payment_entry)
			if pe.docstatus == 1:
				pe.flags.ignore_permissions = True
				pe.cancel()

		if self.purchase_invoice:
			pi = frappe.get_doc("Purchase Invoice", self.purchase_invoice)
			if pi.docstatus == 1:
				pi.flags.ignore_permissions = True
				pi.cancel()

		if self.journal_entry:
			je = frappe.get_doc("Journal Entry", self.journal_entry)
			if je.docstatus == 1:
				je.flags.ignore_permissions = True
				je.cancel()
