# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, nowdate


class StaffAdvance(Document):
	def validate(self):
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)
		if flt(self.amount) <= 0:
			frappe.throw(_("Advance amount must be greater than zero."))

		if not self.posting_date:
			self.posting_date = nowdate()

		if not self.paid_from:
			self.resolve_paid_from()

	def resolve_paid_from(self):
		if self.mode_of_payment and self.company:
			default_acc = frappe.db.get_value(
				"Mode of Payment Account",
				{"parent": self.mode_of_payment, "company": self.company},
				"default_account",
			)
			if default_acc:
				self.paid_from = default_acc
				return

		if self.company:
			cash_account = frappe.get_cached_value("Company", self.company, "default_cash_account") or frappe.db.get_value(
				"Account",
				{"company": self.company, "account_type": "Cash", "is_group": 0},
				"name",
			)
			if cash_account:
				self.paid_from = cash_account

	def on_submit(self):
		if not self.paid_from:
			frappe.throw(_("Please select Paid From (Cash / Bank account)."))
		self.create_payment_record()

	def create_payment_record(self):
		# Look for default employee advance or payroll payable account
		advance_account = (
			frappe.get_cached_value("Company", self.company, "default_advance_paid_account")
			or frappe.db.get_value("Account", {"company": self.company, "account_type": "Payable", "is_group": 0}, "name")
			or frappe.db.get_value("Account", {"company": self.company, "account_name": ["like", "%Advance%"], "is_group": 0}, "name")
		)

		try:
			pe = frappe.new_doc("Payment Entry")
			pe.payment_type = "Pay"
			pe.company = self.company
			pe.posting_date = self.posting_date
			pe.mode_of_payment = self.mode_of_payment
			pe.party_type = "Employee"
			pe.party = self.employee

			pe.paid_from = self.paid_from
			if advance_account:
				pe.paid_to = advance_account
			pe.paid_amount = self.amount
			pe.received_amount = self.amount
			pe.reference_no = self.name
			pe.reference_date = self.posting_date
			pe.remarks = _("Staff Cash Advance ({0}) for {1}. {2}").format(
				self.name, self.employee_name or self.employee, self.reason or ""
			)
			pe.flags.ignore_permissions = True
			pe.flags.ignore_mandatory = True
			pe.insert()
			pe.submit()
			self.db_set("payment_entry", pe.name)
		except Exception as e:
			frappe.log_error(f"Error creating Payment Entry for Staff Advance {self.name}: {str(e)}")
			# Fallback: Journal Entry
			self.create_fallback_journal_entry(advance_account)

	def create_fallback_journal_entry(self, advance_account):
		if not advance_account:
			advance_account = frappe.db.get_value(
				"Account",
				{"company": self.company, "root_type": "Asset", "is_group": 0},
				"name",
			)

		if not advance_account:
			return

		je = frappe.new_doc("Journal Entry")
		je.voucher_type = "Cash Entry"
		je.company = self.company
		je.posting_date = self.posting_date
		je.cheque_no = self.name
		je.cheque_date = self.posting_date
		je.user_remark = _("Staff Advance {0} for {1}").format(self.name, self.employee_name)

		# Debit advance asset / employee
		je.append("accounts", {
			"account": advance_account,
			"party_type": "Employee",
			"party": self.employee,
			"debit_in_account_currency": self.amount,
		})
		# Credit Cash
		je.append("accounts", {
			"account": self.paid_from,
			"credit_in_account_currency": self.amount,
		})

		je.flags.ignore_permissions = True
		je.insert()
		je.submit()
		self.db_set("payment_entry", je.name)

	def on_cancel(self):
		if self.payment_entry:
			if frappe.db.exists("Payment Entry", self.payment_entry):
				doc = frappe.get_doc("Payment Entry", self.payment_entry)
				if doc.docstatus == 1:
					doc.flags.ignore_permissions = True
					doc.cancel()
			elif frappe.db.exists("Journal Entry", self.payment_entry):
				doc = frappe.get_doc("Journal Entry", self.payment_entry)
				if doc.docstatus == 1:
					doc.flags.ignore_permissions = True
					doc.cancel()
