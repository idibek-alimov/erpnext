# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


CATEGORY_ACCOUNT_MAP = {
	# Russian categories
	"Упаковка и пакеты": ["Store Supplies and Consumables", "Print and Stationery", "Office Maintenance Expenses", "Miscellaneous Expenses"],
	"Курьер и доставка": ["Freight and Forwarding Charges", "Travel Expenses", "Miscellaneous Expenses"],
	"Питание и чай": ["Entertainment Expenses", "Staff Welfare", "Miscellaneous Expenses"],
	"Уборка и хозтовары": ["Store Cleaning & Maintenance", "Office Maintenance Expenses", "Store Supplies and Consumables", "Miscellaneous Expenses"],
	"Коммуналка и интернет": ["Electricity & Power Expense", "Utility Expenses", "Electricity Expenses", "Internet and Communications", "Telephone Expenses"],
	"Ремонт и обслуживание": ["Office Maintenance Expenses", "Repair and Maintenance", "Miscellaneous Expenses"],
	"Аванс сотруднику": ["Staff Bonuses and Incentives", "Salary", "Employee Advance"],
	"Аренда помещения": ["Rent", "Office Rent", "Rent Expenses"],
	"Такси и транспорт": ["Travel Expenses", "Miscellaneous Expenses"],
	"Прочие расходы": ["Miscellaneous Expenses"],

	# English fallback mappings
	"Packaging & Bags": ["Store Supplies and Consumables", "Print and Stationery", "Office Maintenance Expenses", "Miscellaneous Expenses"],
	"Courier & Delivery": ["Freight and Forwarding Charges", "Travel Expenses", "Miscellaneous Expenses"],
	"Food & Tea": ["Entertainment Expenses", "Miscellaneous Expenses"],
	"Cleaning & Supplies": ["Store Cleaning & Maintenance", "Office Maintenance Expenses", "Store Supplies and Consumables", "Miscellaneous Expenses"],
	"Utilities & Internet": ["Electricity & Power Expense", "Utility Expenses", "Electricity Expenses", "Internet and Communications", "Telephone Expenses"],
	"Repairs & Maintenance": ["Office Maintenance Expenses", "Repair and Maintenance", "Miscellaneous Expenses"],
	"Staff Advance": ["Staff Bonuses and Incentives", "Salary", "Employee Advance"],
	"Rent": ["Office Rent", "Rent", "Rent Expenses"],
	"Electricity": ["Electricity Expenses", "Utility Expenses"],
	"Internet & Phone": ["Internet and Communications", "Telephone Expenses", "Utility Expenses"],
	"Staff Bonus": ["Staff Bonuses and Incentives", "Salary"],
	"Store & Office Supplies": ["Store Supplies and Consumables", "Print and Stationery", "Office Maintenance Expenses"],
	"Transportation & Taxi": ["Travel Expenses"],
	"Food & Refreshments": ["Entertainment Expenses", "Miscellaneous Expenses"],
	"Other Expense": ["Miscellaneous Expenses"],
	"Other / Custom": ["Miscellaneous Expenses"],
}


