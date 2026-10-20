# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt


@frappe.whitelist()
def get_product_detail(item_code):
	"""Everything the simplified product view needs: general info + colors -> sizes with stock/sold."""
	if not frappe.has_permission("Item", "read", item_code):
		frappe.throw(_("Not permitted"), frappe.PermissionError)

	item = frappe.db.get_value(
		"Item",
		item_code,
		["name", "item_name", "item_group", "image", "has_variants", "custom_short_code", "stock_uom"],
		as_dict=True,
	)
	if not item:
		frappe.throw(_("Item {0} not found").format(item_code))

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
	sold_map = {
		s.item_code: flt(s.qty)
		for s in frappe.db.sql(
			"""SELECT sii.item_code, SUM(sii.qty) qty
			FROM `tabSales Invoice Item` sii
			JOIN `tabSales Invoice` si ON si.name = sii.parent
			WHERE sii.item_code IN %(c)s AND si.docstatus = 1
			GROUP BY sii.item_code""",
			{"c": codes},
			as_dict=True,
		)
	}

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

	# Group by color
	colors, order = {}, []
	for v in variants:
		attrs = attr_map.get(v.name, {})
		color = attrs.get("colour") or attrs.get("color") or ""
		size = attrs.get("size") or ""
		if color not in colors:
			colors[color] = {"color": color, "image": "", "sizes": [], "stock": 0, "sold": 0}
			order.append(color)
		c = colors[color]
		if v.image and not c["image"]:
			c["image"] = v.image
		stock, sold = stock_map.get(v.name, 0), sold_map.get(v.name, 0)
		c["stock"] += stock
		c["sold"] += sold
		c["sizes"].append(
			{
				"item_code": v.name,
				"item_name": v.item_name,
				"size": size or v.item_name,
				"short_code": v.custom_short_code or "",
				"stock_qty": stock,
				"sold_qty": sold,
				"buying_price": buy_map.get(v.name, 0),
				"selling_price": sell_map.get(v.name, 0),
			}
		)

	return {
		"item_code": item.name,
		"item_name": item.item_name,
		"item_group": item.item_group,
		"image": item.image or "",
		"short_code": item.custom_short_code or "",
		"has_variants": item.has_variants,
		"supplier": get_supplier(item_code, codes),
		"currency": frappe.db.get_default("currency") or "TJS",
		"total_stock": sum(c["stock"] for c in colors.values()),
		"total_sold": sum(c["sold"] for c in colors.values()),
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

	# Update template image if not set
	template_image = frappe.db.get_value("Item", item_code, "image")
	if not template_image:
		frappe.db.set_value("Item", item_code, "image", image_url)

	updated_count = 0
	if color:
		# Find all variants of item_code that have this color attribute
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
