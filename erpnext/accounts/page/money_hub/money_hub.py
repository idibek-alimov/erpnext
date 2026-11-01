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
	"""Sync all existing Cash/Bank leaf accounts into Money Wallets."""
	ensure_default_payment_accounts(company)

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
	pos_tills = []
	bank_wallets = []
	safes = []

	for w in wallets:
		w["balance"] = flt(get_balance_on(w.account, company=company)) if w.account else 0.0
		d, c = _today_movement(w.account) if w.account else (0.0, 0.0)
		w["today_in"], w["today_out"] = d, c

		if w.get("enabled", 1):
			total += w["balance"]
			today_in += d
			today_out += c

		wtype = (w.get("wallet_type") or "").strip()
		if wtype == "Till":
			cash += w["balance"]
			pos_tills.append(w)
		elif wtype == "Safe":
			cash += w["balance"]
			safes.append(w)
		else:
			non_cash += w["balance"]
			bank_wallets.append(w)

	return {
		"company": company,
		"currency": currency,
		"wallets": wallets,
		"pos_tills": pos_tills,
		"bank_wallets": bank_wallets,
		"safes": safes,
		"totals": {
			"total": total,
			"cash": cash,
			"non_cash": non_cash,
			"today_in": today_in,
			"today_out": today_out,
			"net_today": today_in - today_out,
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


def sync_pos_profiles(company):
	"""Ensure POS Profiles contain ONLY active Money Wallets with accept_in_pos=1."""
	wallets = frappe.db.get_all(
		"Money Wallet",
		filters={"company": company, "enabled": 1, "accept_in_pos": 1},
		fields=["name", "wallet_name", "wallet_type", "account", "mode_of_payment"],
		order_by="sort_order asc, creation asc",
	)
	allowed_mops = [w.mode_of_payment for w in wallets if w.mode_of_payment]

	# Always ensure at least default Cash MOP exists
	if not any(w.wallet_type == "Till" for w in wallets):
		default_cash_mop = frappe.db.get_value("Mode of Payment", {"type": "Cash", "enabled": 1}, "name") or "Cash"
		if default_cash_mop not in allowed_mops:
			allowed_mops.insert(0, default_cash_mop)

	for prof in frappe.db.get_all("POS Profile", filters={"company": company, "disabled": 0}, pluck="name"):
		doc = frappe.get_doc("POS Profile", prof)
		existing_mops = [p.mode_of_payment for p in doc.payments]

		filtered_payments = [p for p in doc.payments if p.mode_of_payment in allowed_mops]
		new_mops = [mop for mop in allowed_mops if mop not in existing_mops]

		# If nothing changed, do not re-save POS Profile (prevents flushing site Redis cache and triggering payment refresh warnings)
		if len(filtered_payments) == len(existing_mops) and not new_mops:
			continue

		doc.payments = filtered_payments
		for mop in new_mops:
			doc.append("payments", {"mode_of_payment": mop, "default": 0})

		# Ensure one default
		if doc.payments and not any(p.default for p in doc.payments):
			doc.payments[0].default = 1

		doc.flags.ignore_permissions = True
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
	
	sync_pos_profiles(company)
	frappe.db.commit()
	return get_money_hub_data(company)


@frappe.whitelist()
def update_wallet(name, wallet_name=None, commission_percent=None, enabled=None, accept_in_pos=None, company=None):
	"""Rename, change commission, toggle POS acceptance, or hide/show a wallet."""
	_check_permission()
	doc = frappe.get_doc("Money Wallet", name)
	doc.flags.ignore_permissions = True
	company = company or doc.company
	if commission_percent is not None:
		doc.commission_percent = flt(commission_percent)
	if enabled is not None:
		doc.enabled = int(enabled)
	if accept_in_pos is not None:
		doc.accept_in_pos = int(accept_in_pos)
		if doc.accept_in_pos and not doc.mode_of_payment and doc.account:
			cfg = WALLET_TYPES.get(doc.wallet_type, {"mop_type": "Bank"})
			doc.mode_of_payment = _create_mode_of_payment(doc.wallet_name, cfg["mop_type"], doc.account, company)
	doc.save()
	new_name = (wallet_name or "").strip()
	if new_name and new_name != doc.name:
		frappe.rename_doc("Money Wallet", doc.name, new_name)
		frappe.db.set_value("Money Wallet", new_name, "wallet_name", new_name)
	
	sync_pos_profiles(company)
	frappe.db.commit()
	return get_money_hub_data(company, include_hidden=0)


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
	from frappe.utils import add_days, get_first_day, get_last_day, getdate, add_months

	t = getdate(today())
	if period == "today":
		return t, t
	if period == "yesterday":
		y = add_days(t, -1)
		return y, y
	if period == "week":
		return add_days(t, -7), t
	if period == "month":
		return get_first_day(t), get_last_day(t)
	if period == "quarter":
		qm = ((t.month - 1) // 3) * 3 + 1
		first = getdate(f"{t.year}-{qm:02d}-01")
		return first, get_last_day(add_months(first, 2))
	return None, None


@frappe.whitelist()
def get_money_feed(wallet=None, period="week", from_date=None, to_date=None, op_type=None, direction=None, search=None, limit=500, company=None):
	"""Chronological stream of money movements with rich categorization and party metadata."""
	company = company or get_default_company()
	wallets = frappe.db.get_all("Money Wallet", filters={"company": company}, fields=["name", "wallet_name", "account", "wallet_type", "icon", "color"])
	acc_map = {w.account: w for w in wallets if w.account}
	if wallet:
		wacc = frappe.db.get_value("Money Wallet", wallet, "account")
		accounts = [wacc] if wacc else []
	else:
		accounts = list(acc_map)
	if not accounts:
		return []

	conds, vals = ["account IN %(accounts)s", "is_cancelled = 0"], {"accounts": accounts}

	if from_date and to_date:
		conds.append("posting_date BETWEEN %(from_date)s AND %(to_date)s")
		vals.update({"from_date": from_date, "to_date": to_date})
	elif from_date:
		conds.append("posting_date >= %(from_date)s")
		vals["from_date"] = from_date
	elif to_date:
		conds.append("posting_date <= %(to_date)s")
		vals["to_date"] = to_date
	elif period and period != "all":
		start, end = _feed_period(period)
		if start:
			conds.append("posting_date BETWEEN %(start)s AND %(end)s")
			vals.update({"start": start, "end": end})

	rows = frappe.db.sql(
		f"""SELECT name, posting_date, creation, account, debit, credit, voucher_type, voucher_no, owner, remarks, against
		FROM `tabGL Entry` WHERE {' AND '.join(conds)}
		ORDER BY posting_date DESC, creation DESC LIMIT {int(limit)}""",
		vals,
		as_dict=True,
	)
	if not rows:
		return []

	pe_names = [r.voucher_no for r in rows if r.voucher_type == "Payment Entry"]
	je_names = [r.voucher_no for r in rows if r.voucher_type == "Journal Entry"]
	si_names = [r.voucher_no for r in rows if r.voucher_type == "Sales Invoice"]
	pos_names = [r.voucher_no for r in rows if r.voucher_type == "POS Invoice"]
	pi_names = [r.voucher_no for r in rows if r.voucher_type == "Purchase Invoice"]

	pe_info = {}
	if pe_names:
		for p in frappe.db.get_all("Payment Entry", filters={"name": ["in", pe_names]}, fields=["name", "payment_type", "party_type", "party", "party_name", "remarks"]):
			pe_info[p.name] = p

	je_info = {}
	if je_names:
		for j in frappe.db.get_all("Journal Entry", filters={"name": ["in", je_names]}, fields=["name", "voucher_type", "user_remark"]):
			je_info[j.name] = j

	cust_info = {}
	if si_names:
		for s in frappe.db.get_all("Sales Invoice", filters={"name": ["in", si_names]}, fields=["name", "customer", "customer_name"]):
			cust_info[s.name] = s.customer_name or s.customer
	if pos_names:
		for p in frappe.db.get_all("POS Invoice", filters={"name": ["in", pos_names]}, fields=["name", "customer", "customer_name"]):
			cust_info[p.name] = p.customer_name or p.customer

	supp_info = {}
	if pi_names:
		for p in frappe.db.get_all("Purchase Invoice", filters={"name": ["in", pi_names]}, fields=["name", "supplier", "supplier_name"]):
			supp_info[p.name] = p.supplier_name or p.supplier

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
		label, icon, op_cat, party, detail_notes = _feed_classify(r, pe_info, je_info, cust_info, supp_info, exp_by_voucher)
		debit = flt(r.debit)
		credit = flt(r.credit)
		amount = debit - credit
		w = acc_map.get(r.account)

		feed.append({
			"gl_name": r.name,
			"date": frappe.utils.formatdate(r.posting_date, "dd.mm.yyyy"),
			"raw_date": str(r.posting_date),
			"time": r.creation.strftime("%H:%M") if r.creation else "",
			"wallet": w.wallet_name if w else r.account,
			"wallet_icon": w.icon if w else "💰",
			"wallet_color": w.color if w else "#4a5568",
			"label": label,
			"icon": icon,
			"op_type": op_cat,
			"party": party,
			"notes": detail_notes or r.remarks or "",
			"debit": debit,
			"credit": credit,
			"amount": amount,
			"voucher_type": r.voucher_type,
			"voucher_no": r.voucher_no,
			"user": frappe.utils.get_fullname(r.owner),
		})

	# Python filtering
	if op_type and op_type != "all":
		feed = [f for f in feed if f["op_type"] == op_type]

	if direction == "in":
		feed = [f for f in feed if f["debit"] > 0]
	elif direction == "out":
		feed = [f for f in feed if f["credit"] > 0]

	if search and search.strip():
		s = search.strip().lower()
		feed = [
			f for f in feed
			if s in f["label"].lower()
			or s in (f["wallet"] or "").lower()
			or s in f["voucher_no"].lower()
			or s in (f["party"] or "").lower()
			or s in (f["notes"] or "").lower()
			or s in f["user"].lower()
		]

	return feed


def _feed_classify(r, pe_info, je_info, cust_info, supp_info, exp_by_voucher):
	vt = r.voucher_type
	vno = r.voucher_no

	if vt in ("Sales Invoice", "POS Invoice"):
		party = cust_info.get(vno) or "Покупатель"
		if flt(r.credit) > flt(r.debit):
			return "Возврат товара", "↩️", "sales", party, "Возврат средств клиенту"
		return "Продажа (Розница)", "🛒", "sales", party, "Оплата за покупку"

	if vt == "Purchase Invoice":
		party = supp_info.get(vno) or "Поставщик"
		return "Закупка товара", "📦", "supplier", party, "Поступление товара / Накладная"

	if vt == "Payment Entry":
		if vno in exp_by_voucher:
			cat = exp_by_voucher[vno]
			return f"Расход: {cat}", "💸", "expense", cat, "Операционный расход"
		pe = pe_info.get(vno)
		if pe:
			party = pe.party_name or pe.party or ""
			if pe.payment_type == "Internal Transfer":
				rem = (pe.remarks or "Перевод").split(" Amount")[0]
				return rem, "🔄", "transfer", "", pe.remarks or "Внутренний перевод"
			if pe.payment_type == "Receive":
				return f"Оплата от клиента: {party}" if party else "Оплата от клиента", "⬇️", "sales", party, pe.remarks or ""
			if pe.payment_type == "Pay":
				return f"Оплата поставщику: {party}" if party else "Оплата поставщику", "⬆️", "supplier", party, pe.remarks or ""
		return "Платёж", "💳", "other", "", r.remarks or ""

	if vt == "Journal Entry":
		if vno in exp_by_voucher:
			cat = exp_by_voucher[vno]
			return f"Расход: {cat}", "💸", "expense", cat, "Операционный расход"
		je = je_info.get(vno)
		remark = (je.user_remark if je else "") or (r.remarks or "")
		if remark.startswith("MONEYHUB_TAX") or "налог" in remark.lower() or "tax" in remark.lower():
			return "Оплата налога", "🏛️", "tax", "Налоговая служба", remark
		if je and je.voucher_type == "Opening Entry":
			return "Начальный остаток", "🏁", "other", "", "Ввод начального сальдо"
		return "Корректировка / Проводка", "✏️", "other", "", remark

	return vt, "•", "other", "", r.remarks or ""


@frappe.whitelist()
def get_transaction_details(voucher_type, voucher_no, company=None):
	"""Returns comprehensive structured details for Option A Modal."""
	company = company or get_default_company()
	if not voucher_type or not voucher_no:
		frappe.throw(_("Missing voucher parameters"))

	if not frappe.db.exists(voucher_type, voucher_no):
		frappe.throw(_("Document {0} {1} not found").format(voucher_type, voucher_no))

	doc = frappe.get_doc(voucher_type, voucher_no)
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	out = {
		"voucher_type": voucher_type,
		"voucher_no": voucher_no,
		"docstatus": doc.docstatus,
		"status": getattr(doc, "status", "Submitted" if doc.docstatus == 1 else "Draft"),
		"posting_date": frappe.utils.formatdate(getattr(doc, "posting_date", today()), "dd.mm.yyyy"),
		"posting_time": str(getattr(doc, "posting_time", ""))[:5],
		"owner": frappe.utils.get_fullname(doc.owner),
		"currency": currency,
		"items": [],
		"payments": [],
		"references": [],
		"accounts": [],
		"remarks": getattr(doc, "remarks", "") or getattr(doc, "user_remark", "") or "",
	}

	if voucher_type in ("Sales Invoice", "POS Invoice"):
		out["party_type"] = "Customer"
		out["party"] = getattr(doc, "customer", "")
		out["party_name"] = getattr(doc, "customer_name", doc.customer or "")
		out["grand_total"] = flt(getattr(doc, "grand_total", 0))
		out["net_total"] = flt(getattr(doc, "net_total", 0))
		out["discount_amount"] = flt(getattr(doc, "discount_amount", 0))
		out["is_return"] = getattr(doc, "is_return", 0)

		for item in getattr(doc, "items", []):
			out["items"].append({
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": flt(item.qty),
				"rate": flt(item.rate),
				"amount": flt(item.amount),
				"uom": getattr(item, "uom", "шт"),
			})

		for p in getattr(doc, "payments", []):
			if flt(p.amount) > 0:
				out["payments"].append({
					"mode_of_payment": p.mode_of_payment,
					"amount": flt(p.amount),
				})

	elif voucher_type == "Purchase Invoice":
		out["party_type"] = "Supplier"
		out["party"] = getattr(doc, "supplier", "")
		out["party_name"] = getattr(doc, "supplier_name", doc.supplier or "")
		out["grand_total"] = flt(getattr(doc, "grand_total", 0))
		out["net_total"] = flt(getattr(doc, "net_total", 0))

		for item in getattr(doc, "items", []):
			out["items"].append({
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": flt(item.qty),
				"rate": flt(item.rate),
				"amount": flt(item.amount),
				"uom": getattr(item, "uom", "шт"),
			})

	elif voucher_type == "Payment Entry":
		out["payment_type"] = doc.payment_type
		out["party_type"] = getattr(doc, "party_type", "")
		out["party"] = getattr(doc, "party", "")
		out["party_name"] = getattr(doc, "party_name", doc.party or "")
		out["paid_amount"] = flt(doc.paid_amount)
		out["received_amount"] = flt(doc.received_amount)
		out["paid_from"] = doc.paid_from
		out["paid_to"] = doc.paid_to
		out["reference_no"] = getattr(doc, "reference_no", "")

		for ref in getattr(doc, "references", []):
			out["references"].append({
				"reference_doctype": ref.reference_doctype,
				"reference_name": ref.reference_name,
				"total_amount": flt(ref.total_amount),
				"allocated_amount": flt(ref.allocated_amount),
			})

	elif voucher_type == "Journal Entry":
		out["total_debit"] = flt(getattr(doc, "total_debit", 0))
		out["voucher_type_name"] = getattr(doc, "voucher_type", "Journal Entry")

		for acc in getattr(doc, "accounts", []):
			out["accounts"].append({
				"account": acc.account,
				"debit": flt(getattr(acc, "debit_in_account_currency", getattr(acc, "debit", 0))),
				"credit": flt(getattr(acc, "credit_in_account_currency", getattr(acc, "credit", 0))),
			})

	return out


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
