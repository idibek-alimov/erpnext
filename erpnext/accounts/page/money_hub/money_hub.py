# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, flt, today

from erpnext.accounts.page.money_hub import money_commands as commands

from erpnext.stock.page.product_catalog.product_catalog import get_default_company

ALLOWED_ROLES = {"Accounts Manager", "Stock Manager", "System Manager", "Administrator"}

WALLET_TYPES = {
	"Till": {"icon": "💵", "color": "#38a169", "group": "Cash In Hand", "account_type": "Cash", "mop_type": "Cash"},
	"Safe": {"icon": "🔐", "color": "#d69e2e", "group": "Cash In Hand", "account_type": "Cash", "mop_type": "Cash"},
	"Mobile Wallet": {"icon": "📱", "color": "#805ad5", "group": "Bank Accounts", "account_type": "Bank", "mop_type": "Bank"},
	"Bank": {"icon": "🏦", "color": "#3182ce", "group": "Bank Accounts", "account_type": "Bank", "mop_type": "Bank"},
}

SAFE_NAME_HINTS = ("safe", "сейф")


def _check_permission():
	if not ALLOWED_ROLES.intersection(frappe.get_roles()):
		frappe.throw(_("Only Store Managers and Owners can manage wallets."), frappe.PermissionError)


@frappe.whitelist()
def get_business_results(company=None, from_date=None, to_date=None):
	from erpnext.accounts.page.money_hub.business_results import read_results

	return read_results(company or get_default_company(), from_date, to_date)


def _classify_account(account_name, account_type):
	if account_type == "Bank":
		return "Bank"
	if any(h in (account_name or "").lower() for h in SAFE_NAME_HINTS):
		return "Safe"
	return "Till"


def import_existing_accounts(company):
	"""Sync all existing Cash/Bank leaf accounts into Money Wallets."""

	accounts = frappe.db.get_all(
		"Account",
		filters={"company": company, "account_type": ["in", ["Cash", "Bank"]], "is_group": 0, "disabled": 0},
		fields=["name", "account_name", "account_type"],
		order_by="account_type asc, creation asc",
	)
	for idx, acc in enumerate(accounts):
		wtype = _classify_account(acc.account_name, acc.account_type)
		if frappe.db.exists("Money Wallet", {"account": acc.name, "company": company}) or frappe.db.exists("Money Wallet", acc.account_name):
			continue
		mop = frappe.db.get_value(
			"Mode of Payment Account", {"default_account": acc.name, "company": company}, "parent"
		)
		doc = frappe.get_doc({
			"doctype": "Money Wallet",
			"wallet_name": acc.account_name,
			"wallet_type": wtype,
			"company": company,
			"account": acc.name,
			"mode_of_payment": mop,
			"accept_in_pos": 1 if mop else 0,
			"icon": WALLET_TYPES[wtype]["icon"],
			"color": WALLET_TYPES[wtype]["color"],
			"sort_order": idx,
			"enabled": 1,
		})
		doc.flags.ignore_permissions = True
		doc.insert()
	frappe.db.commit()


def _read_wallets(company, include_hidden=False):
	"""No provisioning on reads; native wallet/account permissions define scope."""
	_check_permission()
	frappe.get_doc("Company", company).check_permission("read")
	if not frappe.has_permission("GL Entry", "read"):
		frappe.throw(_("Accounting ledger read permission is required."), frappe.PermissionError)
	filters = {"company": company}
	if not include_hidden:
		filters["enabled"] = 1
	wallets = frappe.get_list("Money Wallet", filters=filters, fields=[
		"name", "wallet_name", "wallet_type", "account", "mode_of_payment", "pos_profile",
		"accept_in_pos", "commission_percent", "icon", "color", "sort_order", "enabled"],
		order_by="sort_order asc, creation asc", limit_page_length=0)
	accounts = sorted({row.account for row in wallets if row.account})
	permitted = {}
	for offset in range(0, len(accounts), 200):
		permitted.update({row.name: row for row in frappe.get_list("Account",
			filters={"company": company, "is_group": 0, "account_type": ["in", ["Cash", "Bank"]],
				"name": ["in", accounts[offset:offset + 200]]},
			fields=["name", "account_currency", "account_type"], limit_page_length=0)})
	return [frappe._dict(row, account_currency=permitted[row.account].account_currency,
		account_type=permitted[row.account].account_type)
		for row in wallets if row.account in permitted]


