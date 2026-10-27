# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, today

from erpnext.accounts.page.expense_desk.expense_desk import ensure_default_payment_accounts
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
		frappe.throw(_("Only Store Managers and Owners can manage wallets."))


def _classify_account(account_name, account_type):
	if account_type == "Bank":
		return "Bank"
	if any(h in (account_name or "").lower() for h in SAFE_NAME_HINTS):
		return "Safe"
	return "Till"


def import_existing_accounts(company):
	"""First run: turn existing Cash/Bank leaf accounts into Money Wallets."""
	if frappe.db.count("Money Wallet", {"company": company}):
		return

	ensure_default_payment_accounts(company)

	accounts = frappe.db.get_all(
		"Account",
		filters={"company": company, "account_type": ["in", ["Cash", "Bank"]], "is_group": 0, "disabled": 0},
		fields=["name", "account_name", "account_type"],
		order_by="account_type asc, creation asc",
	)
	for idx, acc in enumerate(accounts):
		wtype = _classify_account(acc.account_name, acc.account_type)
		if frappe.db.exists("Money Wallet", acc.account_name):
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


def _today_movement(account):
	row = frappe.db.sql(
		"""SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) FROM `tabGL Entry`
		WHERE account = %s AND posting_date = %s AND is_cancelled = 0""",
		(account, today()),
	)[0]
	return flt(row[0]), flt(row[1])


@frappe.whitelist()
def get_money_hub_data(company=None, include_hidden=0):
	from erpnext.accounts.utils import get_balance_on

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	import_existing_accounts(company)

	filters = {"company": company}
	if not int(include_hidden or 0):
		filters["enabled"] = 1

	wallets = frappe.db.get_all(
		"Money Wallet",
		filters=filters,
		fields=[
			"name", "wallet_name", "wallet_type", "account", "mode_of_payment", "pos_profile",
			"accept_in_pos", "commission_percent", "icon", "color", "sort_order", "enabled",
		],
		order_by="sort_order asc, creation asc",
	)

	total = cash = non_cash = today_in = today_out = 0.0
	for w in wallets:
		w["balance"] = flt(get_balance_on(w.account, company=company)) if w.account else 0.0
		d, c = _today_movement(w.account) if w.account else (0.0, 0.0)
		w["today_in"], w["today_out"] = d, c
		if w.enabled:
			total += w["balance"]
			today_in += d
			today_out += c
			if w.wallet_type in ("Till", "Safe"):
				cash += w["balance"]
			else:
				non_cash += w["balance"]

	return {
		"company": company,
		"currency": currency,
		"wallets": wallets,
		"totals": {
			"total": total,
			"cash": cash,
			"non_cash": non_cash,
			"today_in": today_in,
			"today_out": today_out,
		},
	}


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
	if not any(r.company == company for r in mop.accounts):
		mop.append("accounts", {"company": company, "default_account": account})
	mop.flags.ignore_permissions = True
	mop.save()
	return mop.name


def _add_to_pos_profiles(mop, company):
	"""Expose a Mode of Payment in every active POS Profile so POS Awesome shows it."""
	for prof in frappe.db.get_all("POS Profile", filters={"company": company, "disabled": 0}, pluck="name"):
		doc = frappe.get_doc("POS Profile", prof)
		if any(p.mode_of_payment == mop for p in doc.payments):
			continue
		doc.append("payments", {"mode_of_payment": mop, "default": 0})
		doc.flags.ignore_permissions = True
		doc.save()


def _post_opening_balance(wallet_account, amount, company, wallet_name):
	temp = frappe.db.get_value(
		"Account", {"company": company, "account_type": "Temporary", "is_group": 0}, "name"
	)
	if not temp:
		frappe.throw(_("Opening balance account (Temporary Opening) not found for {0}").format(company))
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
	je.flags.ignore_permissions = True
	je.insert()
	je.submit()


@frappe.whitelist()
def create_wallet(wallet_name, wallet_type, opening_balance=0, accept_in_pos=0, commission_percent=0, company=None):
	"""30-second wallet creator: Account + Mode of Payment + Money Wallet in one call."""
	_check_permission()
	company = company or get_default_company()
	wallet_name = (wallet_name or "").strip()
	if not wallet_name:
		frappe.throw(_("Wallet name is required"))
	if wallet_type not in WALLET_TYPES:
		frappe.throw(_("Unknown wallet type"))
	if frappe.db.exists("Money Wallet", wallet_name):
		frappe.throw(_("Wallet '{0}' already exists").format(wallet_name))

	cfg = WALLET_TYPES[wallet_type]
	opening_balance = flt(opening_balance)
	accept_in_pos = int(accept_in_pos or 0)

	parent = _get_parent_group(company, cfg["group"])
	account_doc = frappe.get_doc({
		"doctype": "Account",
		"company": company,
		"account_name": wallet_name,
		"account_type": cfg["account_type"],
		"parent_account": parent,
		"is_group": 0,
	})
	account_doc.flags.ignore_permissions = True
	account_doc.insert()

	mop = None
	if accept_in_pos:
		mop = _create_mode_of_payment(wallet_name, cfg["mop_type"], account_doc.name, company)
		_add_to_pos_profiles(mop, company)

	if opening_balance > 0:
		_post_opening_balance(account_doc.name, opening_balance, company, wallet_name)

	max_order = frappe.db.sql("SELECT COALESCE(MAX(sort_order), 0) FROM `tabMoney Wallet`")[0][0]
	wallet = frappe.get_doc({
		"doctype": "Money Wallet",
		"wallet_name": wallet_name,
		"wallet_type": wallet_type,
		"company": company,
		"account": account_doc.name,
		"mode_of_payment": mop,
		"accept_in_pos": accept_in_pos,
		"commission_percent": flt(commission_percent),
		"icon": cfg["icon"],
		"color": cfg["color"],
		"sort_order": int(max_order) + 1,
		"enabled": 1,
	})
	wallet.flags.ignore_permissions = True
	wallet.insert()
	frappe.db.commit()
	return get_money_hub_data(company)


@frappe.whitelist()
def update_wallet(name, wallet_name=None, commission_percent=None, enabled=None, company=None):
	"""Rename, change commission, or hide/show a wallet."""
	_check_permission()
	doc = frappe.get_doc("Money Wallet", name)
	doc.flags.ignore_permissions = True
	if commission_percent is not None:
		doc.commission_percent = flt(commission_percent)
	if enabled is not None:
		doc.enabled = int(enabled)
	doc.save()
	new_name = (wallet_name or "").strip()
	if new_name and new_name != doc.name:
		frappe.rename_doc("Money Wallet", doc.name, new_name)
		frappe.db.set_value("Money Wallet", new_name, "wallet_name", new_name)
	frappe.db.commit()
	return get_money_hub_data(company or doc.company, include_hidden=0)
