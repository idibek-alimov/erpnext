"""Supplier detail built from the same scoped balances and inventory as the hub."""

from collections import defaultdict
import math

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from erpnext.buying.page.supplier_hub.supplier_data import batched_rows, load_supplier_context, readable
from erpnext.buying.page.supplier_hub.supplier_revision import current_revision


def paginate(rows, page=1, page_size=20):
	page_size = min(100, max(1, cint(page_size) or 20))
	page = min(max(1, cint(page)), max(1, math.ceil(len(rows) / page_size)))
	return dict(rows=rows[(page - 1) * page_size:page * page_size], total=len(rows), page=page, page_size=page_size)


def invoice_rows(context):
	"""Allocate native outstanding terms to their source voucher, retaining old debt."""
	balances = defaultdict(list)
	for row in context["payables"]:
		balances[(row.get("voucher_type"), row.get("voucher_no"))].append(row)
	rows = []
	for invoice in context["invoices"]:
		terms = balances.pop(("Purchase Invoice", invoice.name), [])
		positive = [t for t in terms if flt(t.get("outstanding")) > 0]
		due = min((getdate(t["due_date"]) for t in positive if t.get("due_date")), default=None)
		outstanding = sum(max(flt(t.get("outstanding")), 0) for t in terms) if context["can_payables"] else None
		rows.append(dict(name=invoice.name, doctype="Purchase Invoice", posting_date=str(invoice.posting_date),
			bill_no=invoice.bill_no or "", amount=flt(invoice.base_grand_total), outstanding=outstanding,
			payment_deadline_not_agreed=bool(invoice.get("payment_deadline_not_agreed")),
			due_date=str(due or invoice.due_date) if due or invoice.due_date else None,
			days_overdue=max(0, (context["end"] - due).days) if due else 0,
			is_return=bool(invoice.is_return), is_opening=invoice.is_opening == "Yes",
			can_pay=bool(outstanding and not invoice.is_return and invoice.currency == context["currency"]
				and invoice.party_account_currency == context["currency"])))
	# Opening balances and adjustments can originate in journals or Payment Entries.
	for (doctype, name), terms in balances.items():
		positive = [t for t in terms if flt(t.get("outstanding")) > 0]
		if not positive:
			continue
		due = min((getdate(t["due_date"]) for t in positive if t.get("due_date")), default=None)
		rows.append(dict(name=name, doctype=doctype, posting_date=str(positive[0].get("posting_date") or ""),
			bill_no="", amount=None, outstanding=sum(flt(t.get("outstanding")) for t in positive),
			due_date=str(due) if due else None, days_overdue=max(0, (context["end"] - due).days) if due else 0,
			is_return=False, is_opening=False, can_pay=False))
	return sorted(rows, key=lambda r: (r["days_overdue"], r["posting_date"], r["name"]), reverse=True)


def product_rows(context, supplier):
	groups = defaultdict(list)
	for code in context["links"].get(supplier, set()):
		item = context["items"][code]
		groups[item.variant_of or code].append(item)
	rows = []
	for model, items in groups.items():
		parent = context["items"].get(model) or items[0]
		units = {i.stock_uom for i in items}
		qty = sum(flt(context["stock"].get(i.name, {}).get("qty")) for i in items)
		value = sum(flt(context["stock"].get(i.name, {}).get("value")) for i in items)
		rows.append(dict(name=parent.name, item_name=parent.item_name, item_group=parent.item_group,
			code=parent.custom_short_code or parent.name, variants=len(items), disabled=bool(parent.disabled),
			stock_uom=next(iter(units)) if len(units) == 1 else None,
			stock_qty=qty if len(units) == 1 else None, stock_value=value,
			valuation_rate=value / qty if len(units) == 1 and qty > 0 else None,
			search=" ".join([model, parent.item_name or ""] + [i.name for i in items]).casefold()))
	return sorted(rows, key=lambda r: (r["item_name"] or r["name"]).casefold())


def payment_rows(context):
	rows = []
	for payment in context["payments"]:
		refund = payment.payment_type == "Receive"
		rows.append(dict(name=payment.name, posting_date=str(payment.posting_date),
			amount=-flt(payment.base_received_amount) if refund else flt(payment.base_paid_amount),
			is_refund=refund, mode_of_payment=payment.mode_of_payment or "",
			account=payment.paid_to if refund else payment.paid_from,
			reference_no=payment.reference_no or "", remarks=payment.remarks or "", owner=payment.owner))
	return sorted(rows, key=lambda r: (r["posting_date"], r["name"]), reverse=True)


