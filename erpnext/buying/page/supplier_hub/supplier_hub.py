# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, cint, today, nowdate, getdate

from erpnext.stock.page.product_catalog.product_catalog import get_default_company, get_stores_warehouse


@frappe.whitelist()
def get_supplier_hub_data(search=None, supplier_group=None, debt_filter=None, company=None):
	company = company or get_default_company()
	stores_wh = get_stores_warehouse(company)
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# 1. Fetch all active suppliers
	conds = ["s.disabled = 0"]
	vals = {"company": company}

	if supplier_group and supplier_group != "All":
		conds.append("s.supplier_group = %(supplier_group)s")
		vals["supplier_group"] = supplier_group

	if search:
		vals["search_term"] = f"%{search.strip()}%"
		conds.append(
			"(s.name LIKE %(search_term)s OR s.supplier_name LIKE %(search_term)s OR s.mobile_no LIKE %(search_term)s OR s.email_id LIKE %(search_term)s)"
		)

	where_clause = " AND ".join(conds)
	suppliers_raw = frappe.db.sql(
		f"""
		SELECT 
			s.name, s.supplier_name, s.supplier_group, s.supplier_type,
			s.mobile_no, s.email_id, s.country
		FROM `tabSupplier` s
		WHERE {where_clause}
		ORDER BY s.name ASC
		""",
		vals,
		as_dict=True,
	)

	supplier_groups = frappe.db.sql_list(
		"SELECT DISTINCT supplier_group FROM `tabSupplier` WHERE disabled = 0 AND supplier_group IS NOT NULL ORDER BY supplier_group ASC"
	)

	if not suppliers_raw:
		return {
			"suppliers": [],
			"total": 0,
			"summary": {
				"total_debt": 0.0,
				"total_stock_qty": 0.0,
				"total_stock_value": 0.0,
				"total_purchased": 0.0,
				"total_paid": 0.0,
				"suppliers_count": 0,
				"suppliers_with_debt_count": 0,
			},
			"supplier_groups": supplier_groups,
			"currency": currency,
		}

	# 2. Batch fetch Purchase Invoices aggregation for all suppliers
	pi_stats_raw = frappe.db.sql(
		"""
		SELECT 
			supplier,
			COALESCE(SUM(grand_total), 0) as total_purchased,
			COALESCE(SUM(outstanding_amount), 0) as current_debt,
			COUNT(*) as invoice_count
		FROM `tabPurchase Invoice`
		WHERE docstatus = 1 AND company = %(company)s
		GROUP BY supplier
		""",
		{"company": company},
		as_dict=True,
	)
	pi_map = {r.supplier: r for r in pi_stats_raw}

	# 3. Batch fetch last purchase invoice date & name
	last_pi_raw = frappe.db.sql(
		"""
		SELECT pi.supplier, pi.name, pi.posting_date, pi.grand_total
		FROM `tabPurchase Invoice` pi
		INNER JOIN (
			SELECT supplier, MAX(posting_date) as max_date, MAX(creation) as max_creation
			FROM `tabPurchase Invoice`
			WHERE docstatus = 1 AND company = %(company)s
			GROUP BY supplier
		) latest ON latest.supplier = pi.supplier AND latest.max_date = pi.posting_date
		WHERE pi.docstatus = 1 AND pi.company = %(company)s
		""",
		{"company": company},
		as_dict=True,
	)
	last_pi_map = {r.supplier: r for r in last_pi_raw}

	# 4. Batch fetch direct item linkages for suppliers
	# (a) From Purchase Invoice Item
	pi_items_raw = frappe.db.sql(
		"""
		SELECT DISTINCT pi.supplier, pii.item_code
		FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pi.docstatus = 1 AND pi.company = %(company)s AND pii.item_code IS NOT NULL
		""",
		{"company": company},
		as_dict=True,
	)
	# (b) From Purchase Receipt Item
	pr_items_raw = frappe.db.sql(
		"""
		SELECT DISTINCT pr.supplier, pri.item_code
		FROM `tabPurchase Receipt Item` pri
		JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
		WHERE pr.docstatus = 1 AND pr.company = %(company)s AND pri.item_code IS NOT NULL
		""",
		{"company": company},
		as_dict=True,
	)
	# (c) From Item Default
	default_supp_items_raw = frappe.db.sql(
		"""
		SELECT DISTINCT id.default_supplier as supplier, id.parent as item_code
		FROM `tabItem Default` id
		WHERE id.default_supplier IS NOT NULL AND id.default_supplier != ''
		""",
		as_dict=True,
	)

	supplier_direct_items = {}
	all_referenced_items = set()

	for r in list(pi_items_raw) + list(pr_items_raw) + list(default_supp_items_raw):
		s = r.supplier
		it = r.item_code
		if s and it:
			supplier_direct_items.setdefault(s, set()).add(it)
			all_referenced_items.add(it)

	# 5. Fetch variant relationships for all referenced items
	item_family_map = {}
	if all_referenced_items:
		items_meta = frappe.db.sql(
			"""
			SELECT name, variant_of, has_variants
			FROM `tabItem`
			WHERE (name IN %(items)s OR variant_of IN %(items)s) AND disabled = 0
			""",
			{"items": list(all_referenced_items)},
			as_dict=True,
		)
		for row in items_meta:
			item_family_map[row.name] = row

	# 6. Map each supplier to its complete item list (including variants & templates)
	supplier_full_items = {}
	all_needed_stock_items = set()

	for s, items in supplier_direct_items.items():
		expanded = set(items)
		for it in items:
			meta = item_family_map.get(it)
			if meta:
				if meta.variant_of:
					expanded.add(meta.variant_of)
				if meta.has_variants:
					# Add its variants
					for sub_name, sub_meta in item_family_map.items():
						if sub_meta.variant_of == it:
							expanded.add(sub_name)
		supplier_full_items[s] = expanded
		all_needed_stock_items.update(expanded)

	# 7. Batch fetch stock and valuation from tabBin
	bin_map = {}
	if all_needed_stock_items:
		bins_raw = frappe.db.sql(
			"""
			SELECT 
				item_code,
				COALESCE(SUM(actual_qty), 0) as actual_qty,
				COALESCE(SUM(stock_value), 0) as stock_value
			FROM `tabBin`
			WHERE item_code IN %(items)s
			GROUP BY item_code
			""",
			{"items": list(all_needed_stock_items)},
			as_dict=True,
		)
		for b in bins_raw:
			bin_map[b.item_code] = b

	# 8. Build supplier records
	result = []
	tot_debt = 0.0
	tot_stock_qty = 0.0
	tot_stock_val = 0.0
	tot_purchased = 0.0
	tot_paid = 0.0
	debt_suppliers_cnt = 0

	for s in suppliers_raw:
		supp_name = s.name
		pi_info = pi_map.get(supp_name, frappe._dict(total_purchased=0.0, current_debt=0.0, invoice_count=0))
		last_pi = last_pi_map.get(supp_name)

		debt = flt(pi_info.current_debt, 2)
		purchased = flt(pi_info.total_purchased, 2)
		paid = max(0.0, flt(purchased - debt, 2))

		# Stock aggregation
		related_items = supplier_full_items.get(supp_name, set())
		supp_stock_qty = 0.0
		supp_stock_val = 0.0
		model_templates = set()
		distinct_skus = set()

		for it in related_items:
			meta = item_family_map.get(it)
			if meta and meta.has_variants:
				model_templates.add(it)
			elif meta and meta.variant_of:
				model_templates.add(meta.variant_of)
				distinct_skus.add(it)
			else:
				model_templates.add(it)
				distinct_skus.add(it)

			b = bin_map.get(it)
			if b and b.actual_qty > 0:
				supp_stock_qty += flt(b.actual_qty)
				supp_stock_val += flt(b.stock_value)

		supp_stock_qty = flt(supp_stock_qty, 2)
		supp_stock_val = flt(supp_stock_val, 2)

		# Comparison & Coverage
		# difference: stock value minus debt
		coverage_diff = flt(supp_stock_val - debt, 2)
		if debt == 0 and supp_stock_qty == 0:
			coverage_status = "settled"
			coverage_label_ru = "Рассчитано (нет остатка)"
			coverage_label_tg = "Ҳисобӣ шуд (мол нест)"
		elif debt == 0 and supp_stock_qty > 0:
			coverage_status = "fully_covered"
			coverage_label_ru = "Долга нет (товар в наличии)"
			coverage_label_tg = "Қарз нест (мол ҳаст)"
		elif coverage_diff >= 0:
			coverage_status = "covered"
			coverage_label_ru = f"Товар покрывает долг (+{coverage_diff:,.0f} {currency})"
			coverage_label_tg = f"Мол қарзро мепӯшонад (+{coverage_diff:,.0f} {currency})"
		else:
			coverage_status = "uncovered"
			coverage_label_ru = f"Долг выше остатка ({coverage_diff:,.0f} {currency})"
			coverage_label_tg = f"Қарз аз мол зиёд аст ({coverage_diff:,.0f} {currency})"

		# Apply debt filter if requested
		if debt_filter == "with_debt" and debt <= 0:
			continue
		elif debt_filter == "settled" and debt > 0:
			continue
		elif debt_filter == "in_stock" and supp_stock_qty <= 0:
			continue

		tot_debt += debt
		tot_stock_qty += supp_stock_qty
		tot_stock_val += supp_stock_val
		tot_purchased += purchased
		tot_paid += paid
		if debt > 0:
			debt_suppliers_cnt += 1

		row = {
			"name": supp_name,
			"supplier_name": s.supplier_name or supp_name,
			"supplier_group": s.supplier_group or _("All Supplier Groups"),
			"supplier_type": s.supplier_type or "",
			"mobile_no": s.mobile_no or "",
			"email_id": s.email_id or "",
			"country": s.country or "",
			# Stock at Hand
			"stock_qty": supp_stock_qty,
			"stock_value": supp_stock_val,
			"models_count": len(model_templates),
			"skus_count": len(distinct_skus),
			# Current Debt
			"current_debt": debt,
			# Comparison
			"coverage_diff": coverage_diff,
			"coverage_status": coverage_status,
			"coverage_label_ru": coverage_label_ru,
			"coverage_label_tg": coverage_label_tg,
			# History & Activity
			"total_purchased": purchased,
			"total_paid": paid,
			"invoice_count": pi_info.invoice_count or 0,
			"last_delivery_date": str(last_pi.posting_date) if last_pi else None,
			"last_delivery_invoice": last_pi.name if last_pi else None,
			"last_delivery_amount": flt(last_pi.grand_total, 2) if last_pi else 0.0,
		}
		result.append(row)

	return {
		"suppliers": result,
		"total": len(result),
		"summary": {
			"total_debt": flt(tot_debt, 2),
			"total_stock_qty": flt(tot_stock_qty, 2),
			"total_stock_value": flt(tot_stock_val, 2),
			"total_purchased": flt(tot_purchased, 2),
			"total_paid": flt(tot_paid, 2),
			"suppliers_count": len(result),
			"suppliers_with_debt_count": debt_suppliers_cnt,
		},
		"supplier_groups": supplier_groups,
		"currency": currency,
		"stores_warehouse": stores_wh,
	}


