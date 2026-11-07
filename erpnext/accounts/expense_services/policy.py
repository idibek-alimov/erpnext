"""Expense capabilities and sources; discovery and writes use the same policy."""

from contextlib import contextmanager
from decimal import Decimal, InvalidOperation

import frappe
from frappe import _
from frappe.permissions import get_allowed_docs_for_doctype, get_user_permissions, has_user_permission
from frappe.utils import cint, getdate, today

_SERVICE_REQUEST = object()  # An object identity cannot be supplied by a JSON/REST caller.

MANAGER_ROLES = {"Retail Manager", "Retail Owner", "Accounts Manager"}
DESK_ROLES = MANAGER_ROLES | {"Accounts User"}
CASHIER_ROLES = {"Retail Cashier"}


def require_schema():
	if not frappe.get_meta("Quick Expense").has_field("client_request_id") or not frappe.db.has_column("Quick Expense", "cancellation_fingerprint"):
		frappe.throw(_("The expense upgrade requires a site migration. Ask the administrator to complete setup before recording expenses."))


def is_manager(user=None):
	user = user or frappe.session.user
	return user == "Administrator" or bool(MANAGER_ROLES.intersection(frappe.get_roles(user)))


def require_manager():
	if not is_manager():
		frappe.throw(_("Only an authorized manager can correct or cancel expenses."), frappe.PermissionError)


def link_allowed(doctype, name, user=None):
	permissions = get_user_permissions(user or frappe.session.user)
	allowed = get_allowed_docs_for_doctype(permissions.get(doctype, []), "Quick Expense")
	return not allowed or name in allowed


def check_company(company, user=None):
	user = user or frappe.session.user
	if not company or not link_allowed("Company", company, user) or not frappe.has_permission("Company", "read", doc=company, user=user):
		frappe.throw(_("You do not have access to this company."), frappe.PermissionError)


def check_user_scope(doctype, name, user=None):
	"""Respect native User Permissions without granting ledger/balance visibility to cashiers."""
	if not name or not link_allowed(doctype, name, user) or not has_user_permission(frappe.get_cached_doc(doctype, name), user=user):
		frappe.throw(_("The selected record is outside your permitted scope."), frappe.PermissionError)


def get_context(company, pos_profile=None, pos_opening_shift=None, entry_context=None, reason=None,
				action="create", user=None):
	user = user or frappe.session.user
	require_schema()
	check_company(company, user)
	if user == "Guest":
		frappe.throw(_("Please sign in."), frappe.PermissionError)
	if not frappe.has_permission("Quick Expense", "read", user=user):
		frappe.throw(_("Expense read permission is required."), frappe.PermissionError)
	context = entry_context or ("POS" if pos_profile or pos_opening_shift else "Desk")
	if context not in {"Desk", "POS", "POS Correction"}:
		frappe.throw(_("Invalid expense context."))
	if context == "Desk":
		if pos_profile or pos_opening_shift:
			frappe.throw(_("Select an explicit POS correction and opening shift."))
		if user != "Administrator" and not DESK_ROLES.intersection(frappe.get_roles(user)):
			frappe.throw(_("You are not authorized to use Expense Desk."), frappe.PermissionError)
		return frappe._dict(company=company, entry_context="Desk", pos_profile=None, pos_opening_shift=None)
	if context == "POS Correction" and not is_manager(user):
		frappe.throw(_("A manager is required for a POS expense correction."), frappe.PermissionError)
	if context == "POS Correction" and action == "create" and not (reason or "").strip():
		frappe.throw(_("Enter the reason for this POS correction."))
	validators = frappe.get_hooks("expense_pos_context_validator")
	if len(validators) != 1:
		frappe.throw(_("POS expense validation is unavailable. Check the installed POS app."))
	validated = frappe.get_attr(validators[0])(
		company=company, pos_profile=pos_profile, pos_opening_shift=pos_opening_shift,
		entry_context=context, action=action, user=user,
	)
	return frappe._dict(validated, entry_context=context, company=company)


