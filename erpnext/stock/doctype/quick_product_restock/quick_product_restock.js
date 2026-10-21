// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

/*
 * Quick Product Restock
 * Standard Desk form. The "Colors, Sizes & Quantities" HTML area lets staff tick the colors that
 * arrived and shows one clearly labelled table per color. Sizes are always picked from the
 * Item Attribute list (never typed). The hidden child table `items` is filled from this state
 * and is what the server processes.
 */

frappe.ui.form.on("Quick Product Restock", {
	setup(frm) {
		frm.set_query("supplier", () => ({ filters: { disabled: 0 } }));
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
		if (frm.doc.docstatus === 0) {
			setup_product_autocomplete(frm);
			if (frm.is_new() && frm.doc.company && !frm.doc.target_warehouse) {
				set_default_warehouse(frm);
			}
			init_matrix(frm);
		} else {
			if (frm.doc.item) {
				frm.add_custom_button(
					__("Product"),
					() => frappe.set_route("product-detail", frm.doc.item),
					__("View")
				);
			}
			if (frm.doc.purchase_invoice) {
				frm.add_custom_button(
					__("Purchase Invoice"),
					() => frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice),
					__("View")
				);
			}
		}
	},

	company(frm) {
		set_default_warehouse(frm);
	},

	short_code(frm) {
		if (frm.doc.docstatus !== 0) return;
		const code = (frm.doc.short_code || "").trim();
		if (!code) {
			if (frm.doc.item) {
				apply_product_selection(frm, "", "", "");
			}
			return;
		}
		frappe.call({
			method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_product_by_code",
			args: { code },
			callback(r) {
				if (r.message) {
					apply_product_selection(
						frm,
						r.message.item_code,
						r.message.item_name,
						r.message.short_code
					);
				} else {
					frappe.show_alert({
						message: __("Product with Code/ID '{0}' not found", [code]),
						indicator: "orange",
					});
				}
			},
		});
	},

	item_name(frm) {
		if (frm.doc.docstatus !== 0) return;
		if (!frm.doc.item_name && frm.doc.item) {
			apply_product_selection(frm, "", "", "");
		}
	},

	item(frm) {
		if (frm.doc.docstatus !== 0) return;
		const prefix = `${frm.doc.name}|`;
		const key = `${prefix}${frm.doc.item}`;
		if (frm._loaded_key === key) return;
		if (frm._loaded_key && frm._loaded_key.startsWith(prefix)) {
			frm.clear_table("items");
			frm.refresh_field("items");
			frm.doc.initial_color = "";
			frm._state = null;
		}
		init_matrix(frm);
	},

	before_save(frm) {
		if (frm.doc.docstatus === 0 && frm._state) sync_items(frm);
	},
});

function apply_product_selection(frm, item_code, item_name, short_code) {
	const current_item = frm.doc.item || "";
	const changed = current_item !== item_code;

	if (changed) {
		frm.clear_table("items");
		frm.refresh_field("items");
		frm.doc.initial_color = "";
		frm._state = null;
		frm._loaded_key = null;
	}

	frm.set_value("item", item_code || "");
	frm.set_value("item_name", item_name || "");
	frm.set_value("short_code", short_code || "");

	init_matrix(frm);
}

function setup_product_autocomplete(frm) {
	const field = frm.fields_dict.item_name;
	if (!field || !field.$input) return;
	if (field.$input.data("awesomplete_ready")) return;
	field.$input.data("awesomplete_ready", true);

	$(field.input_area).addClass("ui-front");
	const input = field.$input.get(0);
	const awe = new Awesomplete(input, {
		minChars: 1,
		maxItems: 25,
		autoFirst: true,
		list: [],
		data: (item) => ({
			label: item.label,
			value: item.item_name,
			item_code: item.item_code,
			short_code: item.short_code,
		}),
	});

	let timer = null;
	field.$input.on("input", function (e) {
		const val = (e.target.value || "").trim();
		clearTimeout(timer);
		if (!val) {
			if (frm.doc.item) {
				apply_product_selection(frm, "", "", "");
			}
			return;
		}
		timer = setTimeout(() => {
			frappe.call({
				method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.search_products",
				args: { query: val },
				callback(r) {
					if (r.message && r.message.length) {
						awe.list = r.message;
						awe.evaluate();
					}
				},
			});
		}, 150);
	});

	field.$input.on("awesomplete-selectcomplete", function (e) {
		const original = e.originalEvent || e;
		const selected = original.text;
		if (selected && selected.item_code) {
			apply_product_selection(frm, selected.item_code, selected.value, selected.short_code);
		}
	});

	field.$input.on("change", function (e) {
		const val = (e.target.value || "").trim();
		if (!val) {
			if (frm.doc.item) {
				apply_product_selection(frm, "", "", "");
			}
		} else if (!frm.doc.item || frm.doc.item_name !== val) {
			frappe.call({
				method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.search_products",
				args: { query: val, limit: 1 },
				callback(r) {
					if (r.message && r.message.length === 1) {
						const m = r.message[0];
						apply_product_selection(frm, m.item_code, m.item_name, m.short_code);
					}
				},
			});
		}
	});
}

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