@frappe.whitelist()
def get_supplier_details(supplier, company=None):
	"""Returns product inventory, recent invoices, and recent payments for a single supplier."""
	if not supplier:
		return {}

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# 1. Supplier Doc info
	supp = frappe.db.get_value(
		"Supplier",
		supplier,
		["name", "supplier_name", "supplier_group", "mobile_no", "email_id", "country"],
		as_dict=True,
	)
	if not supp:
		frappe.throw(_("Supplier {0} not found").format(supplier))

	# 2. Invoices list
	invoices = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, bill_no, grand_total, outstanding_amount, status
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 50
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	# 3. Payments list
	payments = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, mode_of_payment, paid_amount, reference_no, reference_date, status
		FROM `tabPayment Entry`
		WHERE party_type = 'Supplier' AND party = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 50
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	# 4. Products list
	# Items from PI, PR, and Item Default
	item_rows = frappe.db.sql(
		"""
		SELECT DISTINCT pii.item_code
		FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pi.supplier = %(supplier)s AND pi.docstatus = 1 AND pi.company = %(company)s AND pii.item_code IS NOT NULL
		UNION
		SELECT DISTINCT pri.item_code
		FROM `tabPurchase Receipt Item` pri
		JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
		WHERE pr.supplier = %(supplier)s AND pr.docstatus = 1 AND pr.company = %(company)s AND pri.item_code IS NOT NULL
		UNION
		SELECT DISTINCT parent as item_code
		FROM `tabItem Default`
		WHERE default_supplier = %(supplier)s
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	direct_items = [r.item_code for r in item_rows if r.item_code]
	all_items = set(direct_items)

	if direct_items:
		variants = frappe.db.sql(
			"SELECT name, variant_of FROM `tabItem` WHERE variant_of IN %(items)s AND disabled = 0",
			{"items": direct_items},
			as_dict=True,
		)
		for v in variants:
			all_items.add(v.name)

		parents = frappe.db.sql(
			"SELECT variant_of FROM `tabItem` WHERE name IN %(items)s AND variant_of IS NOT NULL AND variant_of != ''",
			{"items": direct_items},
			as_dict=True,
		)
		for p in parents:
			all_items.add(p.variant_of)

	products = []
	if all_items:
		items_data = frappe.db.sql(
			"""
			SELECT 
				i.name as item_code, i.item_name, i.item_group, i.image, i.custom_short_code,
				i.has_variants, i.variant_of, i.stock_uom,
				COALESCE(b.actual_qty, 0) as stock_qty,
				COALESCE(b.stock_value, 0) as stock_value,
				COALESCE(b.valuation_rate, 0) as valuation_rate
			FROM `tabItem` i
			LEFT JOIN (
				SELECT item_code, SUM(actual_qty) as actual_qty, SUM(stock_value) as stock_value,
				       AVG(valuation_rate) as valuation_rate
				FROM `tabBin`
				WHERE item_code IN %(items)s
				GROUP BY item_code
			) b ON b.item_code = i.name
			WHERE i.name IN %(items)s AND i.disabled = 0
			ORDER BY b.actual_qty DESC, i.item_name ASC
			""",
			{"items": list(all_items)},
			as_dict=True,
		)

		# Fetch selling prices
		selling_prices = frappe.db.sql(
			"""
			SELECT item_code, price_list_rate
			FROM `tabItem Price`
			WHERE item_code IN %(items)s AND price_list = 'Standard Selling'
			""",
			{"items": list(all_items)},
			as_dict=True,
		)
		sp_map = {p.item_code: flt(p.price_list_rate) for p in selling_prices}

		for it in items_data:
			it["selling_price"] = sp_map.get(it["item_code"], 0.0)
			products.append(it)

	return {
		"supplier": supp,
		"invoices": invoices,
		"payments": payments,
		"products": products,
		"currency": currency,
	}


@frappe.whitelist()
def get_payment_options(company=None):
	"""Returns payment modes and cash/bank accounts for the payment dialog."""
	company = company or get_default_company()
	default_cash = frappe.get_cached_value("Company", company, "default_cash_account") or "Cash - R"
	default_bank = frappe.get_cached_value("Company", company, "default_bank_account")
	default_payable = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - R"
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# Get active modes of payment
	mops = frappe.db.sql(
		"""
		SELECT mop.name, mop.type, COALESCE(mopa.default_account, '') as default_account
		FROM `tabMode of Payment` mop
		LEFT JOIN `tabMode of Payment Account` mopa ON mopa.parent = mop.name AND mopa.company = %(company)s
		WHERE mop.enabled = 1
		ORDER BY mop.idx ASC, mop.name ASC
		""",
		{"company": company},
		as_dict=True,
	)

	return {
		"modes": mops,
		"default_cash_account": default_cash,
		"default_bank_account": default_bank,
		"default_payable_account": default_payable,
		"currency": currency,
	}


@frappe.whitelist()
def make_quick_supplier_payment(supplier, amount, mode_of_payment="Cash", posting_date=None, reference_no=None, remarks=None, company=None):
	"""Fast, 1-click payment creation to a supplier, auto-allocating to oldest Purchase Invoices FIFO."""
	if not supplier:
		frappe.throw(_("Supplier is required"))

	amount = flt(amount)
	if amount <= 0:
		frappe.throw(_("Payment amount must be greater than zero"))

	company = company or get_default_company()
	posting_date = posting_date or today()

	# Resolve Accounts
	paid_from = None
	if mode_of_payment:
		paid_from = frappe.db.get_value(
			"Mode of Payment Account",
			{"parent": mode_of_payment, "company": company},
			"default_account",
		)

	if not paid_from:
		paid_from = (
			frappe.get_cached_value("Company", company, "default_cash_account")
			or frappe.get_cached_value("Company", company, "default_bank_account")
			or "Cash - R"
		)

	paid_to = frappe.get_cached_value("Company", company, "default_payable_account") or "Creditors - R"

	pe = frappe.new_doc("Payment Entry")
	pe.payment_type = "Pay"
	pe.party_type = "Supplier"
	pe.party = supplier
	pe.company = company
	pe.posting_date = posting_date
	pe.mode_of_payment = mode_of_payment
	pe.paid_from = paid_from
	pe.paid_to = paid_to
	pe.paid_amount = amount
	pe.received_amount = amount
	pe.reference_no = reference_no
	pe.reference_date = posting_date
	pe.remarks = remarks or _("Quick Supplier Payment to {0}").format(supplier)

	pe.setup_party_account_field()
	pe.set_missing_values()

	# FIFO Allocation against oldest unpaid Purchase Invoices
	unpaid_invoices = frappe.db.sql(
		"""
		SELECT name, grand_total, outstanding_amount
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s AND outstanding_amount > 0
		ORDER BY posting_date ASC, creation ASC
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	rem_alloc = amount
	allocated_count = 0
	for inv in unpaid_invoices:
		if rem_alloc <= 0:
			break
		alloc = min(flt(inv.outstanding_amount), rem_alloc)
		pe.append(
			"references",
			{
				"reference_doctype": "Purchase Invoice",
				"reference_name": inv.name,
				"total_amount": inv.grand_total,
				"outstanding_amount": inv.outstanding_amount,
				"allocated_amount": alloc,
			},
		)
		rem_alloc -= alloc
		allocated_count += 1

	pe.flags.ignore_permissions = True
	pe.insert()
	pe.submit()

	# Calculate new updated debt
	updated_debt = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(outstanding_amount), 0)
		FROM `tabPurchase Invoice`
		WHERE supplier = %s AND docstatus = 1 AND company = %s
		""",
		(supplier, company),
	)[0][0]

	return {
		"success": True,
		"payment_entry": pe.name,
		"paid_amount": amount,
		"allocated_invoices": allocated_count,
		"unallocated_amount": flt(pe.unallocated_amount, 2),
		"updated_debt": flt(updated_debt, 2),
		"message": _("Payment {0} of {1} successfully recorded for {2}").format(
			pe.name, frappe.format(amount, {"fieldtype": "Currency"}), supplier
		),
	}


@frappe.whitelist()
def create_quick_supplier(supplier_name, supplier_group="All Supplier Groups", mobile_no=None, email_id=None):
	"""Fast modal supplier creation."""
	supplier_name = (supplier_name or "").strip()
	if not supplier_name:
		frappe.throw(_("Supplier Name is required"))

	if frappe.db.exists("Supplier", supplier_name):
		frappe.throw(_("Supplier with name '{0}' already exists").format(supplier_name))

	supp = frappe.new_doc("Supplier")
	supp.supplier_name = supplier_name
	supp.supplier_group = supplier_group or "All Supplier Groups"
	supp.mobile_no = mobile_no
	supp.email_id = email_id
	supp.flags.ignore_permissions = True
	supp.insert()

	return {"success": True, "name": supp.name, "supplier_name": supp.supplier_name}