def same_stored_value(field, left, right):
	# Native Desk payloads use ISO strings; database Documents use date/number objects.
	if field == "posting_date":
		if not left or not right:
			return not left and not right
		return getdate(left) == getdate(right)
	if field == "amount":
		try:
			return Decimal(str(left)) == Decimal(str(right))
		except InvalidOperation:
			return False
	return (left or None) == (right or None)


def positive_amount(value, precision=2):
	try:
		amount = Decimal(str(value))
		quantum = Decimal(1).scaleb(-precision)
		if not amount.is_finite() or amount <= 0 or amount != amount.quantize(quantum):
			raise ValueError
	except (InvalidOperation, ValueError, TypeError):
		frappe.throw(_("Enter a finite positive amount using the company currency precision."))
	return amount


def currency_precision(company):
	from frappe.model.meta import get_field_precision
	currency = frappe.get_cached_value("Company", company, "default_currency")
	return get_field_precision(frappe._dict(fieldtype="Currency", options="currency"), currency=currency)


def validate_account(name, company, expense=False, user=None):
	account = frappe.get_cached_doc("Account", name)
	if account.company != company or account.is_group or account.disabled:
		frappe.throw(_("Select an enabled leaf account in the expense company."))
	if expense and account.root_type != "Expense":
		frappe.throw(_("The category must use an expense account."))
	if not expense and account.account_type not in {"Cash", "Bank"}:
		frappe.throw(_("The funding source must be a cash or bank account."))
	currency = frappe.get_cached_value("Company", company, "default_currency")
	if (account.account_currency or currency) != currency:
		frappe.throw(_("Foreign-currency expenses require the native accounting workflow."))
	check_user_scope("Account", name, user)
	return account


def category_mapping(category, company, user=None):
	if not category or not frappe.db.exists("Quick Expense Category", category):
		frappe.throw(_("Configure the expense category before recording an expense."))
	doc = frappe.get_cached_doc("Quick Expense Category", category)
	rows = [r for r in doc.get("company_accounts", []) if r.company == company]
	if len(rows) > 1:
		frappe.throw(_("The category has duplicate company mappings."))
	account = rows[0].expense_account if rows else doc.default_account
	# A legacy default is explicit configuration only for the account's own company.
	if not account or frappe.get_cached_value("Account", account, "company") != company:
		frappe.throw(_("Configure this category's expense account for the selected company."))
	validate_account(account, company, expense=True, user=user)
	cost_center = rows[0].cost_center if rows else None
	cost_center = cost_center or frappe.get_cached_value("Company", company, "cost_center")
	if cost_center:
		cc = frappe.get_cached_doc("Cost Center", cost_center)
		if cc.company != company or cc.is_group or cc.disabled:
			frappe.throw(_("Configure an enabled company cost center for the category."))
		check_user_scope("Cost Center", cost_center, user)
	return frappe._dict(expense_account=account, cost_center=cost_center)


@contextmanager
def quiet_setup_checks():
	previous = frappe.flags.mute_messages
	frappe.flags.mute_messages = True
	try:
		yield
	finally:
		frappe.flags.mute_messages = previous


def get_sources(context, user=None):
	user = user or frappe.session.user
	wallets = frappe.get_all("Money Wallet", filters={"company": context.company, "enabled": 1},
		fields=["name"], order_by="sort_order asc, name asc")
	result = {}
	for row in wallets:
		wallet = frappe.get_cached_doc("Money Wallet", row.name)
		profiles = {r.pos_profile for r in wallet.get("expense_profiles", [])}
		if context.entry_context == "Desk":
			if not wallet.get("allow_desk_expenses") or wallet.wallet_type not in {"Safe", "Bank", "Mobile Wallet"}:
				continue
			# An office checkbox cannot turn a register/receipt source into an unassigned outflow.
			if profiles or wallet.pos_profile or wallet.accept_in_pos or is_pos_account(wallet.account, context.company):
				continue
		elif context.pos_profile not in profiles:
			continue
		if not wallet.account:
			continue
		try:
			with quiet_setup_checks():
				account = validate_account(wallet.account, context.company, user=user)
		except (frappe.PermissionError, frappe.ValidationError):
			continue
		if context.entry_context != "Desk" and wallet.account not in context.source_accounts:
			continue
		if wallet.mode_of_payment:
			mop = frappe.get_cached_doc("Mode of Payment", wallet.mode_of_payment)
			mapped_account = frappe.db.get_value("Mode of Payment Account",
				{"parent": wallet.mode_of_payment, "company": context.company}, "default_account")
			if not mop.enabled or mapped_account != wallet.account:
				continue
		result.setdefault(wallet.account, dict(
			id=f"wallet:{wallet.name}", wallet=wallet.name, account=wallet.account,
			label=wallet.wallet_name, type="pos" if context.entry_context != "Desk" else wallet.wallet_type.lower(),
			source_type=wallet.wallet_type, account_type=account.account_type,
			currency=account.account_currency or frappe.get_cached_value("Company", context.company, "default_currency"),
			pos_profile=context.pos_profile, mode_of_payment=wallet.mode_of_payment,
		))
	return list(result.values())


