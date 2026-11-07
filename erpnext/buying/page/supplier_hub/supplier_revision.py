"""Invalidate browser-held supplier summaries after committed business changes.

No financial results are cached on the server. Every data response still runs native
permission-aware queries. The revision only allows a browser to reuse its own response.
"""

import hashlib
import json
import time

import frappe
from frappe.utils import today
from redis.exceptions import RedisError


REVISION_KEY = "supplier_pages_revision"
REUSE_SECONDS = 20
TRACKED_DOCTYPES = frozenset({
	"Supplier", "Supplier Group", "Company", "Warehouse", "Item", "Item Price", "Price List",
	"Contact", "Address", "Money Wallet", "Account", "Mode of Payment", "Bin",
	"Purchase Invoice", "Purchase Receipt", "Payment Entry", "Journal Entry",
	"Payment Reconciliation", "Unreconcile Payment", "GL Entry", "Payment Ledger Entry",
	"Stock Entry", "Stock Reconciliation", "Delivery Note", "Sales Invoice",
	"Landed Cost Voucher", "Repost Item Valuation", "Repost Accounting Ledger",
	"Subcontracting Receipt", "Stock Ledger Entry", "User", "User Permission", "DocShare",
	"Role", "Role Profile", "DocType", "Custom DocPerm", "Report", "Custom Role",
	"Property Setter", "Buying Settings", "Accounts Settings", "Global Defaults",
})


def current_revision(scope=None):
	# A short lifetime also covers maintenance scripts that use direct SQL instead of document events.
	from frappe.core.doctype.user_permission.user_permission import get_user_permissions

	read_permissions = {dt: bool(frappe.has_permission(dt, "read")) for dt in (
		"Supplier", "Company", "Warehouse", "Bin", "Item", "Purchase Invoice", "Purchase Receipt",
		"Payment Entry", "Journal Entry", "Contact", "Address", "Item Price", "Price List", "Sales Invoice", "Stock Ledger Entry", "Delivery Note")}
	policy = dict(version=4, scope=scope, user=frappe.session.user, roles=sorted(frappe.get_roles()), read_permissions=read_permissions,
		user_permissions=get_user_permissions(), date=today(), window=int(time.time() // REUSE_SECONDS),
		create_payment=bool(frappe.has_permission("Payment Entry", "create")),
		submit_payment=bool(frappe.has_permission("Payment Entry", "submit")),
		reports={name: bool(frappe.get_cached_doc("Report", name).is_permitted())
			for name in ("Accounts Payable", "General Ledger")},
		change=frappe.cache().get_value(REVISION_KEY) or "initial")
	return hashlib.sha256(json.dumps(policy, sort_keys=True, default=str).encode()).hexdigest()


def clear_supplier_revision():
	"""Framework permission/cache resets also invalidate browser-held responses."""
	try:
		frappe.cache().set_value(REVISION_KEY, frappe.generate_hash(length=16))
	except RedisError:
		# Cache invalidation must not turn an already-committed payment into an API failure.
		# The short response lifetime still forces a fresh read after an outage.
		pass


def invalidate_supplier_pages(doc, method=None, *args):
	if doc.doctype not in TRACKED_DOCTYPES or getattr(frappe.local, "supplier_revision_pending", False):
		return
	frappe.local.supplier_revision_pending = True

	def reset():
		frappe.local.supplier_revision_pending = False

	def committed():
		try:
			clear_supplier_revision()
		finally:
			reset()

	# One invalidation per transaction, including bulk stock updates; never publish a rolled-back change.
	frappe.db.after_commit.add(committed)
	frappe.db.after_rollback.add(reset)
