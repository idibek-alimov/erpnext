// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quick Discount", {
	setup(frm) {
		frm.set_query("item_group", () => ({
			filters: { is_group: 0 }
		}));
	},

	refresh(frm) {
		render_scanner_panel(frm);
		render_items_table(frm);

		if (frm.doc.discount_scope === "По категории (Category)") {
			render_category_filters(frm);
			load_category_preview(frm);
		}

		if (!frm.is_new()) {
			if (frm.doc.pricing_rule) {
				frm.add_custom_button(
					__("Pricing Rule"),
					() => frappe.set_route("Form", "Pricing Rule", frm.doc.pricing_rule),
					__("Связи")
				);
			}

			// 1-Click quick toggle button
			if (frm.doc.enabled) {
				frm.add_custom_button(__("Поставить на паузу ⏸️"), () => {
					frm.set_value("enabled", 0);
					frm.save();
				});
			} else {
				frm.add_custom_button(__("Активировать ▶️"), () => {
					frm.set_value("enabled", 1);
					frm.save();
				});
			}
		}
	},

	discount_scope(frm) {
		const scope = frm.doc.discount_scope;
		if (scope === "По категории (Category)") {
			if (frm.doc.priority_tier && frm.doc.priority_tier.includes("Tier 2")) {
				frm.set_value("priority_tier", "Tier 3 - Распродажа категории (10)");
			}
			render_category_filters(frm);
			load_category_preview(frm);
		} else {
			if (frm.doc.priority_tier && frm.doc.priority_tier.includes("Tier 3")) {
				frm.set_value("priority_tier", "Tier 2 - Акция на товар (15)");
			}
			render_items_table(frm);
		}
	},

	discount_percentage(frm) {
		recalc_items_table(frm);
		render_items_table(frm);

		if (frm.doc.discount_scope === "По категории (Category)") {
			load_category_preview(frm);
		}

		if (frm._current_matrix) {
			render_candidate_matrix(frm, frm._current_matrix);
		}
	},

	item_group(frm) {
		if (frm.doc.discount_scope === "По категории (Category)") {
			frm.set_value("filter_color", "");
			frm.set_value("filter_size", "");
			frm.set_value("excluded_items", "");
			render_category_filters(frm);
			load_category_preview(frm);
		}
	},

	scan_barcode(frm) {
		const val = (frm.doc.scan_barcode || "").trim();
		if (!val) {
			clear_candidate(frm);
			return;
		}
		perform_lookup(frm, val);
	}
});

function recalc_items_table(frm) {
	const pct = flt(frm.doc.discount_percentage);
	(frm.doc.items || []).forEach(row => {
		const base = flt(row.base_price);
		if (pct > 0) {
			row.discounted_price = flt(base * (1.0 - (pct / 100.0)), 2);
		} else {
			row.discounted_price = base;
		}
	});
	frm.refresh_field("items");
}

// =====================================================================
// 1. SCANNER & STREAMLINED VARIANT PICKER
// =====================================================================

function render_scanner_panel(frm) {
	const field = frm.get_field("scan_html");
	if (!field || !field.$wrapper) return;
	const wrapper = field.$wrapper;
	wrapper.empty();

	const container = $(`
		<div id="qd-scanner-container" style="background: var(--fg-color); border: 1px solid var(--border-color); border-radius: 8px; padding: 14px; margin-top: 6px; margin-bottom: 12px;">
			<div id="qd-candidate-area" style="display: none;"></div>
			<div id="qd-scanner-help" style="color: var(--text-muted); font-size: 13px;">
				<i class="fa fa-barcode"></i> Сканируйте штрихкод сканером или начните вводить название товара / 4-значный Short Code в поле выше.
			</div>
		</div>
	`);
	wrapper.append(container);

	setup_autocomplete(frm);
}

