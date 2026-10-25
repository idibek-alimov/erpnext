# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, cint, add_days, today, format_date, nowtime
from erpnext.stock.page.product_catalog.product_catalog import get_default_company, get_stores_warehouse


def _generate_ean13():
	last = frappe.db.sql("""
		SELECT barcode FROM `tabItem Barcode`
		WHERE barcode LIKE '20%' AND LENGTH(barcode) = 13
		ORDER BY barcode DESC LIMIT 1
	""")
	next_num = int(last[0][0][:-1]) + 1 if last and last[0][0] else 200000000000
	base = str(next_num).zfill(12)
	total = sum(int(d) * (1 if i % 2 == 0 else 3) for i, d in enumerate(base))
	check = str((10 - (total % 10)) % 10)
	return base + check


@frappe.whitelist()
def fix_all_legacy_barcodes():
	rows = frappe.db.sql("""
		SELECT name, parent, barcode FROM `tabItem Barcode`
		WHERE LENGTH(barcode) < 12
		ORDER BY creation ASC
	""", as_dict=True)
	updated = 0
	for r in rows:
		ean = _generate_ean13()
		frappe.db.set_value("Item Barcode", r.name, {"barcode": ean, "barcode_type": "EAN"}, update_modified=False)
		updated += 1
	frappe.db.commit()
	return {"updated": updated}


