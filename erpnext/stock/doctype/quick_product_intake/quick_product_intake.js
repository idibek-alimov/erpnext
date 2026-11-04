// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quick Product Intake", {
	setup(frm) {
		frm.set_query("payment_account", () => ({
			filters: {
				company: frm.doc.company,
				is_group: 0,
				disabled: 0,
				account_type: ["in", ["Cash", "Bank"]],
				account_currency: frm.doc.currency,
			},
		}));
		frm.set_query("target_warehouse", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
					disabled: 0,
				},
			};
		});
	},

	onload(frm) {
		if (frm.doc.docstatus !== 0) return;
		set_default_warehouse(frm);
		intake_defaults(frm, false);
	},

	refresh(frm) {
		frm.__header_prices = { buying_price: frm.doc.buying_price, selling_price: frm.doc.selling_price };
		render_attribute_pickers(frm);
		render_intake_summary(frm);

		if (frm.doc.docstatus === 0) {
			if (frm.doc.has_variants) {
				frm.add_custom_button(
					__("Fill Same Qty for All"),
					() => {
						fill_all_quantities(frm);
					},
					__("Matrix Actions")
				);

				frm.add_custom_button(
					__("Apply Header Prices to Rows"),
					() => {
						apply_header_prices(frm);
					},
					__("Matrix Actions")
				);
			}
		} else if (frm.doc.docstatus === 1) {
			const product = frm.doc.template_item || frm.doc.items?.[0]?.generated_item_code;
			if (product)
				frm.add_custom_button(__("Product Detail"), () => {
					frappe.route_options = {
						catalog_company: frm.doc.company,
						catalog_period: "month",
						catalog_warehouse: frm.doc.target_warehouse || "",
					};
					frappe.set_route("product-detail", product);
				});
			frm.add_custom_button(__("Supplier Detail"), () => {
				frappe.route_options = { supplier_company: frm.doc.company };
				frappe.set_route("supplier-detail", frm.doc.supplier);
			});
			if (frm.doc.payment_entry)
				frm.add_custom_button(
					__("Payment Entry"),
					() => frappe.set_route("Form", "Payment Entry", frm.doc.payment_entry),
					__("View")
				);
			if (frm.doc.template_item) {
				frm.add_custom_button(
					__("Template Item"),
					() => {
						frappe.set_route("Form", "Item", frm.doc.template_item);
					},
					__("View")
				);
			}
			if (frm.doc.purchase_invoice) {
				frm.add_custom_button(
					__("Purchase Invoice"),
					() => {
						frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice);
					},
					__("View")
				);
			}
			if (frm.doc.stock_entry) {
				frm.add_custom_button(
					__("Stock Entry"),
					() => {
						frappe.set_route("Form", "Stock Entry", frm.doc.stock_entry);
					},
					__("View")
				);
			}
			if (frm.doc.pricing_rule) {
				frm.add_custom_button(
					__("Pricing Rule"),
					() => {
						frappe.set_route("Form", "Pricing Rule", frm.doc.pricing_rule);
					},
					__("View")
				);
			}
		}
	},

	generate_matrix_btn(frm) {
		generate_matrix_rows(frm);
	},

	company(frm) {
		if (frm.doc.docstatus !== 0) return;
		frm.set_value("payment_account", "");
		set_default_warehouse(frm, true);
		intake_defaults(frm, true);
	},
	supplier: (frm) => intake_defaults(frm, true),
	posting_date: (frm) => intake_defaults(frm, false),
	bill_date: (frm) => intake_defaults(frm, false),
	due_date: render_intake_summary,
	payment_amount: render_intake_summary,
	currency(frm) {
		for (const field of ["buying_price", "selling_price", "payment_amount", "items"])
			frm.refresh_field(field);
		render_intake_summary(frm);
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
			frm.set_value(
				"selling_price",
				flt(flt(frm.doc.buying_price) * (1 + flt(frm.doc.margin_percentage) / 100), 2)
			);
		} else if (!frm.__calc_lock && flt(frm.doc.buying_price) && flt(frm.doc.selling_price)) {
			frm.set_value(
				"margin_percentage",
				flt(
					((flt(frm.doc.selling_price) - flt(frm.doc.buying_price)) / flt(frm.doc.buying_price)) *
						100,
					2
				)
			);
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
		}
		render_intake_summary(frm);
	},

	item_name(frm) {
		if (!frm.doc.has_variants && frm.doc.items && frm.doc.items.length === 1) {
			frappe.model.set_value(
				frm.doc.items[0].doctype,
				frm.doc.items[0].name,
				"variant_title",
				frm.doc.item_name || ""
			);
			frm.refresh_field("items");
		}
	},
});

