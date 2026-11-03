# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, flt, getdate, now_datetime, today

DEFAULT_TAX_SUPPLIER = "Налоговый комитет"
SIMPLIFIED_TEMPLATE_TITLE = "TJ Simplified Tax"
VAT_SALES_TEMPLATE_TITLE = "TJ General VAT"
VAT_PURCHASE_TEMPLATE_TITLE = "TJ Input VAT"


def _resolve_default_company(company=None):
	if company and frappe.db.exists("Company", company):
		return company
	try:
		from erpnext.stock.page.product_catalog.product_catalog import get_default_company

		comp = get_default_company()
		if comp:
			return comp
	except Exception:
		pass
	return (
		frappe.defaults.get_user_default("Company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Company", {}, "name")
	)


class RetailTaxSettings(Document):
	def validate(self):
		if not self.company:
			self.company = _resolve_default_company()

		if not self.tax_regime:
			self.tax_regime = "Simplified"

		if self.simplified_tax_rate is None or self.simplified_tax_rate == "":
			self.simplified_tax_rate = 6.0
		if self.vat_rate is None or self.vat_rate == "":
			self.vat_rate = 14.0

		self.simplified_tax_rate = flt(self.simplified_tax_rate)
		self.vat_rate = flt(self.vat_rate)
		self.simplified_cashless_rate = flt(self.simplified_cashless_rate)
		self.vat_cashless_rate = flt(self.vat_cashless_rate)

		for label, val in (
			(_("Simplified Tax Rate"), self.simplified_tax_rate),
			(_("General VAT Rate"), self.vat_rate),
			(_("Simplified Cashless Rate"), self.simplified_cashless_rate),
			(_("VAT Cashless Rate"), self.vat_cashless_rate),
		):
			if val < 0 or val > 100:
				frappe.throw(_("{0} must be between 0 and 100%.").format(label))

		if self.company:
			self._provision_accounts_and_templates()

		self._append_rate_history_if_changed()

	def on_update(self):
		if self.company and self.sales_tax_template:
			_sync_pos_profiles(self.company, self.sales_tax_template, self)

	def _provision_accounts_and_templates(self):
		"""Idempotently ensures GL accounts, tax supplier, and tax templates exist for the company."""
		company = self.company
		if not company or not frappe.db.exists("Company", company):
			return

		self.tax_authority_supplier = ensure_tax_supplier(self.tax_authority_supplier or DEFAULT_TAX_SUPPLIER)

		accounts = ensure_retail_tax_accounts(company)
		self.simplified_tax_account = accounts.get("simplified_tax_account")
		self.output_vat_account = accounts.get("output_vat_account")
		self.input_vat_account = accounts.get("input_vat_account")

		templates = ensure_retail_tax_templates(
			company=company,
			simplified_account=self.simplified_tax_account,
			simplified_rate=flt(self.simplified_tax_rate),
			output_vat_account=self.output_vat_account,
			input_vat_account=self.input_vat_account,
			vat_rate=flt(self.vat_rate),
			active_regime=self.tax_regime,
		)

		if self.tax_regime == "General (VAT)":
			self.sales_tax_template = templates.get("vat_sales_template")
		else:
			self.sales_tax_template = templates.get("simplified_sales_template")

		self.purchase_tax_template = templates.get("vat_purchase_template")

	def _append_rate_history_if_changed(self):
		active_rate = (
			flt(self.vat_rate) if self.tax_regime == "General (VAT)" else flt(self.simplified_tax_rate)
		)
		active_cashless = (
			(
				flt(self.vat_cashless_rate)
				if self.tax_regime == "General (VAT)"
				else flt(self.simplified_cashless_rate)
			)
			if cint(self.enable_cashless_split)
			else 0.0
		)

		history = self.get("rate_history") or []
		if history:
			last = history[-1]
			if (
				last.tax_regime == self.tax_regime
				and flt(last.tax_rate) == active_rate
				and flt(last.cashless_rate) == active_cashless
			):
				return

		self.append(
			"rate_history",
			{
				"effective_from": today(),
				"tax_regime": self.tax_regime,
				"tax_rate": active_rate,
				"cashless_rate": active_cashless,
				"changed_by": frappe.session.user or "Administrator",
				"changed_on": now_datetime(),
			},
		)