@frappe.whitelist()
def get_product_detail(item_code):
	if not item_code:
		frappe.throw(_("Укажите код товара."))

	if not frappe.db.exists("Item", item_code):
		# Try lookup by short code
		code_by_short = frappe.db.get_value("Item", {"custom_short_code": item_code, "disabled": 0}, "name")
		if code_by_short:
			item_code = code_by_short
		else:
			# Try barcode lookup
			code_by_barcode = frappe.db.get_value("Item Barcode", {"barcode": item_code}, "parent")
			if code_by_barcode:
				item_code = code_by_barcode

	# If variant was supplied, navigate up to parent template
	parent_template = frappe.db.get_value("Item", item_code, "variant_of")
	if parent_template:
		item_code = parent_template

	if not frappe.has_permission("Item", "read", item_code):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	item = frappe.db.get_value(
		"Item",
		item_code,
		["name", "item_name", "item_group", "image", "has_variants", "custom_short_code", "stock_uom"],
		as_dict=True,
	)
	if not item:
		frappe.throw(_("Товар {0} не найден").format(item_code))

	if item.has_variants:
		variants = frappe.get_all(
			"Item",
			filters={"variant_of": item_code, "disabled": 0},
			fields=["name", "item_name", "image", "custom_short_code"],
			order_by="creation asc",
		)
	else:
		variants = [
			frappe._dict(
				name=item.name,
				item_name=item.item_name,
				image=item.image,
				custom_short_code=item.custom_short_code,
			)
		]

	codes = [v.name for v in variants] or [item_code]

	# Barcodes (Ensure all variants have real EAN-13 barcodes)
	barcode_map = {}
	all_item_codes = list(set(codes + [item_code]))

	existing_barcodes = frappe.get_all(
		"Item Barcode",
		filters={"parent": ["in", all_item_codes]},
		fields=["name", "parent", "barcode", "barcode_type"],
		order_by="idx asc",
	)

	for b in existing_barcodes:
		if b.parent not in barcode_map and b.barcode and len(b.barcode) >= 12:
			barcode_map[b.parent] = b.barcode
		elif b.parent not in barcode_map:
			new_ean = _generate_ean13()
			frappe.db.set_value("Item Barcode", b.name, {"barcode": new_ean, "barcode_type": "EAN"}, update_modified=False)
			barcode_map[b.parent] = new_ean

	for code in all_item_codes:
		if code not in barcode_map:
			new_ean = _generate_ean13()
			frappe.get_doc({
				"doctype": "Item Barcode",
				"parent": code,
				"parenttype": "Item",
				"parentfield": "barcodes",
				"barcode": new_ean,
				"barcode_type": "EAN",
			}).insert(ignore_permissions=True)
			barcode_map[code] = new_ean

	# Attributes (Colour / Size)
	attr_map = {}
	for a in frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", codes]},
		fields=["parent", "attribute", "attribute_value"],
	):
		attr_map.setdefault(a.parent, {})[a.attribute.lower()] = a.attribute_value

	stock_map = {
		b.item_code: flt(b.qty)
		for b in frappe.db.sql(
			"""SELECT item_code, SUM(actual_qty) qty FROM `tabBin`
			WHERE item_code IN %(c)s GROUP BY item_code""",
			{"c": codes},
			as_dict=True,
		)
	}

	# Buying and Selling prices
	sell_map, buy_map = {}, {}
	for p in frappe.db.sql(
		"""SELECT item_code, price_list, price_list_rate FROM `tabItem Price`
		WHERE item_code IN %(c)s AND price_list IN ('Standard Selling', 'Standard Buying')
		ORDER BY modified DESC""",
		{"c": codes},
		as_dict=True,
	):
		target = sell_map if p.price_list == "Standard Selling" else buy_map
		target.setdefault(p.item_code, flt(p.price_list_rate))

	# Effective Active Pricing Rules (Discounts)
	active_item_rules = frappe.db.sql(
		"""SELECT pri.item_code, pr.name as rule_name, pr.title, pr.priority, pr.discount_percentage, pr.rate, pr.rate_or_discount
		FROM `tabPricing Rule Item Code` pri
		JOIN `tabPricing Rule` pr ON pr.name = pri.parent
		WHERE pri.item_code IN %(c)s
		  AND pr.disable = 0
		  AND pr.selling = 1
		  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
		  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
		ORDER BY CAST(pr.priority AS UNSIGNED) DESC, pr.modified DESC""",
		{"c": codes, "today": today()},
		as_dict=True,
	)

	active_cat_rules = frappe.db.sql(
		"""SELECT prig.item_group, pr.name as rule_name, pr.title, pr.priority, pr.discount_percentage, pr.rate, pr.rate_or_discount
		FROM `tabPricing Rule Item Group` prig
		JOIN `tabPricing Rule` pr ON pr.name = prig.parent
		WHERE prig.item_group = %(ig)s
		  AND pr.disable = 0
		  AND pr.selling = 1
		  AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
		  AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
		ORDER BY CAST(pr.priority AS UNSIGNED) DESC, pr.modified DESC""",
		{"ig": item.item_group, "today": today()},
		as_dict=True,
	)

	def get_rule_badge(priority_val, title_val):
		p = cint(priority_val)
		if p >= 20 or "Tier 1" in (title_val or "") or "Ликвидация" in (title_val or ""):
			return "🔴 ТОП-1 Ликвидация"
		elif p >= 15 or "Tier 2" in (title_val or "") or "Акция на товар" in (title_val or ""):
			return "🟠 ТОП-2 Акция"
		elif p >= 10 or "Tier 3" in (title_val or "") or "Распродажа" in (title_val or ""):
			return "🟡 ТОП-3 Распродажа"
		elif p >= 5 or "Tier 4" in (title_val or "") or "Лояльность" in (title_val or ""):
			return "🟢 ТОП-4 Лояльность"
		return "🏷️ Акция"

	item_rule_map = {}
	for r in active_item_rules:
		if r.item_code not in item_rule_map:
			item_rule_map[r.item_code] = r

	cat_rule = active_cat_rules[0] if active_cat_rules else None


	# All historical sales items
	sales_records = frappe.db.sql(
		"""SELECT sii.item_code, sii.qty, sii.amount, si.posting_date
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name = sii.parent
		WHERE sii.item_code IN %(c)s AND si.docstatus = 1
		ORDER BY si.posting_date ASC""",
		{"c": codes},
		as_dict=True,
	)

	sold_map = {}
	total_revenue = 0.0
	total_cost = 0.0
	item_revenue_map = {}
	item_cost_map = {}

	for s in sales_records:
		q = flt(s.qty)
		amt = flt(s.amount)
		c_code = s.item_code
		sold_map[c_code] = sold_map.get(c_code, 0) + q
		total_revenue += amt
		cost = q * buy_map.get(c_code, 0)
		total_cost += cost
		item_revenue_map[c_code] = item_revenue_map.get(c_code, 0.0) + amt
		item_cost_map[c_code] = item_cost_map.get(c_code, 0.0) + cost

	total_profit = total_revenue - total_cost
	margin_pct = flt((total_profit / total_revenue) * 100, 1) if total_revenue > 0 else 0.0

	# 30-day Daily Sales Chart Series
	days_list = [add_days(today(), -i) for i in range(29, -1, -1)]
	daily_map = {}
	daily_color_map = {}
	for s in sales_records:
		p_date = str(s.posting_date)
		q = flt(s.qty)
		daily_map[p_date] = daily_map.get(p_date, 0) + q
		v_color = attr_map.get(s.item_code, {}).get("colour") or attr_map.get(s.item_code, {}).get("color") or ""
		if v_color:
			daily_color_map.setdefault(v_color, {})
			daily_color_map[v_color][p_date] = daily_color_map[v_color].get(p_date, 0) + q

	chart_labels = [format_date(d, "dd MMM") for d in days_list]
	chart_values = [daily_map.get(str(d), 0) for d in days_list]

	color_chart_values = {}
	for col, c_data in daily_color_map.items():
		color_chart_values[col] = [c_data.get(str(d), 0) for d in days_list]

	# Group variants by color
	colors, order = {}, []
	for v in variants:
		attrs = attr_map.get(v.name, {})
		color = attrs.get("colour") or attrs.get("color") or ""
		size = attrs.get("size") or ""
		if color not in colors:
			colors[color] = {
				"color": color,
				"image": "",
				"sizes": [],
				"stock": 0,
				"sold": 0,
				"revenue": 0.0,
				"profit": 0.0,
				"margin_pct": 0.0,
				"sold_last_30d": 0,
				"velocity_per_day": 0.0,
				"runway_days": 0,
				"top_sizes": [],
			}
			order.append(color)

		c = colors[color]
		if v.image and not c["image"]:
			c["image"] = v.image

		stock, sold = stock_map.get(v.name, 0), sold_map.get(v.name, 0)
		c["stock"] += stock
		c["sold"] += sold
		c["revenue"] += item_revenue_map.get(v.name, 0.0)
		c["profit"] += item_revenue_map.get(v.name, 0.0) - item_cost_map.get(v.name, 0.0)

		# Check effective discount
		eff_rule = item_rule_map.get(v.name) or item_rule_map.get(item_code)
		if not eff_rule and cat_rule:
			eff_rule = cat_rule
		elif eff_rule and cat_rule:
			if cint(cat_rule.priority) > cint(eff_rule.priority):
				eff_rule = cat_rule

		base_sell = sell_map.get(v.name, 0)
		discount_info = {
			"has_discount": False,
			"discount_percentage": 0.0,
			"discounted_price": base_sell,
			"tier_badge": "",
			"title": "",
		}
		if eff_rule:
			if eff_rule.rate_or_discount == "Rate" and flt(eff_rule.rate) > 0:
				promo = flt(eff_rule.rate)
				pct = flt(((base_sell - promo) / base_sell) * 100.0, 1) if base_sell > promo else 0.0
			else:
				pct = flt(eff_rule.discount_percentage)
				promo = flt(base_sell * (1.0 - (pct / 100.0)), 2) if pct > 0 else base_sell

			discount_info = {
				"has_discount": True,
				"discount_percentage": pct,
				"discounted_price": promo,
				"tier_badge": get_rule_badge(eff_rule.priority, eff_rule.title),
				"title": eff_rule.title,
			}

		c["sizes"].append(
			{
				"item_code": v.name,
				"item_name": v.item_name,
				"size": size or v.item_name,
				"short_code": v.custom_short_code or "",
				"barcode": barcode_map.get(v.name) or v.custom_short_code or v.name,
				"stock_qty": stock,
				"sold_qty": sold,
				"buying_price": buy_map.get(v.name, 0),
				"selling_price": base_sell,
				"discount": discount_info,
			}
		)

	# Compute stats and top sizes for each color
	for c in colors.values():
		c_discounts = [s["discount"] for s in c["sizes"] if s["discount"]["has_discount"]]
		c["discount"] = c_discounts[0] if c_discounts else {"has_discount": False}

		c["margin_pct"] = flt((c["profit"] / c["revenue"]) * 100, 1) if c["revenue"] > 0 else 0.0
		c["sold_last_30d"] = sum(daily_color_map.get(c["color"], {}).values())
		c["velocity_per_day"] = round(c["sold_last_30d"] / 30.0, 1)
		c["runway_days"] = (
			round(c["stock"] / c["velocity_per_day"])
			if c["velocity_per_day"] > 0
			else (999 if c["stock"] > 0 else 0)
		)

		# Top sizes for this color (up to 3)
		valid_sizes = [s for s in c["sizes"] if s["sold_qty"] > 0]
		valid_sizes.sort(key=lambda s: s["sold_qty"], reverse=True)
		c_sold = c["sold"] or 1
		c["top_sizes"] = [
			{
				"name": s["size"],
				"qty": s["sold_qty"],
				"pct": round((s["sold_qty"] / c_sold) * 100),
			}
			for s in valid_sizes[:3]
		]

	total_stock = sum(c["stock"] for c in colors.values())
	total_sold = sum(c["sold"] for c in colors.values())

	# Best selling sizes overall (up to 3)
	size_sales = {}
	for v in variants:
		attrs = attr_map.get(v.name, {})
		sz = attrs.get("size") or v.item_name
		size_sales[sz] = size_sales.get(sz, 0) + sold_map.get(v.name, 0)

	top_sizes_overall = []
	if size_sales:
		sorted_sizes = sorted(size_sales.items(), key=lambda x: x[1], reverse=True)
		t_sold = total_sold or 1
		top_sizes_overall = [
			{"name": k, "qty": v, "pct": round((v / t_sold) * 100)}
			for k, v in sorted_sizes[:3]
			if v > 0
		]

	# Best selling colors overall (up to 3)
	color_sales = {c["color"]: c["sold"] for c in colors.values() if c["color"]}
	top_colors_overall = []
	if color_sales:
		sorted_colors = sorted(color_sales.items(), key=lambda x: x[1], reverse=True)
		t_sold = total_sold or 1
		top_colors_overall = [
			{"name": k, "qty": v, "pct": round((v / t_sold) * 100)}
			for k, v in sorted_colors[:3]
			if v > 0
		]

	sold_last_30d = sum(chart_values)
	velocity_per_day = round(sold_last_30d / 30.0, 1)
	runway_days = round(total_stock / velocity_per_day) if velocity_per_day > 0 else (999 if total_stock > 0 else 0)

	top_discount = None
	for c in colors.values():
		if c.get("discount", {}).get("has_discount"):
			top_discount = c["discount"]
			break

	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"image": item.image or "",
		"short_code": item.custom_short_code or "",
		"stock_uom": item.stock_uom or "шт",
		"barcode": barcode_map.get(item.name) or item.custom_short_code or item.name,
		"company_name": frappe.db.get_single_value("Global Defaults", "default_company") or frappe.defaults.get_user_default("company") or "Radolfa",
		"has_variants": item.has_variants,
		"supplier": get_supplier(item_code, codes),
		"currency": frappe.db.get_default("currency") or "TJS",
		"effective_discount": top_discount,
		"total_stock": total_stock,
		"total_sold": total_sold,
		"total_revenue": total_revenue,
		"total_profit": total_profit,
		"margin_pct": margin_pct,
		"sold_last_30d": sold_last_30d,
		"velocity_per_day": velocity_per_day,
		"runway_days": runway_days,
		"top_sizes": top_sizes_overall,
		"top_colors": top_colors_overall,
		"chart_labels": chart_labels,
		"chart_values": chart_values,
		"color_chart_values": color_chart_values,
		"colors": [colors[k] for k in order],
	}