def filter_rows(rows, tab, search, status, start, end, date_from=None, date_to=None):
	term = (search or "").strip().casefold()
	result = []
	for row in rows:
		if term and not any(term in str(row.get(k) or "").casefold() for k in
			("name", "bill_no", "item_name", "code", "item_group", "search", "reference_no", "remarks", "account", "mode_of_payment")):
			continue
		if tab == "invoices":
			balance = row["outstanding"]
			if status == "unpaid" and (balance is None or balance <= 0):
				continue
			if status == "overdue" and not row["days_overdue"]:
				continue
			if status == "settled" and (balance is None or balance > 0 or row["is_return"]):
				continue
			if status == "returns" and not row["is_return"]:
				continue
			# Current unpaid/overdue documents deliberately ignore the activity period.
			if status not in ("unpaid", "overdue") and not start <= getdate(row["posting_date"]) <= end:
				continue
		elif tab == "payments" and not start <= getdate(row["posting_date"]) <= end:
			continue
		if tab in ("invoices", "payments"):
			if date_from and getdate(row["posting_date"]) < getdate(date_from):
				continue
			if date_to and getdate(row["posting_date"]) > getdate(date_to):
				continue
		result.append(row)
	return result


def supplier_profile(supplier):
	doc = frappe.get_doc("Supplier", supplier)
	doc.check_permission("read")
	profile = {k: doc.get(k) or "" for k in ("name", "supplier_name", "supplier_group", "country", "mobile_no", "email_id", "supplier_details")}
	profile["disabled"] = cint(doc.disabled)
	# Prefer the explicitly selected primary records. Never guess a different record to edit.
	for doctype, field, keys in (
		("Contact", "supplier_primary_contact", ["name", "full_name", "mobile_no", "phone", "email_id"]),
		("Address", "supplier_primary_address", ["name", "address_line1", "address_line2", "city", "country"]),
	):
		name = doc.get(field)
		rows = readable(doctype, {"name": name}, keys) if name else []
		if not name:
			linked = set(frappe.get_all("Dynamic Link", filters={"parenttype": doctype,
				"link_doctype": "Supplier", "link_name": supplier}, pluck="parent", limit_page_length=0))
			permitted = batched_rows(doctype, {}, keys, "name", linked, permitted=True)
			# A sole linked record is unambiguous. Multiple contacts/addresses stay in the native form.
			rows = [r for r in permitted if r.name in linked] if len(linked) == 1 else []
		profile["contact" if doctype == "Contact" else "address"] = rows[0] if rows else None
	return profile


def enrich_payments(rows, context):
	if not rows:
		return
	refs = defaultdict(list)
	allowed = {i.name for i in context["invoices"]}
	for ref in frappe.get_all("Payment Entry Reference",
		filters={"parent": ["in", [r["name"] for r in rows]], "parenttype": "Payment Entry", "reference_doctype": "Purchase Invoice"},
		fields=["parent", "reference_name", "allocated_amount"], limit_page_length=0):
		if ref.reference_name in allowed:
			refs[ref.parent].append(dict(name=ref.reference_name, allocated_amount=flt(ref.allocated_amount)))
	# Allocation amounts have party-account currency, which can differ from company currency.
	currencies = {i.name: i.party_account_currency for i in context["invoices"]}
	for row in rows:
		row["invoices"] = [{**r, "currency": currencies[r["name"]]} for r in refs[row["name"]]]


def enrich_product_prices(rows, context, supplier):
	"""Optional current list prices, per stock unit; never a stock valuation fallback."""
	if not frappe.has_permission("Item Price", "read") or not rows:
		return
	price_lists = readable("Price List", {"selling": 1, "enabled": 1}, ["name"])
	if "Standard Selling" not in {p.name for p in price_lists}:
		return
	models = {context["items"][r["name"]].variant_of or r["name"] for r in rows}
	codes = {c for c in context["links"].get(supplier, set())
		if (context["items"][c].variant_of or c) in models}
	prices = batched_rows("Item Price", {"price_list": "Standard Selling",
		"currency": context["currency"]}, ["item_code", "price_list_rate", "uom", "valid_from", "valid_upto", "customer", "supplier", "batch_no", "packing_unit", "modified"],
		"item_code", codes, permitted=True)
	latest = {}
	for price in sorted(prices, key=lambda p: str(p.modified), reverse=True):
		item = context["items"][price.item_code]
		if (price.valid_from and getdate(price.valid_from) > context["end"]) or (price.valid_upto and getdate(price.valid_upto) < context["end"]):
			continue
		if price.customer or price.supplier or price.batch_no or flt(price.packing_unit) > 1 or price.uom not in (None, "", item.stock_uom):
			continue
		latest.setdefault(price.item_code, flt(price.price_list_rate))
	for row in rows:
		if not row["stock_uom"]:
			continue
		values = [latest[c] for c in codes if c in latest and
			(context["items"][c].variant_of or c) == (context["items"][row["name"]].variant_of or row["name"])]
		row["selling_price"] = min(values) if values else None
		row["price_varies"] = len(set(values)) > 1