def ensure_tax_supplier(supplier_name=DEFAULT_TAX_SUPPLIER):
	"""Ensures the standard Tax Authority Supplier exists."""
	supplier_name = (supplier_name or DEFAULT_TAX_SUPPLIER).strip()
	if not frappe.db.exists("Supplier", supplier_name):
		sg = "Government" if frappe.db.exists("Supplier Group", "Government") else "Services"
		if not frappe.db.exists("Supplier Group", sg):
			sg = frappe.db.get_value("Supplier Group", {"is_group": 0}, "name") or "All Supplier Groups"

		doc = frappe.get_doc(
			{
				"doctype": "Supplier",
				"supplier_name": supplier_name,
				"supplier_group": sg,
				"supplier_type": "Company",
				"country": "Tajikistan",
			}
		)
		doc.flags.ignore_permissions = True
		doc.insert()
	return supplier_name


def _get_duties_and_taxes_parent(company):
	"""Finds the parent group account for Duties and Taxes under Liabilities."""
	parent = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"is_group": 1,
			"account_name": [
				"in",
				[
					"Duties and Taxes",
					"Налоги и сборы",
					"Обязательства по налогам",
					"Current Liabilities",
					"Краткосрочные обязательства",
				],
			],
		},
		"name",
	)
	if parent:
		return parent

	# Fallback: any Liability group account
	return frappe.db.get_value(
		"Account",
		{"company": company, "is_group": 1, "root_type": "Liability"},
		"name",
	)


def _find_or_create_tax_leaf_account(company, parent_account, candidate_names, default_account_name):
	"""Finds an existing leaf tax account by candidate names or creates a new one under parent_account."""
	existing = frappe.db.get_value(
		"Account",
		{
			"company": company,
			"is_group": 0,
			"account_name": ["in", candidate_names],
		},
		"name",
	)
	if existing:
		return existing

	if not parent_account:
		return None

	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"
	doc = frappe.get_doc(
		{
			"doctype": "Account",
			"account_name": default_account_name,
			"parent_account": parent_account,
			"company": company,
			"is_group": 0,
			"account_type": "Tax",
			"account_currency": currency,
		}
	)
	doc.flags.ignore_permissions = True
	doc.insert()
	return doc.name


def ensure_retail_tax_accounts(company):
	"""Provisions or locates the 3 core retail tax accounts for a company."""
	parent = _get_duties_and_taxes_parent(company)

	simplified_acc = _find_or_create_tax_leaf_account(
		company=company,
		parent_account=parent,
		candidate_names=[
			"Упрощенный налог",
			"Simplified Tax 6%",
			"Упрощенный налог 6%",
			"Налог с продаж 6%",
			"Simplified Tax Payable",
		],
		default_account_name="Упрощенный налог",
	)

	output_vat_acc = _find_or_create_tax_leaf_account(
		company=company,
		parent_account=parent,
		candidate_names=[
			"НДС к уплате",
			"Output VAT Payable",
			"Output VAT",
			"НДС с продаж",
			"VAT 14%",
			"НДС 14%",
		],
		default_account_name="НДС к уплате",
	)

	input_vat_acc = _find_or_create_tax_leaf_account(
		company=company,
		parent_account=parent,
		candidate_names=[
			"НДС к зачету",
			"Input VAT Receivable",
			"Input VAT",
			"Входящий НДС",
		],
		default_account_name="НДС к зачету",
	)

	return {
		"simplified_tax_account": simplified_acc,
		"output_vat_account": output_vat_acc,
		"input_vat_account": input_vat_acc,
	}


