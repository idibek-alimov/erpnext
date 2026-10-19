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

			# Resolve price from template or first variant
			selling_price = selling_price_map.get(p_code)
			if selling_price is None and variants:
				selling_price = selling_price_map.get(variants[0].name, 0)
			selling_price = selling_price or 0

			buying_price = buying_price_map.get(p_code)
			if buying_price is None and variants:
				buying_price = buying_price_map.get(variants[0].name, 0)
			buying_price = buying_price or 0

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


@frappe.whitelist()
def get_product_details(item_code, company=None):
	company = company or get_default_company()
	stores_wh = get_stores_warehouse(company)

	item = frappe.get_doc("Item", item_code)
	currency = frappe.get_cached_value("Company", company, "default_currency") or "TJS"

	# Get master prices
	selling_price = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "price_list": "Standard Selling"}, "price_list_rate"
	) or 0

	buying_price = frappe.db.get_value(
		"Item Price", {"item_code": item_code, "price_list": "Standard Buying"}, "price_list_rate"
	) or 0

	discount_pct = frappe.db.sql(
		"""
		SELECT pr.discount_percentage
		FROM `tabPricing Rule Item Code` pri
		JOIN `tabPricing Rule` pr ON pr.name = pri.parent
		WHERE pri.item_code = %s AND pr.disable = 0 AND pr.selling = 1
		LIMIT 1
		""",
		(item_code,),
	)
	discount_pct = flt(discount_pct[0][0]) if discount_pct else 0

	variants_data = []

	if item.has_variants:
		# Fetch all variants
		variant_docs = frappe.get_all(
			"Item",
			filters={"variant_of": item_code, "disabled": 0},
			fields=["name", "item_name", "custom_short_code"],
			order_by="custom_short_code ASC, name ASC",
		)

		for v in variant_docs:
			# Attributes
			attrs = frappe.get_all(
				"Item Variant Attribute",
				filters={"parent": v.name},
				fields=["attribute", "attribute_value"],
			)
			color = ""
			size = ""
			for a in attrs:
				attr_lower = (a.attribute or "").lower()
				if "color" in attr_lower or "colour" in attr_lower:
					color = a.attribute_value
				elif "size" in attr_lower:
					size = a.attribute_value

			# Barcode
			barcode = frappe.db.get_value("Item Barcode", {"parent": v.name}, "barcode") or v.custom_short_code or ""

			# Stock
			stock_qty = flt(frappe.db.get_value("tabBin", {"item_code": v.name, "warehouse": stores_wh}, "actual_qty") or 0)
			# Fallback if no stock in stores_wh specifically
			if not stock_qty:
				stock_qty = flt(frappe.db.sql("SELECT SUM(actual_qty) FROM tabBin WHERE item_code = %s", (v.name,))[0][0] or 0)

			# Sold (last 30 days)
			sold_qty = flt(
				frappe.db.sql(
					"""
					SELECT SUM(sii.qty)
					FROM `tabSales Invoice Item` sii
					JOIN `tabSales Invoice` si ON si.name = sii.parent
					WHERE sii.item_code = %s AND si.docstatus = 1
					""",
					(v.name,),
				)[0][0]
				or 0
			)

			v_sell = frappe.db.get_value("Item Price", {"item_code": v.name, "price_list": "Standard Selling"}, "price_list_rate") or selling_price
			v_buy = frappe.db.get_value("Item Price", {"item_code": v.name, "price_list": "Standard Buying"}, "price_list_rate") or buying_price

			variants_data.append({
				"item_code": v.name,
				"variant_title": v.item_name,
				"color": color,
				"size": size,
				"custom_short_code": v.custom_short_code or "",
				"barcode": barcode,
				"stock_qty": stock_qty,
				"sold_qty": sold_qty,
				"selling_price": flt(v_sell),
				"buying_price": flt(v_buy),
			})
	else:
		# Single item
		barcode = frappe.db.get_value("Item Barcode", {"parent": item_code}, "barcode") or item.custom_short_code or ""
		stock_qty = flt(frappe.db.get_value("tabBin", {"item_code": item_code, "warehouse": stores_wh}, "actual_qty") or 0)
		if not stock_qty:
			stock_qty = flt(frappe.db.sql("SELECT SUM(actual_qty) FROM tabBin WHERE item_code = %s", (item_code,))[0][0] or 0)

		sold_qty = flt(
			frappe.db.sql(
				"""
				SELECT SUM(sii.qty)
				FROM `tabSales Invoice Item` sii
				JOIN `tabSales Invoice` si ON si.name = sii.parent
				WHERE sii.item_code = %s AND si.docstatus = 1
				""",
				(item_code,),
			)[0][0]
			or 0
		)

		variants_data.append({
			"item_code": item_code,
			"variant_title": item.item_name,
			"color": "-",
			"size": "-",
			"custom_short_code": item.custom_short_code or "",
			"barcode": barcode,
			"stock_qty": stock_qty,
			"sold_qty": sold_qty,
			"selling_price": flt(selling_price),
			"buying_price": flt(buying_price),
		})

	# Suppliers list for dropdown
	suppliers = frappe.db.sql_list("SELECT name FROM `tabSupplier` WHERE disabled = 0 ORDER BY name ASC LIMIT 50")

	total_stock = sum(v["stock_qty"] for v in variants_data)
	total_sold = sum(v["sold_qty"] for v in variants_data)

	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"image": item.image or "",
		"custom_short_code": item.custom_short_code or "",
		"has_variants": item.has_variants,
		"selling_price": flt(selling_price),
		"buying_price": flt(buying_price),
		"discount_percentage": flt(discount_pct),
		"currency": currency,
		"total_stock": total_stock,
		"total_sold": total_sold,
		"stores_warehouse": stores_wh,
		"variants": variants_data,
		"suppliers": suppliers,
	}


