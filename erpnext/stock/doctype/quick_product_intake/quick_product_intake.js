// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quick Product Intake", {
	setup(frm) {
		frm.set_query("target_warehouse", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});
	},

	onload(frm) {
		set_default_warehouse(frm);
		if (frm.doc.discount_percentage && frm.doc.discount_percentage > 0) {
			frm.set_value("create_pricing_rule", 1);
		}
	},

	refresh(frm) {
		set_default_warehouse(frm);

		if (frm.doc.docstatus === 0) {
			if (frm.doc.has_variants) {
				frm.add_custom_button(__("⚡ Generate Matrix Rows"), () => {
					generate_matrix_rows(frm);
				}).addClass("btn-primary");

				frm.add_custom_button(__("Fill Same Qty for All"), () => {
					fill_all_quantities(frm);
				}, __("Matrix Actions"));

				frm.add_custom_button(__("Apply Header Prices to Rows"), () => {
					apply_header_prices(frm);
				}, __("Matrix Actions"));
			}
		} else if (frm.doc.docstatus === 1) {
			if (frm.doc.template_item) {
				frm.add_custom_button(__("Template Item"), () => {
					frappe.set_route("Form", "Item", frm.doc.template_item);
				}, __("View"));
			}
			if (frm.doc.purchase_invoice) {
				frm.add_custom_button(__("Purchase Invoice"), () => {
					frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice);
				}, __("View"));
			}
			if (frm.doc.stock_entry) {
				frm.add_custom_button(__("Stock Entry"), () => {
					frappe.set_route("Form", "Stock Entry", frm.doc.stock_entry);
				}, __("View"));
			}
			if (frm.doc.pricing_rule) {
				frm.add_custom_button(__("Pricing Rule"), () => {
					frappe.set_route("Form", "Pricing Rule", frm.doc.pricing_rule);
				}, __("View"));
			}
		}
	},

	generate_matrix_btn(frm) {
		generate_matrix_rows(frm);
	},

	company(frm) {
		set_default_warehouse(frm, true);
	},

	discount_percentage(frm) {
		if (frm.doc.discount_percentage && frm.doc.discount_percentage > 0) {
			frm.set_value("create_pricing_rule", 1);
		} else {
			frm.set_value("create_pricing_rule", 0);
		}
	},

	selling_price(frm) {
		if (frm.doc.items && frm.doc.items.length > 0) {
			frm.doc.items.forEach(row => {
				frappe.model.set_value(row.doctype, row.name, "selling_price", frm.doc.selling_price || 0);
			});
			frm.refresh_field("items");
		}
	},

	buying_price(frm) {
		if (frm.doc.items && frm.doc.items.length > 0) {
			frm.doc.items.forEach(row => {
				frappe.model.set_value(row.doctype, row.name, "buying_price", frm.doc.buying_price || 0);
			});
			frm.refresh_field("items");
		}
	},

	has_variants(frm) {
		if (!frm.doc.has_variants) {
			if (!frm.doc.items || frm.doc.items.length === 0) {
				const row = frm.add_child("items");
				row.variant_title = frm.doc.item_name || "";
				row.buying_price = frm.doc.buying_price || 0;
				row.selling_price = frm.doc.selling_price || 0;
				row.qty = 0;
				frm.refresh_field("items");
			}
		}
	},

	item_name(frm) {
		if (!frm.doc.has_variants && frm.doc.items && frm.doc.items.length === 1) {
			frappe.model.set_value(frm.doc.items[0].doctype, frm.doc.items[0].name, "variant_title", frm.doc.item_name || "");
			frm.refresh_field("items");
		}
	},
});

frappe.ui.form.on("Quick Product Intake Item", {
	items_add(frm, cdt, cdn) {
		const row = frappe.get_doc(cdt, cdn);
		if (!row.selling_price && frm.doc.selling_price) {
			frappe.model.set_value(cdt, cdn, "selling_price", frm.doc.selling_price);
		}
		if (!row.buying_price && frm.doc.buying_price) {
			frappe.model.set_value(cdt, cdn, "buying_price", frm.doc.buying_price);
		}
	},
});

