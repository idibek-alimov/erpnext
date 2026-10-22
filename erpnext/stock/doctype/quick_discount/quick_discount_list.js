// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.listview_settings["Quick Discount"] = {
	add_fields: ["title", "enabled", "priority_tier", "discount_scope", "discount_percentage", "is_lifetime", "valid_from", "valid_upto"],

	get_indicator: function (doc) {
		if (!doc.enabled) {
			return [__("На паузе"), "grey", "enabled,=,0"];
		}
		if (!doc.is_lifetime && doc.valid_upto && doc.valid_upto < frappe.datetime.get_today()) {
			return [__("Истекла"), "red", "valid_upto,<,Today"];
		}
		return [__("Активна"), "green", "enabled,=,1"];
	},

	formatters: {
		priority_tier: function (val) {
			if (!val) return "";
			if (val.includes("Tier 1")) {
				return `<span class="indicator-pill red" style="font-weight: 600;">🔴 ТОП-1 Ликвидация</span>`;
			} else if (val.includes("Tier 2")) {
				return `<span class="indicator-pill orange" style="font-weight: 600;">🟠 ТОП-2 Товар</span>`;
			} else if (val.includes("Tier 3")) {
				return `<span class="indicator-pill yellow" style="font-weight: 600;">🟡 ТОП-3 Категория</span>`;
			} else if (val.includes("Tier 4")) {
				return `<span class="indicator-pill green" style="font-weight: 600;">🟢 ТОП-4 Лояльность</span>`;
			}
			return val;
		},
		discount_percentage: function (val) {
			if (val && flt(val) > 0) {
				return `<strong style="color: var(--text-color); font-size: 13px;">-${flt(val)}%</strong>`;
			}
			return "-";
		}
	}
};