def _upsert_tax_template(
	doctype, title, company, account_head, rate, description, is_inclusive=1, is_default=0
):
	"""Creates or updates a Sales/Purchase Taxes and Charges Template for the given company."""
	if not account_head:
		return None

	existing_name = frappe.db.get_value(
		doctype,
		{"company": company, "title": title},
		"name",
	)

	if existing_name:
		tmpl = frappe.get_doc(doctype, existing_name)
		updated = False
		if cint(tmpl.is_default) != cint(is_default):
			tmpl.is_default = cint(is_default)
			updated = True
		if tmpl.taxes:
			row = tmpl.taxes[0]
			if (
				row.account_head != account_head
				or flt(row.rate) != flt(rate)
				or cint(row.included_in_print_rate) != cint(is_inclusive)
				or row.description != description
			):
				row.charge_type = "On Net Total"
				row.account_head = account_head
				row.rate = flt(rate)
				row.included_in_print_rate = cint(is_inclusive)
				row.description = description
				updated = True
		else:
			tmpl.append(
				"taxes",
				{
					"charge_type": "On Net Total",
					"account_head": account_head,
					"rate": flt(rate),
					"included_in_print_rate": cint(is_inclusive),
					"description": description,
				},
			)
			updated = True

		if updated:
			tmpl.flags.ignore_permissions = True
			tmpl.save()
		return tmpl.name

	tmpl = frappe.get_doc(
		{
			"doctype": doctype,
			"title": title,
			"company": company,
			"is_default": cint(is_default),
			"taxes": [
				{
					"charge_type": "On Net Total",
					"account_head": account_head,
					"rate": flt(rate),
					"included_in_print_rate": cint(is_inclusive),
					"description": description,
				}
			],
		}
	)
	tmpl.flags.ignore_permissions = True
	tmpl.insert()
	return tmpl.name


def ensure_retail_tax_templates(
	company,
	simplified_account,
	simplified_rate,
	output_vat_account,
	input_vat_account,
	vat_rate,
	active_regime="Simplified",
):
	"""Ensures Sales and Purchase Tax Templates exist and match current configured rates."""
	is_vat = active_regime == "General (VAT)"

	simplified_sales = _upsert_tax_template(
		doctype="Sales Taxes and Charges Template",
		title=SIMPLIFIED_TEMPLATE_TITLE,
		company=company,
		account_head=simplified_account,
		rate=simplified_rate,
		description=f"Упрощенный налог ({simplified_rate:g}%)",
		is_inclusive=1,
		is_default=0 if is_vat else 1,
	)

	vat_sales = _upsert_tax_template(
		doctype="Sales Taxes and Charges Template",
		title=VAT_SALES_TEMPLATE_TITLE,
		company=company,
		account_head=output_vat_account,
		rate=vat_rate,
		description=f"НДС ({vat_rate:g}%)",
		is_inclusive=1,
		is_default=1 if is_vat else 0,
	)

	vat_purchase = _upsert_tax_template(
		doctype="Purchase Taxes and Charges Template",
		title=VAT_PURCHASE_TEMPLATE_TITLE,
		company=company,
		account_head=input_vat_account,
		rate=vat_rate,
		description=f"Входящий НДС ({vat_rate:g}%)",
		is_inclusive=1,
		is_default=1 if is_vat else 0,
	)

	return {
		"simplified_sales_template": simplified_sales,
		"vat_sales_template": vat_sales,
		"vat_purchase_template": vat_purchase,
	}


def _sync_pos_profiles(company, sales_tax_template, settings_doc=None):
	"""Updates all active POS Profiles of the company to use the active regime's Sales Tax Template."""
	if not company or not sales_tax_template:
		return

	has_posa_inclusive = frappe.get_meta("POS Profile").has_field("posa_tax_inclusive")
	profiles = frappe.db.get_all(
		"POS Profile",
		filters={"company": company, "disabled": 0},
		pluck="name",
	)
	for profile_name in profiles:
		updates = {}
		current_tmpl = frappe.db.get_value("POS Profile", profile_name, "taxes_and_charges")
		if current_tmpl != sales_tax_template:
			updates["taxes_and_charges"] = sales_tax_template

		if has_posa_inclusive:
			curr_inc = frappe.db.get_value("POS Profile", profile_name, "posa_tax_inclusive")
			if cint(curr_inc) != 1:
				updates["posa_tax_inclusive"] = 1

		if updates:
			frappe.db.set_value(
				"POS Profile",
				profile_name,
				updates,
				update_modified=False,
			)

	frappe.clear_cache(doctype="POS Profile")

	try:
		frappe.publish_realtime(
			"retail_tax_settings_updated",
			{
				"company": company,
				"tax_regime": settings_doc.tax_regime if settings_doc else None,
				"sales_tax_template": sales_tax_template,
			},
		)
	except Exception:
		pass


