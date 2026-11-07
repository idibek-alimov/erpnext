"""Explicit owner funds/equity and owner loans; native Journal Entries own the money."""

import hashlib
import json
from decimal import Decimal, ROUND_HALF_UP

import frappe
from frappe import _
from frappe.utils import today

from . import money_commands as commands

_SERVICE = object()
OPERATIONS = {
	"contribution": ("contribution_account", "Equity", True, "Owner funds added"),
	"withdrawal": ("withdrawal_account", "Equity", False, "Owner funds withdrawn"),
	"loan_received": ("loan_account", "Liability", True, "Owner loan received"),
	"loan_repayment": ("loan_account", "Liability", False, "Owner loan repaid"),
}
POSTING_ROLES = {"Retail Owner", "Accounts Manager", "System Manager"}


def authorized():
	return frappe.session.user == "Administrator" or bool(POSTING_ROLES.intersection(frappe.get_roles()))


def require_authority():
	if not authorized():
		frappe.throw(_("An owner or authorized accounting user is required to record owner money."), frappe.PermissionError)


def schema_ready():
	return all(frappe.db.has_table(doctype) for doctype in ("Owner Money Settings", "Owner Money Movement"))


def require_schema():
	if not schema_ready():
		frappe.throw(_("Owner money requires a site upgrade before configuration or posting."))


def counterpart(name, company, root_type, active=True):
	account = commands.account_doc(name, company, cash_bank=False, active=active)
	currency = frappe.get_cached_value("Company", company, "default_currency")
	if account.root_type != root_type or account.account_currency != currency:
		frappe.throw(_("Choose a company-currency {0} account for this owner mapping.").format(root_type))
	if account.account_type not in (None, "", "Equity"):
		frappe.throw(_("Use a dedicated owner account, not a tax, stock or party payable account."))
	return account


def validate_settings(doc):
	require_authority()
	commands.company_doc(doc.company)
	for field, root_type in (("contribution_account", "Equity"), ("withdrawal_account", "Equity"), ("loan_account", "Liability")):
		if doc.get(field):
			counterpart(doc.get(field), doc.company, root_type)
	if not doc.contribution_account or not doc.withdrawal_account:
		frappe.throw(_("Configure both owner contribution and withdrawal accounts."))
	if doc.contribution_account == doc.withdrawal_account:
		frappe.throw(_("Use separate contribution and withdrawal accounts."))


def settings(company, lock=False):
	name = frappe.db.get_value("Owner Money Settings", {"company": company}, "name", for_update=lock)
	if not name:
		return None
	return frappe.get_doc("Owner Money Settings", name, for_update=lock)


def configure(company, create_accounts=False):
	"""Explicit one-time guided setup. Existing mappings are never silently replaced."""
	require_schema()
	require_authority()
	commands.company_doc(company)
	with commands.atomic():
		frappe.db.get_value("Company", company, "name", for_update=True)
		existing = settings(company, lock=True)
		if existing:
			existing.check_permission("read")
			validate_settings(existing)
			return dict(company=company, settings=existing.name)
		if not create_accounts:
			frappe.throw(_("Choose existing accounts in Owner Money Settings or explicitly create dedicated accounts."))
		groups = {}
		for root_type in ("Equity", "Liability"):
			rows = frappe.get_list("Account", filters=dict(company=company, is_group=1,
				root_type=root_type, parent_account=["is", "not set"]), pluck="name", limit_page_length=0)
			if len(rows) != 1:
				frappe.throw(_("Choose the owner account groups in the native chart of accounts first."))
			groups[root_type] = rows[0]
		doc = frappe.get_doc(dict(doctype="Owner Money Settings", company=company))
		doc.check_permission("create")
		for field, name, root_type in (("contribution_account", "Owner Contributions", "Equity"),
				("withdrawal_account", "Owner Withdrawals", "Equity"), ("loan_account", "Owner Loan", "Liability")):
			# Inserting a new named account is explicit. A preexisting same-name
			# account causes native duplicate validation, never an inferred mapping.
			account = frappe.get_doc(dict(doctype="Account", company=company, account_name=name,
				parent_account=groups[root_type], is_group=0, account_currency=frappe.get_cached_value("Company", company, "default_currency"),
				account_type="Equity" if root_type == "Equity" else ""))
			account.insert()
			doc.set(field, account.name)
		doc.insert()
		return dict(company=company, settings=doc.name)


