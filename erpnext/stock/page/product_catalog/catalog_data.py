"""Permission-aware inventory and sales data for the owner's product list."""

from collections import defaultdict

import frappe
from frappe import _
from frappe.utils import add_days, cint, flt, get_first_day, getdate, today


def period_dates(period):
	end = getdate(today())
	starts = {
		"month": get_first_day(end), "today": end, "7d": add_days(end, -6),
		"30d": add_days(end, -29), "all": getdate("1900-01-01"),
	}
	if period not in starts:
		frappe.throw(_("Invalid period"))
	return getdate(starts[period]), end


def stock_attention(quantities, has_variants):
	"""A healthy model total can still hide depleted individual variants."""
	total = sum(quantities)
	out = sum(q <= 0 for q in quantities) if has_variants else 0
	low = sum(0 < q <= 5 for q in quantities) if has_variants else 0
	status = "out_of_stock" if total <= 0 else "low_stock" if total <= 5 else "in_stock"
	return dict(status=status, out_variant_count=out, low_variant_count=low,
		needs_attention=total > 0 and (total <= 5 or out > 0 or low > 0))


def _sales_rows(codes, warehouses, company, start, end):
	from erpnext.accounts.report.gross_profit.gross_profit import GrossProfitGenerator

	if not codes or not warehouses or not frappe.has_permission("Sales Invoice", "read"):
		return []
	invoices = frappe.get_list("Sales Invoice", filters={"company": company, "docstatus": 1,
		"posting_date": ["between", [start, end]], "is_opening": "No"},
		pluck="name", limit_page_length=0)
	if not invoices:
		return []
	query = GrossProfitGenerator.__new__(GrossProfitGenerator)
	query.filters = frappe._dict(company=company, from_date=start, to_date=end)
	sii, si = frappe.qb.DocType("Sales Invoice Item"), frappe.qb.DocType("Sales Invoice")
	return (query.prepare_invoice_query().where(sii.item_code.isin(codes))
		.where(sii.warehouse.isin(warehouses)).where(si.name.isin(invoices)).run(as_dict=True))


def _prices(codes, company, currency):
	"""Show current list prices; stock value always comes directly from Bin."""
	if not codes:
		return {}, {}, []
	prices = frappe.db.sql("""SELECT item_code, price_list, price_list_rate FROM `tabItem Price`
		WHERE item_code IN %(codes)s AND currency = %(currency)s
		AND price_list IN ('Standard Selling', 'Standard Buying')
		AND (valid_from IS NULL OR valid_from <= %(today)s)
		AND (valid_upto IS NULL OR valid_upto >= %(today)s)
		ORDER BY modified DESC""", dict(codes=codes, currency=currency, today=today()), as_dict=True)
	sell, buy = {}, {}
	for p in prices:
		(sell if p.price_list == "Standard Selling" else buy).setdefault(p.item_code, flt(p.price_list_rate))
	# Keep variant-specific rules separate rather than applying one variant's discount to the model.
	rules = frappe.db.sql("""SELECT pri.item_code, prig.item_group, pr.priority,
		pr.discount_percentage, pr.rate, pr.rate_or_discount
		FROM `tabPricing Rule` pr
		LEFT JOIN `tabPricing Rule Item Code` pri ON pri.parent = pr.name
		LEFT JOIN `tabPricing Rule Item Group` prig ON prig.parent = pr.name
		WHERE pr.disable = 0 AND pr.selling = 1
		AND (pr.company IS NULL OR pr.company = '' OR pr.company = %(company)s)
		AND (pr.currency IS NULL OR pr.currency = '' OR pr.currency = %(currency)s)
		AND (pr.valid_from IS NULL OR pr.valid_from <= %(today)s)
		AND (pr.valid_upto IS NULL OR pr.valid_upto >= %(today)s)
		AND (pr.customer IS NULL OR pr.customer = '')
		AND (pr.customer_group IS NULL OR pr.customer_group = '')
		AND (pr.territory IS NULL OR pr.territory = '')
		ORDER BY CAST(pr.priority AS UNSIGNED) DESC, pr.modified DESC""",
		dict(company=company, currency=currency, today=today()), as_dict=True)
	return sell, buy, rules


def _model_price(model, variants, sell, buy, rules):
	values, original, buying = [], [], []
	for item in variants or [model]:
		base = sell.get(item.name, sell.get(model.name))
		cost = buy.get(item.name, buy.get(model.name))
		if cost is not None:
			buying.append(cost)
		if base is None:
			continue
		price = base
		for rule in rules:
			if rule.item_code in (item.name, model.name) or rule.item_group == model.item_group:
				if rule.rate_or_discount == "Rate" and flt(rule.rate) > 0:
					price = flt(rule.rate)
				elif rule.rate_or_discount == "Discount Percentage":
					price = base * (1 - flt(rule.discount_percentage) / 100)
				break
		values.append(flt(price, 2))
		original.append(base)
	return dict(selling_price=min(original) if original else None,
		discounted_price=min(values) if values else None,
		buying_price=min(buying) if buying else None,
		price_varies=bool(values) and min(values) != max(values),
		on_sale=any(p < b for p, b in zip(values, original)))


