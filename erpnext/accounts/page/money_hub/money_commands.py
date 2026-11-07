"""Money Hub command policy and atomic native internal transfers.

No financial document bypasses native permissions. The only elevated write is the
private request receipt, inserted before posting in the same database transaction.
"""

import hashlib
import json
import re
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation

import frappe
from frappe import _
from frappe.utils import today

_REQUEST_SERVICE = object()


@contextmanager
def atomic():
	# Unique savepoints permit nesting without consuming a caller's rollback point.
	point = "money_hub_" + frappe.generate_hash(length=12)
	frappe.db.savepoint(point)
	try:
		yield
	except Exception:
		frappe.db.rollback(save_point=point)
		raise


def company_doc(company):
	doc = frappe.get_doc("Company", company)
	doc.check_permission("read")
	return doc


def account_doc(name, company, cash_bank=True, active=True):
	doc = frappe.get_doc("Account", name)
	doc.check_permission("read")
	if doc.company != company or doc.is_group or (active and doc.disabled):
		frappe.throw(_("Choose an enabled leaf account in the selected company."), frappe.PermissionError)
	if cash_bank and doc.account_type not in {"Cash", "Bank"}:
		frappe.throw(_("Choose a cash or bank account."))
	# Native get_account_currency uses the company currency for older accounts
	# whose explicit currency is empty. This changes no stored master data.
	if not doc.account_currency:
		doc.account_currency = frappe.get_cached_value("Company", company, "default_currency")
	return doc


def wallet_doc(name, company, write=False, active=True):
	doc = frappe.get_doc("Money Wallet", name)
	doc.check_permission("read")
	if write:
		doc.check_permission("write")
	if doc.company != company:
		frappe.throw(_("The wallet does not belong to the selected company."), frappe.PermissionError)
	if active and not doc.enabled:
		frappe.throw(_("Choose an active wallet."))
	return doc, account_doc(doc.account, company, active=active)


def number(value, label, positive=False, precision=None):
	try:
		value = Decimal(str(value))
		if not value.is_finite() or (positive and value <= 0):
			raise ValueError
		if precision is not None and value != value.quantize(Decimal(1).scaleb(-precision)):
			raise ValueError
	except (InvalidOperation, TypeError, ValueError):
		frappe.throw(_("Enter a valid {0} with the supported precision.").format(label))
	return value


def currency_precision(currency):
	from frappe.model.meta import get_field_precision
	return get_field_precision(frappe._dict(fieldtype="Currency", options="currency"), currency=currency)