def is_pos_account(account, company):
	"""Include aliases and profiles without wallets; never infer shift from account/date."""
	return bool(frappe.db.sql("""
		select p.name from `tabPOS Profile` p
		join `tabPOS Payment Method` pm on pm.parent = p.name and pm.parenttype = 'POS Profile'
		join `tabMode of Payment Account` ma on ma.parent = pm.mode_of_payment
			and ma.parenttype = 'Mode of Payment' and ma.company = p.company
		where p.company = %s and ma.default_account = %s limit 1
	""", (company, account)))


def validate_expense(doc):
	"""Always called by the controller, even for REST/native forms/ignore_permissions writes."""
	require_schema()
	context = get_context(doc.company, doc.pos_profile, doc.pos_opening_shift,
		doc.entry_context if doc.get("entry_context") != "Desk" else None, doc.correction_reason)
	doc.entry_context = context.entry_context
	doc.pos_profile = context.pos_profile
	doc.pos_opening_shift = context.pos_opening_shift
	doc.created_from_pos = cint(context.entry_context == "POS")
	amount = positive_amount(doc.amount, currency_precision(doc.company))
	doc.amount = float(amount)
	mapping = category_mapping(doc.expense_category, doc.company)
	if doc.expense_account and doc.expense_account != mapping.expense_account:
		frappe.throw(_("Expense account must match the configured category account."))
	if doc.cost_center and doc.cost_center != mapping.cost_center:
		frappe.throw(_("Use the category's configured cost center or the native accounting workflow."))
	doc.expense_account, doc.cost_center = mapping.expense_account, mapping.cost_center
	source = next((s for s in get_sources(context) if s["account"] == doc.paid_from), None)
	if not source:
		frappe.throw(_("This source is not authorized for expense payments in this context."), frappe.PermissionError)
	if doc.mode_of_payment and doc.mode_of_payment != source["mode_of_payment"]:
		frappe.throw(_("Mode of payment must match the funding wallet."))
	doc.mode_of_payment = source["mode_of_payment"]
	if context.entry_context == "POS" and getdate(doc.posting_date) != getdate(today()):
		frappe.throw(_("Cashier expenses must use today's posting date. Ask a manager to correct earlier spending."))
	if doc.party_type or doc.party:
		frappe.throw(_("Use Purchase Invoice, Expense Claim or Employee Advance for party-based payments. A recipient name is descriptive."))
	if doc.receipt_attachment:
		files = frappe.get_all("File", filters={"file_url": doc.receipt_attachment}, pluck="name")
		if not any(frappe.has_permission("File", "read", doc=name) for name in files):
			frappe.throw(_("You do not have access to this receipt."), frappe.PermissionError)
	old = doc.get_doc_before_save()
	if not old and (doc.client_request_id or doc.request_fingerprint) and doc.flags.get("_expense_service") is not _SERVICE_REQUEST:
		frappe.throw(_("Expense request identity is set by the shared expense service."))
	if old and old.docstatus == 0:
		for key in ("owner", "company", "pos_profile", "pos_opening_shift", "entry_context", "client_request_id", "request_fingerprint"):
			if old.get(key) != doc.get(key):
				frappe.throw(_("Expense context and request identity cannot be changed. Start a new expense."))
	if doc.amended_from:
		require_manager()
		original = frappe.get_doc("Quick Expense", doc.amended_from)
		assert_read(original)
		if original.docstatus != 2:
			frappe.throw(_("Only cancelled expenses can be amended."))
		if not (doc.correction_reason or "").strip():
			frappe.throw(_("Enter an amendment reason."))
		if (doc.company, doc.pos_profile, doc.pos_opening_shift) != (original.company, original.pos_profile, original.pos_opening_shift):
			frappe.throw(_("An amendment must preserve the original company and shift. Use a separate audited correction."))
	if not has_user_permission(doc):
		frappe.throw(_("This expense is outside your permitted scope."), frappe.PermissionError)
	if any(doc.get(k) for k in ("journal_entry", "payment_entry", "purchase_invoice", "cancelled_by", "cancellation_request_id", "cancellation_fingerprint", "cancellation_reason")):
		frappe.throw(_("Accounting and cancellation links are set by the expense workflow."))