@frappe.whitelist()
def restock_items(item_code, items_data, supplier=None, company=None):
	company = company or get_default_company()
	stores_wh = get_stores_warehouse(company)
	currency = frappe.get_cached_value("Company", company, "default_currency") or "TJS"

	if isinstance(items_data, str):
		items_data = json.loads(items_data)

	valid_items = [r for r in items_data if flt(r.get("qty", 0)) > 0]
	if not valid_items:
		frappe.throw(_("Please enter a quantity greater than 0 for at least one item."))

	if supplier:
		# Create Purchase Invoice with update_stock = 1
		pi = frappe.new_doc("Purchase Invoice")
		pi.company = company
		pi.supplier = supplier
		pi.posting_date = today()
		pi.bill_date = today()
		pi.bill_no = f"RESTOCK-{today()}-{frappe.generate_hash(length=4).upper()}"
		pi.update_stock = 1
		pi.currency = currency
		pi.remarks = _("Quick Restock for {0}").format(item_code)

		for r in valid_items:
			rate = flt(r.get("buying_price") or 0)
			if rate <= 0:
				rate = flt(frappe.db.get_value("Item Price", {"item_code": r["item_code"], "price_list": "Standard Buying"}, "price_list_rate") or 1)

			pi.append(
				"items",
				{
					"item_code": r["item_code"],
					"qty": flt(r["qty"]),
					"rate": rate,
					"warehouse": stores_wh,
				},
			)

		pi.flags.ignore_permissions = True
		pi.flags.ignore_mandatory = True
		pi.insert()
		pi.submit()
		return {"success": True, "doctype": "Purchase Invoice", "name": pi.name, "docstatus": pi.docstatus}
	else:
		# Create Stock Entry (Material Receipt)
		se = frappe.new_doc("Stock Entry")
		se.stock_entry_type = "Material Receipt"
		se.company = company
		se.posting_date = today()
		se.remarks = _("Quick Restock for {0}").format(item_code)

		for r in valid_items:
			rate = flt(r.get("buying_price") or 0)
			if rate <= 0:
				rate = flt(frappe.db.get_value("Item Price", {"item_code": r["item_code"], "price_list": "Standard Buying"}, "price_list_rate") or 1)

			se.append(
				"items",
				{
					"item_code": r["item_code"],
					"qty": flt(r["qty"]),
					"t_warehouse": stores_wh,
					"basic_rate": rate,
				},
			)

		se.flags.ignore_permissions = True
		se.flags.ignore_mandatory = True
		se.insert()
		se.submit()
		return {"success": True, "doctype": "Stock Entry", "name": se.name, "docstatus": se.docstatus}