def build_catalog(search=None, item_group=None, status_filter=None, sort_by=None,
	page=1, page_size=20, company=None, period="month", warehouse=None):
	from erpnext.stock.page.product_catalog.product_catalog import get_default_company
	from erpnext.stock.page.product_detail.product_detail import ProductCostLookup

	frappe.has_permission("Item", "read", throw=True)
	company = company or get_default_company()
	frappe.has_permission("Company", "read", company, throw=True)
	currency = frappe.get_cached_value("Company", company, "default_currency")
	start, end = period_dates(period)
	page_size = min(500, max(1, cint(page_size) or 20))
	page = max(1, cint(page) or 1)
	warehouses = frappe.get_list("Warehouse", filters={"company": company, "is_group": 0},
		pluck="name", limit_page_length=0)
	if warehouse and warehouse not in warehouses:
		frappe.throw(_("Not permitted"), frappe.PermissionError)
	scope = [warehouse] if warehouse else warehouses
	all_items = frappe.get_list("Item", fields=["name", "item_name", "item_group", "image",
		"has_variants", "variant_of", "custom_short_code", "stock_uom", "disabled", "modified"],
		limit_page_length=0, order_by="modified desc")
	children = defaultdict(list)
	for item in all_items:
		if item.variant_of:
			children[item.variant_of].append(item)
	models = [i for i in all_items if not i.variant_of and not i.disabled]
	categories = sorted({i.item_group for i in models})
	if item_group and item_group != "All":
		models = [i for i in models if i.item_group == item_group]
	if search and search.strip():
		term = search.strip().casefold()
		barcodes = frappe.get_all("Item Barcode", filters={"barcode": ["like", f"%{search.strip()}%"]},
			pluck="parent", limit_page_length=0)
		matches = set(barcodes)
		for i in all_items:
			if term in i.name.casefold() or term in i.item_name.casefold() or term == (i.custom_short_code or "").casefold():
				matches.add(i.name)
		models = [m for m in models if m.name in matches or any(v.name in matches for v in children[m.name])]
	model_codes = [m.name for m in models]
	codes = model_codes + [v.name for m in models for v in children[m.name]]
	stock = {}
	if codes and scope:
		stock = {b.item_code: b for b in frappe.db.sql("""SELECT item_code,
			SUM(actual_qty) qty, SUM(stock_value) value FROM `tabBin`
			WHERE item_code IN %(codes)s AND warehouse IN %(scope)s GROUP BY item_code""",
			dict(codes=codes, scope=scope), as_dict=True)}
	sell, buy, rules = _prices(codes, company, currency)
	code_to_model = {}
	for m in models:
		for v in children[m.name] or [m]:
			code_to_model[v.name] = m.name
	rows = _sales_rows(list(code_to_model), scope, company, start, end)
	sales = defaultdict(lambda: dict(sold_qty=0, sold_amount=0, returned_qty=0))
	for row in rows:
		m = code_to_model[row.item_code]
		qty = 0 if row.is_debit_note else flt(row.qty)
		sales[m]["sold_qty"] += qty
		sales[m]["returned_qty"] += max(-qty, 0)
		sales[m]["sold_amount"] += flt(row.base_net_amount)
	catalog = []
	for m in models:
		variants = children[m.name]
		balances = [stock.get(v.name, frappe._dict(qty=0, value=0)) for v in variants or [m]]
		attention = stock_attention([flt(b.qty) for b in balances], bool(variants))
		prices = _model_price(m, variants, sell, buy, rules)
		p = dict(item_code=m.name, item_name=m.item_name, item_group=m.item_group,
			image=m.image or "", custom_short_code=m.custom_short_code or "", stock_uom=m.stock_uom,
			has_variants=m.has_variants, variant_count=len(variants), modified=str(m.modified),
			stock_qty=sum(flt(b.qty) for b in balances), stock_value_cost=sum(flt(b.value) for b in balances),
			**attention, **prices, **sales[m.name])
		if status_filter == "in_stock" and p["stock_qty"] <= 0:
			continue
		if status_filter == "low_stock" and not p["needs_attention"]:
			continue
		if status_filter == "out_of_stock" and p["status"] != "out_of_stock":
			continue
		if status_filter == "on_sale" and not p["on_sale"]:
			continue
		catalog.append(p)
	summary = dict(products=len(catalog), stock_value=sum(p["stock_value_cost"] for p in catalog),
		attention=sum(p["needs_attention"] for p in catalog), out_of_stock=sum(p["stock_qty"] <= 0 for p in catalog))
	keys = {"stock_desc": "stock_qty", "stock_val_desc": "stock_value_cost", "sold_desc": "sold_qty"}
	if sort_by == "name_asc":
		catalog.sort(key=lambda p: (p["item_name"].casefold(), p["item_code"]))
	else:
		catalog.sort(key=lambda p: (p.get(keys.get(sort_by, "modified")), p["item_code"]), reverse=True)
	total = len(catalog)
	page = min(page, max(1, (total + page_size - 1) // page_size))
	visible = catalog[(page - 1) * page_size:page * page_size]
	# Value historical costs only for visible products, in one shared lookup.
	visible_codes = {p["item_code"] for p in visible}
	visible_rows = [r for r in rows if code_to_model[r.item_code] in visible_codes]
	profits = defaultdict(float)
	if visible_rows:
		costs = ProductCostLookup(visible_rows, company)
		for row in visible_rows:
			cost = 0 if row.is_debit_note else costs.cost(row)
			profits[code_to_model[row.item_code]] += flt(row.base_net_amount) - flt(cost)
	for p in visible:
		p["gross_profit"] = profits[p["item_code"]]
		p.pop("modified")
	return dict(items=visible, total=total, page=page, page_size=page_size, categories=categories,
		currency=currency, warehouses=warehouses, company=company, summary=summary,
		can_read_sales=frappe.has_permission("Sales Invoice", "read"),
		from_date=str(start) if period != "all" else None, to_date=str(end))
