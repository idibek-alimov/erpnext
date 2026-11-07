# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint

from erpnext.accounts.expense_services import commands, history, policy
from erpnext.stock.page.product_catalog.product_catalog import get_default_company


def _context(company=None, pos_profile=None, pos_opening_shift=None, from_pos=0, entry_context=None, reason=None):
	company = company or get_default_company()
	if cint(from_pos) and not pos_opening_shift:
		frappe.throw(_("Open a shift before recording POS expenses."))
	return policy.get_context(company, pos_profile, pos_opening_shift, entry_context, reason, action="read")


def get_categories(company):
	categories = []
	for row in frappe.get_all("Quick Expense Category", fields=["name", "category_name", "icon", "is_pinned"], order_by="is_pinned desc, creation asc"):
		try:
			with policy.quiet_setup_checks():
				mapping = policy.category_mapping(row.name, company)
		except (frappe.PermissionError, frappe.ValidationError):
			continue
		categories.append(dict(row, default_account=mapping.expense_account, cost_center=mapping.cost_center))
	return categories


@frappe.whitelist()
def get_expense_desk_init_data(company=None, pos_profile=None, pos_opening_shift=None, from_pos=0, entry_context=None,
		period=None, from_date=None, to_date=None, source_id="all", category="all", employee="all", search=None, status="submitted"):
	context = _context(company, pos_profile, pos_opening_shift, from_pos, entry_context)
	result = history.list_expenses(context, period or ("shift" if context.pos_opening_shift else "all"),
		from_date, to_date, source_id, category, employee, search, status)
	# Recipient names are descriptive, not party accounting. Cashiers do not receive the staff directory.
	employees = []
	if policy.is_manager() and frappe.has_permission("Employee", "read"):
		employees = frappe.get_list("Employee", filters={"company": context.company, "status": "Active"},
			fields=["name", "employee_name"], order_by="employee_name asc", limit_page_length=0)
	return dict(company=context.company,
		currency=frappe.get_cached_value("Company", context.company, "default_currency"),
		pos_profile=context.pos_profile, pos_opening_shift=context.pos_opening_shift,
		payment_sources=policy.get_sources(context), categories=get_categories(context.company),
		expense_accounts=[], employees=employees, recent_expenses=result["recent_expenses"], summary=result["summary"],
		can_cancel=policy.is_manager() and frappe.has_permission("Quick Expense", "cancel"),
		can_record=all(frappe.has_permission("Quick Expense", action) for action in ("create", "submit")),
		can_correct=policy.is_manager() and bool(frappe.get_hooks("expense_pos_context_validator"))
			and all(frappe.has_permission(doctype, "read") for doctype in ("POS Profile", "POS Opening Shift")),
		history_filters=history.filter_options(context), entry_context=context.entry_context,
		has_more=result["has_more"], next_start=result["next_start"],
		period_from=result.get("period_from"), period_to=result.get("period_to"))


def get_payment_sources(company, pos_profile=None, pos_opening_shift=None, entry_context=None):
	return policy.get_sources(_context(company, pos_profile, pos_opening_shift, entry_context=entry_context))


@frappe.whitelist()
def get_filtered_expenses(period="today", from_date=None, to_date=None, source_id="all", category="all",
		employee="all", search=None, company=None, pos_profile=None, pos_opening_shift=None, from_pos=0,
		entry_context=None, status="submitted", limit_start=0, limit_page_length=50):
	context = _context(company, pos_profile, pos_opening_shift, from_pos, entry_context)
	return history.list_expenses(context, period, from_date, to_date, source_id, category, employee, search,
		status, limit_start, limit_page_length)


def get_expenses_and_summary(company, period="today", from_date=None, to_date=None, source_id="all",
		category="all", employee="all", search=None, pos_profile=None, pos_opening_shift=None, from_pos=0,
		entry_context=None):
	context = _context(company, pos_profile, pos_opening_shift, from_pos, entry_context)
	result = history.list_expenses(context, period, from_date, to_date, source_id, category, employee, search)
	return result["recent_expenses"], result["summary"]