function setup_autocomplete(frm) {
	const inputField = frm.page.wrapper.find('input[data-fieldname="scan_barcode"]');
	if (!inputField.length) return;
	if (inputField.data("awesomplete_ready")) return;
	inputField.data("awesomplete_ready", true);

	const input = inputField.get(0);
	const awe = new Awesomplete(input, {
		minChars: 1,
		maxItems: 20,
		autoFirst: true,
		list: [],
		data: (item) => ({
			label: item.label,
			value: item.item_code,
			item_name: item.item_name,
			short_code: item.short_code
		})
	});

	let timer = null;
	inputField.on("input", function (e) {
		const val = (e.target.value || "").trim();
		clearTimeout(timer);
		if (!val) {
			clear_candidate(frm);
			return;
		}
		timer = setTimeout(() => {
			frappe.call({
				method: "erpnext.stock.doctype.quick_discount.quick_discount.search_products_for_discount",
				args: { query: val },
				callback(r) {
					if (r.message && r.message.length) {
						awe.list = r.message;
						awe.evaluate();
					}
				}
			});
		}, 150);
	});

	inputField.on("awesomplete-selectcomplete", function (e) {
		const original = e.originalEvent || e;
		const selected = original.text;
		if (selected && selected.value) {
			inputField.val(selected.item_name || selected.value);
			perform_lookup(frm, selected.value);
		}
	});

	inputField.off("keydown").on("keydown", function (e) {
		if (e.which === 13) {
			e.preventDefault();
			const val = $(this).val().trim();
			if (val) {
				perform_lookup(frm, val);
			}
		}
	});
}

function clear_candidate(frm) {
	frm._current_matrix = null;
	const area = $("#qd-candidate-area");
	area.hide().empty();
	$("#qd-scanner-help").show();
}

function perform_lookup(frm, query) {
	frappe.call({
		method: "erpnext.stock.doctype.quick_discount.quick_discount.get_product_variant_matrix",
		args: {
			query: query,
			current_tier: frm.doc.priority_tier
		},
		freeze: false,
		callback(r) {
			if (!r.message) {
				frappe.show_alert({
					message: __("Товар по запросу '{0}' не найден", [query]),
					indicator: "orange"
				});
				clear_candidate(frm);
				return;
			}
			render_candidate_matrix(frm, r.message);
		}
	});
}

