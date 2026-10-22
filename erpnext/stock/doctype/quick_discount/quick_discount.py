# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, cint, today, getdate


class QuickDiscount(Document):
	def validate(self):
		self.validate_mandatory()
		self.validate_dates()
		self.validate_no_same_tier_conflicts()
		self.recalculate_item_prices()

	def validate_mandatory(self):
		if not (self.title or "").strip():
			frappe.throw(_("Пожалуйста, укажите название акции / кампании."))

		if cint(self.enabled):
			pct = flt(self.discount_percentage)
			if pct <= 0 or pct > 100:
				frappe.throw(_("Укажите корректный процент скидки (%) от 1 до 100."))

			if self.discount_scope == "По выбранным товарам (Items / Scan)" and not self.items:
				frappe.throw(_("Добавьте хотя бы один товар в список товаров акции."))

			if self.discount_scope == "По категории (Category)" and not self.item_group:
				frappe.throw(_("Пожалуйста, выберите категорию товара (Item Group)."))

	def validate_dates(self):
		if not self.is_lifetime:
			if self.valid_from and self.valid_upto:
				if getdate(self.valid_from) > getdate(self.valid_upto):
					frappe.throw(_("Дата начала действия ('Действует с') не может быть позже даты окончания ('Действует по')."))

	def validate_no_same_tier_conflicts(self):
		"""Prevent saving if any item is already in an active campaign with the exact same Priority Tier."""
		if not cint(self.enabled):
			return
		if self.discount_scope != "По выбранным товарам (Items / Scan)":
			return

		for row in self.get("items", []):
			if not row.item_code:
				continue
			conflict = get_active_discount_for_item(row.item_code, exclude_campaign=self.name, tier=self.priority_tier)
			if conflict:
				frappe.throw(
					_(
						"Товар '{0}' уже участвует в активной акции '{1}' ({2}) с тем же уровнем приоритета ({3}). "
						"Сначала удалите его из предыдущей акции или поставьте её на паузу."
					).format(row.item_name or row.item_code, conflict["campaign_title"], conflict["campaign_name"], self.priority_tier)
				)

	def recalculate_item_prices(self):
		"""Recalculate discounted prices for all items in the child table based on discount_percentage."""
		pct = flt(self.discount_percentage)

		for row in self.get("items", []):
			base = flt(row.base_price)
			if pct > 0:
				row.discounted_price = flt(base * (1.0 - (pct / 100.0)), 2)
			else:
				row.discounted_price = base

	def get_calculated_priority(self):
		"""
		Clean priority mapping strictly within 3-20 (0, 1, 2 reserved):
		Tier 1 (Ликвидация / Финальная уценка) -> 20
		Tier 2 (Акция на товар)                -> 15
		Tier 3 (Распродажа категории)          -> 10
		Tier 4 (Базовая / Лояльность)          -> 5
		"""
		tier_str = self.priority_tier or ""
		if "Tier 1" in tier_str or "20" in tier_str or "30" in tier_str:
			return 20
		elif "Tier 2" in tier_str or "15" in tier_str:
			return 15
		elif "Tier 3" in tier_str or "10" in tier_str:
			return 10
		elif "Tier 4" in tier_str or "5" in tier_str:
			return 5
		return 15

	def on_update(self):
		self.sync_pricing_rule()

	def sync_pricing_rule(self):
		"""Create or update linked native ERPNext Pricing Rule."""
		rule_name = self.pricing_rule

		if not cint(self.enabled):
			if rule_name and frappe.db.exists("Pricing Rule", rule_name):
				frappe.db.set_value("Pricing Rule", rule_name, "disable", 1)
			return

		pr = None
		if rule_name and frappe.db.exists("Pricing Rule", rule_name):
			pr = frappe.get_doc("Pricing Rule", rule_name)
		else:
			pr = frappe.new_doc("Pricing Rule")

		pr.title = f"{self.title} [{self.name}]"
		pr.disable = 0
		pr.selling = 1
		pr.buying = 0
		pr.price_or_product_discount = "Price"
		pr.has_priority = 1
		pr.priority = str(self.get_calculated_priority())

		# Price List & Currency
		default_company = (
			frappe.defaults.get_user_default("Company")
			or frappe.db.get_single_value("Global Defaults", "default_company")
			or frappe.db.get_value("Company", {}, "name")
		)
		pr.company = default_company or ""
		pr.currency = frappe.db.get_default("currency") or "TJS"
		pr.for_price_list = "Standard Selling"

		# Validity dates
		if not self.is_lifetime:
			pr.valid_from = self.valid_from
			pr.valid_upto = self.valid_upto
		else:
			pr.valid_from = None
			pr.valid_upto = None

		# Rate or Discount - strictly percentage
		pct = flt(self.discount_percentage)
		pr.rate_or_discount = "Discount Percentage"
		pr.discount_percentage = pct
		pr.rate = 0.0

		# Applicability mapping
		target_item_codes = set()
		use_item_group = False

		if self.discount_scope == "По категории (Category)":
			excluded_set = {x.strip() for x in (self.excluded_items or "").split(",") if x.strip()}
			has_filters = bool((self.filter_size or "").strip() or (self.filter_color or "").strip() or excluded_set)
			if not has_filters:
				use_item_group = True
			else:
				# Resolve items matching category + filters
				target_item_codes = self.resolve_items_by_category_and_filters(
					self.item_group, self.filter_size, self.filter_color
				)
				if excluded_set:
					target_item_codes = target_item_codes - excluded_set
		else:
			# По выбранным товарам (Items / Scan)
			target_item_codes = self.resolve_child_items()

		if use_item_group:
			pr.apply_on = "Item Group"
			pr.set("item_groups", [{"item_group": self.item_group}])
			pr.set("items", [])
		else:
			pr.apply_on = "Item Code"
			pr.set("item_groups", [])
			pr.set("items", [])
			for code in sorted(target_item_codes):
				pr.append("items", {"item_code": code})

		pr.flags.ignore_permissions = True
		pr.save()

		if not self.pricing_rule or self.pricing_rule != pr.name:
			self.db_set("pricing_rule", pr.name, update_modified=False)

	def resolve_child_items(self):
		"""Collect all matching item codes from child table."""
		codes = set()
		for row in self.get("items", []):
			item_code = row.item_code
			if not item_code:
				continue
			codes.add(item_code)
		return codes

	def resolve_items_by_category_and_filters(self, item_group=None, filter_size=None, filter_color=None):
		"""Resolve items by category and/or attribute filters."""
		return resolve_category_filtered_items(item_group or self.item_group, filter_size or self.filter_size, filter_color or self.filter_color)

	def on_trash(self):
		"""Clean up linked Pricing Rule when Quick Discount is deleted."""
		if self.pricing_rule and frappe.db.exists("Pricing Rule", self.pricing_rule):
			try:
				frappe.delete_doc("Pricing Rule", self.pricing_rule, ignore_permissions=True, force=True)
			except Exception as e:
				frappe.log_error(f"Error deleting linked Pricing Rule {self.pricing_rule}: {e}")


