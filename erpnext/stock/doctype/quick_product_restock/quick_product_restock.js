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
			filters: { company: frm.doc.company, is_group: 0, disabled: 0 },
		}));
		frm.set_query("payment_account", () => ({
			filters: {
				company: frm.doc.company,
				is_group: 0,
				disabled: 0,
				account_type: ["in", ["Cash", "Bank"]],
				account_currency: frm.doc.currency,
			},
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
			frm._state = null;
			frm._loaded_key = null;
			frm._loading = false;
		}
		qpr_style(frm);
		qpr_summary(frm);
		if (frm.doc.docstatus > 0 && !frm.doc.currency && frm.doc.company) {
			const name = frm.doc.name;
			frappe.db.get_value("Company", frm.doc.company, "default_currency").then(({ message }) => {
				if (frm.doc.name !== name) return;
				frm._restock_currency = message.default_currency;
				qpr_summary(frm);
			});
		}
		if (frm.doc.docstatus === 0) {
			qpr_defaults(frm, false);
			setup_product_autocomplete(frm);
			if (frm.is_new() && frm.doc.company && !frm.doc.target_warehouse) {
				set_default_warehouse(frm);
			}
			init_matrix(frm);
		} else {
			if (frm.doc.item) {
				frm.add_custom_button(
					__("Product"),
					() => {
						frappe.route_options = {
							catalog_company: frm.doc.company,
							catalog_warehouse: frm.doc.target_warehouse || "",
						};
						frappe.set_route("product-detail", frm.doc.item);
					},
					__("View")
				);
			}
			if (frm.doc.payment_entry)
				frm.add_custom_button(
					__("Payment Entry"),
					() => frappe.set_route("Form", "Payment Entry", frm.doc.payment_entry),
					__("View")
				);
			frm.add_custom_button(
				__("Supplier Detail"),
				() => {
					frappe.route_options = { supplier_company: frm.doc.company };
					frappe.set_route("supplier-detail", frm.doc.supplier);
				},
				__("View")
			);
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
		if (frm.doc.docstatus !== 0) return;
		frm.set_value("payment_account", "");
		frm.set_value("target_warehouse", "");
		set_default_warehouse(frm);
		qpr_defaults(frm, true);
		init_matrix(frm);
	},
	target_warehouse: init_matrix,
	supplier: (frm) => qpr_defaults(frm, true),
	posting_date: (frm) => qpr_defaults(frm, false),
	bill_date: (frm) => qpr_defaults(frm, false),
	due_date: qpr_summary,
	payment_amount: qpr_summary,
	price_only: qpr_summary,
	currency: qpr_summary,

	short_code(frm) {
		if (frm.doc.docstatus !== 0 || frm._applying_product) return;
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
				if (frm.doc.short_code !== code || frm.doc.docstatus !== 0) return;
				if (r.message) {
					apply_product_selection(
						frm,
						r.message.item_code,
						r.message.item_name,
						r.message.short_code
					);
				} else {
					qpr_clear_selection(frm);
					frappe.show_alert({
						message: __("Product with Code/ID '{0}' not found", [code]),
						indicator: "orange",
					});
				}
			},
		});
	},

	item_name(frm) {
		if (frm.doc.docstatus !== 0 || frm._applying_product) return;
		if (frm.doc.item && frm.doc.item_name !== frm._selected_name) {
			qpr_clear_selection(frm);
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
		if (frm.doc.docstatus !== 0) return;
		if (
			!frm.doc.item ||
			frm.doc.item_name !== frm._selected_name ||
			frm.doc.short_code !== frm._selected_code
		) {
			frappe.throw(__("Choose a product from the search results or scan its code"));
		}
		if (!frm._state || frm._loading) frappe.throw(__("Wait for the product to finish loading"));
		sync_items(frm);
	},
});

async function apply_product_selection(frm, item_code, item_name, short_code) {
	const current_item = frm.doc.item || "";
	const changed = current_item !== item_code;

	if (changed) {
		if (frm.doc.supplier === frm._suggested_supplier) await frm.set_value("supplier", "");
		frm.clear_table("items");
		frm.refresh_field("items");
		frm.doc.initial_color = "";
		frm._state = null;
		frm._loaded_key = null;
	}
	frm._applying_product = true;
	frm._selected_name = item_name || "";
	frm._selected_code = short_code || "";
	try {
		await frm.set_value({
			item: item_code || "",
			item_name: item_name || "",
			short_code: short_code || "",
		});
	} finally {
		frm._applying_product = false;
	}
	init_matrix(frm);
}