def assert_read(doc, user=None):
	user = user or frappe.session.user
	check_company(doc.company, user)
	check_user_scope("Account", doc.paid_from, user)
	if doc.pos_profile or doc.pos_opening_shift:
		get_context(doc.company, doc.pos_profile, doc.pos_opening_shift, "POS Correction" if is_manager(user) else "POS", action="read", user=user)
	elif user != "Administrator" and not DESK_ROLES.intersection(frappe.get_roles(user)):
		frappe.throw(_("You do not have access to this expense."), frappe.PermissionError)
	if not has_user_permission(doc, user=user):
		frappe.throw(_("This expense is outside your permitted scope."), frappe.PermissionError)


def has_permission(doc, ptype=None, user=None, **kwargs):
	try:
		if ptype in {"cancel", "amend", "delete"} and not is_manager(user):
			return False
		if ptype in {"read", "select", "print", "export", "write", "submit", "cancel", "amend", "delete"}:
			assert_read(doc, user)
	except (frappe.PermissionError, frappe.ValidationError, frappe.DoesNotExistError):
		return False
	return None  # Native permissions must also grant the requested action.


def permission_query_conditions(user=None, legacy=False):
	user = user or frappe.session.user
	roles = set(frappe.get_roles(user))
	cashier_roles = CASHIER_ROLES | ({"Sales User", "Sales Manager", "System Manager"} if legacy else set())
	if user == "Administrator":
		return ""
	if not roles.intersection(DESK_ROLES | cashier_roles):
		return "1=0"
	office = "(coalesce(`tabQuick Expense`.pos_profile, '') = '' and coalesce(`tabQuick Expense`.pos_opening_shift, '') = '')"
	if not frappe.get_hooks("expense_pos_context_validator"):
		return office if roles.intersection(DESK_ROLES) else "1=0"
	if not frappe.has_permission("POS Profile", "read", user=user):
		return office if roles.intersection(DESK_ROLES) else "1=0"
	actor = frappe.db.escape(user)
	profile_scope = """exists (select p.name from `tabPOS Profile` p
		where p.name = `tabQuick Expense`.pos_profile and p.company = `tabQuick Expense`.company
		and (not exists (select u.name from `tabPOS Profile User` u where u.parent = p.name and u.parenttype = 'POS Profile')
		or exists (select u.name from `tabPOS Profile User` u where u.parent = p.name and u.parenttype = 'POS Profile' and u.user = {actor})))""".format(actor=actor)
	if roles.intersection({"Retail Owner", "Accounts Manager"}):
		return ""  # Native company/account User Permissions still apply.
	if is_manager(user):
		return f"({office} or ({profile_scope}))"
	own_shift = """exists (select s.name from `tabPOS Opening Shift` s
		where s.name = `tabQuick Expense`.pos_opening_shift and s.user = {actor} and s.docstatus = 1
		and s.company = `tabQuick Expense`.company and s.pos_profile = `tabQuick Expense`.pos_profile)""".format(actor=actor)
	pos = f"({own_shift} and {profile_scope})" if roles.intersection(cashier_roles) else "1=0"
	return f"({office} or {pos})" if roles.intersection(DESK_ROLES) else pos