def build_detail(supplier, company=None, period="month", warehouse=None, tab="invoices", search=None,
	status="unpaid", date_from=None, date_to=None, page=1, page_size=20,
	summary_revision=None, known_revision=None):
	if tab not in ("invoices", "payments", "products", "details") or status not in ("unpaid", "overdue", "all", "settled", "returns"):
		frappe.throw(_("Invalid filter"))
	if date_from and date_to and getdate(date_from) > getdate(date_to):
		frappe.throw(_("From Date must be before To Date"))
	from erpnext.stock.page.product_catalog.product_catalog import get_default_company

	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	frappe.get_doc("Supplier", supplier).check_permission("read")
	revision = current_revision((company, supplier, period, warehouse or ""))
	if known_revision and known_revision == revision:
		return dict(unchanged=True, revision=revision)
	include_summary = not summary_revision or summary_revision != revision
	context = load_supplier_context(company, period, warehouse, supplier,
		include_stock=include_summary or tab == "products", include_payables=include_summary or tab == "invoices")
	context["currency"] = frappe.get_cached_value("Company", context["company"], "default_currency")
	if not context["rows"]:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	source = invoice_rows(context) if tab == "invoices" else payment_rows(context) if tab == "payments" else product_rows(context, supplier) if tab == "products" else []
	matched = filter_rows(source, tab, search, status, context["start"], context["end"], date_from, date_to)
	listing = paginate(matched, page, page_size)
	if tab == "payments":
		enrich_payments(listing["rows"], context)
	if tab == "products":
		enrich_product_prices(listing["rows"], context, supplier)
	listing["amount"] = sum(flt(r["amount"]) for r in matched) if tab in ("invoices", "payments") and all(r.get("amount") is not None for r in matched) else None
	listing["outstanding"] = sum(flt(r.get("outstanding")) for r in matched) if context["can_payables"] and tab == "invoices" else None
	listing["stock_value"] = sum(r["stock_value"] for r in matched) if tab == "products" else None
	can_pay = frappe.has_permission("Payment Entry", "create") and frappe.has_permission("Payment Entry", "submit")
	result = dict(partial=not include_summary, revision=revision, listing=listing,
		company=context["company"], currency=context["currency"],
		from_date=str(context["start"]), to_date=str(context["end"]),
		permissions=dict(payables=bool(context["can_payables"]), purchases=bool(context["can_purchases"]),
			payments=bool(context["can_payments"]), stock=bool(context["can_stock"]),
			pay=bool(can_pay and context["can_payables"]), edit=doc_permission("Supplier", supplier, "write"),
			receive=bool(frappe.has_permission("Quick Product Restock", "create")),
			statement=bool(frappe.get_cached_doc("Report", "General Ledger").is_permitted())))
	if include_summary:
		result.update(supplier=supplier_profile(supplier),
			summary={k: v for k, v in context["rows"][0].items() if k != "_stock_codes"},
			companies=frappe.get_list("Company", pluck="name", limit_page_length=0), warehouses=context["warehouse_names"])
	return result


def doc_permission(doctype, name, permission):
	return bool(frappe.has_permission(doctype, permission, doc=name))


def get_invoice_items(supplier, invoice, company):
	frappe.get_doc("Supplier", supplier).check_permission("read")
	frappe.get_cached_doc("Company", company).check_permission("read")
	doc = frappe.get_doc("Purchase Invoice", invoice)
	doc.check_permission("read")
	if doc.supplier != supplier or doc.company != company or doc.docstatus != 1:
		frappe.throw(_("Invalid invoice"))
	return dict(currency=doc.currency, items=[dict(item_code=r.item_code, item_name=r.item_name,
		qty=r.qty, uom=r.uom, amount=r.amount) for r in doc.items])