def get_retail_tax_settings(company=None, auto_provision=True):
	"""Returns the active Retail Tax Settings document (auto-initializing it if needed)."""
	company = _resolve_default_company(company)
	doc = frappe.get_single("Retail Tax Settings")

	needs_save = False
	if not doc.company and company:
		doc.company = company
		needs_save = True
	if not doc.tax_regime:
		doc.tax_regime = "Simplified"
		needs_save = True
	if not doc.simplified_tax_rate and doc.simplified_tax_rate != 0:
		doc.simplified_tax_rate = 6.0
		needs_save = True
	if not doc.vat_rate and doc.vat_rate != 0:
		doc.vat_rate = 14.0
		needs_save = True

	if auto_provision and company and (
		needs_save
		or not doc.simplified_tax_account
		or not doc.output_vat_account
		or not doc.sales_tax_template
	):
		doc.flags.ignore_permissions = True
		doc.save()
		frappe.db.commit()

	active_rate = (
		flt(doc.vat_rate) if doc.tax_regime == "General (VAT)" else flt(doc.simplified_tax_rate)
	)
	active_account = (
		doc.output_vat_account if doc.tax_regime == "General (VAT)" else doc.simplified_tax_account
	)

	return {
		"company": doc.company or company,
		"tax_regime": doc.tax_regime or "Simplified",
		"is_vat_regime": doc.tax_regime == "General (VAT)",
		"active_tax_rate": active_rate,
		"simplified_tax_rate": flt(doc.simplified_tax_rate or 6.0),
		"vat_rate": flt(doc.vat_rate or 14.0),
		"enable_cashless_split": cint(doc.enable_cashless_split),
		"simplified_cashless_rate": flt(doc.simplified_cashless_rate),
		"vat_cashless_rate": flt(doc.vat_cashless_rate),
		"active_tax_account": active_account,
		"simplified_tax_account": doc.simplified_tax_account,
		"output_vat_account": doc.output_vat_account,
		"input_vat_account": doc.input_vat_account,
		"sales_tax_template": doc.sales_tax_template,
		"purchase_tax_template": doc.purchase_tax_template,
		"tax_authority_supplier": doc.tax_authority_supplier or DEFAULT_TAX_SUPPLIER,
		"hide_tax_from_customer": doc.tax_regime != "General (VAT)",
		"rate_history": [
			{
				"effective_from": str(row.effective_from),
				"tax_regime": row.tax_regime,
				"tax_rate": flt(row.tax_rate),
				"cashless_rate": flt(row.cashless_rate),
				"changed_by": row.changed_by,
				"changed_on": str(row.changed_on) if row.changed_on else "",
			}
			for row in (doc.get("rate_history") or [])
		],
	}


def get_effective_rate_for_date(target_date, settings_dict=None):
	"""Resolves the historical tax rate that was active on `target_date`."""
	settings_dict = settings_dict or get_retail_tax_settings(auto_provision=False)
	history = settings_dict.get("rate_history") or []
	if not history:
		return flt(settings_dict.get("active_tax_rate") or 6.0)

	target = getdate(target_date)
	matched_rate = None
	for row in history:
		eff = getdate(row.get("effective_from") or today())
		if eff <= target:
			matched_rate = flt(row.get("tax_rate"))

	if matched_rate is not None:
		return matched_rate

	# If target_date is older than the earliest history entry, use the earliest recorded rate
	return flt(history[0].get("tax_rate") or settings_dict.get("active_tax_rate") or 6.0)