@frappe.whitelist()
def get_money_hub_data(company=None, include_hidden=0):
	from collections import defaultdict
	from decimal import Decimal

	from frappe.model.meta import get_field_precision
	from frappe.utils import cint

	from erpnext.accounts.page.money_hub.account_balances import read_balances
	from erpnext.accounts.utils import get_currency_precision

	company = company or get_default_company()
	wallets = _read_wallets(company, bool(cint(include_hidden)))
	currency = frappe.get_cached_value("Company", company, "default_currency")
	as_of = today()
	currencies = {currency} | {row.account_currency for row in wallets if row.account_currency}
	precisions = {code: get_field_precision(frappe._dict(fieldtype="Currency", options="currency"), currency=code)
		for code in currencies}
	aliases = defaultdict(list)
	for wallet in wallets:
		aliases[wallet.account].append(wallet)
	balances = read_balances(company, aliases, as_of, get_currency_precision())
	accounts = []
	for account, linked in aliases.items():
		value = balances[account]
		for wallet in linked:
			wallet.update({key: value[key] for key in ("balance", "account_balance", "today_in", "today_out", "opening_balance")})
		accounts.append(dict(account=account, account_type=linked[0].account_type,
			account_currency=linked[0].account_currency, wallet_names=[w.wallet_name for w in linked],
			wallets=[w.name for w in linked], primary_wallet=next((w.name for w in linked if w.enabled), linked[0].name),
			enabled=any(w.enabled for w in linked), **value))

	def total(rows, field):
		values = [row[field] for row in rows]
		return None if any(value is None for value in values) else float(sum((Decimal(str(value)) for value in values), Decimal(0)))

	totals = {key: total(accounts, field) for key, field in (("total", "balance"),
		("opening_balance", "opening_balance"), ("today_in", "today_in"), ("today_out", "today_out"))}
	totals["cash"] = total([row for row in accounts if row["account_type"] == "Cash"], "balance")
	totals["non_cash"] = total([row for row in accounts if row["account_type"] == "Bank"], "balance")
	if any(row["account_type"] not in ("Cash", "Bank") for row in accounts):
		totals["cash"] = totals["non_cash"] = None
	totals["net_today"] = (float(Decimal(str(totals["today_in"])) - Decimal(str(totals["today_out"])))
		if totals["today_in"] is not None and totals["today_out"] is not None else None)
	return dict(company=company, currency=currency, currency_precisions=precisions,
		wallets=wallets, accounts=accounts, totals=totals, as_of=as_of,
		include_hidden=bool(cint(include_hidden)), balance_scope="permitted_gl_through_date",
		pos_tills=[w for w in wallets if w.wallet_type == "Till"],
		safes=[w for w in wallets if w.wallet_type == "Safe"],
		bank_wallets=[w for w in wallets if w.wallet_type not in ("Till", "Safe")])


def _get_parent_group(company, group_name):
	parent = frappe.db.get_value("Account", {"company": company, "account_name": group_name, "is_group": 1}, "name")
	if not parent:
		frappe.throw(_("Account group '{0}' not found for {1}").format(group_name, company))
	return parent


def _create_mode_of_payment(wallet_name, mop_type, account, company):
	mop_name = wallet_name
	if frappe.db.exists("Mode of Payment", mop_name):
		mop = frappe.get_doc("Mode of Payment", mop_name)
	else:
		mop = frappe.get_doc({"doctype": "Mode of Payment", "mode_of_payment": mop_name, "type": mop_type, "enabled": 1})
	mop.check_permission("write" if not mop.is_new() else "create")
	if not mop.is_new():
		mop.check_permission("read")
	for row in mop.accounts:
		if row.company == company and row.default_account != account:
			frappe.throw(_("This payment method already uses another account in the selected company."))
	if not any(r.company == company for r in mop.accounts):
		mop.append("accounts", {"company": company, "default_account": account})
	mop.save()
	return mop.name