function qpr_clear_selection(frm) {
	frm._state = null;
	frm._loaded_key = null;
	frm.clear_table("items");
	frm.set_value("item", "");
	init_matrix(frm);
	qpr_summary(frm);
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
		data: (item) => ({ label: item.label, value: item.item_code }),
		item(text) {
			const li = document.createElement("li");
			li.textContent = text.label;
			return li;
		},
	});
	let results = [];
	let request = 0;

	let timer = null;
	field.$input.on("input", function (e) {
		const val = (e.target.value || "").trim();
		const current = ++request;
		clearTimeout(timer);
		if (frm.doc.item && val !== frm._selected_name) qpr_clear_selection(frm);
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
					if (current !== request || field.$input.val().trim() !== val) return;
					results = r.message || [];
					awe.list = results;
					awe.evaluate();
				},
			});
		}, 150);
	});

	field.$input.on("awesomplete-selectcomplete", function (e) {
		const original = e.originalEvent || e;
		const selected = original.text;
		const match = results.find((r) => r.item_code === selected?.value);
		if (match) {
			++request;
			apply_product_selection(frm, match.item_code, match.item_name, match.short_code);
		}
	});
}

function set_default_warehouse(frm) {
	if (!frm.doc.company || frm.doc.docstatus !== 0 || frm.doc.target_warehouse) return;
	const company = frm.doc.company;
	frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_default_warehouse",
		args: { company: frm.doc.company },
		callback(r) {
			if (frm.doc.company !== company || frm.doc.target_warehouse || frm.doc.docstatus !== 0) return;
			if (r.message && frm.doc.target_warehouse !== r.message) {
				frm.set_value("target_warehouse", r.message);
			}
		},
	});
}

// ---------------------------------------------------------------- state