function render_candidate_matrix(frm, data) {
	frm._current_matrix = data;
	$("#qd-scanner-help").hide();
	const area = $("#qd-candidate-area");
	area.empty().show();

	const esc = frappe.utils.escape_html;
	const pct = flt(frm.doc.discount_percentage);
	const existingCodes = new Set((frm.doc.items || []).map(r => r.item_code));

	let colorsHtml = "";
	let totalVariantsCount = 0;

	if (data.has_variants) {
		(data.colors || []).forEach(c => {
			let sizesHtml = "";

			(c.sizes || []).forEach(s => {
				totalVariantsCount++;
				const isAlreadyInDoc = existingCodes.has(s.item_code);
				const isConflict = Boolean(s.conflict && s.conflict.is_same_tier);
				const isScanned = Boolean(s.is_scanned);

				const salePrice = pct > 0 ? flt(s.base_price * (1.0 - (pct / 100.0)), 2) : s.base_price;
				const isChecked = isScanned || (!isConflict && !isAlreadyInDoc);

				let statusText = "";
				if (isAlreadyInDoc) {
					statusText = `<span class="badge" style="background: #10b981; color: white; font-size: 10px; margin-left: 4px;">В акции</span>`;
				} else if (isConflict) {
					statusText = `
						<span style="color: #dc2626; font-size: 11px; margin-left: 4px;">
							(⚠️ ${esc(s.conflict.campaign_title)})
							<a href="javascript:void(0)" class="qd-steal-link" data-campaign="${esc(s.conflict.campaign_name)}" data-item="${esc(s.item_code)}" style="color: #dc2626; text-decoration: underline;">Забрать 🔄</a>
						</span>
					`;
				}

				sizesHtml += `
					<label class="checkbox-inline" style="margin: 3px 12px 3px 0; font-size: 13px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
						<input type="checkbox" class="qd-size-cb" data-item="${esc(s.item_code)}" data-color="${esc(c.color)}" data-size="${esc(s.size)}" data-price="${s.base_price}" data-barcode="${esc(s.barcode)}" data-short="${esc(s.custom_short_code)}" ${isChecked && !isAlreadyInDoc ? 'checked' : ''} ${isAlreadyInDoc ? 'disabled' : ''}>
						<strong>${esc(s.size || "-")}</strong>
						<span class="text-muted" style="font-size: 11px;">(${s.stock || 0} шт · ${salePrice} TJS)</span>
						${statusText}
					</label>
				`;
			});

			colorsHtml += `
				<div style="padding: 8px 0; border-bottom: 1px dashed var(--border-color);">
					<div style="font-weight: 600; font-size: 13px; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
						<span>🎨 Цвет: <strong>${esc(c.color || "Основной")}</strong></span>
						<a href="javascript:void(0)" class="qd-toggle-color-btn text-muted small" data-color="${esc(c.color)}">[Выбрать весь цвет]</a>
					</div>
					<div style="display: flex; flex-wrap: wrap; align-items: center;">
						${sizesHtml}
					</div>
				</div>
			`;
		});
	} else {
		// Standalone product
		const singleItem = data.colors[0].sizes[0];
		totalVariantsCount = 1;
		const isAlreadyInDoc = existingCodes.has(singleItem.item_code);
		const isConflict = Boolean(singleItem.conflict && singleItem.conflict.is_same_tier);
		const salePrice = pct > 0 ? flt(singleItem.base_price * (1.0 - (pct / 100.0)), 2) : singleItem.base_price;

		colorsHtml = `
			<div style="padding: 8px 0; display: flex; justify-content: space-between; align-items: center;">
				<div>
					<span>Остаток: <strong>${singleItem.stock || 0} шт</strong> · Базовая цена: <del class="text-muted">${singleItem.base_price} TJS</del> <strong style="color: #2563eb;">➔ ${salePrice} TJS</strong></span>
					${isConflict ? `
						<span style="color: #dc2626; font-size: 12px; margin-left: 8px;">
							⚠️ В акции: «${esc(singleItem.conflict.campaign_title)}»
							<a href="javascript:void(0)" class="qd-steal-link" data-campaign="${esc(singleItem.conflict.campaign_name)}" data-item="${esc(singleItem.item_code)}" style="color: #dc2626; text-decoration: underline;">Забрать 🔄</a>
						</span>
					` : ''}
				</div>
				<div>
					<input type="checkbox" class="qd-size-cb" data-item="${esc(singleItem.item_code)}" data-color="${esc(singleItem.color)}" data-size="${esc(singleItem.size)}" data-price="${singleItem.base_price}" data-barcode="${esc(singleItem.barcode)}" data-short="${esc(singleItem.custom_short_code)}" checked style="display: none;">
				</div>
			</div>
		`;
	}

	const headerHtml = `
		<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; margin-bottom: 8px;">
			<div>
				<strong style="font-size: 15px; color: var(--text-color);">📦 ${esc(data.item_name)}</strong>
				${data.custom_short_code ? `<span class="badge" style="background: #e2e8f0; color: #334155; margin-left: 6px;">Short Code: ${esc(data.custom_short_code)}</span>` : ''}
			</div>
			${data.has_variants ? `
				<div style="display: flex; gap: 8px;">
					<a href="javascript:void(0)" id="qd-select-all-btn" class="text-muted small">[✓ Выбрать все]</a>
					<a href="javascript:void(0)" id="qd-unselect-all-btn" class="text-muted small">[✕ Снять выбор]</a>
				</div>
			` : ''}
		</div>
	`;

	const footerHtml = `
		<div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-color);">
			<div id="qd-selection-summary" style="font-size: 12px; color: var(--text-muted);">
				Подсчет...
			</div>
			<div style="display: flex; gap: 8px;">
				<button type="button" class="btn btn-default btn-xs" id="qd-cancel-candidate-btn">
					Отмена
				</button>
				<button type="button" class="btn btn-primary btn-xs" id="qd-add-selected-btn" style="font-weight: 700;">
					<i class="fa fa-plus"></i> Добавить в акцию
				</button>
			</div>
		</div>
	`;

	area.html(`
		${headerHtml}
		<div>
			${colorsHtml}
		</div>
		${footerHtml}
	`);

	function update_summary() {
		const checkedCount = area.find(".qd-size-cb:checked:not(:disabled)").length;
		area.find("#qd-selection-summary").html(`Выбрано: <strong>${checkedCount}</strong> из ${totalVariantsCount}`);
		area.find("#qd-add-selected-btn").prop("disabled", checkedCount === 0);
	}
	update_summary();

	area.find(".qd-size-cb").on("change", update_summary);

	area.find("#qd-select-all-btn").on("click", function() {
		area.find(".qd-size-cb:not(:disabled)").prop("checked", true);
		update_summary();
	});
	area.find("#qd-unselect-all-btn").on("click", function() {
		area.find(".qd-size-cb:not(:disabled)").prop("checked", false);
		update_summary();
	});

	area.find(".qd-toggle-color-btn").on("click", function() {
		const block = $(this).closest("div").parent();
		const cbs = block.find(".qd-size-cb:not(:disabled)");
		const allChecked = cbs.toArray().every(cb => cb.checked);
		cbs.prop("checked", !allChecked);
		update_summary();
	});

	area.find("#qd-cancel-candidate-btn").on("click", function() {
		frm.set_value("scan_barcode", "");
		clear_candidate(frm);
	});

	area.find(".qd-steal-link").on("click", function() {
		const $link = $(this);
		const oldCampaign = $link.attr("data-campaign");
		const itemCode = $link.attr("data-item");

		$link.text("Перенос...");
		frappe.call({
			method: "erpnext.stock.doctype.quick_discount.quick_discount.transfer_item_from_campaign",
			args: { old_campaign: oldCampaign, item_code: itemCode },
			freeze: true,
			freeze_message: __("Перенос товара..."),
			callback(r) {
				if (r.message && r.message.success) {
					frappe.show_alert({
						message: __("Товар перенесён!"),
						indicator: "green"
					});
					perform_lookup(frm, data.template_code);
				}
			}
		});
	});

	area.find("#qd-add-selected-btn").on("click", function() {
		const checkedInputs = area.find(".qd-size-cb:checked:not(:disabled)");
		if (!checkedInputs.length) return;

		let addedCount = 0;
		checkedInputs.each(function() {
			const $cb = $(this);
			const itemCode = $cb.attr("data-item");
			const color = $cb.attr("data-color");
			const size = $cb.attr("data-size");
			const basePrice = flt($cb.attr("data-price"));
			const barcode = $cb.attr("data-barcode");
			const shortCode = $cb.attr("data-short");

			const pct = flt(frm.doc.discount_percentage);
			const discountedPrice = pct > 0 ? flt(basePrice * (1.0 - (pct / 100.0)), 2) : basePrice;

			const already = (frm.doc.items || []).find(r => r.item_code === itemCode);
			if (!already) {
				frm.add_child("items", {
					item_code: itemCode,
					item_name: data.item_name,
					scope_type: "Specific SKU",
					color: color,
					size: size,
					base_price: basePrice,
					discounted_price: discountedPrice,
					barcode: barcode,
					custom_short_code: shortCode
				});
				addedCount++;
			}
		});

		frm.refresh_field("items");
		render_items_table(frm);

		frappe.show_alert({
			message: __("Добавлено {0} товаров в акцию", [addedCount]),
			indicator: "green"
		});

		frm.set_value("scan_barcode", "");
		clear_candidate(frm);

		setTimeout(() => {
			frm.page.wrapper.find('input[data-fieldname="scan_barcode"]').focus();
		}, 100);
	});
}

