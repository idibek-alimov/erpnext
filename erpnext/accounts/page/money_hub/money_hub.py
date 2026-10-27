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


# ---------------------------------------------------------------------------
# Step 2: Transfers, Money Feed, Taxes
# ---------------------------------------------------------------------------

TRANSFER_KINDS = ("Инкассация", "Пополнение", "Снятие", "Обычный перевод")


@frappe.whitelist()
def transfer_money(from_wallet, to_wallet, amount, kind="Обычный перевод", note=None, company=None):
	"""1-click internal transfer / инкассация between two wallets (Payment Entry, Internal Transfer)."""
	_check_permission()
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than 0"))
	if from_wallet == to_wallet:
		frappe.throw(_("Choose two different wallets"))
	if kind not in TRANSFER_KINDS:
		kind = "Обычный перевод"

	src = frappe.db.get_value("Money Wallet", from_wallet, "account")
	dst = frappe.db.get_value("Money Wallet", to_wallet, "account")
	if not src or not dst:
		frappe.throw(_("Wallet account not found"))

	remarks = f"[{kind}] {from_wallet} → {to_wallet}"
	if note:
		remarks += f": {note}"

	pe = frappe.get_doc({
		"doctype": "Payment Entry",
		"payment_type": "Internal Transfer",
		"company": company,
		"posting_date": today(),
		"paid_from": src,
		"paid_to": dst,
		"paid_amount": amount,
		"received_amount": amount,
		"source_exchange_rate": 1,
		"target_exchange_rate": 1,
		"reference_no": f"MH-{frappe.utils.now_datetime().strftime('%Y%m%d%H%M%S')}",
		"reference_date": today(),
		"custom_remarks": 1,
		"remarks": remarks,
	})
	pe.flags.ignore_permissions = True
	pe.insert()
	pe.submit()
	frappe.db.commit()
	return get_money_hub_data(company)


def _feed_period(period):
	from frappe.utils import add_days, get_first_day, get_last_day, getdate

	t = getdate(today())
	if period == "today":
		return t, t
	if period == "week":
		return add_days(t, -7), t
	if period == "month":
		return get_first_day(t), get_last_day(t)
	return None, None


@frappe.whitelist()
def get_money_feed(wallet=None, period="week", search=None, limit=100, company=None):
	"""Chronological stream of every money movement through wallets with human labels."""
	company = company or get_default_company()
	wallets = frappe.db.get_all("Money Wallet", filters={"company": company}, fields=["name", "wallet_name", "account"])
	acc_map = {w.account: w.wallet_name for w in wallets if w.account}
	if wallet:
		wacc = frappe.db.get_value("Money Wallet", wallet, "account")
		accounts = [wacc] if wacc else []
	else:
		accounts = list(acc_map)
	if not accounts:
		return []

	conds, vals = ["account IN %(accounts)s", "is_cancelled = 0"], {"accounts": accounts}
	start, end = _feed_period(period)
	if start:
		conds.append("posting_date BETWEEN %(start)s AND %(end)s")
		vals.update({"start": start, "end": end})

	rows = frappe.db.sql(
		f"""SELECT name, posting_date, creation, account, debit, credit, voucher_type, voucher_no, owner
		FROM `tabGL Entry` WHERE {' AND '.join(conds)}
		ORDER BY posting_date DESC, creation DESC LIMIT {int(limit)}""",
		vals,
		as_dict=True,
	)
	if not rows:
		return []

	pe_names = [r.voucher_no for r in rows if r.voucher_type == "Payment Entry"]
	je_names = [r.voucher_no for r in rows if r.voucher_type == "Journal Entry"]
	pe_info = {}
	if pe_names:
		for p in frappe.db.get_all("Payment Entry", filters={"name": ["in", pe_names]}, fields=["name", "payment_type", "party", "remarks"]):
			pe_info[p.name] = p
	je_info = {}
	if je_names:
		for j in frappe.db.get_all("Journal Entry", filters={"name": ["in", je_names]}, fields=["name", "voucher_type", "user_remark"]):
			je_info[j.name] = j
	exp_by_voucher = {}
	if pe_names or je_names:
		for e in frappe.db.sql(
			"""SELECT expense_category, payment_entry, journal_entry FROM `tabQuick Expense`
			WHERE docstatus = 1 AND (payment_entry IN %(pe)s OR journal_entry IN %(je)s)""",
			{"pe": pe_names or [""], "je": je_names or [""]},
			as_dict=True,
		):
			exp_by_voucher[e.payment_entry or e.journal_entry] = e.expense_category

	feed = []
	for r in rows:
		label, icon = _feed_label(r, pe_info, je_info, exp_by_voucher)
		amount = flt(r.debit) - flt(r.credit)
		feed.append({
			"date": frappe.utils.formatdate(r.posting_date, "dd.mm.yyyy"),
			"time": r.creation.strftime("%H:%M") if r.creation else "",
			"wallet": acc_map.get(r.account),
			"label": label,
			"icon": icon,
			"amount": amount,
			"voucher_type": r.voucher_type,
			"voucher_no": r.voucher_no,
			"user": frappe.utils.get_fullname(r.owner),
		})
	if search and search.strip():
		s = search.strip().lower()
		feed = [f for f in feed if s in f["label"].lower() or s in (f["wallet"] or "").lower() or s in f["voucher_no"].lower()]
	return feed