// ---------------------------------------------------------------- state

function init_matrix(frm) {
	const $w = frm.fields_dict.restock_matrix && frm.fields_dict.restock_matrix.$wrapper;
	if (!$w) return;

	if (!frm.doc.item) {
		$w.html(`<p class="text-muted" style="padding: 12px 0;">${__("Select a Product to receive stock.")}</p>`);
		return;
	}

	const key = `${frm.doc.name}|${frm.doc.item}`;
	if (frm._loaded_key === key && frm._state) {
		render_matrix(frm);
		return;
	}
	frm._loaded_key = key;

	frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_product_template_info",
		args: { item: frm.doc.item },
		callback(r) {
			if (!r.message || frm._loaded_key !== key) return;
			build_state(frm, r.message);
			if (r.message.supplier && !frm.doc.supplier) {
				frm.set_value("supplier", r.message.supplier);
			}
			if (r.message.item_name && frm.doc.item_name !== r.message.item_name) {
				frm.set_value("item_name", r.message.item_name);
			}
			if (r.message.short_code && frm.doc.short_code !== r.message.short_code) {
				frm.set_value("short_code", r.message.short_code);
			}
			render_matrix(frm);
		},
	});
}

function build_state(frm, info) {
	const rows = (info.rows || []).map((r) => ({
		item_code: r.item_code,
		color: (r.color || "").trim(),
		size: (r.size || "").trim(),
		custom_short_code: r.custom_short_code || "",
		barcode: r.barcode || "",
		current_stock: flt(r.current_stock),
		qty: 0,
		buying_price: flt(r.buying_price),
		selling_price: flt(r.selling_price),
		orig_buying: flt(r.buying_price),
		orig_selling: flt(r.selling_price),
		is_new_variant: 0,
	}));

	const by_code = {};
	rows.forEach((r) => (by_code[r.item_code] = r));

	const selected = [];
	(frm.doc.items || []).forEach((d) => {
		const color = (d.color || "").trim();
		if (!selected.includes(color)) selected.push(color);
		const existing = d.item_code && by_code[d.item_code];
		if (existing) {
			existing.qty = flt(d.qty);
			existing.buying_price = flt(d.buying_price);
			existing.selling_price = flt(d.selling_price);
		} else {
			rows.push({
				item_code: d.item_code || "",
				color,
				size: (d.size || "").trim(),
				custom_short_code: d.custom_short_code || "",
				barcode: d.barcode || "",
				current_stock: flt(d.current_stock),
				qty: flt(d.qty),
				buying_price: flt(d.buying_price),
				selling_price: flt(d.selling_price),
				orig_buying: 0,
				orig_selling: 0,
				is_new_variant: d.item_code ? 0 : 1,
			});
		}
	});

	if (!info.color_attr) {
		// product without colors: a single group
		if (!selected.includes("")) selected.push("");
	} else if (!selected.length && frm.doc.initial_color) {
		selected.push(frm.doc.initial_color);
	}

	frm._state = { info, rows, selected };
}

function color_order(st) {
	const colors = [];
	st.rows.forEach((r) => {
		if (!colors.includes(r.color)) colors.push(r.color);
	});
	(st.info.available_colors || []).forEach((c) => {
		if (!colors.includes(c)) colors.push(c);
	});
	st.selected.forEach((c) => {
		if (!colors.includes(c)) colors.push(c);
	});
	return colors;
}