def request_name(key):
	if not isinstance(key, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{8,140}", key):
		frappe.throw(_("A stable transfer request ID is required. Reopen the transfer form."))
	return "MHT-" + hashlib.sha256(key.encode()).hexdigest()


def require_schema():
	if not frappe.db.has_table("Money Hub Transfer"):
		frappe.throw(_("The transfer upgrade requires a site migration. Ask the administrator to complete setup."))


def lock_actor():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please sign in."), frappe.PermissionError)
	frappe.db.get_value("User", frappe.session.user, "name", for_update=True)


def native_permissions(doc, posting=False):
	doc.check_permission("read")
	if posting:
		doc.check_permission("create")
		doc.check_permission("submit")


def receipt_result(receipt):
	if receipt.actor != frappe.session.user:
		frappe.throw(_("This transfer request belongs to another user."), frappe.PermissionError)
	company_doc(receipt.company)
	# A concurrent retry may already have an older repeatable-read snapshot from
	# its company lookup. Use a current read for the newly committed native source.
	doc = frappe.get_doc("Payment Entry", receipt.payment_entry, for_update=True)
	native_permissions(doc)
	if doc.company != receipt.company or doc.payment_type != "Internal Transfer":
		frappe.throw(_("The transfer source no longer matches its request."))
	account_doc(doc.paid_from, doc.company, active=False)
	account_doc(doc.paid_to, doc.company, active=False)
	doc.apply_fieldlevel_read_permissions()
	return dict(name=doc.name, doctype="Payment Entry", docstatus=doc.docstatus,
		status={0: "draft", 1: "submitted", 2: "cancelled"}[doc.docstatus],
		company=doc.company, paid_from=doc.paid_from, paid_to=doc.paid_to,
		paid_amount=doc.paid_amount, received_amount=doc.received_amount,
		source_currency=doc.paid_from_account_currency, target_currency=doc.paid_to_account_currency,
		source_exchange_rate=doc.source_exchange_rate, target_exchange_rate=doc.target_exchange_rate,
		request=receipt.name)


def outcome(key, company):
	require_schema()
	company_doc(company)
	name = request_name(key)
	lock_actor()
	if not frappe.db.get_value("Money Hub Transfer", name, "name", for_update=True):
		return dict(status="not_found")
	receipt = frappe.get_doc("Money Hub Transfer", name, for_update=True)
	if receipt.company != company:
		frappe.throw(_("This request belongs to another company."), frappe.PermissionError)
	return receipt_result(receipt)


def transfer(company, from_wallet, to_wallet, amount, kind, note, client_request_id,
		received_amount=None, source_exchange_rate=None, target_exchange_rate=None):
	require_schema()
	company_record = company_doc(company)
	name = request_name(client_request_id)
	# Normalize the submitted intent independently of current master data. A retry
	# after a wallet rename/disable can recover its original source without reposting.
	intent = dict(company=company, from_wallet=from_wallet, to_wallet=to_wallet, kind=kind,
		note=(note or "").strip())
	for key, value in (("amount", amount), ("received_amount", received_amount),
			("source_exchange_rate", source_exchange_rate), ("target_exchange_rate", target_exchange_rate)):
		intent[key] = (format(number(value, key, positive=True).normalize(), "f")
			if value not in (None, "") else None)
	digest = hashlib.sha256(json.dumps(intent, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
	lock_actor()
	if frappe.db.get_value("Money Hub Transfer", name, "name", for_update=True):
		receipt = frappe.get_doc("Money Hub Transfer", name, for_update=True)
		if receipt.actor != frappe.session.user or receipt.fingerprint != digest:
			frappe.throw(_("This request ID was already used for a different transfer."), frappe.PermissionError)
		result = receipt_result(receipt)
		# Recovery is read-only: revoked posting authority does not create a second entry.
		return result
	_source_wallet, src = wallet_doc(from_wallet, company)
	_target_wallet, dst = wallet_doc(to_wallet, company)
	if src.name == dst.name:
		frappe.throw(_("Choose two different accounts. These wallets may share one account."))
	base = company_record.default_currency
	source_currency, target_currency = src.account_currency, dst.account_currency
	paid = number(amount, _("source amount"), positive=True, precision=currency_precision(source_currency))
	received = (paid if received_amount in (None, "") and source_currency == target_currency
		else number(received_amount, _("received amount"), positive=True, precision=currency_precision(target_currency)))
	source_rate = (Decimal(1) if source_currency == base and source_exchange_rate in (None, "")
		else number(source_exchange_rate, _("source exchange rate"), positive=True, precision=9))
	target_rate = (source_rate if source_currency == target_currency and target_exchange_rate in (None, "")
		else Decimal(1) if target_currency == base and target_exchange_rate in (None, "")
		else number(target_exchange_rate, _("target exchange rate"), positive=True, precision=9))
	if ((source_currency == base and source_rate != 1) or (target_currency == base and target_rate != 1)
			or (source_currency == target_currency and (source_rate != target_rate or paid != received))):
		frappe.throw(_("Amounts and exchange rates must agree for accounts in the same currency."))
	quantum = Decimal(1).scaleb(-currency_precision(base))
	from decimal import ROUND_HALF_UP
	if (paid * source_rate).quantize(quantum, rounding=ROUND_HALF_UP) != (received * target_rate).quantize(quantum, rounding=ROUND_HALF_UP):
		frappe.throw(_("The transfer must balance in company currency. Record fees or exchange differences in the native Payment Entry."))
	remarks = f"[{kind}] {from_wallet} → {to_wallet}"
	if intent["note"]:
		remarks += ": " + intent["note"]
	doc = frappe.get_doc(dict(doctype="Payment Entry", payment_type="Internal Transfer", company=company,
		posting_date=today(), paid_from=src.name, paid_to=dst.name, paid_amount=float(paid),
		received_amount=float(received), source_exchange_rate=float(source_rate), target_exchange_rate=float(target_rate),
		paid_from_account_currency=source_currency, paid_to_account_currency=target_currency,
		reference_no=name, reference_date=today(), custom_remarks=1, remarks=remarks))
	native_permissions(doc, posting=True)
	with atomic():
		receipt = frappe.get_doc(dict(doctype="Money Hub Transfer", actor=frappe.session.user,
			company=company, fingerprint=digest, intent=json.dumps(intent, sort_keys=True, ensure_ascii=False)))
		receipt.flags._money_transfer_service = _REQUEST_SERVICE
		# This receipt grants no ability to post. Its unique PK is claimed before PE
		# insertion, so a colliding request by another actor cannot post first.
		receipt.insert(ignore_permissions=True, set_name=name)
		doc.insert()
		doc.submit()
		receipt.payment_entry = doc.name
		receipt.save(ignore_permissions=True)
		return receipt_result(receipt)