// =====================================================================
// 2. UNIFIED CLEAN TABLE FOR ITEM-BASED MODE
// =====================================================================

function render_items_table(frm) {
	const field = frm.get_field("items_matrix_html");
	if (!field || !field.$wrapper) return;
	const wrapper = field.$wrapper;
	wrapper.empty();

	const items = frm.doc.items || [];
	if (!items.length) {
		wrapper.html(`
			<div style="border: 2px dashed var(--border-color); border-radius: 8px; padding: 24px; text-align: center; color: var(--text-muted);">
				<i class="fa fa-tags" style="font-size: 24px; margin-bottom: 6px; display: block; opacity: 0.5;"></i>
				В этой акции пока нет добавленных товаров.<br>
				Используйте поле быстрого подбора выше, чтобы найти или отсканировать товары.
			</div>
		`);
		return;
	}

	const esc = frappe.utils.escape_html;
	const pct = flt(frm.doc.discount_percentage);

	let rowsHtml = "";
	items.forEach(row => {
		rowsHtml += `
			<tr>
				<td>
					<strong>${esc(row.item_name || row.item_code)}</strong>
					<small class="text-muted">(${esc(row.custom_short_code || row.item_code)})</small>
				</td>
				<td>${esc(row.color || "-")}</td>
				<td>${esc(row.size || "-")}</td>
				<td class="text-right" style="text-decoration: line-through; opacity: 0.7;">${row.base_price} TJS</td>
				<td class="text-right"><strong style="color: #2563eb;">${row.discounted_price} TJS</strong></td>
				<td class="text-center" style="width: 40px;">
					<a href="javascript:void(0)" class="qd-delete-row-btn text-danger" data-code="${esc(row.item_code)}" title="Удалить этот товар из акции" style="font-size: 15px; font-weight: bold; line-height: 1;">
						&times;
					</a>
				</td>
			</tr>
		`;
	});

	wrapper.html(`
		<div style="margin-top: 6px;">
			<div style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
				<div>
					<i class="fa fa-check-circle"></i> Всего в акции: <strong>${items.length}</strong> товаров (SKU) со скидкой <strong>${pct}%</strong>
				</div>
				<a href="javascript:void(0)" id="qd-clear-all-btn" class="text-danger small" style="font-weight: 600;">
					<i class="fa fa-trash"></i> Очистить весь список
				</a>
			</div>
			<div class="table-responsive" style="max-height: 380px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
				<table class="table table-bordered table-striped" style="margin: 0; font-size: 12px;">
					<thead style="background: var(--bg-light-gray, #f8fafc); position: sticky; top: 0; z-index: 2;">
						<tr>
							<th>Товар / Модель</th>
							<th>Цвет</th>
							<th>Размер</th>
							<th class="text-right">Базовая цена</th>
							<th class="text-right">Цена со скидкой</th>
							<th class="text-center" style="width: 40px;"></th>
						</tr>
					</thead>
					<tbody>
						${rowsHtml}
					</tbody>
				</table>
			</div>
		</div>
	`);

	// Remove single SKU
	wrapper.find(".qd-delete-row-btn").on("click", function() {
		const code = $(this).attr("data-code");
		frm.doc.items = (frm.doc.items || []).filter(r => r.item_code !== code);
		frm.refresh_field("items");
		render_items_table(frm);
	});

	// Clear all
	wrapper.find("#qd-clear-all-btn").on("click", function() {
		frappe.confirm(__("Удалить все товары из этой акции?"), () => {
			frm.clear_table("items");
			frm.refresh_field("items");
			render_items_table(frm);
		});
	});
}