@frappe.whitelist()
def search_products_for_discount(query="", limit=20):
	"""
	Searches main products (templates or standalone items) by item_name, custom_short_code, or item_code.
	Excludes individual variants from main autocomplete so user picks the product model.
	"""
	query = (query or "").strip()
	conditions = ["disabled = 0", "(variant_of IS NULL OR variant_of = '')"]
	values = {"limit": int(limit or 20)}

	if query:
		conditions.append(
			"(name LIKE %(q)s OR item_name LIKE %(q)s OR custom_short_code LIKE %(q)s "
			"OR name IN (SELECT parent FROM `tabItem Barcode` WHERE barcode LIKE %(q)s) "
			"OR name IN (SELECT variant_of FROM `tabItem` WHERE disabled=0 AND ("
			"   name LIKE %(q)s OR item_name LIKE %(q)s OR custom_short_code LIKE %(q)s "
			"   OR name IN (SELECT parent FROM `tabItem Barcode` WHERE barcode LIKE %(q)s))))"
		)
		values["q"] = f"%{query}%"

	where_clause = " AND ".join(conditions)
	items = frappe.db.sql(
		f"""
		SELECT name AS item_code, item_name, custom_short_code AS short_code, has_variants, item_group
		FROM `tabItem`
		WHERE {where_clause}
		ORDER BY CASE WHEN custom_short_code = %(exact)s THEN 0
		              WHEN name = %(exact)s THEN 1
		              WHEN item_name = %(exact)s THEN 2
		              ELSE 3 END,
		         name ASC
		LIMIT %(limit)s
		""",
		{**values, "exact": query},
		as_dict=True,
	)

	return [
		{
			"item_code": r.item_code,
			"item_name": r.item_name,
			"short_code": r.short_code or "",
			"has_variants": cint(r.has_variants),
			"item_group": r.item_group,
			"label": f"[{r.short_code or r.item_code}] {r.item_name}",
		}
		for r in items
	]