def sync_pos_profiles(company, mode_of_payment=None):
	"""Update only this wallet's payment method; preserve unrelated POS configuration.

	Every affected profile requires native write permission. A denied profile aborts
	the whole wallet command, rather than silently updating just a permitted subset.
	"""
	if not mode_of_payment:
		return
	accepted = bool(frappe.db.exists("Money Wallet", {
		"company": company, "enabled": 1, "accept_in_pos": 1, "mode_of_payment": mode_of_payment}))
	for name in frappe.get_all("POS Profile", filters={"company": company, "disabled": 0}, pluck="name"):
		doc = frappe.get_doc("POS Profile", name)
		present = any(row.mode_of_payment == mode_of_payment for row in doc.payments)
		if present == accepted:
			continue
		doc.check_permission("write")
		if accepted:
			doc.append("payments", {"mode_of_payment": mode_of_payment, "default": 0})
		else:
			doc.set("payments", [row for row in doc.payments if row.mode_of_payment != mode_of_payment])
		if doc.payments and not any(row.default for row in doc.payments):
			doc.payments[0].default = 1
		doc.save()


@frappe.whitelist(allow_guest=True)
def get_pos_wallets(company=None):
	"""Returns active Money Wallets configured for POS."""
	company = company or get_default_company()
	return frappe.db.get_all(
		"Money Wallet",
		filters={"company": company, "enabled": 1, "accept_in_pos": 1},
		fields=["name", "wallet_name", "wallet_type", "account", "mode_of_payment", "icon", "color"],
		order_by="sort_order asc, creation asc",
	)


def _post_opening_balance(wallet_account, amount, company, wallet_name):
	temp = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Temporary", "is_group": 0}, "name"
	)
	if not temp:
		frappe.throw(_("Opening balance account (Temporary Opening) not found for {0}").format(company))
	commands.account_doc(temp, company, cash_bank=False)
	je = frappe.get_doc({
		"doctype": "Journal Entry",
		"voucher_type": "Opening Entry",
		"company": company,
		"posting_date": today(),
		"user_remark": _("Opening balance: {0}").format(wallet_name),
		"accounts": [
			{"account": wallet_account, "debit_in_account_currency": amount},
			{"account": temp, "credit_in_account_currency": amount},
		],
	})
	je.check_permission("create")
	je.check_permission("submit")
	je.insert()
	je.submit()


@frappe.whitelist(methods=["POST"])
def create_wallet(wallet_name, wallet_type, opening_balance=0, accept_in_pos=0, commission_percent=0, company=None):
	"""Atomic Account + optional payment method/opening + wallet + authorized POS sync."""
	_check_permission()
	company = company or get_default_company()
	company_record = commands.company_doc(company)
	wallet_name = (wallet_name or "").strip()
	if not wallet_name or wallet_type not in WALLET_TYPES:
		frappe.throw(_("Enter a wallet name and a valid wallet type."))
	if frappe.db.exists("Money Wallet", wallet_name):
		frappe.throw(_("Wallet '{0}' already exists").format(wallet_name))
	opening = commands.number(opening_balance, _("opening balance"),
		precision=commands.currency_precision(company_record.default_currency))
	commission = commands.number(commission_percent, _("commission"))
	if opening < 0 or not 0 <= commission <= 100:
		frappe.throw(_("Opening balance cannot be negative and commission must be between 0 and 100."))
	cfg = WALLET_TYPES[wallet_type]
	parent = _get_parent_group(company, cfg["group"])
	frappe.get_doc("Account", parent).check_permission("read")
	with commands.atomic():
		frappe.db.get_value("Company", company, "name", for_update=True)
		account = frappe.get_doc(dict(doctype="Account", company=company, account_name=wallet_name,
			account_type=cfg["account_type"], parent_account=parent, is_group=0,
			account_currency=company_record.default_currency))
		account.insert()
		mop = (_create_mode_of_payment(wallet_name, cfg["mop_type"], account.name, company)
			if cint(accept_in_pos) else None)
		if opening:
			_post_opening_balance(account.name, float(opening), company, wallet_name)
		wallet = frappe.get_doc(dict(doctype="Money Wallet", wallet_name=wallet_name,
			wallet_type=wallet_type, company=company, account=account.name, mode_of_payment=mop,
			accept_in_pos=cint(accept_in_pos), commission_percent=float(commission),
			icon=cfg["icon"], color=cfg["color"], enabled=1))
		wallet.insert()
		sync_pos_profiles(company, mop)
		return dict(company=company, wallet=wallet.name)