def ensure_invoice_retail_taxes(doc, method=None):
	"""Ensures Sales/POS Invoices have the active company retail tax template attached as inclusive tax."""
	if not doc or doc.doctype not in ("Sales Invoice", "POS Invoice"):
		return
	if doc.get("is_opening") == "Yes":
		return
	if hasattr(doc, "is_internal_transfer") and callable(doc.is_internal_transfer) and doc.is_internal_transfer():
		return
	if not doc.get("company") or not doc.get("items"):
		return

	try:
		settings = get_retail_tax_settings(doc.company, auto_provision=False)
	except Exception:
		return

	active_account = settings.get("active_tax_account")
	active_rate = flt(settings.get("active_tax_rate"))
	active_template = settings.get("sales_tax_template")
	managed_accounts = {
		acc
		for acc in (
			settings.get("simplified_tax_account"),
			settings.get("output_vat_account"),
		)
		if acc
	}

	# If invoice has no tax rows yet, auto-attach the active regime's tax row
	if not doc.get("taxes") and active_account and active_rate > 0:
		if active_template and not doc.get("taxes_and_charges"):
			doc.taxes_and_charges = active_template

		description = (
			f"НДС ({active_rate:g}%)"
			if settings.get("is_vat_regime")
			else f"Упрощенный налог ({active_rate:g}%)"
		)
		doc.append(
			"taxes",
			{
				"charge_type": "On Net Total",
				"account_head": active_account,
				"rate": active_rate,
				"included_in_print_rate": 1,
				"description": description,
				"cost_center": doc.get("cost_center")
				or (doc.items[0].get("cost_center") if doc.items else None),
			},
		)

	# Ensure any managed retail tax row on the invoice stays tax-inclusive (never inflates retail price)
	for tax in doc.get("taxes") or []:
		if tax.get("account_head") in managed_accounts and tax.get("charge_type") == "On Net Total":
			tax.included_in_print_rate = 1