@frappe.whitelist()
def get_product_variant_matrix(query, current_tier=None):
	"""
	Resolves any product identifier (barcode, short code, item code, or name)
	and returns the template model along with all color/size variants, stock, base price,
	and existing active campaign conflict alerts.
	"""
	if not query or not str(query).strip():
		return None

	query_str = str(query).strip()
	matched_code = None
	scanned_variant_code = None

	# 1. Barcode lookup
	barcode_match = frappe.db.get_value("Item Barcode", {"barcode": query_str}, "parent")
	if barcode_match:
		matched_code = barcode_match
		scanned_variant_code = barcode_match

	# 2. Short code exact lookup
	if not matched_code:
		short_match = frappe.db.get_value("Item", {"custom_short_code": query_str, "disabled": 0}, ["name", "variant_of"], as_dict=True)
		if short_match:
			matched_code = short_match.name
			if short_match.variant_of:
				scanned_variant_code = short_match.name

	# 3. Exact item code
	if not matched_code:
		if frappe.db.exists("Item", query_str):
			matched_code = query_str
			v_of = frappe.db.get_value("Item", query_str, "variant_of")
			if v_of:
				scanned_variant_code = query_str

	# 4. Partial match on template name / code
	if not matched_code:
		candidates = frappe.get_all(
			"Item",
			filters={"disabled": 0, "variant_of": ["in", ["", None]]},
			or_filters={"name": ["like", f"%{query_str}%"], "item_name": ["like", f"%{query_str}%"]},
			fields=["name"],
			limit=1,
		)
		if candidates:
			matched_code = candidates[0].name

	# 5. Fallback: match any variant
	if not matched_code:
		candidates = frappe.get_all(
			"Item",
			filters={"disabled": 0},
			or_filters={"name": ["like", f"%{query_str}%"], "item_name": ["like", f"%{query_str}%"]},
			fields=["name", "variant_of"],
			limit=1,
		)
		if candidates:
			matched_code = candidates[0].name
			if candidates[0].variant_of:
				scanned_variant_code = candidates[0].name

	if not matched_code:
		return None

	# Determine template item and whether it has variants
	item_record = frappe.db.get_value(
		"Item",
		matched_code,
		["name", "item_name", "item_group", "variant_of", "has_variants", "custom_short_code"],
		as_dict=True,
	)
	if not item_record:
		return None

	if item_record.variant_of:
		template_code = item_record.variant_of
		template = frappe.get_doc("Item", template_code)
	else:
		template_code = item_record.name
		template = frappe.get_doc("Item", item_record.name)

	has_variants = bool(template.has_variants)

	# Fetch variants
	if has_variants:
		variants = frappe.get_all(
			"Item",
			filters={"variant_of": template.name, "disabled": 0},
			fields=["name", "item_name", "custom_short_code"],
			order_by="name asc",
		)
	else:
		variants = [frappe._dict(name=template.name, item_name=template.item_name, custom_short_code=template.custom_short_code)]

	variant_codes = [v.name for v in variants]
	if not variant_codes:
		return None

	# Stock bins
	stock_map = {
		r.item_code: flt(r.qty)
		for r in frappe.db.sql(
			"SELECT item_code, SUM(actual_qty) AS qty FROM `tabBin` WHERE item_code IN %(codes)s GROUP BY item_code",
			{"codes": variant_codes},
			as_dict=True,
		)
	}

	# Selling prices
	price_map = {}
	for p in frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", variant_codes + [template.name]], "price_list": "Standard Selling"},
		fields=["item_code", "price_list_rate"],
		order_by="modified desc",
	):
		price_map.setdefault(p.item_code, flt(p.price_list_rate))

	# Attributes
	attrs_map = {}
	for a in frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", variant_codes]},
		fields=["parent", "attribute", "attribute_value"],
	):
		attrs_map.setdefault(a.parent, []).append(a)

	# Barcodes
	barcode_map = {
		b.parent: b.barcode
		for b in frappe.get_all(
			"Item Barcode",
			filters={"parent": ["in", variant_codes]},
			fields=["parent", "barcode"],
		)
	}

	# Group by Color
	colors_dict = {}
	for v in variants:
		color_val = "Основной"
		size_val = "Стандарт"
		for a in attrs_map.get(v.name, []):
			attr_name = (a.attribute or "").lower()
			if "colo" in attr_name:
				color_val = (a.attribute_value or "").strip()
			elif "size" in attr_name:
				size_val = (a.attribute_value or "").strip()

		selling_price = price_map.get(v.name, price_map.get(template.name, 0.0))
		barcode = barcode_map.get(v.name, "")

		# Check existing active discount
		existing_discount = get_active_discount_for_item(v.name, template.item_group)
		conflict = None
		if existing_discount:
			is_same_tier = bool(current_tier and existing_discount.get("priority_tier") == current_tier)
			conflict = {
				"campaign_name": existing_discount["campaign_name"],
				"campaign_title": existing_discount["campaign_title"],
				"priority_tier": existing_discount["priority_tier"],
				"discount_summary": existing_discount["discount_summary"],
				"is_same_tier": is_same_tier,
			}

		item_entry = {
			"item_code": v.name,
			"item_name": v.item_name,
			"custom_short_code": v.custom_short_code or "",
			"barcode": barcode,
			"color": color_val,
			"size": size_val,
			"stock": stock_map.get(v.name, 0.0),
			"base_price": selling_price,
			"conflict": conflict,
			"is_scanned": bool(scanned_variant_code and v.name == scanned_variant_code),
		}

		if color_val not in colors_dict:
			colors_dict[color_val] = []
		colors_dict[color_val].append(item_entry)

	# Format colors list
	colors_list = []
	for color_name, items_in_color in colors_dict.items():
		colors_list.append({
			"color": color_name,
			"sizes": items_in_color,
		})

	return {
		"template_code": template.name,
		"item_name": template.item_name,
		"custom_short_code": template.custom_short_code or "",
		"item_group": template.item_group,
		"has_variants": has_variants,
		"scanned_variant_code": scanned_variant_code,
		"colors": colors_list,
	}


