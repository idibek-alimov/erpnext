# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe

COLOURS = [
	("Черный", "BLA"),
	("Белый", "WHI"),
	("Серый", "GRY"),
	("Красный", "RED"),
	("Синий", "BLU"),
	("Голубой", "LBL"),
	("Темно-синий", "NVY"),
	("Зеленый", "GRE"),
	("Желтый", "YEL"),
	("Оранжевый", "ORG"),
	("Розовый", "PNK"),
	("Фиолетовый", "PRP"),
	("Коричневый", "BRN"),
	("Бежевый", "BEG"),
	("Бордовый", "BRD"),
	("Хаки", "KHK"),
]

SIZES = [(s, s) for s in ("XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL")] + [
	(str(n), str(n)) for n in range(39, 46)
]

# Old English defaults ➔ new defaults (so existing items/variants keep working)
RENAMES = {
	"Colour": {"Red": "Красный", "Green": "Зеленый", "Blue": "Синий", "Black": "Черный", "White": "Белый"},
	"Size": {"Extra Small": "XS", "Small": "S", "Medium": "M", "Large": "L", "Extra Large": "XL"},
}


def execute():
	apply_defaults("Colour", COLOURS, RENAMES["Colour"])
	apply_defaults("Size", SIZES, RENAMES["Size"])
	frappe.db.commit()


def apply_defaults(attribute, defaults, renames):
	if not frappe.db.exists("Item Attribute", attribute):
		frappe.get_doc({"doctype": "Item Attribute", "attribute_name": attribute}).insert(
			ignore_permissions=True
		)

	# 1. Rename old English values in place (values table + already-created variants)
	for old, new in renames.items():
		frappe.db.sql(
			"""UPDATE `tabItem Variant Attribute` SET attribute_value=%s
			WHERE attribute=%s AND attribute_value=%s""",
			(new, attribute, old),
		)
		frappe.db.sql(
			"""UPDATE `tabItem Attribute Value` SET attribute_value=%s
			WHERE parent=%s AND attribute_value=%s""",
			(new, attribute, old),
		)

	doc = frappe.get_doc("Item Attribute", attribute)
	doc.flags.ignore_permissions = True
	doc.flags.ignore_validate = True

	# 2. Make sure every default exists with its abbreviation
	by_value = {r.attribute_value: r for r in doc.item_attribute_values}
	used_abbrs = {(r.abbr or "").upper() for r in doc.item_attribute_values}
	for value, abbr in defaults:
		row = by_value.get(value)
		if row:
			if not row.abbr:
				row.abbr = abbr
			continue
		if abbr.upper() in used_abbrs:
			continue
		doc.append("item_attribute_values", {"attribute_value": value, "abbr": abbr})
		used_abbrs.add(abbr.upper())

	# 3. Defaults first (in order), user-added values after them
	order = {v: i for i, (v, _a) in enumerate(defaults)}
	rows = sorted(doc.item_attribute_values, key=lambda r: (order.get(r.attribute_value, 10_000), r.idx))
	for i, r in enumerate(rows, 1):
		r.idx = i
	doc.set("item_attribute_values", rows)
	doc.save()