function sync_items(frm) {
	const st = frm._state;
	frm.clear_table("items");
	st.rows.forEach((r) => {
		if (!st.selected.includes(r.color)) return;
		const price_changed =
			r.item_code &&
			(flt(r.selling_price) !== flt(r.orig_selling) || flt(r.buying_price) !== flt(r.orig_buying));
		if (!(flt(r.qty) > 0 || price_changed)) return;

		const child = frm.add_child("items");
		Object.assign(child, {
			item_code: r.item_code || "",
			color: r.color,
			size: r.size,
			custom_short_code: r.custom_short_code,
			barcode: r.barcode,
			current_stock: r.current_stock,
			qty: flt(r.qty),
			buying_price: flt(r.buying_price),
			old_selling_price: flt(r.orig_selling),
			selling_price: flt(r.selling_price),
			is_new_variant: r.item_code ? 0 : 1,
		});
	});
}

// ---------------------------------------------------------------- rendering

function render_matrix(frm) {
	const st = frm._state;
	const $w = frm.fields_dict.restock_matrix.$wrapper;
	if (!st) return;

	const info = st.info;
	const esc = frappe.utils.escape_html;
	const has_colors = !!info.color_attr;
	const existing_colors = new Set(st.rows.filter((r) => r.item_code).map((r) => r.color));
	const all_colors = color_order(st);

	let html = "";

	if (has_colors) {
		const boxes = all_colors
			.map((c) => {
				const checked = st.selected.includes(c) ? "checked" : "";
				const is_new = !existing_colors.has(c);
				return `
				<div class="checkbox" style="display:inline-block; margin: 0 18px 6px 0;">
					<label>
						<input type="checkbox" class="qpr-color-cb" data-color="${esc(c)}" ${checked}>
						<span class="label-area">${esc(c)}</span>${
							is_new ? ` <span class="text-muted small">(${__("new for this product")})</span>` : ""
						}
					</label>
				</div>`;
			})
			.join("");

		html += `
			<div class="form-group">
				<label class="control-label">${__("Colors in this delivery")}</label>
				<div>${boxes}</div>
				<p class="help-box small text-muted">${__("Tick every color that arrived in the box.")}</p>
			</div>`;
	}

	if (!st.selected.length) {
		html += `<p class="text-muted">${__("No color selected yet. Tick a color above to see its sizes.")}</p>`;
	}

	all_colors
		.filter((c) => st.selected.includes(c))
		.forEach((c) => {
			const entries = st.rows.map((r, i) => ({ r, i })).filter((x) => x.r.color === c);
			const is_new_color = has_colors && !existing_colors.has(c);
			const heading = has_colors ? esc(c) : esc(frm.doc.item_name || frm.doc.item);

			const body = entries.length
				? entries
						.map(({ r, i }) => {
							const is_new_row = !r.item_code;
							return `
					<tr>
						<td><b>${esc(r.size || "-")}</b>${
							is_new_row ? ` <span class="indicator-pill green">${__("New")}</span>` : ""
						}</td>
						<td class="text-right">${is_new_row ? "-" : flt(r.current_stock)}</td>
						<td>${num_input(i, "qty", r.qty)}</td>
						<td>${num_input(i, "buying_price", r.buying_price)}</td>
						<td>${num_input(i, "selling_price", r.selling_price)}</td>
						<td class="text-center" style="width:32px;">${
							is_new_row
								? `<a class="qpr-del text-muted" data-idx="${i}" title="${__("Remove")}">&times;</a>`
								: ""
						}</td>
					</tr>`;
						})
						.join("")
				: `<tr><td colspan="6" class="text-muted">${
						info.size_attr
							? __("No sizes yet. Use the button to add sizes.")
							: __("Nothing to add.")
				  }</td></tr>`;

			html += `
			<div class="qpr-section" data-color="${esc(c)}" style="margin-bottom: 22px;">
				<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
					<h5 style="margin:0;">
						${has_colors ? `${__("Color")}: ` : ""}<b>${heading}</b>${
							is_new_color ? ` <span class="indicator-pill blue">${__("New color")}</span>` : ""
						}
					</h5>
					${
						info.size_attr
							? `<button type="button" class="btn btn-default btn-xs qpr-add-size" data-color="${esc(c)}">
								${__("Add size")}${has_colors ? ` (${esc(c)})` : ""}
							</button>`
							: ""
					}
				</div>
				<div class="table-responsive">
					<table class="table table-bordered" style="margin:0;">
						<thead>
							<tr>
								<th>${__("Size")}</th>
								<th class="text-right" style="width:110px;">${__("In Stock")}</th>
								<th style="width:140px;">${__("Received Qty (+)")}</th>
								<th style="width:150px;">${__("Cost (This Delivery)")}</th>
								<th style="width:150px;">${__("Retail Price")}</th>
								<th></th>
							</tr>
						</thead>
						<tbody>${body}</tbody>
					</table>
				</div>
			</div>`;
		});

	html += `<div class="qpr-total" style="font-weight:600;"></div>`;
	$w.html(html);
	update_total(frm);
	bind_matrix_events(frm);
}