@frappe.whitelist()
def get_category_filter_data(item_group):
	"""
	Returns distinct colors and sizes for items in the specified Item Group (including sub-groups).
	"""
	if not item_group:
		return {"colors": [], "sizes": []}

	group_record = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"], as_dict=True)
	if group_record and group_record.lft and group_record.rgt:
		group_cond = "i.item_group IN (SELECT name FROM `tabItem Group` WHERE lft >= %(lft)s AND rgt <= %(rgt)s)"
		values = {"lft": group_record.lft, "rgt": group_record.rgt}
	else:
		group_cond = "i.item_group = %(item_group)s"
		values = {"item_group": item_group}

	# Distinct colors
	colors = frappe.db.sql_list(
		f"""
		SELECT DISTINCT iva.attribute_value
		FROM `tabItem Variant Attribute` iva
		JOIN `tabItem` i ON i.name = iva.parent
		WHERE {group_cond}
		  AND i.disabled = 0
		  AND LOWER(iva.attribute) IN ('colour', 'color')
		ORDER BY iva.attribute_value ASC
		""",
		values,
	)

	# Distinct sizes
	sizes = frappe.db.sql_list(
		f"""
		SELECT DISTINCT iva.attribute_value
		FROM `tabItem Variant Attribute` iva
		JOIN `tabItem` i ON i.name = iva.parent
		WHERE {group_cond}
		  AND i.disabled = 0
		  AND LOWER(iva.attribute) = 'size'
		ORDER BY iva.idx ASC, iva.attribute_value ASC
		""",
		values,
	)

	# Fallbacks if category has no variants yet
	if not colors:
		colors = frappe.db.sql_list(
			"""
			SELECT attribute_value FROM `tabItem Attribute Value`
			WHERE parent IN ('Colour', 'Color', 'colour', 'color')
			ORDER BY idx ASC, attribute_value ASC
			"""
		)
	if not sizes:
		sizes = frappe.db.sql_list(
			"""
			SELECT attribute_value FROM `tabItem Attribute Value`
			WHERE parent IN ('Size', 'size')
			ORDER BY idx ASC, attribute_value ASC
			"""
		)

	return {"colors": colors, "sizes": sizes}