function set_default_warehouse(frm, force = false) {
	if (!frm.doc.company) {
		const default_comp = frappe.defaults.get_default("company") || frappe.defaults.get_user_default("Company");
		if (default_comp) {
			frm.set_value("company", default_comp);
		}
	}

	const current_wh = frm.doc.target_warehouse || "";
	const needs_stores_wh = !current_wh || force || current_wh.includes("Finished Goods");

	if (frm.doc.company && needs_stores_wh) {
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Warehouse",
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
				fields: ["name", "warehouse_name"],
				limit_page_length: 50,
			},
			callback: function (r) {
				if (r.message && r.message.length > 0) {
					// 1. Strict match for warehouse named "Stores"
					let preferred = r.message.find(w => w.warehouse_name === "Stores");
					// 2. Match warehouse with "store" in warehouse_name or name
					if (!preferred) {
						preferred = r.message.find(w =>
							(w.warehouse_name && w.warehouse_name.toLowerCase().includes("store")) ||
							(w.name && w.name.toLowerCase().includes("store"))
						);
					}
					// 3. Fallback only if no stores warehouse exists
					const selected = preferred ? preferred.name : r.message[0].name;
					if (frm.doc.target_warehouse !== selected) {
						frm.set_value("target_warehouse", selected);
					}
				}
			},
		});
	}
}

function parse_items_list(text) {
	if (!text) return [];
	return text
		.split(/[\n,]+/)
		.map(s => s.trim())
		.filter(s => s.length > 0);
}

function generate_matrix_rows(frm) {
	if (!frm.doc.item_name) {
		frappe.msgprint(__("Please enter Product Name before generating matrix rows."));
		return;
	}

	const colors = parse_items_list(frm.doc.colors);
	const sizes = parse_items_list(frm.doc.sizes);

	if (colors.length === 0 && sizes.length === 0) {
		frappe.msgprint(__("Please enter at least one Color or Size."));
		return;
	}

	const color_list = colors.length > 0 ? colors : [""];
	const size_list = sizes.length > 0 ? sizes : [""];

	frm.clear_table("items");

	color_list.forEach(c => {
		size_list.forEach(s => {
			const parts = [frm.doc.item_name];
			if (c) parts.push(c);
			if (s) parts.push(s);

			const row = frm.add_child("items");
			row.color = c;
			row.size = s;
			row.variant_title = parts.join(" - ");
			row.qty = 0;
			row.buying_price = frm.doc.buying_price || 0;
			row.selling_price = frm.doc.selling_price || 0;
		});
	});

	frm.refresh_field("items");
	frappe.show_alert({
		message: __("{0} matrix rows generated with Retail Price {1}.", [frm.doc.items.length, frm.doc.selling_price || 0]),
		indicator: "green",
	});
}

function fill_all_quantities(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("Please generate matrix rows first."));
		return;
	}

	frappe.prompt(
		[
			{
				fieldname: "qty",
				fieldtype: "Float",
				label: __("Quantity for All Rows"),
				reqd: 1,
				default: 10,
			},
		],
		values => {
			frm.doc.items.forEach(row => {
				row.qty = values.qty;
			});
			frm.refresh_field("items");
			frappe.show_alert({
				message: __("Set quantity to {0} for all rows.", [values.qty]),
				indicator: "green",
			});
		},
		__("Fill Quantities"),
		__("Apply")
	);
}

function apply_header_prices(frm) {
	if (!frm.doc.items || frm.doc.items.length === 0) {
		frappe.msgprint(__("Please generate matrix rows first."));
		return;
	}

	frm.doc.items.forEach(row => {
		row.buying_price = frm.doc.buying_price || 0;
		row.selling_price = frm.doc.selling_price || 0;
	});
	frm.refresh_field("items");
	frappe.show_alert({
		message: __("Updated prices for all rows from header."),
		indicator: "green",
	});
}