@frappe.whitelist(methods=["POST"])
def update_wallet(name, wallet_name=None, commission_percent=None, enabled=None, accept_in_pos=None, company=None):
	_check_permission()
	doc = frappe.get_doc("Money Wallet", name)
	company = company or doc.company
	commands.company_doc(company)
	doc, _account = commands.wallet_doc(name, company, write=True, active=False)
	with commands.atomic():
		frappe.db.get_value("Company", company, "name", for_update=True)
		previous_pos = (cint(doc.enabled), cint(doc.accept_in_pos), doc.mode_of_payment)
		if commission_percent is not None:
			doc.commission_percent = float(commands.number(commission_percent, _("commission")))
		if enabled is not None:
			doc.enabled = cint(enabled)
		if accept_in_pos is not None:
			doc.accept_in_pos = cint(accept_in_pos)
		if doc.accept_in_pos and not doc.mode_of_payment:
			cfg = WALLET_TYPES[doc.wallet_type]
			doc.mode_of_payment = _create_mode_of_payment(doc.wallet_name, cfg["mop_type"], doc.account, company)
		new_name = (wallet_name or "").strip()
		if new_name:
			doc.wallet_name = new_name
		doc.save()
		if new_name and new_name != doc.name:
			# Native rename checks are retained. The native form remains available.
			frappe.rename_doc("Money Wallet", doc.name, new_name)
			doc.name = new_name
		if previous_pos != (cint(doc.enabled), cint(doc.accept_in_pos), doc.mode_of_payment):
			sync_pos_profiles(company, doc.mode_of_payment)
		return dict(company=company, wallet=doc.name)


TRANSFER_KINDS = ("Инкассация", "Пополнение", "Снятие", "Обычный перевод")


@frappe.whitelist(methods=["POST"])
def transfer_money(from_wallet, to_wallet, amount, kind="Обычный перевод", note=None, company=None,
		client_request_id=None, received_amount=None, source_exchange_rate=None, target_exchange_rate=None):
	_check_permission()
	if kind not in TRANSFER_KINDS:
		frappe.throw(_("Choose a valid transfer kind."))
	return commands.transfer(company or get_default_company(), from_wallet, to_wallet, amount, kind, note,
		client_request_id, received_amount, source_exchange_rate, target_exchange_rate)


# New clients use a new route so an older worker cannot silently discard the
# request/currency arguments and execute the former non-idempotent transfer.
record_money_transfer = transfer_money


@frappe.whitelist()
def get_owner_money_context(company=None):
	from . import owner_money
	return owner_money.context(company or get_default_company())


@frappe.whitelist(methods=["POST"])
def setup_owner_money(company=None):
	from . import owner_money
	_check_permission()
	return owner_money.configure(company or get_default_company(), create_accounts=True)


@frappe.whitelist(methods=["POST"])
def record_owner_money_movement(operation, wallet, amount, client_request_id, company=None, note=None, exchange_rate=None):
	from . import owner_money
	_check_permission()
	return owner_money.record(company or get_default_company(), operation, wallet, amount, client_request_id, note, exchange_rate)


@frappe.whitelist(methods=["POST"])
def get_owner_money_request_outcome(client_request_id, company=None):
	from . import owner_money
	_check_permission()
	return owner_money.outcome(company or get_default_company(), client_request_id)


@frappe.whitelist(methods=["POST"])
def get_transfer_request_outcome(client_request_id, company=None):
	_check_permission()
	return commands.outcome(client_request_id, company or get_default_company())