def resolve_category_filtered_items(item_group=None, filter_size=None, filter_color=None):
	"""Resolve items by category and/or attribute filters."""
	conditions = ["i.disabled = 0"]
	values = {}

	if item_group:
		group_record = frappe.db.get_value("Item Group", item_group, ["lft", "rgt"], as_dict=True)
		if group_record and group_record.lft and group_record.rgt:
			conditions.append(
				"""i.item_group IN (
					SELECT name FROM `tabItem Group`
					WHERE lft >= %(lft)s AND rgt <= %(rgt)s
				)"""
			)
			values["lft"] = group_record.lft
			values["rgt"] = group_record.rgt
		else:
			conditions.append("i.item_group = %(item_group)s")
			values["item_group"] = item_group

	if isinstance(filter_size, str):
		sizes = [s.strip().lower() for s in filter_size.split(",") if s.strip()]
	elif isinstance(filter_size, (list, tuple)):
		sizes = [str(s).strip().lower() for s in filter_size if str(s).strip()]
	else:
		sizes = []

	if isinstance(filter_color, str):
		colors = [c.strip().lower() for c in filter_color.split(",") if c.strip()]
	elif isinstance(filter_color, (list, tuple)):
		colors = [str(c).strip().lower() for c in filter_color if str(c).strip()]
	else:
		colors = []

	if sizes:
		values["sizes"] = tuple(sizes)
		conditions.append(
			"""i.name IN (
				SELECT parent FROM `tabItem Variant Attribute`
				WHERE LOWER(attribute) = 'size'
				  AND LOWER(TRIM(attribute_value)) IN %(sizes)s
			)"""
		)

	if colors:
		values["colors"] = tuple(colors)
		conditions.append(
			"""i.name IN (
				SELECT parent FROM `tabItem Variant Attribute`
				WHERE LOWER(attribute) IN ('colour', 'color')
				  AND LOWER(TRIM(attribute_value)) IN %(colors)s
			)"""
		)

	where_clause = " AND ".join(conditions)
	query = f"SELECT i.name FROM `tabItem` i WHERE {where_clause}"
	return set(frappe.db.sql_list(query, values))


