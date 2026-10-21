# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, cint, today, nowdate, add_days


def get_default_company():
	return (
		frappe.defaults.get_user_default("Company")
		or frappe.db.get_single_value("Global Defaults", "default_company")
		or frappe.db.get_value("Company", {}, "name")
	)


def get_stores_warehouse(company):
	if not company:
		company = get_default_company()

	# 1. Configured global default warehouse in Stock Settings
	stock_settings_wh = frappe.db.get_single_value("Stock Settings", "default_warehouse")
	if stock_settings_wh:
		wh_company, is_group = frappe.db.get_value("Warehouse", stock_settings_wh, ["company", "is_group"]) or (None, 1)
		if (not wh_company or wh_company == company) and not is_group:
			return stock_settings_wh

	# 2. Company default warehouse
	company_wh = frappe.db.get_value("Company", company, "default_warehouse")
	if company_wh and not frappe.db.get_value("Warehouse", company_wh, "is_group"):
		return company_wh

	# 3. User default warehouse
	user_wh = frappe.defaults.get_user_default("default_warehouse")
	if user_wh and not frappe.db.get_value("Warehouse", user_wh, "is_group"):
		return user_wh

	# 4. Fallback search
	return (
		frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "warehouse_name": "Stores"},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "name": ["like", "%Stores%"]},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0, "name": ["like", "%Store%"]},
			"name",
		)
		or frappe.db.get_value(
			"Warehouse",
			{"company": company, "is_group": 0},
			"name",
		)
	)