def context(company):
	from .money_hub import _read_wallets
	wallets = _read_wallets(company)
	base = frappe.get_cached_value("Company", company, "default_currency")
	result = dict(company=company, currency=base, as_of=today(), upgrade_required=not schema_ready(), configured=False,
		can_record=False, can_configure=authorized(), wallets=[dict(name=w.name, account=w.account,
			currency=w.account_currency or base) for w in wallets], loan_balance=None, loan_scope="permitted_gl_through_date")
	if result["upgrade_required"]:
		return result
	result["can_configure"] = authorized() and frappe.has_permission("Owner Money Settings", "create")
	doc = settings(company)
	if not doc:
		return result
	# Settings are a routing contract, not permission to read a balance or post.
	# Never serialize protected raw configuration without native account access.
	for field, root_type in (("contribution_account", "Equity"), ("withdrawal_account", "Equity"), ("loan_account", "Liability")):
		if doc.get(field):
			counterpart(doc.get(field), company, root_type, active=False)
	result.update(configured=True, settings=doc.name, loans_enabled=bool(doc.loan_account))
	result["can_configure"] = authorized() and frappe.has_permission("Owner Money Settings", "write", doc=doc)
	je = frappe.get_doc(dict(doctype="Journal Entry", company=company))
	result["can_record"] = authorized() and all(frappe.has_permission("Journal Entry", p, doc=je) for p in ("read", "create", "submit"))
	if doc.loan_account:
		from .account_balances import read_balances
		from erpnext.accounts.utils import get_currency_precision
		balance = read_balances(company, [doc.loan_account], result["as_of"], get_currency_precision())[doc.loan_account]["balance"]
		result["loan_balance"] = -balance if balance is not None else None
	return result


def request_name(key):
	return "OMM-" + commands.request_name(key)[4:]


def _loan_owed_current(company, account):
	"""Full-book write validation only, never a permission-scoped display figure.

	The company lock serializes simple repayments; locking GL reads also avoid a
	pre-lock repeatable-read snapshot missing another actor's committed repayment.
	"""
	from erpnext.accounts.utils import get_currency_precision
	quantum = Decimal(1).scaleb(-get_currency_precision())
	rows = frappe.db.sql("""SELECT debit, credit FROM `tabGL Entry`
		WHERE company=%s AND account=%s AND is_cancelled=0 AND posting_date<=%s
		FOR UPDATE""", (company, account, today()), as_dict=True)
	return sum((Decimal(str(row.credit)).quantize(quantum, rounding=ROUND_HALF_UP)
		- Decimal(str(row.debit)).quantize(quantum, rounding=ROUND_HALF_UP) for row in rows), Decimal(0))


def result(receipt):
	if receipt.actor != frappe.session.user:
		frappe.throw(_("This owner-money request belongs to another user."), frappe.PermissionError)
	commands.company_doc(receipt.company)
	je = frappe.get_doc("Journal Entry", receipt.journal_entry, for_update=True)
	je.check_permission("read")
	if je.company != receipt.company:
		frappe.throw(_("The journal no longer matches the owner-money request."))
	for name in (receipt.wallet_account, receipt.owner_account):
		commands.account_doc(name, receipt.company, cash_bank=False, active=False)
	je.apply_fieldlevel_read_permissions()
	return dict(name=je.name, doctype="Journal Entry", docstatus=je.docstatus,
		status={0: "draft", 1: "submitted", 2: "cancelled"}[je.docstatus], company=je.company,
		operation=receipt.operation, request=receipt.name)


def outcome(company, client_request_id):
	require_schema()
	commands.company_doc(company)
	key = request_name(client_request_id)
	commands.lock_actor()
	frappe.db.get_value("Company", company, "name", for_update=True)
	if not frappe.db.get_value("Owner Money Movement", key, "name", for_update=True):
		return dict(status="not_found")
	receipt = frappe.get_doc("Owner Money Movement", key, for_update=True)
	if receipt.company != company:
		frappe.throw(_("The request belongs to another company."), frappe.PermissionError)
	return result(receipt)