@frappe.whitelist()
def preview_category_discount(item_group, colors=None, sizes=None, discount_percentage=0, excluded_items=None):
	"""
	Calculates and returns a preview list of items affected by the category discount + attribute filters.
	Excludes items passed in excluded_items.
	"""
	if not item_group:
		return {"total_count": 0, "items": [], "excluded_list": []}

	if isinstance(colors, str):
		try:
			colors_list = json.loads(colors)
		except Exception:
			colors_list = [c.strip() for c in colors.split(",") if c.strip()]
	else:
		colors_list = colors or []

	if isinstance(sizes, str):
		try:
			sizes_list = json.loads(sizes)
		except Exception:
			sizes_list = [s.strip() for s in sizes.split(",") if s.strip()]
	else:
		sizes_list = sizes or []

	if isinstance(excluded_items, str):
		try:
			excluded_list = json.loads(excluded_items)
		except Exception:
			excluded_list = [x.strip() for x in excluded_items.split(",") if x.strip()]
	else:
		excluded_list = list(excluded_items or [])

	excluded_set = set(excluded_list)

	matched_codes = list(resolve_category_filtered_items(item_group, sizes_list, colors_list))
	active_codes = [c for c in matched_codes if c not in excluded_set]

	total_count = len(active_codes)
	if not active_codes:
		return {"total_count": 0, "items": [], "excluded_count": len(excluded_set), "excluded_list": excluded_list}

	# Pick top 50 items for preview
	preview_codes = active_codes[:50]

	items = frappe.get_all(
		"Item",
		filters={"name": ["in", preview_codes]},
		fields=["name", "item_name", "custom_short_code", "variant_of"],
	)

	# Stock
	stock_map = {
		r.item_code: flt(r.qty)
		for r in frappe.db.sql(
			"SELECT item_code, SUM(actual_qty) AS qty FROM `tabBin` WHERE item_code IN %(codes)s GROUP BY item_code",
			{"codes": preview_codes},
			as_dict=True,
		)
	}

	# Base prices
	price_map = {}
	for p in frappe.get_all(
		"Item Price",
		filters={"item_code": ["in", preview_codes], "price_list": "Standard Selling"},
		fields=["item_code", "price_list_rate"],
	):
		price_map.setdefault(p.item_code, flt(p.price_list_rate))

	# Attributes
	attrs_map = {}
	for a in frappe.get_all(
		"Item Variant Attribute",
		filters={"parent": ["in", preview_codes]},
		fields=["parent", "attribute", "attribute_value"],
	):
		attrs_map.setdefault(a.parent, []).append(a)

	pct = flt(discount_percentage)
	result_items = []
	for it in items:
		color = ""
		size = ""
		for a in attrs_map.get(it.name, []):
			attr_name = (a.attribute or "").lower()
			if "colo" in attr_name:
				color = a.attribute_value or ""
			elif "size" in attr_name:
				size = a.attribute_value or ""

		base_p = price_map.get(it.name, 0.0)
		sale_p = flt(base_p * (1.0 - (pct / 100.0)), 2) if pct > 0 else base_p

		result_items.append({
			"item_code": it.name,
			"item_name": it.item_name,
			"short_code": it.custom_short_code or "",
			"color": color or "-",
			"size": size or "-",
			"stock": stock_map.get(it.name, 0.0),
			"base_price": base_p,
			"discounted_price": sale_p,
		})

	# Details for excluded items to render tags
	excluded_info = []
	if excluded_set:
		ex_items = frappe.get_all(
			"Item",
			filters={"name": ["in", list(excluded_set)]},
			fields=["name", "item_name", "custom_short_code"],
		)
		ex_attrs = {}
		for a in frappe.get_all(
			"Item Variant Attribute",
			filters={"parent": ["in", list(excluded_set)]},
			fields=["parent", "attribute", "attribute_value"],
		):
			ex_attrs.setdefault(a.parent, []).append(a)

		for it in ex_items:
			c, s = "", ""
			for a in ex_attrs.get(it.name, []):
				an = (a.attribute or "").lower()
				if "colo" in an:
					c = a.attribute_value or ""
				elif "size" in an:
					s = a.attribute_value or ""
			excluded_info.append({
				"item_code": it.name,
				"item_name": it.item_name,
				"short_code": it.custom_short_code or "",
				"color": c,
				"size": s,
			})

	return {
		"total_count": total_count,
		"items": result_items,
		"excluded_count": len(excluded_set),
		"excluded_list": excluded_info,
	}


