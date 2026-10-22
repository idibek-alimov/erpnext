# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# See license.txt

import frappe
from frappe.tests.utils import FrappeTestCase
from erpnext.stock.doctype.quick_discount.quick_discount import (
	lookup_item_for_discount,
	transfer_item_from_campaign,
	search_products_for_discount,
	get_product_variant_matrix,
	get_category_filter_data,
	preview_category_discount,
)


class TestQuickDiscount(FrappeTestCase):
	pass


def run_discount_tests():
	print("--- Starting Quick Discount Integration Tests ---")

	# Pick test item
	test_item = frappe.db.get_value("Item", {"custom_short_code": "1001"}, "name") or "123123"
	assert test_item, "Test item '123123' or short code '1001' not found"

	# Clean up any leftover test docs
	for d in frappe.get_all("Quick Discount", filters={"title": ["like", "Test QC%"]}):
		frappe.delete_doc("Quick Discount", d.name, force=True)

	# 1. Create Campaign A (Tier 2 - Priority 15)
	qd1 = frappe.get_doc({
		"doctype": "Quick Discount",
		"title": "Test QC Campaign A",
		"enabled": 1,
		"priority_tier": "Tier 2 - Акция на товар (15)",
		"discount_scope": "По выбранным товарам (Items / Scan)",
		"discount_percentage": 20.0,
		"is_lifetime": 1,
		"items": [
			{
				"item_code": test_item,
				"item_name": "Test Product",
				"scope_type": "Specific SKU",
				"base_price": 100.0,
			}
		],
	})
	qd1.insert()
	print(f"✓ Campaign A created: {qd1.name}")

	# Check priority
	assert qd1.get_calculated_priority() == 15, f"Expected 15, got {qd1.get_calculated_priority()}"
	assert qd1.pricing_rule, "Pricing rule was not linked"
	pr1 = frappe.get_doc("Pricing Rule", qd1.pricing_rule)
	assert str(pr1.priority) == "15", f"Expected PR priority '15', got {pr1.priority}"
	assert pr1.has_priority == 1, "Expected has_priority == 1"
	assert pr1.discount_percentage == 20.0, "Expected discount 20%"
	print(f"✓ Linked Pricing Rule verified: {pr1.name} with priority={pr1.priority}")

	# 2. Test get_product_variant_matrix & lookup_item_for_discount
	matrix = get_product_variant_matrix("1001", current_tier="Tier 2 - Акция на товар (15)")
	assert matrix is not None, "get_product_variant_matrix returned None"
	assert len(matrix["colors"]) > 0, "Expected colors in matrix"
	print(f"✓ Variant matrix loaded: template={matrix['template_code']}, colors count={len(matrix['colors'])}")

	info = lookup_item_for_discount("1001", current_tier="Tier 2 - Акция на товар (15)")
	assert info is not None, "Lookup returned None"
	assert info["existing_discount"] is not None, "Existing discount not detected"
	assert info["existing_discount"]["is_same_tier"] is True, "Same tier conflict flag not set"
	print(f"✓ Lookup detected same-tier active discount: {info['existing_discount']}")

	# 3. Test search_products_for_discount
	prods = search_products_for_discount("1001")
	assert len(prods) > 0, "search_products_for_discount returned empty"
	print(f"✓ Autocomplete search found {len(prods)} products")

	# 4. Test duplicate creation prevention (validate_no_same_tier_conflicts)
	conflict_thrown = False
	try:
		qd2 = frappe.get_doc({
			"doctype": "Quick Discount",
			"title": "Test QC Campaign B (Conflicting)",
			"enabled": 1,
			"priority_tier": "Tier 2 - Акция на товар (15)",
			"discount_scope": "По выбранным товарам (Items / Scan)",
			"discount_percentage": 30.0,
			"is_lifetime": 1,
			"items": [
				{
					"item_code": test_item,
					"item_name": "Test Product",
					"scope_type": "Specific SKU",
					"base_price": 100.0,
				}
			],
		})
		qd2.insert()
	except frappe.ValidationError as e:
		conflict_thrown = True
		print(f"✓ Conflict correctly blocked by validate_no_same_tier_conflicts: {e}")

	assert conflict_thrown, "Expected ValidationError on same-tier conflict, but save succeeded!"

	# 5. Test 1-Click transfer
	transfer_res = transfer_item_from_campaign(qd1.name, test_item)
	assert transfer_res.get("success") is True, f"Transfer failed: {transfer_res}"
	assert transfer_res.get("paused") is True, "Campaign A should be paused since it had only 1 item"
	qd1.reload()
	assert len(qd1.items) == 0, "Item was not removed from Campaign A"
	assert qd1.enabled == 0, "Campaign A was not paused"
	print(f"✓ 1-Click transfer succeeded: Item removed and Campaign A paused")

	# Now Campaign B can be saved
	qd2 = frappe.get_doc({
		"doctype": "Quick Discount",
		"title": "Test QC Campaign B (After Transfer)",
		"enabled": 1,
		"priority_tier": "Tier 2 - Акция на товар (15)",
		"discount_scope": "По выбранным товарам (Items / Scan)",
		"discount_percentage": 30.0,
		"is_lifetime": 1,
		"items": [
			{
				"item_code": test_item,
				"item_name": "Test Product",
				"scope_type": "Specific SKU",
				"base_price": 100.0,
			}
		],
	})
	qd2.insert()
	print(f"✓ Campaign B saved successfully after transfer: {qd2.name}")

	# 6. Test Category mode filter data & preview
	cat = frappe.db.get_value("Item", test_item, "item_group")
	filter_data = get_category_filter_data(cat)
	assert "colors" in filter_data and "sizes" in filter_data, "Filter data missing keys"
	preview_data = preview_category_discount(cat, discount_percentage=15.0)
	assert "total_count" in preview_data and "items" in preview_data, "Preview missing keys"
	print(f"✓ Category filter & preview verified for group '{cat}': found {preview_data['total_count']} items")

	# 7. Test Priority tier mapping
	qd_tiers = [
		("Tier 1 - Ликвидация / Финальная уценка (20)", 20),
		("Tier 2 - Акция на товар (15)", 15),
		("Tier 3 - Распродажа категории (10)", 10),
		("Tier 4 - Базовая / Лояльность (5)", 5),
	]
	for tier_str, expected_num in qd_tiers:
		dummy = frappe.new_doc("Quick Discount")
		dummy.priority_tier = tier_str
		calc_p = dummy.get_calculated_priority()
		assert calc_p == expected_num, f"For {tier_str}, expected {expected_num}, got {calc_p}"
		assert calc_p not in (0, 1, 2), f"Priority {calc_p} collides with reserved 0, 1, 2!"
		assert 3 <= calc_p <= 20, f"Priority {calc_p} outside range 3-20!"
	print("✓ All priority tiers verified strictly within 3-20 without colliding with reserved 0, 1, 2")

	# 8. Cleanup
	pr2_name = qd2.pricing_rule
	qd1.delete()
	qd2.delete()
	frappe.db.commit()

	assert not frappe.db.exists("Pricing Rule", pr1.name), "PR1 was not cleaned up on trash"
	assert not frappe.db.exists("Pricing Rule", pr2_name), "PR2 was not cleaned up on trash"
	print("✓ Cleanup successful: Quick Discounts and linked Pricing Rules removed cleanly")

	print("\n>>> ALL QUICK DISCOUNT INTEGRATION TESTS PASSED SUCCESSFULLY! <<<")
	return True