function init_matrix(frm) {
	if (frm.doc.docstatus !== 0) return;
	const $w = frm.fields_dict.restock_matrix && frm.fields_dict.restock_matrix.$wrapper;
	if (!$w) return;

	if (!frm.doc.item) {
		$w.html(
			`<p class="text-muted" style="padding: 12px 0;">${__("Select a Product to receive stock.")}</p>`
		);
		return;
	}

	if (!frm.doc.company) return;
	const key = `${frm.doc.name}|${frm.doc.item}|${frm.doc.company}|${frm.doc.target_warehouse || ""}`;
	if (frm._loaded_key === key && frm._loading) return;
	if (frm._loaded_key === key && frm._state) {
		render_matrix(frm);
		return;
	}
	if (frm._state) sync_items(frm);
	frm._loaded_key = key;
	const request = (frm._matrix_request || 0) + 1;
	frm._matrix_request = request;
	frm._loading = true;
	$w.html(`<p class="text-muted" role="status">${__("Loading product…")}</p>`);

	frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_product_template_info",
		args: { item: frm.doc.item, company: frm.doc.company, warehouse: frm.doc.target_warehouse },
		callback(r) {
			if (!r.message || frm._loaded_key !== key || frm._matrix_request !== request) return;
			frm._loading = false;
			frm._selected_name = r.message.item_name;
			frm._selected_code = r.message.short_code;
			build_state(frm, r.message);
			frm._suggested_supplier = r.message.supplier;
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
		error() {
			if (frm._loaded_key !== key || frm._matrix_request !== request) return;
			frm._loading = true;
			$w.html(
				`<p class="text-muted">${__(
					"Could not load product. Check access and try again."
				)}</p><button type="button" class="btn btn-default btn-sm qpr-retry">${__("Retry")}</button>`
			);
			$w.find(".qpr-retry").on("click", () => {
				frm._loaded_key = null;
				init_matrix(frm);
			});
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
		stock_uom: r.stock_uom,
		qty: 0,
		buying_price: flt(r.buying_price),
		selling_price: flt(r.selling_price),
		orig_buying: flt(r.buying_price),
		orig_selling: flt(r.selling_price),
		is_new_variant: 0,
	}));

	const by_code = {};
	rows.forEach((r) => (by_code[r.item_code] = r));

	const selected = frm._state?.info.item_code === info.item_code ? [...frm._state.selected] : [];
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
				stock_uom: d.stock_uom || info.stock_uom,
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
		// Keep invalid negative entries so validation cannot silently drop them.
		if (!(flt(r.qty) !== 0 || price_changed || !r.item_code)) return;

		const child = frm.add_child("items");
		Object.assign(child, {
			item_code: r.item_code || "",
			color: r.color,
			size: r.size,
			custom_short_code: r.custom_short_code,
			barcode: r.barcode,
			current_stock: r.current_stock,
			stock_uom: r.stock_uom || st.info.stock_uom,
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
		const visible_colors = all_colors.filter((c) => existing_colors.has(c) || st.selected.includes(c));
		const boxes = visible_colors
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
				<button type="button" class="btn btn-default btn-xs qpr-add-color">${__("Add color")}</button>
			</div>`;
	}
	html += `<p class="text-muted small">${esc(
		frm.doc.target_warehouse || __("Select a receiving warehouse to see current stock")
	)} · ${esc(info.currency || "")} · ${__("Prices and quantities are per stock unit")}</p>
		<div class="qpr-tools"><button type="button" class="btn btn-default btn-xs qpr-bulk" data-field="buying_price">${__(
			"Apply delivery cost"
		)}</button>
		<button type="button" class="btn btn-default btn-xs qpr-bulk" data-field="selling_price">${__(
			"Apply retail price"
		)}</button></div>`;

	if (!st.selected.length) {
		html += `<p class="text-muted">${__(
			"No color selected yet. Tick a color above to see its sizes."
		)}</p>`;
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
						<td class="text-right">${esc(r.stock_uom || info.stock_uom || "")}</td>
						<td class="text-right">${
							!frm.doc.target_warehouse
								? "—"
								: frappe.format(flt(r.current_stock), { fieldtype: "Float" })
						}</td>
						<td>${num_input(i, "qty", r.qty, r)}</td>
						<td class="text-right qpr-after" data-idx="${i}">${
								!frm.doc.target_warehouse
									? "—"
									: frappe.format(flt(r.current_stock) + flt(r.qty), { fieldtype: "Float" })
							}</td>
						<td>${num_input(i, "buying_price", r.buying_price, r)}</td>
						<td>${num_input(i, "selling_price", r.selling_price, r)}<small class="text-muted">${__("Previous price")}: ${
								r.orig_selling
									? format_currency(r.orig_selling, info.currency)
									: __("Not set")
							}</small><small class="qpr-price-change text-warning" data-idx="${i}" ${
								flt(r.selling_price) === flt(r.orig_selling) ? "hidden" : ""
							}>${__("Price changed")}</small></td>
						<td class="text-center" style="width:32px;">${
							is_new_row
								? `<button type="button" class="btn btn-default btn-xs qpr-del" data-idx="${i}" aria-label="${esc(
										__("Remove") + " " + c + " " + r.size
								  )}">&times;</button>`
								: ""
						}</td>
					</tr>`;
						})
						.join("")
				: `<tr><td colspan="8" class="text-muted">${
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
							? `<button type="button" class="btn btn-default btn-xs qpr-add-size" data-color="${esc(
									c
							  )}">
								${__("Add size")}${has_colors ? ` (${esc(c)})` : ""}
							</button>`
							: ""
					}
				</div>
				<div class="table-responsive">
					<table class="table" style="margin:0;">
						<thead>
							<tr>
								<th>${__("Size")}</th>
								<th>${__("Stock unit")}</th>
								<th class="text-right">${__("Stock in receiving warehouse")}</th>
								<th style="width:140px;">${__("Received Qty (+)")}</th>
								<th class="text-right">${__("After receipt")}</th>
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

	$w.html(html);
	update_total(frm);
	bind_matrix_events(frm);
}

function num_input(idx, field, value, row) {
	const label = {
		qty: __("Received Qty (+)"),
		buying_price: __("Cost (This Delivery)"),
		selling_price: __("Retail Price"),
	}[field];
	return `<input type="number" min="0" step="any" class="form-control input-sm qpr-in"
		aria-label="${frappe.utils.escape_html([row.color, row.size, label].filter(Boolean).join(" · "))}"
		data-idx="${idx}" data-field="${field}" value="${flt(value) || ""}">`;
}

