# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_days, cint, date_diff, flt, get_first_day, getdate, nowtime, today

from erpnext.accounts.report.gross_profit.gross_profit import GrossProfitGenerator
from erpnext.stock.page.product_catalog.product_catalog import get_default_company, get_stores_warehouse


class ProductCostLookup(GrossProfitGenerator):
	"""Reuse ERPNext valuation without the report's invoice regrouping of returns."""

	def __init__(self, rows, company):
		self.filters = frappe._dict(company=company, to_date=today())
		self.si_list = rows
		self.sle = {}
		self.average_buying_rate = {}
		self.currency_precision = cint(frappe.db.get_default("currency_precision")) or 3
		self.get_delivery_notes()
		self.load_non_stock_items()
		self.load_product_bundle()

	def cost(self, row):
		# Fallback valuation must be looked up at each transaction's date.
		self.average_buying_rate = {}
		row = row.copy()
		self.filters.to_date = row.posting_date
		if row.dn_detail:
			row.item_row = row.dn_detail
		bundles = self.product_bundles.get(
			row.parenttype if row.update_stock else "Delivery Note", {}
		).get(row.parent if row.update_stock else row.delivery_note, {})
		if row.item_code in bundles:
			return self.get_buying_amount_from_product_bundle(row, bundles[row.item_code])
		return self.get_buying_amount(row, row.item_code)


def summarize_product_sales(rows):
	"""Keep returns on their own date; quantities are in the item's stock UOM."""
	daily = {}
	for row in rows:
		key = str(row.posting_date)
		d = daily.setdefault(key, dict(date=key, sold=0, returned=0, revenue=0, profit=0, invoices=[]))
		qty = flt(row.qty)
		d["sold"] += max(qty, 0)
		d["returned"] += max(-qty, 0)
		d["revenue"] += flt(row.base_net_amount)
		d["profit"] += flt(row.base_net_amount) - flt(row.buying_amount)
		if row.parent not in d["invoices"]:
			d["invoices"].append(row.parent)
	return sorted(daily.values(), key=lambda d: d["date"], reverse=True)