def apply_exact_inclusive_retail_tax(doc, method=None):
	"""Applies exact-percentage inclusive tax math (e.g., 100 TJS @ 6% -> 94.00 Net + 6.00 Tax = 100.00 Grand Total)."""
	if not doc or doc.doctype not in ("Sales Invoice", "POS Invoice", "Sales Order", "Quotation"):
		return
	if not doc.get("items"):
		return

	if doc.doctype in ("Sales Invoice", "POS Invoice"):
		ensure_invoice_retail_taxes(doc)

	taxes = doc.get("taxes") or []
	if not taxes:
		return

	inclusive_taxes = [
		t
		for t in taxes
		if cint(t.get("included_in_print_rate")) == 1 and (t.get("charge_type") or "On Net Total") == "On Net Total"
	]
	if not inclusive_taxes:
		return

	# Only apply exact-percentage math if all taxes on the invoice are inclusive 'On Net Total'
	if len(inclusive_taxes) != len(taxes):
		return

	import json

	conversion_rate = flt(doc.get("conversion_rate")) or 1.0
	raw_total = flt(sum(flt(item.amount) for item in doc.items), doc.precision("total"))
	doc.total = raw_total
	doc.base_total = flt(raw_total * conversion_rate, doc.precision("base_total"))

	discount_amount = flt(doc.get("discount_amount"))
	if not discount_amount and flt(doc.get("additional_discount_percentage")):
		discount_amount = flt(
			raw_total * flt(doc.get("additional_discount_percentage")) / 100.0,
			doc.precision("discount_amount"),
		)
		doc.discount_amount = discount_amount

	doc.base_discount_amount = flt(discount_amount * conversion_rate, doc.precision("base_discount_amount"))
	gross_after_discount = flt(raw_total - discount_amount, doc.precision("grand_total"))

	# Compute exact percentage tax for each inclusive tax row
	for tax in inclusive_taxes:
		rate = flt(tax.rate)
		tax_before_disc = flt(raw_total * (rate / 100.0), tax.precision("tax_amount"))
		tax_after_disc = flt(
			gross_after_discount * (rate / 100.0),
			tax.precision("tax_amount_after_discount_amount"),
		)

		tax.tax_amount = tax_before_disc
		tax.tax_amount_after_discount_amount = tax_after_disc
		tax.base_tax_amount = flt(tax_before_disc * conversion_rate, tax.precision("base_tax_amount"))
		tax.base_tax_amount_after_discount_amount = flt(
			tax_after_disc * conversion_rate,
			tax.precision("base_tax_amount_after_discount_amount"),
		)

	total_tax = flt(
		sum(flt(t.tax_amount_after_discount_amount) for t in inclusive_taxes),
		doc.precision("total_taxes_and_charges"),
	)
	base_total_tax = flt(
		sum(flt(t.base_tax_amount_after_discount_amount) for t in inclusive_taxes),
		doc.precision("base_total_taxes_and_charges"),
	)

	target_grand_total = gross_after_discount
	target_base_grand_total = flt(target_grand_total * conversion_rate, doc.precision("base_grand_total"))

	target_net_total = flt(target_grand_total - total_tax, doc.precision("net_total"))
	target_base_net_total = flt(target_base_grand_total - base_total_tax, doc.precision("base_net_total"))

	# Distribute target_net_total across items proportionally with last-item rounding reconciliation
	running_net = 0.0
	running_base_net = 0.0
	item_count = len(doc.items)

	for idx, item in enumerate(doc.items):
		if idx == item_count - 1:
			item_net = flt(target_net_total - running_net, item.precision("net_amount"))
			item_base_net = flt(target_base_net_total - running_base_net, item.precision("base_net_amount"))
		else:
			share = (flt(item.amount) / raw_total) if raw_total else (1.0 / item_count)
			item_net = flt(target_net_total * share, item.precision("net_amount"))
			item_base_net = flt(item_net * conversion_rate, item.precision("base_net_amount"))
			running_net += item_net
			running_base_net += item_base_net

		item.net_amount = item_net
		item.base_net_amount = item_base_net
		qty = flt(item.qty)
		item.net_rate = flt(item_net / qty, item.precision("net_rate")) if qty else 0.0
		item.base_net_rate = flt(item_base_net / qty, item.precision("base_net_rate")) if qty else 0.0

	# Rebuild item_wise_tax_detail JSON on each tax row so tax reports match to the diram
	for tax in inclusive_taxes:
		rate = flt(tax.rate)
		detail_map = {}
		running_item_tax = 0.0
		target_row_base_tax = flt(tax.base_tax_amount_after_discount_amount)

		for idx, item in enumerate(doc.items):
			key = item.item_code or item.item_name
			if idx == item_count - 1:
				item_base_tax = flt(target_row_base_tax - running_item_tax, tax.precision("tax_amount"))
			else:
				share = (flt(item.amount) / raw_total) if raw_total else (1.0 / item_count)
				item_base_tax = flt(target_row_base_tax * share, tax.precision("tax_amount"))
				running_item_tax += item_base_tax

			if key in detail_map:
				detail_map[key][1] = flt(detail_map[key][1] + item_base_tax, tax.precision("tax_amount"))
			else:
				detail_map[key] = [rate, item_base_tax]

		tax.item_wise_tax_detail = json.dumps(detail_map, separators=(",", ":"))

	doc.net_total = target_net_total
	doc.base_net_total = target_base_net_total

	running_cum_total = doc.net_total
	for tax in inclusive_taxes:
		running_cum_total = flt(
			running_cum_total + flt(tax.tax_amount_after_discount_amount),
			tax.precision("total"),
		)
		tax.total = running_cum_total
		tax.base_total = flt(running_cum_total * conversion_rate, tax.precision("base_total"))

	doc.total_taxes_and_charges = total_tax
	doc.base_total_taxes_and_charges = base_total_tax
	doc.grand_total = target_grand_total
	doc.base_grand_total = target_base_grand_total