// =====================================================================
// 3. CATEGORY MODE: CHIP FILTERS & LIVE PREVIEW TABLE WITH ROW EXCLUSION
// =====================================================================

function render_category_filters(frm) {
	const field = frm.get_field("category_filter_html");
	if (!field || !field.$wrapper) return;
	const wrapper = field.$wrapper;
	wrapper.empty();

	if (!frm.doc.item_group) {
		wrapper.html(`
			<p class="text-muted" style="padding: 10px 0; font-size: 13px;">
				<i class="fa fa-info-circle"></i> Сначала выберите категорию товара (Item Group) выше, чтобы увидеть доступные цвета и размеры.
			</p>
		`);
		return;
	}

	frappe.call({
		method: "erpnext.stock.doctype.quick_discount.quick_discount.get_category_filter_data",
		args: { item_group: frm.doc.item_group },
		callback(r) {
			if (!r.message) return;
			const data = r.message;
			const esc = frappe.utils.escape_html;

			const currentColors = (frm.doc.filter_color || "").split(",").map(c => c.trim()).filter(Boolean);
			const currentSizes = (frm.doc.filter_size || "").split(",").map(s => s.trim()).filter(Boolean);

			let colorPills = "";
			(data.colors || []).forEach(color => {
				const active = currentColors.includes(color);
				colorPills += `
					<button type="button" class="btn btn-xs qd-cat-pill ${active ? 'btn-primary' : 'btn-default'}" data-type="color" data-val="${esc(color)}" style="border-radius: 14px; margin: 2px 4px; padding: 4px 10px;">
						${esc(color)} ${active ? '✓' : ''}
					</button>
				`;
			});

			let sizePills = "";
			(data.sizes || []).forEach(size => {
				const active = currentSizes.includes(size);
				sizePills += `
					<button type="button" class="btn btn-xs qd-cat-pill ${active ? 'btn-primary' : 'btn-default'}" data-type="size" data-val="${esc(size)}" style="border-radius: 14px; margin: 2px 4px; padding: 4px 10px;">
						${esc(size)} ${active ? '✓' : ''}
					</button>
				`;
			});

			wrapper.html(`
				<div style="background: var(--bg-light-gray, #f8fafc); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-top: 6px;">
					<div style="margin-bottom: 10px;">
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
							<label style="font-weight: 700; font-size: 13px; margin: 0;">🎨 Фильтр по цветам (необязательно):</label>
							<a href="javascript:void(0)" class="qd-clear-cat-filter small" data-type="color">Сбросить цвета</a>
						</div>
						<div style="display: flex; flex-wrap: wrap; gap: 4px;">
							${colorPills || '<span class="text-muted small">Нет доступных цветов</span>'}
						</div>
					</div>

					<div>
						<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
							<label style="font-weight: 700; font-size: 13px; margin: 0;">📏 Фильтр по размерам (необязательно):</label>
							<a href="javascript:void(0)" class="qd-clear-cat-filter small" data-type="size">Сбросить размеры</a>
						</div>
						<div style="display: flex; flex-wrap: wrap; gap: 4px;">
							${sizePills || '<span class="text-muted small">Нет доступных размеров</span>'}
						</div>
					</div>
				</div>
			`);

			wrapper.find(".qd-cat-pill").on("click", function() {
				const type = $(this).attr("data-type");
				const val = $(this).attr("data-val");

				let activeList = type === "color"
					? (frm.doc.filter_color || "").split(",").map(c => c.trim()).filter(Boolean)
					: (frm.doc.filter_size || "").split(",").map(s => s.trim()).filter(Boolean);

				if (activeList.includes(val)) {
					activeList = activeList.filter(x => x !== val);
				} else {
					activeList.push(val);
				}

				const fieldname = type === "color" ? "filter_color" : "filter_size";
				frm.set_value(fieldname, activeList.join(", "));
				render_category_filters(frm);
				load_category_preview(frm);
			});

			wrapper.find(".qd-clear-cat-filter").on("click", function() {
				const type = $(this).attr("data-type");
				const fieldname = type === "color" ? "filter_color" : "filter_size";
				frm.set_value(fieldname, "");
				render_category_filters(frm);
				load_category_preview(frm);
			});
		}
	});
}