def _feed_label(r, pe_info, je_info, exp_by_voucher):
	vt = r.voucher_type
	if vt in ("Sales Invoice", "POS Invoice"):
		return ("Возврат" if flt(r.credit) > flt(r.debit) else "Продажа"), "🛒"
	if vt == "Purchase Invoice":
		return "Закупка", "📦"
	if vt == "Payment Entry":
		if r.voucher_no in exp_by_voucher:
			return f"Расход: {exp_by_voucher[r.voucher_no]}", "💸"
		pe = pe_info.get(r.voucher_no)
		if pe:
			if pe.payment_type == "Internal Transfer":
				return (pe.remarks or "Перевод").split(" Amount")[0], "🔄"
			if pe.payment_type == "Receive":
				return f"Оплата от клиента{': ' + pe.party if pe.party else ''}", "⬇️"
			return f"Оплата поставщику{': ' + pe.party if pe.party else ''}", "⬆️"
		return "Платёж", "💳"
	if vt == "Journal Entry":
		if r.voucher_no in exp_by_voucher:
			return f"Расход: {exp_by_voucher[r.voucher_no]}", "💸"
		je = je_info.get(r.voucher_no)
		remark = (je.user_remark if je else "") or ""
		if remark.startswith("MONEYHUB_TAX"):
			return "Налог", "🏛️"
		if je and je.voucher_type == "Opening Entry":
			return "Начальный остаток", "🏁"
		return "Корректировка", "✏️"
	return vt, "•"


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
	if settings.tax_account and frappe.db.exists("Account", settings.tax_account):
		return settings.tax_account
	existing = frappe.db.get_value("Account", {"company": company, "account_name": "Налоги (Tax)", "is_group": 0}, "name")
	if existing:
		return existing
	parent = frappe.db.get_value("Account", {"company": company, "account_name": "Indirect Expenses", "is_group": 1}, "name") \
		or frappe.db.get_value("Account", {"company": company, "root_type": "Expense", "is_group": 1}, "name")
	acc = frappe.get_doc({
		"doctype": "Account", "company": company, "account_name": "Налоги (Tax)",
		"parent_account": parent, "is_group": 0, "account_type": "Tax",
	})
	acc.flags.ignore_permissions = True
	acc.insert()
	return acc.name


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


@frappe.whitelist()
def save_tax_settings(tax_regime, turnover_tax_rate=None, vat_rate=None, patent_amount=None,
		patent_period=None, vat_threshold=None, company=None):
	_check_permission()
	company = company or get_default_company()
	s = frappe.get_single("Money Hub Settings")
	s.company = company
	s.tax_regime = tax_regime
	if turnover_tax_rate is not None:
		s.turnover_tax_rate = flt(turnover_tax_rate)
	if vat_rate is not None:
		s.vat_rate = flt(vat_rate)
	if patent_amount is not None:
		s.patent_amount = flt(patent_amount)
	if patent_period:
		s.patent_period = patent_period
	if vat_threshold is not None:
		s.vat_threshold = flt(vat_threshold)
	s.tax_account = _ensure_tax_account(s, company)
	s.flags.ignore_permissions = True
	s.save()
	frappe.db.commit()
	return get_tax_summary(company)


@frappe.whitelist()
def pay_tax(wallet, amount, company=None):
	"""Record a tax payment from a wallet (Journal Entry debiting the tax account)."""
	_check_permission()
	company = company or get_default_company()
	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Amount must be greater than 0"))
	s = _get_settings(company)
	if not s.tax_regime:
		frappe.throw(_("Choose a tax regime first"))
	tax_account = _ensure_tax_account(s, company)
	wallet_account = frappe.db.get_value("Money Wallet", wallet, "account")
	if not wallet_account:
		frappe.throw(_("Wallet account not found"))
	je = frappe.get_doc({
		"doctype": "Journal Entry",
		"voucher_type": "Journal Entry",
		"company": company,
		"posting_date": today(),
		"user_remark": f"MONEYHUB_TAX: {s.tax_regime}",
		"accounts": [
			{"account": tax_account, "debit_in_account_currency": amount},
			{"account": wallet_account, "credit_in_account_currency": amount},
		],
	})
	je.flags.ignore_permissions = True
	je.insert()
	je.submit()
	if s.tax_account != tax_account:
		frappe.db.set_single_value("Money Hub Settings", "tax_account", tax_account)
	frappe.db.commit()
	return {"hub": get_money_hub_data(company), "tax": get_tax_summary(company)}
