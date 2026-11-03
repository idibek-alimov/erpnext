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
def get_catalog(search=None, item_group=None, status_filter=None, sort_by=None, page=1, page_size=20, company=None):
	company = company or get_default_company()
	stores_wh = get_stores_warehouse(company)
	page = max(1, cint(page) or 1)
	page_size = max(1, cint(page_size) or 20)

	conditions = ["(i.variant_of IS NULL OR i.variant_of = '')", "i.disabled = 0"]
	values = {}

	# 1. Category Filter
	if item_group and item_group != "All":
		conditions.append("i.item_group = %(item_group)s")
		values["item_group"] = item_group

	# 2. Search Filter (exact short code, name, item name, barcode, variant short code)
	if search and search.strip():
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

	# 3. Status Filter (applied directly at DB level across entire catalog)
	if status_filter == "in_stock":
		conditions.append("COALESCE(st.total_stock, 0) > 5")
	elif status_filter == "low_stock":
		conditions.append("COALESCE(st.total_stock, 0) > 0 AND COALESCE(st.total_stock, 0) <= 5")
	elif status_filter == "out_of_stock":
		conditions.append("COALESCE(st.total_stock, 0) <= 0")
	elif status_filter == "on_sale":
		today_str = today()
		values["today"] = today_str
		discount_item_groups = frappe.db.sql_list(
			"""
			SELECT DISTINCT prig.item_group
			FROM `tabPricing Rule Item Group` prig
			JOIN `tabPricing Rule` pr ON pr.name = prig.parent
			WHERE pr.disable = 0 AND pr.selling = 1 AND pr.discount_percentage > 0
			  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
			  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
			""",
			{"today": today_str},
		)
		discount_items = frappe.db.sql_list(
			"""
			SELECT DISTINCT pri.item_code
			FROM `tabPricing Rule Item Code` pri
			JOIN `tabPricing Rule` pr ON pr.name = pri.parent
			WHERE pr.disable = 0 AND pr.selling = 1 AND pr.discount_percentage > 0
			  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
			  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
			""",
			{"today": today_str},
		)
		discount_parents = []
		if discount_items:
			discount_parents = frappe.db.sql_list(
				"""
				SELECT DISTINCT COALESCE(NULLIF(variant_of, ''), name)
				FROM `tabItem`
				WHERE name IN %(discount_items)s
				""",
				{"discount_items": discount_items},
			)

		sale_clauses = []
		if discount_item_groups:
			values["discount_item_groups"] = discount_item_groups
			sale_clauses.append("i.item_group IN %(discount_item_groups)s")
		if discount_parents:
			values["discount_parents"] = discount_parents
			sale_clauses.append("i.name IN %(discount_parents)s")

		if sale_clauses:
			conditions.append(f"({' OR '.join(sale_clauses)})")
		else:
			conditions.append("1=0")

	# Stock Subquery for models/standalone items
	stock_subquery = """
		LEFT JOIN (
			SELECT 
				COALESCE(NULLIF(v.variant_of, ''), b.item_code) as parent_item,
				SUM(b.actual_qty) as total_stock,
				SUM(b.stock_value) as total_stock_value
			FROM `tabBin` b
			LEFT JOIN `tabItem` v ON v.name = b.item_code
			GROUP BY parent_item
		) st ON st.parent_item = i.name
	"""

	# 30-Day Sales Subquery (joined only if sorting by sold, otherwise calculated for paginated items)
	start_date = add_days(today(), -30)
	values["start_date"] = start_date

	sales_subquery = ""
	if sort_by == "sold_desc":
		sales_subquery = """
			LEFT JOIN (
				SELECT 
					COALESCE(NULLIF(v.variant_of, ''), sii.item_code) as parent_item,
					SUM(sii.qty) as sold_qty,
					SUM(sii.base_net_amount) as sold_amount
				FROM `tabSales Invoice Item` sii
				JOIN `tabSales Invoice` si ON si.name = sii.parent
				LEFT JOIN `tabItem` v ON v.name = sii.item_code
				WHERE si.docstatus = 1 AND si.posting_date >= %(start_date)s
				GROUP BY parent_item
			) sl ON sl.parent_item = i.name
		"""

	# 4. Sorting Across All Catalog Items in Database
	if sort_by == "stock_desc":
		order_clause = "COALESCE(st.total_stock, 0) DESC, i.modified DESC"
	elif sort_by == "stock_val_desc":
		order_clause = "COALESCE(st.total_stock_value, 0) DESC, i.modified DESC"
	elif sort_by == "sold_desc":
		order_clause = "COALESCE(sl.sold_qty, 0) DESC, i.modified DESC"
	elif sort_by == "name_asc":
		order_clause = "i.item_name ASC"
	else:
		order_clause = "i.modified DESC"

	where_clause = " AND ".join(conditions)

	# 5. Count Total Matching Items across entire database
	count_query = f"""
		SELECT COUNT(*)
		FROM `tabItem` i
		{stock_subquery}
		WHERE {where_clause}
	"""
	total_records = frappe.db.sql(count_query, values)[0][0]

	item_groups = frappe.db.sql_list(
		"SELECT DISTINCT item_group FROM `tabItem` WHERE disabled = 0 ORDER BY item_group ASC"
	)

	if not total_records:
		return {
			"items": [],
			"total": 0,
			"page": page,
			"page_size": page_size,
			"categories": item_groups,
			"currency": "TJS",
			"stores_warehouse": stores_wh,
		}

	# 6. Fetch only the current page slice
	offset = (page - 1) * page_size
	values["offset"] = offset
	values["page_size"] = page_size

	items_raw = frappe.db.sql(
		f"""
		SELECT
			i.name, i.item_name, i.item_group, i.image, i.has_variants,
			i.custom_short_code, i.stock_uom, i.modified,
			COALESCE(st.total_stock, 0) as total_stock,
			COALESCE(st.total_stock_value, 0) as total_stock_value
		FROM `tabItem` i
		{stock_subquery}
		{sales_subquery}
		WHERE {where_clause}
		ORDER BY {order_clause}
		LIMIT %(offset)s, %(page_size)s
		""",
		values,
		as_dict=True,
	)

	parent_codes = [it.name for it in items_raw]

	# 7. Batch get variants for the current page items only
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

	# 8. Batch get stock balances and valuation for current page items
	bin_records = frappe.db.sql(
		"""
		SELECT item_code, SUM(actual_qty) as total_qty, SUM(stock_value) as total_stock_value
		FROM `tabBin`
		WHERE item_code IN %(item_codes)s
		GROUP BY item_code
		""",
		{"item_codes": all_item_codes},
		as_dict=True,
	)
	stock_map = {b.item_code: flt(b.total_qty) for b in bin_records}
	stock_val_map = {b.item_code: flt(b.total_stock_value) for b in bin_records}

	# 9. Batch get 30-day sales and revenue for current page items
	sales_records = frappe.db.sql(
		"""
		SELECT sii.item_code, SUM(sii.qty) as sold_qty, SUM(sii.base_net_amount) as sold_amount
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
	sales_amount_map = {s.item_code: flt(s.sold_amount) for s in sales_records}

	# 10. Batch get prices for current page items
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

	# 11. Batch get active pricing rules (discounts) for current page items
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
		ORDER BY CAST(pr.priority AS UNSIGNED) DESC, pr.modified DESC
		""",
		{"item_codes": all_item_codes, "today": today()},
		as_dict=True,
	)
	discount_map = {}
	for ar in active_rules:
		if ar.item_code not in discount_map:
			discount_map[ar.item_code] = flt(ar.discount_percentage)

	category_rules = frappe.db.sql(
		"""
		SELECT prig.item_group, pr.discount_percentage
		FROM `tabPricing Rule Item Group` prig
		JOIN `tabPricing Rule` pr ON pr.name = prig.parent
		WHERE pr.disable = 0
		  AND pr.selling = 1
		  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
		  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
		ORDER BY CAST(pr.priority AS UNSIGNED) DESC, pr.modified DESC
		""",
		{"today": today()},
		as_dict=True,
	)
	category_discount_map = {}
	for cr in category_rules:
		if cr.item_group not in category_discount_map:
			category_discount_map[cr.item_group] = flt(cr.discount_percentage)

	# Assemble final catalog items for the page
	catalog = []
	for p in items_raw:
		p_code = p.name
		variants = parent_to_variants.get(p_code, [])

		if p.has_variants and variants:
			total_stock = sum(stock_map.get(v.name, 0) for v in variants)
			total_sold = sum(sales_map.get(v.name, 0) for v in variants)
			total_sold_amount = sum(sales_amount_map.get(v.name, 0) for v in variants)

			# Sizes can have different prices: show lowest and flag range
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
			if discount_pct is None:
				for v in variants:
					if v.name in discount_map:
						discount_pct = discount_map[v.name]
						break
			if discount_pct is None:
				discount_pct = category_discount_map.get(p.item_group, 0)
			discount_pct = discount_pct or 0

			# Stock valuation at cost
			stock_val_cost = sum(
				stock_val_map.get(v.name, 0) or (stock_map.get(v.name, 0) * (buying_price_map.get(v.name) or buying_price))
				for v in variants
			)
			if stock_val_cost == 0 and total_stock > 0 and buying_price > 0:
				stock_val_cost = total_stock * buying_price

			# Stock valuation at retail
			if discount_pct > 0:
				discounted_price = flt(selling_price * (1.0 - (discount_pct / 100.0)), 2)
			else:
				discounted_price = selling_price

			stock_val_retail = sum(
				stock_map.get(v.name, 0) * (selling_price_map.get(v.name) or selling_price)
				for v in variants
			)
			if stock_val_retail == 0 and total_stock > 0 and discounted_price > 0:
				stock_val_retail = total_stock * discounted_price
		else:
			total_stock = stock_map.get(p_code, 0)
			total_sold = sales_map.get(p_code, 0)
			total_sold_amount = sales_amount_map.get(p_code, 0)
			selling_price = selling_price_map.get(p_code, 0)
			buying_price = buying_price_map.get(p_code, 0)
			discount_pct = discount_map.get(p_code)
			if discount_pct is None:
				discount_pct = category_discount_map.get(p.item_group, 0)
			discount_pct = discount_pct or 0
			price_varies = False

			if discount_pct > 0:
				discounted_price = flt(selling_price * (1.0 - (discount_pct / 100.0)), 2)
			else:
				discounted_price = selling_price

			stock_val_cost = stock_val_map.get(p_code, 0)
			if stock_val_cost == 0 and total_stock > 0 and buying_price > 0:
				stock_val_cost = total_stock * buying_price

			stock_val_retail = total_stock * discounted_price

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

		catalog.append({
			"item_code": p.name,
			"item_name": p.item_name,
			"item_group": p.item_group,
			"image": p.image or "",
			"custom_short_code": p.custom_short_code or "",
			"has_variants": p.has_variants,
			"variant_count": len(variants),
			"stock_uom": p.stock_uom or "Nos",
			"stock_qty": flt(total_stock, 2),
			"stock_value_cost": flt(stock_val_cost, 2),
			"stock_value_retail": flt(stock_val_retail, 2),
			"sold_qty": flt(total_sold, 2),
			"sold_amount": flt(total_sold_amount, 2),
			"selling_price": flt(selling_price, 2),
			"price_varies": price_varies,
			"buying_price": flt(buying_price, 2),
			"discount_percentage": flt(discount_pct, 1),
			"discounted_price": flt(discounted_price, 2),
			"status": status,
			"status_label_tg": status_label_tg,
			"status_label_ru": status_label_ru,
			"status_color": status_color,
			"currency": currency,
		})

	return {
		"items": catalog,
		"total": total_records,
		"page": page,
		"page_size": page_size,
		"categories": item_groups,
		"currency": currency,
		"stores_warehouse": stores_wh,
	}