function update_total(frm) {
	qpr_summary(frm);
}

// ---------------------------------------------------------------- events

function bind_matrix_events(frm) {
	const $w = frm.fields_dict.restock_matrix.$wrapper;
	const st = frm._state;
	$w.off(".qpr");
	$w.on("click.qpr", ".qpr-add-color", () => {
		const missing = (st.info.available_colors || []).filter((c) => !st.selected.includes(c));
		if (!missing.length) {
			frappe.msgprint(__("All available colors are already selected"));
			return;
		}
		frappe.prompt(
			{ fieldname: "color", fieldtype: "Select", options: missing, label: __("Color"), reqd: 1 },
			({ color }) => {
				if (!st.selected.includes(color)) st.selected.push(color);
				if (!st.info.size_attr && !st.rows.some((r) => r.color === color))
					st.rows.push(new_row(color, "", price_reference(st, color)));
				frm.dirty();
				render_matrix(frm);
			},
			__("Add color")
		);
	});
	$w.on("click.qpr", ".qpr-bulk", function () {
		qpr_bulk_prices(frm, $(this).attr("data-field"));
	});

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
		const field = $(this).attr("data-field");
		row[field] = flt($(this).val());
		if (field !== "qty") {
			row.overrides ||= {};
			row.overrides[field] = true;
		}
		$w.find(`.qpr-after[data-idx="${$(this).attr("data-idx")}"]`).html(
			!frm.doc.target_warehouse
				? "—"
				: frappe.format(flt(row.current_stock) + flt(row.qty), { fieldtype: "Float" })
		);
		$w.find(`.qpr-price-change[data-idx="${$(this).attr("data-idx")}"]`).prop(
			"hidden",
			flt(row.selling_price) === flt(row.orig_selling)
		);
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

function qpr_bulk_prices(frm, field) {
	const st = frm._state;
	const candidates = st.rows.filter(
		(r) => st.selected.includes(r.color) && (frm.doc.price_only || flt(r.qty) > 0)
	);
	if (!candidates.length) {
		frappe.msgprint(__("Enter received quantities first, or enable Price update only"));
		return;
	}
	frappe.prompt(
		[
			{
				fieldname: "rate",
				fieldtype: "Currency",
				label: field === "buying_price" ? __("Cost (This Delivery)") : __("Retail Price"),
				reqd: 1,
			},
			{
				fieldname: "overwrite",
				fieldtype: "Check",
				label: __("Replace individual price overrides"),
				default: 0,
			},
		],
		({ rate, overwrite }) => {
			if (!(flt(rate) > 0)) frappe.throw(__("Price must be greater than 0"));
			for (const row of candidates) {
				const original = field === "buying_price" ? row.orig_buying : row.orig_selling;
				if (
					!overwrite &&
					(row.overrides?.[field] ||
						(row.item_code &&
							flt(row[field]) !== flt(original) &&
							flt(row[field]) !== row.bulk_rates?.[field]))
				)
					continue;
				row[field] = flt(rate);
				row.bulk_rates ||= {};
				row.bulk_rates[field] = flt(rate);
			}
			sync_items(frm);
			frm.dirty();
			render_matrix(frm);
		},
		field === "buying_price" ? __("Apply delivery cost") : __("Apply retail price")
	);
}

async function qpr_defaults(frm, changed_supplier) {
	if (!frm.doc.company || frm.doc.docstatus !== 0) return;
	const request = (frm._defaults_request || 0) + 1;
	frm._defaults_request = request;
	const previous = frm.doc.due_date;
	const { message } = await frappe.call({
		method: "erpnext.stock.doctype.quick_product_restock.quick_product_restock.get_restock_defaults",
		args: {
			company: frm.doc.company,
			supplier: frm.doc.supplier,
			posting_date: frm.doc.posting_date,
			bill_date: frm.doc.bill_date,
		},
	});
	if (request !== frm._defaults_request || frm.doc.docstatus !== 0) return;
	await frm.set_value("currency", message.currency);
	if (
		frm.doc.due_date === previous &&
		(changed_supplier || (previous && previous === frm._suggested_deadline))
	) {
		frm._suggested_deadline = message.due_date || null;
		await frm.set_value("due_date", frm._suggested_deadline);
	}
	qpr_summary(frm);
}

function qpr_summary(frm) {
	if (!frm.fields_dict.restock_summary) return;
	const rows =
		frm.doc.docstatus === 0 && frm._state
			? frm._state.rows.filter((r) => frm._state.selected.includes(r.color))
			: frm.doc.items || [];
	// Historical submitted restocks predate the stored summary fields.
	const quantity = rows.reduce((s, r) => s + flt(r.qty), 0);
	const digits = frappe.meta.get_field_precision(frm.fields_dict.purchase_total.df, frm.doc);
	const total = rows.reduce((s, r) => s + flt(flt(r.qty) * flt(r.buying_price), digits), 0);
	const payment = flt(frm.doc.payment_amount);
	const currency = frm.doc.currency || frm._restock_currency;
	const esc = frappe.utils.escape_html;
	let html = `<div class="qpr-summary">`;
	for (const [label, value] of [
		[__("Incoming Qty"), frappe.format(quantity, { fieldtype: "Float" })],
		[__("Purchase Total"), format_currency(total, currency)],
		[__("Payment to Record"), format_currency(payment, currency)],
		[__("Remaining Supplier Debt"), format_currency(total - payment, currency)],
	]) {
		html += `<div><div class="text-muted small">${esc(
			label
		)}</div><div class="qpr-figure">${value}</div></div>`;
	}
	html += `</div><p class="text-muted small">${esc(
		frm.doc.price_only
			? __("Price update only: no goods received, no invoice, and no supplier debt.")
			: frm.doc.due_date
			? __("Pay by {0}", [frappe.datetime.str_to_user(frm.doc.due_date)])
			: __("Payment deadline not specified")
	)}</p>`;
	html += `<p class="text-muted small">${__(
		"Price changes apply to future sales. Cancelling this restock does not restore previous prices."
	)}</p>`;
	if (frm.doc.docstatus > 0 && frm.doc.purchase_invoice)
		html += `<p class="text-muted small">${__(
			"Amounts recorded by this restock. Open the invoice for the current balance."
		)}</p>`;
	if (
		payment < 0 ||
		payment > total ||
		rows.some((r) => flt(r.qty) < 0) ||
		(!!quantity && frm.doc.price_only)
	)
		html += `<p class="text-danger small" role="alert">${__(
			"Check quantities and payment amount before submitting"
		)}</p>`;
	frm.fields_dict.restock_summary.$wrapper.html(html);
}

function qpr_style(frm) {
	frm.$wrapper.addClass("quick-product-restock");
	if (document.getElementById("qpr-style")) return;
	$("<style id='qpr-style'>")
		.text(
			`
		.quick-product-restock .qpr-tools {display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
		.quick-product-restock .qpr-summary {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:16px}
		.quick-product-restock .qpr-figure {font-size:18px;margin-top:6px;overflow-wrap:anywhere}
		.quick-product-restock .qpr-section {max-width:100%;min-width:0}
		.quick-product-restock .qpr-section > div:first-child {flex-wrap:wrap;gap:8px}
		.quick-product-restock .qpr-section h5 {overflow-wrap:anywhere;min-width:0}
		.quick-product-restock .qpr-add-size {white-space:normal;max-width:100%}
		.quick-product-restock .qpr-section table {min-width:860px}
		.quick-product-restock .qpr-section th {font-weight:500;white-space:normal}
		.quick-product-restock .qpr-section td {vertical-align:top}
		.quick-product-restock .qpr-section input {min-width:90px;text-align:right}
		.quick-product-restock .qpr-section small {display:block;margin-top:4px}
		.quick-product-restock .table-responsive {max-width:100%;overflow-x:auto}
		.quick-product-restock .timeline-head {flex-wrap:wrap;gap:8px}
		.quick-product-restock .timeline-actions {min-width:0;max-width:100%}
		.quick-product-restock .timeline-actions .action-buttons {display:flex;flex-wrap:wrap;gap:6px}
		.quick-product-restock .timeline-actions .action-btn {white-space:normal;max-width:100%}
		@media(max-width:767px) {.quick-product-restock .qpr-summary {grid-template-columns:repeat(2,minmax(0,1fr))}}
	`
		)
		.appendTo(document.head);
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