function load_category_preview(frm) {
	const field = frm.get_field("category_preview_html");
	if (!field || !field.$wrapper) return;
	const wrapper = field.$wrapper;

	if (!frm.doc.item_group) {
		wrapper.empty();
		return;
	}

	wrapper.html(`<div class="text-muted" style="padding: 10px 0;"><i class="fa fa-spinner fa-spin"></i> Загрузка предпросмотра затронутых товаров...</div>`);

	frappe.call({
		method: "erpnext.stock.doctype.quick_discount.quick_discount.preview_category_discount",
		args: {
			item_group: frm.doc.item_group,
			colors: frm.doc.filter_color,
			sizes: frm.doc.filter_size,
			discount_percentage: frm.doc.discount_percentage,
			excluded_items: frm.doc.excluded_items
		},
		callback(r) {
			if (!r.message) {
				wrapper.empty();
				return;
			}
			const { total_count, items, excluded_count, excluded_list } = r.message;
			const esc = frappe.utils.escape_html;

			if (total_count === 0 && !excluded_count) {
				wrapper.html(`
					<div class="alert alert-warning" style="margin-top: 10px; font-size: 13px;">
						<i class="fa fa-exclamation-triangle"></i> По выбранным критериям (категория + фильтры) товары не найдены.
					</div>
				`);
				return;
			}

			let rowsHtml = "";
			(items || []).forEach(it => {
				rowsHtml += `
					<tr>
						<td><strong>${esc(it.item_name)}</strong> <small class="text-muted">(${esc(it.short_code || it.item_code)})</small></td>
						<td>${esc(it.color)}</td>
						<td>${esc(it.size)}</td>
						<td class="text-right">${it.stock}</td>
						<td class="text-right" style="text-decoration: line-through; opacity: 0.7;">${it.base_price} TJS</td>
						<td class="text-right"><strong style="color: #2563eb;">${it.discounted_price} TJS</strong></td>
						<td class="text-center" style="width: 40px;">
							<a href="javascript:void(0)" class="qd-exclude-sku-btn text-danger" data-code="${esc(it.item_code)}" title="Исключить этот товар из скидки" style="font-size: 15px; font-weight: bold; line-height: 1;">
								&times;
							</a>
						</td>
					</tr>
				`;
			});

			// Render excluded items pill list if any
			let excludedSectionHtml = "";
			if (excluded_count > 0 && excluded_list && excluded_list.length) {
				let exChips = "";
				excluded_list.forEach(ex => {
					exChips += `
						<span class="badge" style="background: #fee2e2; color: #991b1b; padding: 4px 8px; margin: 2px 4px; border-radius: 12px; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
							${esc(ex.item_name)} (${esc(ex.color || "-")}, ${esc(ex.size || "-")})
							<a href="javascript:void(0)" class="qd-restore-sku-btn" data-code="${esc(ex.item_code)}" title="Вернуть в акцию" style="color: #991b1b; font-weight: 700; margin-left: 2px;">↺</a>
						</span>
					`;
				});

				excludedSectionHtml = `
					<div style="background: #fff5f5; border: 1px solid #fed7d7; border-radius: 6px; padding: 8px 12px; margin-top: 8px; font-size: 12px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;">
						<div style="display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
							<span style="font-weight: 700; color: #991b1b;">🚫 Исключённые товары (${excluded_count}):</span>
							${exChips}
						</div>
						<a href="javascript:void(0)" id="qd-restore-all-btn" class="small" style="color: #991b1b; text-decoration: underline; font-weight: 600;">
							Восстановить все
						</a>
					</div>
				`;
			}

			const overflowNotice = total_count > (items || []).length
				? `<div class="text-muted small" style="margin-top: 6px; text-align: right;">Показаны первые ${items.length} товаров из ${total_count}.</div>`
				: "";

			wrapper.html(`
				<div style="margin-top: 10px;">
					<div style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; font-size: 13px; display: flex; justify-content: space-between; align-items: center;">
						<div>
							<i class="fa fa-check-circle"></i> Найдено <strong>${total_count}</strong> товаров (SKU), которые получат скидку <strong>${flt(frm.doc.discount_percentage)}%</strong>
						</div>
					</div>
					<div class="table-responsive" style="max-height: 380px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px;">
						<table class="table table-bordered table-striped" style="margin: 0; font-size: 12px;">
							<thead style="background: var(--bg-light-gray, #f8fafc); position: sticky; top: 0; z-index: 2;">
								<tr>
									<th>Товар / Модель</th>
									<th>Цвет</th>
									<th>Размер</th>
									<th class="text-right">Остаток</th>
									<th class="text-right">Базовая цена</th>
									<th class="text-right">Цена со скидкой</th>
									<th class="text-center" style="width: 40px;"></th>
								</tr>
							</thead>
							<tbody>
								${rowsHtml}
							</tbody>
						</table>
					</div>
					${overflowNotice}
					${excludedSectionHtml}
				</div>
			`);

			// Exclude item handler
			wrapper.find(".qd-exclude-sku-btn").on("click", function() {
				const code = $(this).attr("data-code");
				let exList = (frm.doc.excluded_items || "").split(",").map(x => x.trim()).filter(Boolean);
				if (!exList.includes(code)) {
					exList.push(code);
					frm.set_value("excluded_items", exList.join(", "));
					load_category_preview(frm);
				}
			});

			// Restore single item handler
			wrapper.find(".qd-restore-sku-btn").on("click", function() {
				const code = $(this).attr("data-code");
				let exList = (frm.doc.excluded_items || "").split(",").map(x => x.trim()).filter(Boolean);
				exList = exList.filter(x => x !== code);
				frm.set_value("excluded_items", exList.join(", "));
				load_category_preview(frm);
			});

			// Restore all items handler
			wrapper.find("#qd-restore-all-btn").on("click", function() {
				frm.set_value("excluded_items", "");
				load_category_preview(frm);
			});
		}
	});
}
