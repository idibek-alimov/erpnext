// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quick Product Restock", {
	setup(frm) {
		frm.set_query("item", () => ({
			filters: { variant_of: ["is", "not set"], disabled: 0 },
		}));
		frm.set_query("target_warehouse", () => ({
			filters: { company: frm.doc.company, is_group: 0 },
		}));
	},

	onload(frm) {
		if (frm.is_new() && !frm.doc.company) {
			const company = frappe.defaults.get_user_default("Company");
			if (company) frm.set_value("company", company);
		}
	},

	refresh(frm) {
		if (frm.is_new() && frm.doc.item && !(frm.doc.items || []).length) {
			load_rows(frm);
		}
		if (frm.is_new() && frm.doc.company && !frm.doc.target_warehouse) {
			set_default_warehouse(frm);
		}

		if (frm.doc.docstatus === 0) {
			frm.add_custom_button(__("➕ Add New Size / Color"), () => add_new_row(frm)).addClass("btn-primary");
			frm.add_custom_button(__("Apply Prices to All Sizes"), () => apply_prices_to_all(frm), __("Bulk Actions"));
			frm.add_custom_button(__("Same Received Qty for All"), () => fill_same_qty(frm), __("Bulk Actions"));
		} else if (frm.doc.docstatus === 1) {
			if (frm.doc.item) {
				frm.add_custom_button(__("Product"), () => frappe.set_route("Form", "Item", frm.doc.item), __("View"));
			}
			if (frm.doc.purchase_invoice) {
				frm.add_custom_button(__("Purchase Invoice"), () => frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice), __("View"));
			}
			if (frm.doc.stock_entry) {
				frm.add_custom_button(__("Stock Entry"), () => frappe.set_route("Form", "Stock Entry", frm.doc.stock_entry), __("View"));
			}
		}
	},

	company(frm) {
		set_default_warehouse(frm);
	},

	item(frm) {
		if (frm.doc.docstatus === 0) load_rows(frm);
	},
});

frappe.ui.form.on("Quick Product Restock Item", {
	items_add(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.item_code) return;
		// A manually added row is a brand-new size/color
		const ref = (frm.doc.items || []).find((r) => r.item_code);
		frappe.model.set_value(cdt, cdn, "is_new_variant", 1);
		if (ref) {
			frappe.model.set_value(cdt, cdn, "selling_price", ref.selling_price);
			frappe.model.set_value(cdt, cdn, "buying_price", ref.buying_price);
		}
	},
});

function set_default_warehouse(frm) {
	if (!frm.doc.company) return;
	frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_default_warehouse",
		args: { company: frm.doc.company },
		callback(r) {
			if (r.message && frm.doc.target_warehouse !== r.message) {
				frm.set_value("target_warehouse", r.message);
			}
		},
	});
}

function load_rows(frm) {
	if (!frm.doc.item) {
		frm.clear_table("items");
		frm.refresh_field("items");
		return;
	}
	frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_restock_rows",
		args: { item: frm.doc.item },
		freeze: true,
		callback(r) {
			frm.clear_table("items");
			(r.message || []).forEach((d) => {
				const row = frm.add_child("items");
				Object.assign(row, d, { is_new_variant: 0 });
			});
			frm.refresh_field("items");
			if (!(r.message || []).length) {
				frappe.msgprint(__("This product has no sizes yet. Use 'Add New Size / Color'."));
			}
		},
	});
}

function add_new_row(frm) {
	if (!frm.doc.item) {
		frappe.msgprint(__("Please select a Product first."));
		return;
	}
	const row = frm.add_child("items");
	row.is_new_variant = 1;
	const ref = (frm.doc.items || []).find((r) => r.item_code);
	if (ref) {
		row.selling_price = ref.selling_price;
		row.buying_price = ref.buying_price;
	}
	frm.refresh_field("items");
}

function apply_prices_to_all(frm) {
	if (!(frm.doc.items || []).length) return;
	frappe.prompt(
		[
			{
				fieldname: "selling_price",
				fieldtype: "Currency",
				label: __("NEW Retail Price (leave empty to keep)"),
			},
			{
				fieldname: "buying_price",
				fieldtype: "Currency",
				label: __("Cost of This Delivery (leave empty to keep)"),
			},
		],
		(v) => {
			frm.doc.items.forEach((row) => {
				if (flt(v.selling_price) > 0) row.selling_price = v.selling_price;
				if (flt(v.buying_price) > 0) row.buying_price = v.buying_price;
			});
			frm.refresh_field("items");
		},
		__("Apply to All Sizes"),
		__("Apply")
	);
}

function fill_same_qty(frm) {
	if (!(frm.doc.items || []).length) return;
	frappe.prompt(
		[{ fieldname: "qty", fieldtype: "Float", label: __("Received Qty for Every Row"), reqd: 1, default: 10 }],
		(v) => {
			frm.doc.items.forEach((row) => (row.qty = v.qty));
			frm.refresh_field("items");
		},
		__("Fill Quantities"),
		__("Apply")
	);
}