def payment_options(company):
	"""Read existing permitted accounts/wallets; never initialize business records here."""
	frappe.get_cached_doc("Company", company).check_permission("read")
	frappe.has_permission("Payment Entry", "create", throw=True)
	frappe.has_permission("Payment Entry", "submit", throw=True)
	currency = frappe.get_cached_value("Company", company, "default_currency")
	accounts = readable("Account", {"company": company, "is_group": 0, "disabled": 0,
		"account_type": ["in", ["Cash", "Bank"]], "account_currency": currency}, ["name", "account_name", "account_type"])
	allowed = {a.name for a in accounts}
	wallets = readable("Money Wallet", {"company": company, "enabled": 1}, ["name", "wallet_name", "account", "mode_of_payment"])
	return dict(currency=currency, accounts=accounts, wallets=[w for w in wallets if w.account in allowed])


def payment_invoice(supplier, purchase_invoice, company):
	frappe.get_cached_doc("Company", company).check_permission("read")
	frappe.get_doc("Supplier", supplier).check_permission("read")
	doc = frappe.get_doc("Purchase Invoice", purchase_invoice)
	doc.check_permission("read")
	if doc.company != company or doc.supplier != supplier or doc.docstatus != 1 or doc.is_return:
		frappe.throw(_("Invalid invoice"))
	return dict(name=doc.name, outstanding=flt(doc.outstanding_amount), currency=doc.currency,
		posting_date=str(doc.posting_date), party_account_currency=doc.party_account_currency)


def record_payment(supplier, purchase_invoice, company, amount, account=None, wallet=None,
	posting_date=None, reference_no=None, remarks=None, mode_of_payment=None):
	"""Submit a native, permission-checked Payment Entry against one current invoice."""
	from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

	frappe.get_cached_doc("Company", company).check_permission("read")
	frappe.get_doc("Supplier", supplier).check_permission("read")
	frappe.has_permission("Payment Entry", "create", throw=True)
	frappe.has_permission("Payment Entry", "submit", throw=True)
	invoice = frappe.get_doc("Purchase Invoice", purchase_invoice)
	invoice.check_permission("read")
	if invoice.company != company or invoice.supplier != supplier or invoice.docstatus != 1 or invoice.is_return:
		frappe.throw(_("Invalid invoice"))
	if invoice.invoice_is_blocked():
		frappe.throw(_("This invoice is blocked for payment"))
	currency = frappe.get_cached_value("Company", company, "default_currency")
	if invoice.currency != currency or invoice.party_account_currency != currency:
		frappe.throw(_("Use the ERPNext Payment Entry form for foreign-currency payments"))
	amount = flt(amount)
	if not math.isfinite(amount) or amount <= 0 or amount > flt(invoice.outstanding_amount) + 0.000001:
		frappe.throw(_("Payment must be positive and cannot exceed the current outstanding amount"))
	if wallet:
		wallet_doc = frappe.get_doc("Money Wallet", wallet)
		wallet_doc.check_permission("read")
		if wallet_doc.company != company or not wallet_doc.enabled:
			frappe.throw(_("Invalid wallet"))
		account, mode_of_payment = wallet_doc.account, wallet_doc.mode_of_payment
	if not account:
		frappe.throw(_("Select a cash or bank account"))
	bank = frappe.get_doc("Account", account)
	bank.check_permission("read")
	if bank.company != company or bank.is_group or bank.disabled or bank.account_type not in ("Cash", "Bank") or bank.account_currency != currency:
		frappe.throw(_("Invalid payment account"))
	date = getdate(posting_date)
	if date < getdate(invoice.posting_date) or date > getdate():
		frappe.throw(_("Payment date must be between the invoice date and today"))
	pe = get_payment_entry("Purchase Invoice", invoice.name,
		bank_account=account, reference_date=date)
	if pe.deductions:
		frappe.throw(_("Use the ERPNext Payment Entry form for payments with deductions or discounts"))
	allocate_references(pe, amount)
	pe.paid_amount = pe.received_amount = amount
	pe.posting_date = date
	pe.reference_date = date
	pe.reference_no = reference_no or None
	pe.mode_of_payment = mode_of_payment or None
	if remarks:
		pe.custom_remarks, pe.remarks = 1, remarks
	pe.insert()
	pe.submit()
	return dict(success=True, payment_entry=pe.name, message=_("Payment recorded"))


def allocate_references(payment, amount):
	"""Partial payment: cap native term/request allocations, oldest due date first."""
	remaining = amount
	kept = []
	for row in sorted(payment.references, key=lambda r: (str(r.due_date or ""), r.idx or 0)):
		allocated = min(remaining, max(0, flt(row.allocated_amount)))
		if allocated:
			row.allocated_amount = allocated
			kept.append(row)
			remaining -= allocated
	if remaining > 0.000001:
		frappe.throw(_("Invoice balance changed. Reload the invoice before paying"))
	payment.set("references", kept)