@frappe.whitelist()
def get_product_overview(item_code, period="month", warehouse=None, color=None, company=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
	if not frappe.db.exists("Item", item_code):
		frappe.throw(_("Item not found"), frappe.DoesNotExistError)
	item_code = frappe.db.get_value("Item", item_code, "variant_of") or item_code
	if not frappe.has_permission("Item", "read", item_code):
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	warehouses = frappe.get_list("Warehouse", filters={"company": company, "is_group": 0}, pluck="name", limit_page_length=0)
	if warehouse and warehouse not in warehouses:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	scope_warehouses = [warehouse] if warehouse else warehouses
	variants = frappe.get_all("Item", filters={"variant_of": item_code}, pluck="name")
	codes = variants or [item_code]
	if color:
		codes = frappe.db.sql_list("""SELECT DISTINCT parent FROM `tabItem Variant Attribute`
			WHERE parent IN %(codes)s AND LOWER(attribute) IN ('color', 'colour')
			AND attribute_value = %(color)s""", {"codes": codes, "color": color})
	end = getdate(today())
	starts = {"month": get_first_day(end), "today": end, "7d": add_days(end, -6), "30d": add_days(end, -29), "all": getdate("1900-01-01")}
	if period not in starts:
		frappe.throw(_("Invalid period"))
	start = starts[period]
	stock = []
	if codes and scope_warehouses:
		stock = frappe.db.sql("""SELECT item_code, SUM(actual_qty) qty, SUM(stock_value) value
			FROM `tabBin` WHERE item_code IN %(codes)s AND warehouse IN %(warehouses)s
			GROUP BY item_code""", {"codes": codes, "warehouses": scope_warehouses}, as_dict=True)
	can_read_sales = frappe.has_permission("Sales Invoice", "read")
	rows = []
	if codes and scope_warehouses and can_read_sales:
		# Resolve invoice permissions before reading their child rows.
		invoices = frappe.get_list("Sales Invoice", filters={"company": company, "docstatus": 1,
			"posting_date": ["between", [start, end]], "is_opening": "No"},
			pluck="name", limit_page_length=0)
		if invoices:
			query = GrossProfitGenerator.__new__(GrossProfitGenerator)
			query.filters = frappe._dict(company=company, from_date=start, to_date=end)
			sii = frappe.qb.DocType("Sales Invoice Item")
			si = frappe.qb.DocType("Sales Invoice")
			rows = query.prepare_invoice_query().where(sii.item_code.isin(codes)).where(
				sii.warehouse.isin(scope_warehouses)).where(si.name.isin(invoices)).run(as_dict=True)
			costs = ProductCostLookup(rows, company)
			for row in rows:
				if row.is_debit_note:
					row.qty = 0
					row.buying_amount = 0
				else:
					row.buying_amount = costs.cost(row)
	daily = summarize_product_sales(rows)
	variant_sold = {}
	for row in rows:
		variant_sold[row.item_code] = variant_sold.get(row.item_code, 0) + flt(row.qty)
	chart_start = min((getdate(d["date"]) for d in daily), default=end) if period == "all" else getdate(start)
	# Monthly buckets keep all-time charts readable without losing history detail.
	monthly = date_diff(end, chart_start) > 120
	series = {}
	for i in range(date_diff(end, chart_start) + 1):
		day = str(add_days(chart_start, i))
		series.setdefault(day[:7] if monthly else day, [0, 0])
	for d in daily:
		key = d["date"][:7] if monthly else d["date"]
		series[key][0] += d["revenue"]
		series[key][1] += d["profit"]
	stock_by_code = {s.item_code: s for s in stock}
	return dict(company=company, currency=frappe.get_cached_value("Company", company, "default_currency"),
		warehouses=warehouses, from_date=str(chart_start), to_date=str(end), can_read_sales=can_read_sales,
		stock=sum(flt(s.qty) for s in stock), stock_value=sum(flt(s.value) for s in stock),
		sold=sum(d["sold"] for d in daily), returned=sum(d["returned"] for d in daily),
		revenue=sum(d["revenue"] for d in daily), profit=sum(d["profit"] for d in daily),
		daily=daily, labels=list(series), revenue_series=[v[0] for v in series.values()],
		profit_series=[v[1] for v in series.values()], variant_sold=variant_sold,
		variant_stock={c: flt(stock_by_code[c].qty) if c in stock_by_code else 0 for c in codes})


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
def get_product_detail(item_code, company=None):
	from erpnext.setup.retail_security import require_financial_access

	require_financial_access(company)
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
	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")

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
			filters={"variant_of": item_code},
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

	# Reading a product must never create or replace barcodes.
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
			barcode_map[b.parent] = b.barcode

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
			}
			order.append(color)

		c = colors[color]
		if v.image and not c["image"]:
			c["image"] = v.image

		stock = stock_map.get(v.name, 0)
		c["stock"] += stock

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
				"sold_qty": 0,
				"buying_price": buy_map.get(v.name, 0),
				"selling_price": base_sell,
				"discount": discount_info,
			}
		)

	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"image": item.image or "",
		"short_code": item.custom_short_code or "",
		"stock_uom": item.stock_uom or "шт",
		"barcode": barcode_map.get(item.name) or item.custom_short_code or item.name,
		"company_name": company,
		"has_variants": item.has_variants,
		"supplier": get_supplier(item_code, codes, company),
		"currency": frappe.get_cached_value("Company", company, "default_currency"),
		"colors": [colors[k] for k in order],
	}


def get_supplier(item_code, codes, company=None):
	company = company or get_default_company()
	if not frappe.has_permission("Supplier", "read"):
		return ""
	supplier = frappe.db.get_value("Item Default", {"parent": item_code, "company": company}, "default_supplier")
	if not supplier and frappe.has_permission("Purchase Invoice", "read"):
		# Resolve native invoice permissions before looking up the supplier.
		invoices = frappe.get_list("Purchase Invoice", filters=[["Purchase Invoice", "company", "=", company],
			["Purchase Invoice", "docstatus", "=", 1], ["Purchase Invoice Item", "item_code", "in", codes]], fields=["name", "supplier"],
			order_by="`tabPurchase Invoice`.posting_date desc, `tabPurchase Invoice`.creation desc", limit_page_length=1)
		supplier = invoices[0].supplier if invoices else None
	return supplier if supplier and frappe.has_permission("Supplier", "read", doc=supplier) else ""


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
def reconcile_stock(item_code, changes, reason=None, warehouse=None, company=None):
	"""Adjusts stock balance for variants using an official Stock Reconciliation entry."""
	if not frappe.has_permission("Item", "write", item_code):
		frappe.throw(_("Not permitted to adjust stock for this item"), frappe.PermissionError)

	if isinstance(changes, str):
		changes = frappe.parse_json(changes)

	if not changes or not isinstance(changes, list):
		return {"success": True, "reconciled": False, "message": "No changes"}

	company = company or get_default_company()
	frappe.get_cached_doc("Company", company).check_permission("read")
	if not warehouse:
		warehouse = get_stores_warehouse(company)
	if warehouse:
		warehouse_doc = frappe.get_doc("Warehouse", warehouse)
		warehouse_doc.check_permission("read")
		if warehouse_doc.company != company or warehouse_doc.is_group:
			frappe.throw(_("Invalid warehouse for this company"))

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