def _feed_period(period):
	from frappe.utils import add_days, get_first_day, get_last_day, getdate, add_months

	if period in (None, "", "all"):
		return None, None
	t = getdate(today())
	if period == "today":
		return t, t
	if period == "yesterday":
		y = add_days(t, -1)
		return y, y
	if period == "week":
		return add_days(t, -6), t
	if period == "month":
		return get_first_day(t), get_last_day(t)
	if period == "quarter":
		qm = ((t.month - 1) // 3) * 3 + 1
		first = getdate(f"{t.year}-{qm:02d}-01")
		return first, get_last_day(add_months(first, 2))
	return None, None


@frappe.whitelist()
def get_money_movements(wallet=None, period="week", from_date=None, to_date=None,
	op_type=None, direction=None, search=None, start=0, page_length=50, company=None, include_hidden=1):
	"""Permission-scoped history with whole-filter totals, independent of the page."""
	from erpnext.accounts.page.money_hub.movement_history import query_movements

	return query_movements(wallet=wallet, period=period, from_date=from_date, to_date=to_date,
		op_type=op_type, direction=direction, search=search, start=start,
		page_length=page_length, company=company, include_hidden=include_hidden)


@frappe.whitelist()
def get_money_feed(wallet=None, period="week", from_date=None, to_date=None,
	op_type=None, direction=None, search=None, limit=500, company=None):
	"""Legacy array contract; account legs, filtered before the requested limit."""
	from erpnext.accounts.page.money_hub.movement_history import query_movements

	return query_movements(wallet=wallet, period=period, from_date=from_date, to_date=to_date,
		op_type=op_type, direction=direction, search=search, page_length=limit,
		company=company, legacy=True)["rows"]


@frappe.whitelist()
def get_transaction_details(voucher_type, voucher_no, company=None):
	"""Read a permitted posted voucher behind the caller's cash/bank movements."""
	if not isinstance(voucher_type, str) or voucher_type not in {"Sales Invoice", "POS Invoice", "Purchase Invoice", "Payment Entry", "Journal Entry"}:
		frappe.throw(_("Unsupported money transaction type."))
	if not isinstance(voucher_no, str) or not voucher_no.strip():
		frappe.throw(_("Missing voucher parameters"))
	company = company or get_default_company()
	wallets = _read_wallets(company, include_hidden=True)
	wallet_accounts = {row.account: row for row in wallets if row.account}
	doc = frappe.get_doc(voucher_type, voucher_no)
	doc.check_permission("read")
	if doc.get("company") != company:
		frappe.throw(_("This transaction is outside the selected company."), frappe.PermissionError)
	if doc.docstatus != 1:
		frappe.throw(_("This transaction is no longer posted. Refresh account movements."))
	movements = frappe.get_list("GL Entry", filters={
		"company": company, "voucher_type": voucher_type, "voucher_no": voucher_no,
		"account": ["in", list(wallet_accounts)], "is_cancelled": 0,
	}, fields=["name", "account", "account_currency", "debit", "credit",
		"debit_in_account_currency", "credit_in_account_currency"],
		order_by="name asc", limit_page_length=0) if wallet_accounts else []
	if not movements:
		frappe.throw(_("No permitted account movement was found for this transaction."), frappe.PermissionError)
	company_currency = frappe.get_cached_value("Company", company, "default_currency")
	# A document read check does not confer access to its higher-permission fields.
	doc.apply_fieldlevel_read_permissions()
	currency = doc.get("currency") if voucher_type in {"Sales Invoice", "POS Invoice", "Purchase Invoice"} else company_currency

	def number(value):
		return flt(value) if value is not None else None

	account_names = {row.get("account") for row in doc.get("accounts") or []}
	account_names.update([doc.get("paid_from"), doc.get("paid_to")])
	account_names.discard(None)
	permitted_accounts = set(frappe.get_list("Account", filters={"company": company,
		"name": ["in", list(account_names)]}, pluck="name", limit_page_length=0)) if account_names else set()

	out = {
		"voucher_type": voucher_type,
		"voucher_no": voucher_no,
		"company": company,
		"company_currency": company_currency,
		"docstatus": doc.docstatus,
		"status": doc.get("status") or _("Submitted"),
		"posting_date": frappe.utils.formatdate(doc.get("posting_date"), "dd.mm.yyyy"),
		"posting_time": str(doc.get("posting_time") or "")[:5],
		"owner": frappe.utils.get_fullname(doc.owner),
		"currency": currency,
		"items": [],
		"payments": [],
		"references": [],
		"accounts": [],
		"remarks": doc.get("remarks") or doc.get("user_remark") or "",
		"movements": [{
			"gl_name": row.name, "account": row.account,
			"wallet": wallet_accounts[row.account].wallet_name,
			"currency": company_currency, "account_currency": row.account_currency,
			"debit": number(row.get("debit")), "credit": number(row.get("credit")),
			"account_debit": number(row.get("debit_in_account_currency")),
			"account_credit": number(row.get("credit_in_account_currency")),
		} for row in movements],
	}

	if voucher_type in ("Sales Invoice", "POS Invoice"):
		out["party_type"] = "Customer"
		out["party"] = doc.get("customer")
		out["party_name"] = doc.get("customer_name") or doc.get("customer")
		out["discount_amount"] = number(doc.get("discount_amount"))
		out["is_return"] = doc.get("is_return")
		for p in doc.get("payments") or []:
			if p.get("amount"):
				out["payments"].append({
					"mode_of_payment": p.get("mode_of_payment"),
					"amount": number(p.get("amount")), "currency": currency,
				})

	elif voucher_type == "Purchase Invoice":
		out["party_type"] = "Supplier"
		out["party"] = doc.get("supplier")
		out["party_name"] = doc.get("supplier_name") or doc.get("supplier")

	elif voucher_type == "Payment Entry":
		out.update(payment_type=doc.get("payment_type"), party_type=doc.get("party_type"),
			party=doc.get("party"), party_name=doc.get("party_name") or doc.get("party"),
			reference_no=doc.get("reference_no"))
		for account_field, amount_field, currency_field in (
			("paid_from", "paid_amount", "paid_from_account_currency"),
			("paid_to", "received_amount", "paid_to_account_currency"),
		):
			allowed = doc.get(account_field) in permitted_accounts
			out[account_field] = doc.get(account_field) if allowed else None
			out[amount_field] = number(doc.get(amount_field)) if allowed else None
			out[currency_field] = doc.get(currency_field) if allowed else None
		ref_currency = doc.get("paid_from_account_currency") if doc.get("payment_type") == "Receive" else doc.get("paid_to_account_currency")
		out["references"] = _transaction_references(doc.get("references") or [], ref_currency)
		out["references_restricted"] = len(out["references"]) < len(doc.get("references") or [])
		out["accounts_restricted"] = any(doc.get(field) and doc.get(field) not in permitted_accounts
			for field in ("paid_from", "paid_to"))

	elif voucher_type == "Journal Entry":
		out["total_debit"] = number(doc.get("total_debit"))
		out["voucher_type_name"] = doc.get("voucher_type")
		for acc in doc.get("accounts") or []:
			if acc.get("account") not in permitted_accounts:
				continue
			out["accounts"].append({
				"account": acc.get("account"), "currency": acc.get("account_currency"),
				"debit": number(acc.get("debit_in_account_currency")),
				"credit": number(acc.get("credit_in_account_currency")),
			})
		out["accounts_restricted"] = len(out["accounts"]) < len(doc.get("accounts") or [])

	if voucher_type in {"Sales Invoice", "POS Invoice", "Purchase Invoice"}:
		out["grand_total"] = number(doc.get("grand_total"))
		out["net_total"] = number(doc.get("net_total"))
		out["items"] = [{"item_code": item.get("item_code"), "item_name": item.get("item_name"),
			"qty": number(item.get("qty")), "rate": number(item.get("rate")),
			"amount": number(item.get("amount")), "uom": item.get("uom"), "currency": currency,
		} for item in doc.get("items") or []]

	return out


def _transaction_references(references, currency):
	"""Batch native source queries; a readable payment is not permission to every invoice."""
	allowed_types = {"Sales Invoice", "POS Invoice", "Purchase Invoice", "Sales Order", "Purchase Order",
		"Journal Entry", "Payment Entry", "Dunning", "Expense Claim", "Employee Advance", "Leave Encashment", "Gratuity"}
	readable = set()
	for doctype in {row.get("reference_doctype") for row in references} & allowed_types:
		if not frappe.has_permission(doctype, "read"):
			continue
		names = list({row.get("reference_name") for row in references if row.get("reference_doctype") == doctype and row.get("reference_name")})
		for offset in range(0, len(names), 200):
			readable.update((doctype, name) for name in frappe.get_list(doctype,
				filters={"name": ["in", names[offset:offset + 200]]}, pluck="name", limit_page_length=0))
	return [{"reference_doctype": row.get("reference_doctype"), "reference_name": row.get("reference_name"),
		"total_amount": flt(row.total_amount) if row.get("total_amount") is not None else None,
		"allocated_amount": flt(row.allocated_amount) if row.get("allocated_amount") is not None else None,
		"currency": currency,
	} for row in references if (row.get("reference_doctype"), row.get("reference_name")) in readable]


# ----- Taxes ---------------------------------------------------------------

def _get_settings(company):
	s = frappe.get_single("Money Hub Settings")
	if not s.company:
		s.company = company
	return s


def _tax_period(settings):
	from frappe.utils import get_first_day, get_last_day, getdate, add_months

	t = getdate(today())
	if settings.tax_regime == "Patent":
		if settings.patent_period == "Year":
			return getdate(f"{t.year}-01-01"), getdate(f"{t.year}-12-31")
		if settings.patent_period == "Quarter":
			qm = ((t.month - 1) // 3) * 3 + 1
			first = getdate(f"{t.year}-{qm:02d}-01")
			return first, get_last_day(add_months(first, 2))
	return get_first_day(t), get_last_day(t)


def _ensure_tax_account(settings, company):
	if settings.company != company or not settings.tax_account:
		frappe.throw(_("Configure a tax payment account for this company in the native settings first."))
	account = commands.account_doc(settings.tax_account, company, cash_bank=False)
	if account.root_type not in {"Expense", "Liability"}:
		frappe.throw(_("Select a configured tax liability or expense account."))
	if account.account_currency != frappe.get_cached_value("Company", company, "default_currency"):
		frappe.throw(_("Use the native accounting form for a foreign-currency tax account."))
	return account.name


def _turnover(company, start, end):
	return flt(frappe.db.sql(
		"""SELECT COALESCE(SUM(base_grand_total), 0) FROM `tabSales Invoice`
		WHERE docstatus = 1 AND company = %s AND posting_date BETWEEN %s AND %s""",
		(company, start, end),
	)[0][0])


def _input_vat(company, start, end):
	return flt(frappe.db.sql(
		"""SELECT COALESCE(SUM(base_total_taxes_and_charges), 0) FROM `tabPurchase Invoice`
		WHERE docstatus = 1 AND company = %s AND posting_date BETWEEN %s AND %s""",
		(company, start, end),
	)[0][0])


@frappe.whitelist()
def get_tax_summary(company=None):
	from frappe.utils import add_months, getdate

	company = company or get_default_company()
	s = _get_settings(company)
	t = getdate(today())
	roll_turnover = _turnover(company, add_months(t, -12), t)
	threshold = flt(s.vat_threshold)
	settings = {
		"tax_regime": s.tax_regime, "turnover_tax_rate": flt(s.turnover_tax_rate), "vat_rate": flt(s.vat_rate),
		"patent_amount": flt(s.patent_amount), "patent_period": s.patent_period, "vat_threshold": threshold,
	}
	out = {
		"settings": settings,
		"threshold": {
			"turnover_12m": roll_turnover,
			"threshold": threshold,
			"percent": round(roll_turnover / threshold * 100, 1) if threshold else 0,
		},
	}
	if not s.tax_regime:
		out["configured"] = False
		return out

	start, end = _tax_period(s)
	turnover = _turnover(company, start, end)
	if s.tax_regime == "Turnover Tax":
		accrued = turnover * flt(s.turnover_tax_rate) / 100
		detail = f"{flt(s.turnover_tax_rate)}% от выручки"
	elif s.tax_regime == "VAT":
		rate = flt(s.vat_rate)
		output_vat = turnover * rate / (100 + rate)
		accrued = max(0.0, output_vat - _input_vat(company, start, end))
		detail = f"НДС {rate}% (в цене) − входящий НДС"
	else:
		accrued = flt(s.patent_amount)
		detail = f"Патент: {flt(s.patent_amount)} за период"

	paid = 0.0
	if s.tax_account:
		paid = flt(frappe.db.sql(
			"""SELECT COALESCE(SUM(debit - credit), 0) FROM `tabGL Entry`
			WHERE account = %s AND is_cancelled = 0 AND posting_date BETWEEN %s AND %s""",
			(s.tax_account, start, end),
		)[0][0])

	out.update({
		"configured": True,
		"regime": s.tax_regime,
		"detail": detail,
		"period_start": frappe.utils.formatdate(start, "dd.mm.yyyy"),
		"period_end": frappe.utils.formatdate(end, "dd.mm.yyyy"),
		"turnover": turnover,
		"accrued": round(accrued, 2),
		"paid": round(paid, 2),
		"due": round(max(0.0, accrued - paid), 2),
	})
	return out


@frappe.whitelist(methods=["POST"])
def save_tax_settings(tax_regime, turnover_tax_rate=None, vat_rate=None, patent_amount=None,
		patent_period=None, vat_threshold=None, company=None):
	_check_permission()
	company = company or get_default_company()
	commands.company_doc(company)
	s = frappe.get_single("Money Hub Settings")
	s.check_permission("write")
	if s.company and s.company != company:
		frappe.throw(_("Tax settings belong to another company. Use the native settings form."), frappe.PermissionError)
	with commands.atomic():
		s.company = company
		s.tax_regime = tax_regime
		for field, value in (("turnover_tax_rate", turnover_tax_rate), ("vat_rate", vat_rate),
				("patent_amount", patent_amount), ("vat_threshold", vat_threshold)):
			if value is not None:
				parsed = commands.number(value, field)
				if parsed < 0 or (field.endswith("_rate") and parsed > 100):
					frappe.throw(_("Enter a non-negative amount or a rate between 0 and 100."))
				s.set(field, float(parsed))
		if patent_period:
			s.patent_period = patent_period
		s.save()
		return dict(company=company)


@frappe.whitelist(methods=["POST"])
def pay_tax(wallet, amount, company=None):
	"""Legacy tax payment; native accounting setup/authority is required."""
	_check_permission()
	company = company or get_default_company()
	company_record = commands.company_doc(company)
	_wallet, account = commands.wallet_doc(wallet, company)
	if account.account_currency != company_record.default_currency:
		frappe.throw(_("Use the native accounting form for foreign-currency tax payments."))
	amount = commands.number(amount, _("amount"), positive=True,
		precision=commands.currency_precision(company_record.default_currency))
	s = frappe.get_single("Money Hub Settings")
	s.check_permission("read")
	if not s.tax_regime:
		frappe.throw(_("Choose a tax regime first"))
	tax_account = _ensure_tax_account(s, company)
	if tax_account == account.name:
		frappe.throw(_("Choose different payment and tax accounts."))
	with commands.atomic():
		je = frappe.get_doc(dict(doctype="Journal Entry", voucher_type="Journal Entry", company=company,
			posting_date=today(), user_remark=f"MONEYHUB_TAX: {s.tax_regime}", accounts=[
				{"account": tax_account, "debit_in_account_currency": float(amount)},
				{"account": account.name, "credit_in_account_currency": float(amount)}]))
		je.check_permission("create")
		je.check_permission("submit")
		je.insert()
		je.submit()
		return dict(company=company, journal_entry=je.name)


def tax_for_range(company, start, end):
	"""Estimated tax accrued for an arbitrary date range under the chosen regime (0 if none chosen)."""
	from frappe.utils import date_diff

	s = _get_settings(company)
	if not s.tax_regime:
		return 0.0
	if s.tax_regime == "Turnover Tax":
		return _turnover(company, start, end) * flt(s.turnover_tax_rate) / 100
	if s.tax_regime == "VAT":
		rate = flt(s.vat_rate)
		return max(0.0, _turnover(company, start, end) * rate / (100 + rate) - _input_vat(company, start, end))
	months = {"Month": 1, "Quarter": 3, "Year": 12}.get(s.patent_period, 1)
	return flt(s.patent_amount) / months * (date_diff(end, start) + 1) / 30.4