function num_input(idx, field, value) {
	return `<input type="number" min="0" step="any" class="form-control input-sm qpr-in"
		data-idx="${idx}" data-field="${field}" value="${flt(value) || ""}">`;
}

function update_total(frm) {
	const st = frm._state;
	let total = 0;
	st.rows.forEach((r) => {
		if (st.selected.includes(r.color)) total += flt(r.qty);
	});
	frm.fields_dict.restock_matrix.$wrapper
		.find(".qpr-total")
		.text(total ? `${__("Total to receive")}: ${total}` : "");
}

// ---------------------------------------------------------------- events

function bind_matrix_events(frm) {
	const $w = frm.fields_dict.restock_matrix.$wrapper;
	const st = frm._state;
	$w.off(".qpr");

	$w.on("change.qpr", ".qpr-color-cb", function () {
		const color = $(this).attr("data-color");
		if (this.checked) {
			if (!st.selected.includes(color)) st.selected.push(color);
			// sizeless products: a new color needs exactly one row
			if (!st.info.size_attr && !st.rows.some((r) => r.color === color)) {
				const ref = price_reference(st, color);
				st.rows.push(new_row(color, "", ref));
			}
		} else {
			st.selected = st.selected.filter((c) => c !== color);
		}
		sync_items(frm);
		frm.dirty();
		render_matrix(frm);
	});

	$w.on("input.qpr change.qpr", ".qpr-in", function () {
		const row = st.rows[cint($(this).attr("data-idx"))];
		if (!row) return;
		row[$(this).attr("data-field")] = flt($(this).val());
		update_total(frm);
	});

	$w.on("change.qpr", ".qpr-in", () => {
		sync_items(frm);
		frm.dirty();
	});

	$w.on("click.qpr", ".qpr-add-size", function () {
		add_size_dialog(frm, $(this).attr("data-color"));
	});

	$w.on("click.qpr", ".qpr-del", function () {
		st.rows.splice(cint($(this).attr("data-idx")), 1);
		sync_items(frm);
		frm.dirty();
		render_matrix(frm);
	});
}

function price_reference(st, color) {
	const pick = (rows) => rows.find((r) => flt(r.selling_price) > 0) || {};
	const same_color = pick(st.rows.filter((r) => r.color === color));
	return flt(same_color.selling_price) > 0 ? same_color : pick(st.rows);
}

function new_row(color, size, ref) {
	return {
		item_code: "",
		color,
		size,
		custom_short_code: "",
		barcode: "",
		current_stock: 0,
		qty: 0,
		buying_price: flt(ref.buying_price),
		selling_price: flt(ref.selling_price),
		orig_buying: 0,
		orig_selling: 0,
		is_new_variant: 1,
	};
}

function add_size_dialog(frm, color) {
	const st = frm._state;
	const taken = st.rows.filter((r) => r.color === color).map((r) => (r.size || "").toLowerCase());
	const missing = (st.info.available_sizes || []).filter((s) => !taken.includes(s.toLowerCase()));

	if (!missing.length) {
		frappe.msgprint(__("All available sizes are already added for this color."));
		return;
	}

	const d = new frappe.ui.Dialog({
		title: color ? __("Add sizes to {0}", [color]) : __("Add sizes"),
		fields: [
			{
				fieldname: "sizes",
				fieldtype: "MultiCheck",
				label: __("Sizes"),
				columns: 3,
				options: missing.map((s) => ({ label: s, value: s, checked: 0 })),
			},
		],
		primary_action_label: __("Add"),
		primary_action() {
			const picked = d.get_value("sizes") || [];
			if (!picked.length) {
				frappe.msgprint(__("Please select at least one size."));
				return;
			}
			const ref = price_reference(st, color);
			picked.forEach((s) => st.rows.push(new_row(color, s, ref)));
			d.hide();
			frm.dirty();
			render_matrix(frm);
		},
	});
	d.show();
}