frappe.ui.form.on("Quick Product Intake Item", {
	qty: render_intake_summary,
	buying_price: render_intake_summary,
	selling_price: render_intake_summary,
	items_remove: render_intake_summary,
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
	if (frm.doc.docstatus !== 0) return;
	if (!frm.doc.company) {
		const default_comp =
			frappe.defaults.get_default("company") || frappe.defaults.get_user_default("Company");
		if (default_comp) {
			frm.set_value("company", default_comp);
		}
	}

	const current_wh = frm.doc.target_warehouse || "";
	const needs_stores_wh = !current_wh || force;

	if (frm.doc.company && needs_stores_wh) {
		const company = frm.doc.company;
		const previous = frm.doc.target_warehouse;
		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Warehouse",
				filters: {
					company: frm.doc.company,
					is_group: 0,
					disabled: 0,
				},
				fields: ["name", "warehouse_name"],
				limit_page_length: 50,
			},
			callback: function (r) {
				if (
					frm.doc.company !== company ||
					frm.doc.target_warehouse !== previous ||
					frm.doc.docstatus !== 0
				)
					return;
				if (r.message && r.message.length > 0) {
					// 1. Strict match for warehouse named "Stores"
					let preferred = r.message.find((w) => w.warehouse_name === "Stores");
					// 2. Match warehouse with "store" in warehouse_name or name
					if (!preferred) {
						preferred = r.message.find(
							(w) =>
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
	const previous = frm.__header_prices?.[field];
	frm.__header_prices = { ...frm.__header_prices, [field]: frm.doc[field] };
	if (frm.doc.items && frm.doc.items.length > 0) {
		frm.doc.items.forEach((row) => {
			if (!flt(row[field]) || flt(row[field]) === flt(previous)) {
				frappe.model.set_value(row.doctype, row.name, field, frm.doc[field] || 0);
			}
		});
		frm.refresh_field("items");
	}
	render_intake_summary(frm);
}

function parse_items_list(text) {
	if (!text) return [];
	return text
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function render_attribute_pickers(frm) {
	if (frm.doc.docstatus !== 0 || !frm.doc.has_variants || !frm.fields_dict.color_picker) return;
	const request = (frm.__picker_request || 0) + 1;
	frm.__picker_request = request;
	frappe.call({
		method: "erpnext.stock.doctype.quick_product_intake.quick_product_intake.get_attribute_options",
		callback: (r) => {
			if (frm.__picker_request !== request || frm.doc.docstatus !== 0 || !frm.doc.has_variants) return;
			const opts = r.message || { colors: [], sizes: [] };
			render_picker(frm, "color_picker", "colors", __("Colors"), opts.colors);
			render_picker(frm, "size_picker", "sizes", __("Sizes"), opts.sizes);
		},
		error: () => {
			if (frm.__picker_request !== request) return;
			const wrapper = $(frm.fields_dict.color_picker.wrapper).empty();
			$("<p class='text-muted'>").text(__("Could not load colors and sizes")).appendTo(wrapper);
			$("<button type='button' class='btn btn-xs btn-default'>")
				.text(__("Retry"))
				.on("click", () => render_attribute_pickers(frm))
				.appendTo(wrapper);
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
	const $box = $(
		'<div class="qpi-picker" style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-bottom:8px;"></div>'
	).appendTo($w);

	const save = () => {
		frm.set_value(store_field, [...selected].join(", "));
	};

	all.forEach((val) => {
		const $cb =
			$(`<label class="checkbox" style="margin:0;cursor:pointer;display:flex;align-items:center;gap:6px;">
			<input type="checkbox" ${selected.has(val) ? "checked" : ""}> <span>${frappe.utils.escape_html(
				val
			)}</span></label>`);
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
					render_picker(
						frm,
						html_field,
						store_field,
						title,
						options.includes(val) ? options : [...options, val]
					);
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
	// Desk adds a blank placeholder row to a new required table. It is not a variant.
	for (const row of [...(frm.doc.items || [])]) {
		if (
			!row.color &&
			!row.size &&
			!flt(row.qty) &&
			!row.barcode &&
			!row.variant_title &&
			!row.generated_item_code &&
			(!flt(row.buying_price) || flt(row.buying_price) === flt(frm.doc.buying_price)) &&
			(!flt(row.selling_price) || flt(row.selling_price) === flt(frm.doc.selling_price))
		) {
			frappe.model.clear_doc(row.doctype, row.name);
		}
	}

	const key = (color, size) =>
		JSON.stringify([(color || "").trim().toLowerCase(), (size || "").trim().toLowerCase()]);
	const existing = new Set((frm.doc.items || []).map((row) => key(row.color, row.size)));
	let added = 0;

	color_list.forEach((c) => {
		size_list.forEach((s) => {
			if (existing.has(key(c, s))) return;
			const attrs = [c, s].filter(Boolean).join(", ");

			const row = frm.add_child("items");
			row.color = c;
			row.size = s;
			row.variant_title = attrs ? `${frm.doc.item_name} (${attrs})` : frm.doc.item_name;
			row.qty = 0;
			row.buying_price = frm.doc.buying_price || 0;
			row.selling_price = frm.doc.selling_price || 0;
			existing.add(key(c, s));
			added++;
		});
	});

	frm.refresh_field("items");
	render_intake_summary(frm);
	frappe.show_alert({
		message: __("Added {0} variants. Existing quantities and prices were kept.", [added]),
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
		(values) => {
			if (flt(values.qty) < 0) {
				frappe.throw(__("Incoming quantity cannot be negative"));
			}
			frm.doc.items.forEach((row) => {
				row.qty = values.qty;
			});
			frm.refresh_field("items");
			render_intake_summary(frm);
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

	frm.doc.items.forEach((row) => {
		row.buying_price = frm.doc.buying_price || 0;
		row.selling_price = frm.doc.selling_price || 0;
	});
	frm.refresh_field("items");
	render_intake_summary(frm);
	frappe.show_alert({
		message: __("Updated prices for all rows from header."),
		indicator: "green",
	});
}

async function intake_defaults(frm, changed_supplier) {
	if (!frm.doc.company || frm.doc.docstatus !== 0) return;
	const request = (frm.__defaults_request || 0) + 1;
	frm.__defaults_request = request;
	const previous_deadline = frm.doc.due_date;
	const { message } = await frappe.call({
		method: "erpnext.stock.doctype.quick_product_intake.quick_product_intake.get_intake_defaults",
		args: {
			company: frm.doc.company,
			supplier: frm.doc.supplier,
			posting_date: frm.doc.posting_date,
			bill_date: frm.doc.bill_date,
		},
	});
	if (request !== frm.__defaults_request || frm.doc.docstatus !== 0) return;
	await frm.set_value("currency", message.currency);
	// Clearing a suggested deadline intentionally keeps the agreement open-ended.
	if (
		frm.doc.due_date === previous_deadline &&
		(changed_supplier || (previous_deadline && previous_deadline === frm.__suggested_deadline))
	) {
		frm.__suggested_deadline = message.due_date || null;
		await frm.set_value("due_date", frm.__suggested_deadline);
	}
	render_intake_summary(frm);
}

function render_intake_summary(frm) {
	if (!frm.fields_dict.intake_summary) return;
	const rows = frm.doc.items || [];
	const quantity = rows.reduce((sum, row) => sum + Math.max(0, flt(row.qty)), 0);
	const total = rows.reduce(
		(sum, row) => sum + Math.max(0, flt(row.qty)) * flt(row.buying_price || frm.doc.buying_price),
		0
	);
	const paid = flt(frm.doc.payment_amount);
	const wrapper = $(frm.fields_dict.intake_summary.wrapper).empty();
	const figures = $("<div class='qpi-summary'>")
		.css({ display: "flex", flexWrap: "wrap", gap: "16px 32px", marginBottom: "12px" })
		.appendTo(wrapper);
	for (const [label, value] of [
		[__("Incoming Qty"), frappe.format(quantity, { fieldtype: "Float" })],
		[__("Purchase Total"), format_currency(total, frm.doc.currency)],
		[__("Payment to Record"), format_currency(paid, frm.doc.currency)],
		[__("Remaining Supplier Debt"), format_currency(total - paid, frm.doc.currency)],
	]) {
		const figure = $("<div>").appendTo(figures);
		$("<div class='text-muted small'>").text(label).appendTo(figure);
		$("<div>").html(value).appendTo(figure);
	}
	const note = !quantity
		? frm.doc.docstatus === 1
			? __("Product created without incoming stock or supplier debt.")
			: __("Product only: no goods received, no invoice, and no supplier debt.")
		: frm.doc.due_date
		? __("Pay by {0}", [frappe.datetime.str_to_user(frm.doc.due_date)])
		: __("Payment deadline not specified");
	$("<p class='text-muted small'>").text(note).appendTo(wrapper);
	if (frm.doc.docstatus === 1 && frm.doc.purchase_invoice) {
		$("<p class='text-muted small'>")
			.text(__("Amounts recorded by this intake. Open the invoice for the current balance."))
			.appendTo(wrapper);
	}
	if (paid > total || paid < 0 || rows.some((row) => flt(row.qty) < 0)) {
		$("<p class='text-danger small'>")
			.text(__("Check quantities and payment amount before submitting"))
			.appendTo(wrapper);
	}
}