def get_active_discount_for_item(item_code, item_group=None, exclude_campaign=None, tier=None):
	"""Check if this item or its parent template/variants already participate in an active Quick Discount."""
	variant_of = frappe.db.get_value("Item", item_code, "variant_of")
	codes = [item_code]
	if variant_of:
		codes.append(variant_of)

	variants = frappe.db.sql_list("SELECT name FROM `tabItem` WHERE variant_of = %s AND disabled = 0", (item_code,))
	if variants:
		codes.extend(variants)

	conditions = [
		"qdi.item_code IN %(codes)s",
		"qd.enabled = 1",
		"(qd.is_lifetime = 1 OR (qd.valid_upto >= %(today)s AND (qd.valid_from IS NULL OR qd.valid_from <= %(today)s)))",
	]
	values = {"codes": tuple(set(codes)), "today": today()}

	if exclude_campaign:
		conditions.append("qd.name != %(exclude)s")
		values["exclude"] = exclude_campaign

	if tier:
		conditions.append("qd.priority_tier = %(tier)s")
		values["tier"] = tier

	where_clause = " AND ".join(conditions)
	query = f"""
		SELECT qd.name, qd.title, qd.priority_tier, qd.discount_percentage
		FROM `tabQuick Discount Item` qdi
		JOIN `tabQuick Discount` qd ON qd.name = qdi.parent
		WHERE {where_clause}
		ORDER BY qd.creation DESC
		LIMIT 1
	"""
	active_campaign = frappe.db.sql(query, values, as_dict=True)

	if active_campaign:
		ac = active_campaign[0]
		pct = f"-{flt(ac.discount_percentage)}%"
		return {
			"campaign_name": ac.name,
			"campaign_title": ac.title,
			"priority_tier": ac.priority_tier,
			"discount_summary": pct,
		}

	return None


@frappe.whitelist()
def transfer_item_from_campaign(old_campaign, item_code):
	"""
	Seamless 1-Click transfer:
	Removes item_code from old_campaign (or pauses old_campaign if it is the only item),
	so it can be immediately added into the current new campaign without navigating away or losing unsaved work.
	"""
	if not old_campaign or not item_code:
		frappe.throw(_("Укажите кампанию и код товара для переноса."))

	if not frappe.db.exists("Quick Discount", old_campaign):
		return {"success": False, "message": _("Предыдущая кампания не найдена.")}

	old_doc = frappe.get_doc("Quick Discount", old_campaign)
	matching_rows = [r for r in old_doc.items if r.item_code == item_code]

	if not matching_rows:
		return {"success": True, "message": _("Товар уже не состоит в этой кампании.")}

	# If this was the only item in the previous campaign, pause the campaign
	if len(old_doc.items) <= len(matching_rows):
		old_doc.enabled = 0
		old_doc.items = []
	else:
		old_doc.items = [r for r in old_doc.items if r.item_code != item_code]

	old_doc.flags.ignore_permissions = True
	old_doc.save()

	return {
		"success": True,
		"campaign_name": old_doc.name,
		"campaign_title": old_doc.title,
		"paused": old_doc.enabled == 0,
	}


@frappe.whitelist()
def lookup_item_for_discount(query, current_tier=None):
	"""
	Backwards-compatible item resolver.
	"""
	mat = get_product_variant_matrix(query, current_tier=current_tier)
	if not mat:
		return None

	scanned_code = mat.get("scanned_variant_code")
	target_item = None
	if scanned_code:
		for c in mat.get("colors", []):
			for s in c.get("sizes", []):
				if s["item_code"] == scanned_code:
					target_item = s
					break
			if target_item:
				break

	if not target_item:
		# check if any size has conflict/discount
		for c in mat.get("colors", []):
			for s in c.get("sizes", []):
				if s.get("conflict"):
					target_item = s
					break
			if target_item:
				break

	if not target_item:
		first_color = mat["colors"][0] if mat["colors"] else None
		target_item = first_color["sizes"][0] if first_color and first_color["sizes"] else None

	if not target_item:
		return None

	return {
		"item_code": target_item["item_code"],
		"item_name": mat["item_name"],
		"template_code": mat["template_code"],
		"template_name": mat["item_name"],
		"has_variants": cint(mat["has_variants"]),
		"color": target_item["color"],
		"size": target_item["size"],
		"base_price": target_item["base_price"],
		"barcode": target_item["barcode"],
		"custom_short_code": target_item["custom_short_code"] or mat["custom_short_code"],
		"existing_discount": target_item["conflict"],
	}