@frappe.whitelist(methods=["POST"])
def record_quick_expense(category, amount, paid_from=None, pos_profile=None, pos_opening_shift=None,
		created_from_pos=0, description=None, beneficiary_name=None, expense_account=None, posting_date=None,
		party_type=None, party=None, receipt_attachment=None, pin_category=False, icon=None, company=None,
		client_request_id=None, entry_context=None, correction_reason=None):
	if cint(created_from_pos) and not pos_opening_shift:
		frappe.throw(_("Open a shift before recording POS expenses."))
	company = company or get_default_company()
	posted = commands.record(dict(company=company, expense_category=category, amount=amount, paid_from=paid_from,
		pos_profile=pos_profile, pos_opening_shift=pos_opening_shift, description=description,
		beneficiary_name=beneficiary_name, expense_account=expense_account, posting_date=posting_date,
		party_type=party_type, party=party, receipt_attachment=receipt_attachment,
		entry_context=entry_context or ("POS" if pos_profile or pos_opening_shift else "Desk"), correction_reason=correction_reason,
		client_request_id=client_request_id))
	# The authoritative result is sufficient even if a later list refresh fails. Reads never
	# run in the posting transaction, which keeps a lost-response retry unambiguous.
	return dict(expense=posted, **posted)


@frappe.whitelist()
def get_expense_request_outcome(client_request_id):
	return commands.outcome(client_request_id)


@frappe.whitelist()
def get_expense_detail(expense_name, source_doctype="Quick Expense"):
	if source_doctype != "Quick Expense":
		for hook in frappe.get_hooks("expense_history_detail"):
			result = frappe.get_attr(hook)(source_doctype, expense_name)
			if result is not None:
				result["shift_links"] = _shift_links(frappe._dict(result, doctype=source_doctype))
				return result
		frappe.throw(_("Unsupported expense source."))
	policy.require_schema()
	doc = frappe.get_doc("Quick Expense", expense_name)
	policy.assert_read(doc)
	doc.check_permission("read")
	return dict(commands.result(doc), can_cancel=doc.docstatus == 1 and policy.is_manager() and frappe.has_permission("Quick Expense", "cancel", doc=doc), source_doctype="Quick Expense", source_id=f"Quick Expense:{doc.name}", amended_from=doc.amended_from, expense_category=doc.expense_category, description=doc.description,
		beneficiary_name=doc.beneficiary_name, receipt_attachment=doc.receipt_attachment,
		correction_reason=doc.correction_reason, cancellation_reason=doc.cancellation_reason,
		shift_links=_shift_links(doc))


def _shift_links(doc):
	"""Optional POS integration; permission-scoped by its owning app, without an import."""
	for hook in frappe.get_hooks("expense_history_links"):
		return frappe.get_attr(hook)(doc)
	return {}


@frappe.whitelist(methods=["POST"])
def cancel_quick_expense(expense_name, company=None, pos_profile=None, pos_opening_shift=None,
		reason=None, expected_modified=None, client_request_id=None):
	posted = commands.cancel(expense_name, reason, expected_modified, client_request_id, company, pos_profile, pos_opening_shift)
	return dict(expense=posted, **posted)


@frappe.whitelist()
def get_expense_options(company, pos_profile=None, pos_opening_shift=None, entry_context=None):
	context = _context(company, pos_profile, pos_opening_shift, entry_context=entry_context)
	return dict(pos_profile=context.pos_profile, pos_opening_shift=context.pos_opening_shift,
		payment_sources=policy.get_sources(context), categories=get_categories(company), can_cancel=policy.is_manager(),
		note_required=bool(context.get("note_required")))


@frappe.whitelist()
def get_shift_review_navigation():
	"""Optional POS-owned page: no hard ERPNext dependency on POS Awesome."""
	if "posawesome" not in frappe.get_installed_apps():
		return dict(available=False)
	return frappe.get_attr("posawesome.posawesome.shift_review.desk.navigation")()