@frappe.whitelist()
def get_catalog(search=None, item_group=None, status_filter=None, page=1, page_size=60, company=None):
	company = company or get_default_company()
	stores_wh = get_stores_warehouse(company)
	page = cint(page) or 1
	page_size = cint(page_size) or 60

	# 1. Base query for product models (templates or standalone items)
	conditions = ["(i.variant_of IS NULL OR i.variant_of = '')", "i.disabled = 0"]
	values = {}

	if item_group and item_group != "All":
		conditions.append("i.item_group = %(item_group)s")
		values["item_group"] = item_group

	if search:
		search_term = f"%{search.strip()}%"
		values["search_term"] = search_term
		values["exact_code"] = search.strip()

		# Check if search matches barcode or variant short code
		matching_parents = frappe.db.sql(
			"""
			SELECT DISTINCT parent FROM `tabItem Barcode` WHERE barcode LIKE %(search_term)s
			UNION
			SELECT DISTINCT variant_of FROM `tabItem` WHERE (name LIKE %(search_term)s OR custom_short_code = %(exact_code)s) AND variant_of IS NOT NULL AND variant_of != ''
			""",
			values,
			as_dict=True,
		)
		parent_match_list = [r.parent for r in matching_parents if r.parent]

		if parent_match_list:
			values["parent_match_list"] = parent_match_list
			conditions.append(
				"(i.name LIKE %(search_term)s OR i.item_name LIKE %(search_term)s OR i.custom_short_code = %(exact_code)s OR i.name IN %(parent_match_list)s)"
			)
		else:
			conditions.append(
				"(i.name LIKE %(search_term)s OR i.item_name LIKE %(search_term)s OR i.custom_short_code = %(exact_code)s)"
			)

	where_clause = " AND ".join(conditions)

	items_raw = frappe.db.sql(
		f"""
		SELECT
			i.name, i.item_name, i.item_group, i.image, i.has_variants,
			i.custom_short_code, i.stock_uom, i.modified
		FROM `tabItem` i
		WHERE {where_clause}
		ORDER BY i.modified DESC
		LIMIT {(page - 1) * page_size}, {page_size}
		""",
		values,
		as_dict=True,
	)

	if not items_raw:
		item_groups = frappe.db.sql_list(
			"SELECT DISTINCT item_group FROM `tabItem` WHERE disabled = 0 ORDER BY item_group ASC"
		)
		return {"items": [], "total": 0, "categories": item_groups, "currency": "TJS"}

	parent_codes = [it.name for it in items_raw]

	# 2. Batch get all variants for templates
	variants_raw = frappe.db.sql(
		"""
		SELECT name, variant_of, custom_short_code
		FROM `tabItem`
		WHERE variant_of IN %(parent_codes)s AND disabled = 0
		""",
		{"parent_codes": parent_codes},
		as_dict=True,
	)

	parent_to_variants = {}
	all_item_codes = set(parent_codes)
	for v in variants_raw:
		parent_to_variants.setdefault(v.variant_of, []).append(v)
		all_item_codes.add(v.name)

	all_item_codes = list(all_item_codes)

	# 3. Batch get Stock Balances from tabBin
	bin_records = frappe.db.sql(
		"""
		SELECT item_code, SUM(actual_qty) as total_qty
		FROM `tabBin`
		WHERE item_code IN %(item_codes)s
		GROUP BY item_code
		""",
		{"item_codes": all_item_codes},
		as_dict=True,
	)
	stock_map = {b.item_code: flt(b.total_qty) for b in bin_records}

	# 4. Batch get 30-Day Sales from tabSales Invoice Item
	start_date = add_days(today(), -30)
	sales_records = frappe.db.sql(
		"""
		SELECT sii.item_code, SUM(sii.qty) as sold_qty
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.item_code IN %(item_codes)s
		  AND si.docstatus = 1
		  AND si.posting_date >= %(start_date)s
		GROUP BY sii.item_code
		""",
		{"item_codes": all_item_codes, "start_date": start_date},
		as_dict=True,
	)
	sales_map = {s.item_code: flt(s.sold_qty) for s in sales_records}

	# 5. Batch get Prices from tabItem Price
	price_records = frappe.db.sql(
		"""
		SELECT item_code, price_list, price_list_rate, currency
		FROM `tabItem Price`
		WHERE item_code IN %(item_codes)s
		  AND price_list IN ('Standard Selling', 'Standard Buying')
		ORDER BY modified DESC
		""",
		{"item_codes": all_item_codes},
		as_dict=True,
	)
	selling_price_map = {}
	buying_price_map = {}
	currency = "TJS"
	for pr in price_records:
		currency = pr.currency or currency
		if pr.price_list == "Standard Selling" and pr.item_code not in selling_price_map:
			selling_price_map[pr.item_code] = flt(pr.price_list_rate)
		elif pr.price_list == "Standard Buying" and pr.item_code not in buying_price_map:
			buying_price_map[pr.item_code] = flt(pr.price_list_rate)

	# 6. Batch get active Pricing Rules (Discounts)
	active_rules = frappe.db.sql(
		"""
		SELECT pri.item_code, pr.discount_percentage, pr.rate_or_discount
		FROM `tabPricing Rule Item Code` pri
		JOIN `tabPricing Rule` pr ON pr.name = pri.parent
		WHERE pri.item_code IN %(item_codes)s
		  AND pr.disable = 0
		  AND pr.selling = 1
		  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
		  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
		ORDER BY pr.priority DESC, pr.modified DESC
		""",
		{"item_codes": all_item_codes, "today": today()},
		as_dict=True,
	)
	discount_map = {}
	for ar in active_rules:
		if ar.item_code not in discount_map:
			discount_map[ar.item_code] = flt(ar.discount_percentage)

	# Assemble final catalog items
	catalog = []
	for p in items_raw:
		p_code = p.name
		variants = parent_to_variants.get(p_code, [])

		if p.has_variants and variants:
			total_stock = sum(stock_map.get(v.name, 0) for v in variants)
			total_sold = sum(sales_map.get(v.name, 0) for v in variants)

			# Sizes can have different prices: show the lowest ("from") and flag a range
			sell_values = [selling_price_map[v.name] for v in variants if selling_price_map.get(v.name)]
			if not sell_values and selling_price_map.get(p_code):
				sell_values = [selling_price_map[p_code]]
			selling_price = min(sell_values) if sell_values else 0
			price_varies = bool(sell_values) and max(sell_values) != min(sell_values)

			buy_values = [buying_price_map[v.name] for v in variants if buying_price_map.get(v.name)]
			if not buy_values and buying_price_map.get(p_code):
				buy_values = [buying_price_map[p_code]]
			buying_price = min(buy_values) if buy_values else 0

			discount_pct = discount_map.get(p_code)
			if discount_pct is None and variants:
				discount_pct = discount_map.get(variants[0].name, 0)
			discount_pct = discount_pct or 0
		else:
			total_stock = stock_map.get(p_code, 0)
			total_sold = sales_map.get(p_code, 0)
			selling_price = selling_price_map.get(p_code, 0)
			buying_price = buying_price_map.get(p_code, 0)
			discount_pct = discount_map.get(p_code, 0)
			price_varies = False

		# Calculate final discounted price
		if discount_pct > 0:
			discounted_price = flt(selling_price * (1.0 - (discount_pct / 100.0)), 2)
		else:
			discounted_price = selling_price

		# Status badge
		if total_stock <= 0:
			status = "out_of_stock"
			status_label_tg = "Тамом шуд"
			status_label_ru = "Нет в наличии"
			status_color = "red"
		elif total_stock <= 5:
			status = "low_stock"
			status_label_tg = "Кам монд"
			status_label_ru = "Мало"
			status_color = "orange"
		else:
			status = "in_stock"
			status_label_tg = "Дар анбор"
			status_label_ru = "В наличии"
			status_color = "green"

		if status_filter and status_filter != "all" and status != status_filter:
			continue

		catalog.append({
			"item_code": p.name,
			"item_name": p.item_name,
			"item_group": p.item_group,
			"image": p.image or "",
			"custom_short_code": p.custom_short_code or "",
			"has_variants": p.has_variants,
			"variant_count": len(variants),
			"stock_qty": total_stock,
			"sold_qty": total_sold,
			"selling_price": selling_price,
			"price_varies": price_varies,
			"buying_price": buying_price,
			"discount_percentage": discount_pct,
			"discounted_price": discounted_price,
			"status": status,
			"status_label_tg": status_label_tg,
			"status_label_ru": status_label_ru,
			"status_color": status_color,
			"currency": currency,
		})

	item_groups = frappe.db.sql_list(
		"SELECT DISTINCT item_group FROM `tabItem` WHERE disabled = 0 ORDER BY item_group ASC"
	)

	return {
		"items": catalog,
		"total": len(catalog),
		"categories": item_groups,
		"currency": currency,
		"stores_warehouse": stores_wh,
	}
