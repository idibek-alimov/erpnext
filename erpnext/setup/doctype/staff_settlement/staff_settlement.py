# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, nowdate


class StaffSettlement(Document):
	def validate(self):
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)
		if not self.posting_date:
			self.posting_date = nowdate()

		# Auto-calculate net payable
		earned = flt(self.base_salary) + flt(self.commission_amount) + flt(self.bonuses_total)
		deducted = flt(self.penalties_total) + flt(self.advances_deducted)
		self.net_payable = flt(earned - deducted, 2)

		if not self.paid_from and self.net_payable > 0:
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
		self.db_set("status", "Paid")
		if flt(self.net_payable) > 0 and self.paid_from:
			self.create_payment_record()

		# Mark incentives and advances as settled
		self.mark_linked_records_settled()

	def create_payment_record(self):
		payroll_expense_account = (
			frappe.get_cached_value("Company", self.company, "default_payroll_payable_account")
			or frappe.db.get_value("Account", {"company": self.company, "account_name": ["like", "%Salary%"], "is_group": 0}, "name")
			or frappe.db.get_value("Account", {"company": self.company, "root_type": "Expense", "is_group": 0}, "name")
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
			if payroll_expense_account:
				pe.paid_to = payroll_expense_account
			pe.paid_amount = self.net_payable
			pe.received_amount = self.net_payable
			pe.reference_no = self.name
			pe.reference_date = self.posting_date
			pe.remarks = _("Salary & Commission Settlement ({0}) for {1} [{2} to {3}]").format(
				self.name, self.employee_name or self.employee, self.start_date, self.end_date
			)
			pe.flags.ignore_permissions = True
			pe.flags.ignore_mandatory = True
			pe.insert()
			pe.submit()
			self.db_set("payment_entry", pe.name)
		except Exception as e:
			frappe.log_error(f"Error creating Payment Entry for Staff Settlement {self.name}: {str(e)}")
			self.create_fallback_journal_entry(payroll_expense_account)

	def create_fallback_journal_entry(self, expense_acc):
		if not expense_acc:
			expense_acc = frappe.db.get_value(
				"Account",
				{"company": self.company, "root_type": "Expense", "is_group": 0},
				"name",
			)
		if not expense_acc:
			return

		je = frappe.new_doc("Journal Entry")
		je.voucher_type = "Cash Entry"
		je.company = self.company
		je.posting_date = self.posting_date
		je.cheque_no = self.name
		je.cheque_date = self.posting_date
		je.user_remark = _("Staff Settlement {0} for {1}").format(self.name, self.employee_name)

		# Debit salary expense
		je.append("accounts", {
			"account": expense_acc,
			"debit_in_account_currency": self.net_payable,
		})
		# Credit Cash
		je.append("accounts", {
			"account": self.paid_from,
			"credit_in_account_currency": self.net_payable,
		})

		je.flags.ignore_permissions = True
		je.insert()
		je.submit()
		self.db_set("payment_entry", je.name)

	def mark_linked_records_settled(self):
		# Mark incentives
		frappe.db.sql(
			"""
			UPDATE `tabStaff Incentive`
			SET status = 'Settled', settlement_ref = %(settlement)s
			WHERE employee = %(employee)s
			AND status = 'Pending'
			AND posting_date <= %(end_date)s
			""",
			{"settlement": self.name, "employee": self.employee, "end_date": self.end_date},
		)

		# Mark advances
		frappe.db.sql(
			"""
			UPDATE `tabStaff Advance`
			SET status = 'Settled', settlement_ref = %(settlement)s
			WHERE employee = %(employee)s
			AND status = 'Paid'
			AND docstatus = 1
			AND posting_date <= %(end_date)s
			""",
			{"settlement": self.name, "employee": self.employee, "end_date": self.end_date},
		)

	def on_cancel(self):
		self.db_set("status", "Cancelled")
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

		# Revert linked incentives
		frappe.db.sql(
			"""
			UPDATE `tabStaff Incentive`
			SET status = 'Pending', settlement_ref = NULL
			WHERE settlement_ref = %(settlement)s
			""",
			{"settlement": self.name},
		)

		# Revert linked advances
		frappe.db.sql(
			"""
			UPDATE `tabStaff Advance`
			SET status = 'Paid', settlement_ref = NULL
			WHERE settlement_ref = %(settlement)s
			""",
			{"settlement": self.name},
		)
