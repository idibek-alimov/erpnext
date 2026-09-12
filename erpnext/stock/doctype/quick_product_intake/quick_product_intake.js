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

	refresh(frm) {
		if (frm.doc.docstatus === 0) {
			if (frm.doc.has_variants) {
				frm.add_custom_button(__("⚡ Generate Matrix Rows"), () => {
					generate_matrix_rows(frm);
				}, __("Matrix Actions"));

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

	company(frm) {
		if (frm.doc.company) {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Warehouse",
					filters: {
						company: frm.doc.company,
						is_group: 0,
					},
					fields: ["name", "warehouse_name"],
					limit_page_length: 20,
				},
				callback: function (r) {
					if (r.message && r.message.length > 0 && !frm.doc.target_warehouse) {
						const preferred = r.message.find(w => ["Stores", "Finished Goods"].includes(w.warehouse_name));
						frm.set_value("target_warehouse", preferred ? preferred.name : r.message[0].name);
					}
				},
			});
		}
	},
});

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
		message: __("{0} matrix rows generated successfully.", [frm.doc.items.length]),
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
