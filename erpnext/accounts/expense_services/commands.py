"""Atomic paid expense commands. No explicit commits or page initialization side effects."""

import hashlib
import json
import re
from decimal import Decimal

import frappe
from frappe import _
from frappe.utils import getdate, today

from erpnext.accounts.expense_services.policy import (
	_SERVICE_REQUEST,
	assert_read,
	check_company,
	currency_precision,
	positive_amount,
	require_manager,
	require_schema,
)


def request_id(value):
	if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,140}", value):
		frappe.throw(_("A stable request ID is required. Refresh the expense form and try again."))
	return value


def fingerprint(payload):
	return hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def lock_actor():
	# All requests by this actor serialize until transaction end. The unique request
	# column also protects collisions between different actors. No redis lock expiry
	# can release the posting transaction early.
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in."), frappe.PermissionError)
	frappe.db.get_value("User", frappe.session.user, "name", for_update=True)


def result(doc):
	return dict(name=doc.name, docstatus=doc.docstatus,
		status="submitted" if doc.docstatus == 1 else "cancelled" if doc.docstatus == 2 else "draft",
		company=doc.company, amount=doc.amount,
		currency=frappe.get_cached_value("Company", doc.company, "default_currency"),
		paid_from=doc.paid_from, pos_profile=doc.pos_profile, pos_opening_shift=doc.pos_opening_shift,
		journal_entry=doc.journal_entry, payment_entry=doc.payment_entry, purchase_invoice=doc.purchase_invoice,
		modified=str(doc.modified), client_request_id=doc.client_request_id,
		cancellation_request_id=doc.cancellation_request_id)


def record(payload):
	require_schema()
	data = dict(payload)
	key = request_id(data.pop("client_request_id", None))
	check_company(data["company"])
	data["amount"] = str(positive_amount(data["amount"], currency_precision(data["company"])))
	# Normalize numeric representation and optional values, so 50 and 50.0 are one intent.
	data["amount"] = format(Decimal(data["amount"]).normalize(), "f")
	data = {k: (v if v not in (None, "") else None) for k, v in data.items()}
	digest = fingerprint(dict(actor=frappe.session.user, **data))
	lock_actor()
	existing = frappe.db.get_value("Quick Expense", {"client_request_id": key}, "name", for_update=True)
	if existing:
		doc = frappe.get_doc("Quick Expense", existing, for_update=True)
		assert_read(doc)
		doc.check_permission("read")
		if doc.owner != frappe.session.user or doc.request_fingerprint != digest:
			frappe.throw(_("This request ID was already used for a different expense."), frappe.PermissionError)
		return result(doc)
	frappe.db.savepoint("quick_expense_record")
	try:
		doc = frappe.get_doc(dict(doctype="Quick Expense", **data, client_request_id=key, request_fingerprint=digest))
		doc.flags._expense_service = _SERVICE_REQUEST
		doc.owner = frappe.session.user
		doc.posting_date = data.get("posting_date") or today()
		# Escalate only this business document after policy validation; the controller
		# enforces the same policy and native Journal Entry validation remains enabled.
		from erpnext.accounts.expense_services.policy import validate_expense
		validate_expense(doc)
		if not all(frappe.has_permission("Quick Expense", ptype) for ptype in ("create", "submit")):
			frappe.throw(_("Expense create and submit permissions are required."), frappe.PermissionError)
		doc.flags.ignore_permissions = True
		doc.insert()
		doc.submit()
		return result(doc)
	except Exception:
		frappe.db.rollback(save_point="quick_expense_record")
		raise


def cancel(name, reason, expected_modified, client_request_id, company=None, pos_profile=None, pos_opening_shift=None):
	require_schema()
	require_manager()
	key = request_id(client_request_id)
	if not (reason or "").strip() or not expected_modified:
		frappe.throw(_("A cancellation reason and current expense version are required."))
	lock_actor()
	frappe.db.get_value("Quick Expense", name, "name", for_update=True)
	doc = frappe.get_doc("Quick Expense", name, for_update=True)
	assert_read(doc)
	if not frappe.has_permission("Quick Expense", "cancel", doc=doc):
		frappe.throw(_("Expense cancellation permission is required."), frappe.PermissionError)
	for supplied, stored in ((company, doc.company), (pos_profile, doc.pos_profile), (pos_opening_shift, doc.pos_opening_shift)):
		if supplied and supplied != stored:
			frappe.throw(_("The expense does not belong to the selected company or shift."), frappe.PermissionError)
	digest = fingerprint(dict(actor=frappe.session.user, name=name, reason=reason.strip(), version=str(expected_modified)))
	if doc.docstatus == 2 and doc.cancellation_request_id == key and doc.cancellation_fingerprint == digest:
		return result(doc)
	if doc.docstatus != 1:
		frappe.throw(_("Only submitted expenses can be cancelled."))
	if str(doc.modified) != str(expected_modified):
		frappe.throw(_("The expense changed. Refresh it before cancelling."), frappe.TimestampMismatchError)
	frappe.db.savepoint("quick_expense_cancel")
	try:
		doc.flags._expense_service = _SERVICE_REQUEST
		doc.cancellation_request_id = key
		doc.cancellation_fingerprint = digest
		doc.cancellation_reason = reason.strip()
		doc.flags.ignore_permissions = True
		doc.cancel()
		return result(doc)
	except Exception:
		frappe.db.rollback(save_point="quick_expense_cancel")
		raise


def outcome(client_request_id):
	require_schema()
	key = request_id(client_request_id)
	# The locking read sees a just-committed request even under REPEATABLE READ.
	lock_actor()
	name = frappe.db.get_value("Quick Expense", {"client_request_id": key}, "name", for_update=True)
	if not name:
		name = frappe.db.get_value("Quick Expense", {"cancellation_request_id": key}, "name", for_update=True)
	if not name:
		return {"status": "not_found", "client_request_id": key}
	doc = frappe.get_doc("Quick Expense", name, for_update=True)
	assert_read(doc)
	doc.check_permission("read")
	if doc.client_request_id == key and doc.owner != frappe.session.user:
		frappe.throw(_("This request belongs to another user."), frappe.PermissionError)
	if doc.cancellation_request_id == key and doc.cancelled_by != frappe.session.user:
		frappe.throw(_("This cancellation belongs to another user."), frappe.PermissionError)
	return result(doc)