def get_supplier(item_code, codes):
	supplier = frappe.db.get_value("Item Default", {"parent": item_code}, "default_supplier")
	if supplier:
		return supplier
	row = frappe.db.sql(
		"""SELECT pi.supplier FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pii.item_code IN %(c)s AND pi.docstatus = 1
		ORDER BY pi.posting_date DESC, pi.creation DESC LIMIT 1""",
		{"c": codes},
	)
	return row[0][0] if row else ""


@frappe.whitelist()
def update_color_image(item_code, color=None, image_url=None):
	"""Uploads/attaches an image to all variants of a given color, and/or template item."""
	if not frappe.has_permission("Item", "write", item_code):
		frappe.throw(_("Not permitted to edit item"), frappe.PermissionError)

	if not image_url:
		frappe.throw(_("Image URL is required"))

	template_image = frappe.db.get_value("Item", item_code, "image")
	if not template_image:
		frappe.db.set_value("Item", item_code, "image", image_url)

	updated_count = 0
	if color:
		variants = frappe.db.sql_list(
			"""
			SELECT iva.parent FROM `tabItem Variant Attribute` iva
			JOIN `tabItem` i ON i.name = iva.parent
			WHERE i.variant_of = %(item_code)s
			  AND LOWER(iva.attribute) IN ('colour', 'color')
			  AND iva.attribute_value = %(color)s
			""",
			{"item_code": item_code, "color": color},
		)
		for v in variants:
			frappe.db.set_value("Item", v, "image", image_url)
			updated_count += 1
	else:
		frappe.db.set_value("Item", item_code, "image", image_url)
		updated_count += 1

	frappe.clear_cache(doctype="Item")
	return {"success": True, "image": image_url, "updated_count": updated_count}