class QuickExpense(Document):
	def validate(self):
		self.validate_amount()
		self.set_company_defaults()
		self.resolve_expense_account()
		self.resolve_paid_from()

	def validate_amount(self):
		if not self.amount or self.amount <= 0:
			frappe.throw(_("Amount must be greater than 0"))

	def set_company_defaults(self):
		if not self.company:
			self.company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value(
				"Global Defaults", "default_company"
			)

		if not self.cost_center and self.company:
			self.cost_center = frappe.get_cached_value("Company", self.company, "cost_center")

	def resolve_paid_from(self):
		if self.paid_from:
			return

		# If pos_profile is selected, resolve from POS cash mode of payment
		if self.pos_profile and self.company:
			cash_mop = frappe.db.get_value("POS Profile", self.pos_profile, "posa_cash_mode_of_payment") or "Cash"
			if not self.mode_of_payment:
				self.mode_of_payment = cash_mop
			default_acc = frappe.db.get_value(
				"Mode of Payment Account",
				{"parent": cash_mop, "company": self.company},
				"default_account",
			)
			if default_acc:
				self.paid_from = default_acc
				return

		# If mode of payment is selected, get its default account
		if self.mode_of_payment and self.company:
			default_account = frappe.db.get_value(
				"Mode of Payment Account",
				{"parent": self.mode_of_payment, "company": self.company},
				"default_account",
			)
			if default_account:
				self.paid_from = default_account
				return

		# Otherwise fallback to default Cash account
		if self.company:
			default_cash = frappe.get_cached_value("Company", self.company, "default_cash_account")
			if default_cash:
				self.paid_from = default_cash
				return

			# Look for any Cash account in company
			cash_account = frappe.db.get_value(
				"Account",
				{"company": self.company, "account_type": "Cash", "is_group": 0},
				"name",
			)
			if cash_account:
				self.paid_from = cash_account

	def resolve_expense_account(self):
		if self.expense_account:
			return

		if not self.company or not self.expense_category:
			return

		candidate_names = CATEGORY_ACCOUNT_MAP.get(self.expense_category, ["Miscellaneous Expenses"])
		for candidate in candidate_names:
			account = frappe.db.get_value(
				"Account",
				{"company": self.company, "account_name": candidate, "is_group": 0},
				"name",
			)
			if account:
				self.expense_account = account
				return

		# Fallback: any indirect expense account
		fallback = frappe.db.get_value(
			"Account",
			{"company": self.company, "root_type": "Expense", "is_group": 0},
			"name",
		)
		if fallback:
			self.expense_account = fallback

	def on_submit(self):
		if not self.paid_from:
			frappe.throw(_("Please select Paid From account before submitting."))
		if not self.expense_account:
			frappe.throw(_("Please select Expense Account before submitting."))

		if self.party_type == "Supplier" and self.party:
			self.create_purchase_invoice_and_payment()
		elif self.party_type in ["Employee", "Supplier"] and self.party:
			self.create_direct_payment_entry()
		else:
			self.create_journal_entry()

		self.copy_attachment_to_accounting_docs()

	def create_purchase_invoice_and_payment(self):
		company_currency = frappe.get_cached_value("Company", self.company, "default_currency")

		pi = frappe.new_doc("Purchase Invoice")
		pi.company = self.company
		pi.posting_date = self.posting_date
		pi.bill_date = self.posting_date
		pi.bill_no = self.bill_no or self.name
		pi.supplier = self.party
		pi.currency = company_currency
		pi.remarks = _("Generated via Quick Expense {0}. {1}").format(self.name, self.description or "")

		pi.append(
			"items",
			{
				"item_name": _("{0} Expense").format(self.expense_category),
				"description": self.description or _("{0} Expense").format(self.expense_category),
				"qty": 1,
				"rate": self.amount,
				"expense_account": self.expense_account,
				"cost_center": self.cost_center,
			},
		)

		pi.flags.ignore_permissions = True
		pi.flags.ignore_mandatory = True
		pi.insert()
		pi.submit()

		self.db_set("purchase_invoice", pi.name)

		# Create linked Payment Entry against this Purchase Invoice
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

		pe = get_payment_entry("Purchase Invoice", pi.name, bank_account=self.paid_from)
		pe.posting_date = self.posting_date
		pe.mode_of_payment = self.mode_of_payment or pe.mode_of_payment
		pe.reference_no = self.bill_no or self.name
		pe.reference_date = self.posting_date
		pe.remarks = _("Payment for {0} against Quick Expense {1}").format(
			self.expense_category, self.name
		)

		pe.flags.ignore_permissions = True
		pe.insert()
		pe.submit()

		self.db_set("payment_entry", pe.name)

	def create_direct_payment_entry(self):
		pe = frappe.new_doc("Payment Entry")
		pe.payment_type = "Pay"
		pe.company = self.company
		pe.posting_date = self.posting_date
		pe.mode_of_payment = self.mode_of_payment

		pe.party_type = self.party_type
		pe.party = self.party

		pe.paid_from = self.paid_from
		pe.paid_to = self.expense_account
		pe.paid_amount = self.amount
		pe.received_amount = self.amount
		pe.reference_no = self.bill_no or self.name
		pe.reference_date = self.posting_date
		pe.cost_center = self.cost_center

		remarks_text = _("Quick Expense {0}: {1}").format(self.name, self.expense_category)
		if self.beneficiary_name:
			remarks_text += f" ({_('Beneficiary')}: {self.beneficiary_name})"
		if self.description:
			remarks_text += f" - {self.description}"
		pe.remarks = remarks_text

		pe.flags.ignore_permissions = True
		pe.insert()
		pe.submit()

		self.db_set("payment_entry", pe.name)

	def create_journal_entry(self):
		"""Creates and submits a Journal Entry when no specific Party (Supplier/Employee) is given."""
		je = frappe.new_doc("Journal Entry")
		je.voucher_type = "Cash Entry"
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

		target_docs = []
		if self.payment_entry:
			target_docs.append(("Payment Entry", self.payment_entry))
		if self.purchase_invoice:
			target_docs.append(("Purchase Invoice", self.purchase_invoice))
		if self.journal_entry:
			target_docs.append(("Journal Entry", self.journal_entry))

		for dt, dn in target_docs:
			try:
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