@frappe.whitelist()
def update_prices_and_discount(item_code, selling_price, buying_price=None, discount_percentage=0, company=None):
	company = company or get_default_company()
	currency = frappe.get_cached_value("Company", company, "default_currency") or "TJS"
	selling_price = flt(selling_price)
	buying_price = flt(buying_price) if buying_price is not None else None
	discount_percentage = flt(discount_percentage)

	if selling_price <= 0:
		frappe.throw(_("Retail (Selling Price) must be greater than 0"))

	item = frappe.get_doc("Item", item_code)
	item_codes_to_update = [item_code]

	if item.has_variants:
		variants = frappe.get_all("Item", filters={"variant_of": item_code, "disabled": 0}, pluck="name")
		item_codes_to_update.extend(variants)

	# 1. Update Standard Selling price for all
	for ic in item_codes_to_update:
		existing_sp = frappe.db.get_value("Item Price", {"item_code": ic, "price_list": "Standard Selling"}, "name")
		if existing_sp:
			frappe.db.set_value("Item Price", existing_sp, "price_list_rate", selling_price)
		else:
			frappe.get_doc({
				"doctype": "Item Price",
				"item_code": ic,
				"price_list": "Standard Selling",
				"price_list_rate": selling_price,
				"currency": currency,
			}).insert(ignore_permissions=True)

		if buying_price is not None and buying_price > 0:
			existing_bp = frappe.db.get_value("Item Price", {"item_code": ic, "price_list": "Standard Buying"}, "name")
			if existing_bp:
				frappe.db.set_value("Item Price", existing_bp, "price_list_rate", buying_price)
			else:
				frappe.get_doc({
					"doctype": "Item Price",
					"item_code": ic,
					"price_list": "Standard Buying",
					"price_list_rate": buying_price,
					"currency": currency,
				}).insert(ignore_permissions=True)

	# 2. Update or Cancel Pricing Rule
	rule_name = frappe.db.sql(
		"""
		SELECT pri.parent
		FROM `tabPricing Rule Item Code` pri
		JOIN `tabPricing Rule` pr ON pr.name = pri.parent
		WHERE pri.item_code = %s AND pr.selling = 1
		LIMIT 1
		""",
		(item_code,),
	)

	if discount_percentage > 0:
		if rule_name:
			rule = frappe.get_doc("Pricing Rule", rule_name[0][0])
			if rule.docstatus == 1:
				rule.cancel()
		# Create clean submitted pricing rule
		new_rule = frappe.new_doc("Pricing Rule")
		new_rule.title = f"Promo {discount_percentage}% - {item.item_name}"
		new_rule.apply_on = "Item Code"
		new_rule.price_or_product_discount = "Price"
		new_rule.rate_or_discount = "Discount Percentage"
		new_rule.discount_percentage = discount_percentage
		new_rule.selling = 1
		new_rule.for_price_list = "Standard Selling"
		new_rule.company = company
		for ic in item_codes_to_update:
			new_rule.append("items", {"item_code": ic})
		new_rule.flags.ignore_permissions = True
		new_rule.insert()
		new_rule.submit()
	else:
		# Cancel if 0 discount
		if rule_name:
			rule = frappe.get_doc("Pricing Rule", rule_name[0][0])
			if rule.docstatus == 1:
				rule.cancel()

	return {"success": True, "selling_price": selling_price, "buying_price": buying_price, "discount_percentage": discount_percentage}