@frappe.whitelist()
def reconcile_stock(item_code, changes, reason=None, warehouse=None):
	"""Adjusts stock balance for variants using an official Stock Reconciliation entry."""
	if not frappe.has_permission("Item", "write", item_code):
		frappe.throw(_("Not permitted to adjust stock for this item"), frappe.PermissionError)

	if isinstance(changes, str):
		changes = frappe.parse_json(changes)

	if not changes or not isinstance(changes, list):
		return {"success": True, "reconciled": False, "message": "No changes"}

	company = get_default_company()
	if not warehouse:
		warehouse = get_stores_warehouse(company)

	if not warehouse:
		frappe.throw(_("No default store warehouse found for company {0}").format(company))

	items_to_adjust = []
	for ch in changes:
		variant_code = ch.get("item_code")
		if not variant_code:
			continue
		new_qty = flt(ch.get("qty"))
		orig_qty = flt(ch.get("orig_qty"))
		if new_qty < 0:
			frappe.throw(_("Quantity cannot be negative for item {0}").format(variant_code))

		if new_qty != orig_qty:
			items_to_adjust.append({
				"item_code": variant_code,
				"warehouse": warehouse,
				"qty": new_qty,
			})

	if not items_to_adjust:
		return {"success": True, "reconciled": False, "message": "No quantity changes detected"}

	# Create and submit Stock Reconciliation
	sr = frappe.new_doc("Stock Reconciliation")
	sr.company = company
	sr.purpose = "Stock Reconciliation"
	sr.set_posting_time = 1
	sr.posting_date = today()
	sr.posting_time = nowtime()
	sr.remarks = f"Ислоҳи бақия / Корректировка остатков: {reason or 'Инвентаризация'} ({item_code})"

	for row in items_to_adjust:
		# Check existing valuation rate if available
		val_rate = frappe.db.get_value("Bin", {"item_code": row["item_code"], "warehouse": warehouse}, "valuation_rate")
		if not val_rate or flt(val_rate) <= 0:
			val_rate = frappe.db.get_value(
				"Item Price",
				{"item_code": row["item_code"], "price_list": "Standard Buying"},
				"price_list_rate"
			)

		item_data = {
			"item_code": row["item_code"],
			"warehouse": row["warehouse"],
			"qty": row["qty"],
		}
		if val_rate and flt(val_rate) > 0:
			item_data["valuation_rate"] = flt(val_rate)

		sr.append("items", item_data)

	sr.flags.ignore_permissions = True
	sr.insert()
	sr.submit()

	return {
		"success": True,
		"reconciled": True,
		"name": sr.name,
		"count": len(items_to_adjust),
		"warehouse": warehouse,
	}