def record(company, operation, wallet, amount, client_request_id, note=None, exchange_rate=None):
	require_schema()
	commands.company_doc(company)
	if operation not in OPERATIONS:
		frappe.throw(_("Choose a valid owner-money operation."))
	key = request_name(client_request_id)
	intent = dict(company=company, operation=operation, wallet=wallet,
		amount=format(commands.number(amount, _("amount"), positive=True).normalize(), "f"), note=(note or "").strip(),
		exchange_rate=None if exchange_rate in (None, "") else format(commands.number(exchange_rate, _("exchange rate"), positive=True).normalize(), "f"))
	digest = hashlib.sha256(json.dumps(intent, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
	commands.lock_actor()
	# Serialize company operations before locking a possibly missing receipt key;
	# otherwise two actors' index gap locks can conflict with the first insertion.
	frappe.db.get_value("Company", company, "name", for_update=True)
	if frappe.db.get_value("Owner Money Movement", key, "name", for_update=True):
		receipt = frappe.get_doc("Owner Money Movement", key, for_update=True)
		if receipt.actor != frappe.session.user or receipt.fingerprint != digest:
			frappe.throw(_("This request ID was already used for another owner-money operation."), frappe.PermissionError)
		return result(receipt)
	require_authority()
	with commands.atomic():
		# Also serializes different actors' simple repayments and mapping changes.
		frappe.db.get_value("Company", company, "name", for_update=True)
		doc = settings(company, lock=True)
		if not doc:
			frappe.throw(_("Configure owner-money accounts first."))
		field, root_type, incoming, label = OPERATIONS[operation]
		if not doc.get(field):
			frappe.throw(_("Configure the owner loan account before recording loans or repayments."))
		owner_account = counterpart(doc.get(field), company, root_type)
		_wallet, cash = commands.wallet_doc(wallet, company)
		if cash.name == owner_account.name:
			frappe.throw(_("Choose different money and owner accounts."))
		base = owner_account.account_currency
		amount = commands.number(amount, _("amount"), positive=True, precision=commands.currency_precision(cash.account_currency))
		rate = Decimal(1) if cash.account_currency == base and exchange_rate in (None, "") else commands.number(exchange_rate, _("exchange rate"), positive=True, precision=9)
		if cash.account_currency == base and rate != 1:
			frappe.throw(_("Company-currency payments must use an exchange rate of one."))
		booked = (amount * rate).quantize(Decimal(1).scaleb(-commands.currency_precision(base)), rounding=ROUND_HALF_UP)
		if booked <= 0:
			frappe.throw(_("The booked company-currency amount must be positive."))
		cash_row = dict(account=cash.name, exchange_rate=float(rate))
		owner_row = dict(account=owner_account.name, exchange_rate=1)
		cash_row["debit_in_account_currency" if incoming else "credit_in_account_currency"] = float(amount)
		owner_row["credit_in_account_currency" if incoming else "debit_in_account_currency"] = float(booked)
		je = frappe.get_doc(dict(doctype="Journal Entry", company=company, posting_date=today(),
			voucher_type="Bank Entry" if cash.account_type == "Bank" else "Cash Entry", multi_currency=int(cash.account_currency != base),
			cheque_no=key, cheque_date=today(), user_remark=f"{label}: {intent['note']}", accounts=[cash_row, owner_row]))
		# Native JE otherwise refreshes a foreign rate of exactly 1. The simple
		# command uses the explicitly entered rate; no external lookup at posting.
		je.flags.ignore_exchange_rate = True
		commands.native_permissions(je, posting=True)
		if operation == "loan_repayment":
			# Write validation only: use the authoritative native book balance, not
			# a possibly row-restricted display subtotal. Do not return that balance.
			owed = _loan_owed_current(company, owner_account.name)
			if booked > owed:
				frappe.throw(_("Repayment exceeds the recorded owner loan. Use the native accounting workflow to review it."))
		receipt = frappe.get_doc(dict(doctype="Owner Money Movement", company=company, actor=frappe.session.user,
			operation=operation, fingerprint=digest, intent=json.dumps(intent, sort_keys=True, ensure_ascii=False),
			wallet_account=cash.name, owner_account=owner_account.name))
		receipt.flags._owner_money_service = _SERVICE
		receipt.insert(ignore_permissions=True, set_name=key)
		je.insert()
		je.submit()
		receipt.journal_entry = je.name
		receipt.save(ignore_permissions=True)
		return result(receipt)
