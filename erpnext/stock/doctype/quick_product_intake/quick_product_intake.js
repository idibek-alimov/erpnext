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
	},

	refresh(frm) {
		set_default_warehouse(frm);
		render_attribute_pickers(frm);
		style_generate_matrix_btn(frm);

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

	margin_percentage(frm) {
		if (frm.__calc_lock) return;
		frm.__calc_lock = true;
		const buy = flt(frm.doc.buying_price);
		if (buy) {
			frm.set_value("selling_price", flt(buy * (1 + flt(frm.doc.margin_percentage) / 100), 2));
		}
		setTimeout(() => (frm.__calc_lock = false));
	},

	selling_price(frm) {
		if (!frm.__calc_lock) {
			frm.__calc_lock = true;
			const buy = flt(frm.doc.buying_price);
			if (buy) {
				frm.set_value("margin_percentage", flt(((flt(frm.doc.selling_price) - buy) / buy) * 100, 2));
			}
			setTimeout(() => (frm.__calc_lock = false));
		}
		propagate_price(frm, "selling_price");
	},

	buying_price(frm) {
		// keep margin %, recompute retail price from the new cost
		if (!frm.__calc_lock && flt(frm.doc.buying_price) && frm.doc.margin_percentage) {
			frm.set_value("selling_price", flt(flt(frm.doc.buying_price) * (1 + flt(frm.doc.margin_percentage) / 100), 2));
		} else if (!frm.__calc_lock && flt(frm.doc.buying_price) && flt(frm.doc.selling_price)) {
			frm.set_value("margin_percentage", flt(((flt(frm.doc.selling_price) - flt(frm.doc.buying_price)) / flt(frm.doc.buying_price)) * 100, 2));
		}
		propagate_price(frm, "buying_price");
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
		} else {
			render_attribute_pickers(frm);
			style_generate_matrix_btn(frm);
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

function propagate_price(frm, field) {
	if (frm.doc.items && frm.doc.items.length > 0) {
		frm.doc.items.forEach((row) => {
			frappe.model.set_value(row.doctype, row.name, field, frm.doc[field] || 0);
		});
		frm.refresh_field("items");
	}
}

function parse_items_list(text) {
	if (!text) return [];
	return text
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function render_attribute_pickers(frm) {
	if (frm.doc.docstatus !== 0 || !frm.fields_dict.color_picker) return;
	frappe.call({
		method: "erpnext.stock.doctype.quick_product_intake.quick_product_intake.get_attribute_options",
		callback: (r) => {
			const opts = r.message || { colors: [], sizes: [] };
			render_picker(frm, "color_picker", "colors", __("Colors"), opts.colors);
			render_picker(frm, "size_picker", "sizes", __("Sizes"), opts.sizes);
		},
	});
}

function render_picker(frm, html_field, store_field, title, options) {
	const selected = new Set(parse_items_list(frm.doc[store_field]));
	// include selected values that are brand new (not yet in the attribute)
	const all = [...options];
	selected.forEach((v) => {
		if (!all.includes(v)) all.push(v);
	});

	const $w = $(frm.fields_dict[html_field].wrapper).empty();
	$w.append(`<label class="control-label">${title}</label>`);
	const $box = $('<div class="qpi-picker" style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:8px;"></div>').appendTo($w);

	const save = () => {
		frm.set_value(store_field, [...selected].join(", "));
	};

	all.forEach((val) => {
		const $cb = $(`<label class="checkbox" style="margin:0;cursor:pointer;display:flex;align-items:center;gap:6px;">
			<input type="checkbox" ${selected.has(val) ? "checked" : ""}> <span>${frappe.utils.escape_html(val)}</span></label>`);
		$cb.find("input").on("change", (e) => {
			e.target.checked ? selected.add(val) : selected.delete(val);
			save();
		});
		$box.append($cb);
	});

	if (!all.length) {
		$box.append(`<span class="text-muted">${__("No values yet")}</span>`);
	}

	$(`<button type="button" class="btn btn-xs btn-default">+ ${__("Add New")}</button>`)
		.on("click", () => {
			frappe.prompt(
				{ fieldname: "value", fieldtype: "Data", label: title, reqd: 1 },
				(v) => {
					const val = v.value.trim();
					if (!val) return;
					selected.add(val);
					save();
					render_picker(frm, html_field, store_field, title, options.includes(val) ? options : [...options, val]);
				},
				__("Add New"),
				__("Add")
			);
		})
		.appendTo($w);
}

function generate_matrix_rows(frm) {
	if (!frm.doc.item_name) {
		frappe.msgprint(__("Please enter Product Name before generating matrix rows."));
		return;
	}

	const colors = parse_items_list(frm.doc.colors);
	const sizes = parse_items_list(frm.doc.sizes);

	if (colors.length === 0 && sizes.length === 0) {
		frappe.msgprint(__("Please select at least one Color or Size."));
		return;
	}

	const color_list = colors.length > 0 ? colors : [""];
	const size_list = sizes.length > 0 ? sizes : [""];

	frm.clear_table("items");

	color_list.forEach((c) => {
		size_list.forEach((s) => {
			const attrs = [c, s].filter(Boolean).join(", ");

			const row = frm.add_child("items");
			row.color = c;
			row.size = s;
			row.variant_title = attrs ? `${frm.doc.item_name} (${attrs})` : frm.doc.item_name;
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

function style_generate_matrix_btn(frm) {
	setTimeout(() => {
		if (!frm.fields_dict.generate_matrix_btn) return;
		const $fld = $(frm.fields_dict.generate_matrix_btn.wrapper);
		$fld.css({
			"margin-top": "24px",
			"margin-bottom": "16px",
			"text-align": "left",
		});
		const $btn = $fld.find("button");
		$btn
			.removeClass("btn-default btn-xs btn-sm")
			.addClass("btn-generate-matrix-custom")
			.css({
				"background-color": "#09090b",
				"color": "#ffffff",
				"font-size": "15px",
				"font-weight": "700",
				"padding": "12px 28px",
				"border-radius": "8px",
				"border": "1px solid #000000",
				"cursor": "pointer",
				"display": "inline-flex",
				"align-items": "center",
				"gap": "8px",
				"box-shadow": "0 4px 6px -1px rgba(0, 0, 0, 0.25)",
				"transition": "all 0.15s ease",
			});
		$btn.off("mouseenter mouseleave").hover(
			function () { $(this).css({ "background-color": "#27272a", "transform": "translateY(-1px)" }); },
			function () { $(this).css({ "background-color": "#09090b", "transform": "none" }); }
		);
	}, 100);
}
