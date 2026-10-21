// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["product-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Product"),
		single_column: true,
	});
	wrapper.product_detail = new ProductDetailApp(page);
};

frappe.pages["product-detail"].on_page_show = function (wrapper) {
	const item_code = frappe.get_route()[1];
	if (item_code) {
		wrapper.product_detail.load(decodeURIComponent(item_code));
	}
};

class ProductDetailApp {
	constructor(page) {
		this.page = page;
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.$body = $(page.body).addClass("product-detail-page");
		this.item_code = null;
		this.selected_color = null;
		this.sales_chart = null;
		this.is_reconciling = false;

		this.page.set_secondary_action(__("Back to Catalog"), () => frappe.set_route("product-catalog"));
		this.page.add_menu_item(__("Open full Item form (advanced)"), () => {
			if (this.item_code) frappe.set_route("Form", "Item", this.item_code);
		});
	}

	t(key) {
		const d = {
			product_name: { tg: "Номи мол", ru: "Название товара" },
			code: { tg: "Рамз (ID)", ru: "Код (ID)" },
			category: { tg: "Гурӯҳ", ru: "Категория" },
			supplier: { tg: "Таъминкунанда", ru: "Поставщик" },
			total_stock: { tg: "Дар анбор (ҳамагӣ)", ru: "На складе (всего)" },
			total_sold: { tg: "Фурӯхта шуд (ҳамагӣ)", ru: "Продано (всего)" },
			color: { tg: "Интихоби ранг", ru: "Выбор цвета" },
			color_section_title: { tg: "Ранг ва андозаҳо", ru: "Цвет и размеры" },
			pick_color_hint: {
				tg: "Барои дидани андозаҳо ва бақия, лутфан рангро интихоб кунед.",
				ru: "Пожалуйста, выберите цвет, чтобы увидеть размеры и остатки.",
			},
			sizes: { tg: "Андозаҳо", ru: "Размеры" },
			size: { tg: "Андоза", ru: "Размер" },
			short_code: { tg: "Рамз (Код)", ru: "Код" },
			cost: { tg: "Нархи харид", ru: "Закупка" },
			price: { tg: "Нархи фурӯш", ru: "Цена" },
			left: { tg: "Дар анбор", ru: "Остаток" },
			sold: { tg: "Фурӯхта шуд", ru: "Продано" },
			status: { tg: "Ҳолат", ru: "Статус" },
			in_stock: { tg: "Дар анбор", ru: "В наличии" },
			low: { tg: "Кам монд", ru: "Мало" },
			out: { tg: "Тамом шуд", ru: "Нет в наличии" },
			restock: { tg: "📥 Қабули мол", ru: "📥 Приёмка товара" },
			no_photo: { tg: "Акс нест", ru: "Нет фото" },
			total: { tg: "Ҳамагӣ", ru: "Итого" },
			upload_photo: { tg: "📷 Боргирии акс", ru: "📷 Загрузить фото" },
			change_photo: { tg: "📷 Тағйири акс", ru: "📷 Изменить фото" },
			photo_saved: { tg: "Акс бомуваффақият сабт шуд!", ru: "Фото успешно сохранено!" },
			revenue: { tg: "Маблағи фурӯш", ru: "Выручка" },
			profit: { tg: "Фоидаи соф", ru: "Валовая прибыль" },
			margin: { tg: "Фоизи маржа", ru: "Маржинальность" },
			sales_30d: { tg: "Фурӯш (30 рӯз)", ru: "Продажи (30 дней)" },
			top_sizes_label: { tg: "Хит-андозаҳо", ru: "Хит-размеры" },
			top_colors_label: { tg: "Хит-рангҳо", ru: "Хит-цвета" },
			chart_title: { tg: "Динамикаи фурӯш (30 рӯзи охир)", ru: "Динамика продаж (последние 30 дней)" },
			runway_prefix: { tg: "Бақия мерасад барои: ~", ru: "Хватит на: ~" },
			days: { tg: "рӯз", ru: "дн." },
			items_per_day: { tg: "дона/рӯз", ru: "шт/день" },
			reconcile_stock: { tg: "⚖️ Ислоҳи бақия", ru: "⚖️ Корректировка остатков" },
			reconcile_mode_active: { tg: "Ҳолати ислоҳ", ru: "Режим корректировки" },
			actual_stock_count: { tg: "Бақияи воқеӣ (Факт)", ru: "Фактический остаток" },
			current_stock: { tg: "Дар система", ru: "В системе" },
			save_stock: { tg: "💾 Сабти бақия", ru: "💾 Сохранить" },
			cancel: { tg: "Бекор кардан", ru: "Отмена" },
			no_changes_detected: { tg: "Ягон тағйирот дар бақия ворид нашудааст.", ru: "Изменений в остатках не обнаружено." },
			reconcile_success: { tg: "Бақияи мол бомуваффақият нав карда шуд!", ru: "Остатки успешно скорректированы!" },
			saving: { tg: "Сабт шуда истодааст...", ru: "Сохранение..." },
			reason_audit: { tg: "Инвентаризатсия / Переучёт", ru: "Инвентаризация / Переучёт" },
			reason_damaged: { tg: "Брок (списание)", ru: "Списание брака" },
			reason_error: { tg: "Иштибоҳ / Пересорт", ru: "Ошибка кассира / Пересорт" },
		};
		return (d[key] && d[key][this.lang]) || key;
	}

	load(item_code, retain_color = null) {
		this.item_code = item_code;
		this.is_reconciling = false;
		this.$body.html(`<div class="text-center text-muted" style="padding:60px;">${__("Loading...")}</div>`);
		frappe.call({
			method: "erpnext.stock.page.product_detail.product_detail.get_product_detail",
			args: { item_code },
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.selected_color = null;
				this.render();
				if (retain_color && this.color_control) {
					this.color_control.set_value(retain_color);
				}
			},
		});
	}

	render() {
		const d = this.data;
		this.page.set_title(d.item_name);
		this.page.clear_primary_action();
		this.page.set_primary_action(this.t("restock"), () => {
			const color = this.selected_color ? this.selected_color.color : "";
			frappe.new_doc("Quick Product Restock", {
				item: this.item_code,
				item_name: d.item_name,
				short_code: d.short_code,
				initial_color: color,
			});
		});

		this.$body.html(`
			<div class="product-detail-container">
				<div class="pd-card">
					<!-- Top Section: Image + Info Fields -->
					<div class="pd-main-grid">
						<div class="pd-image-col">
							<div class="pd-image-box" title="${this.t("change_photo")}"></div>
							<button type="button" class="pd-upload-btn" id="pd-btn-upload">
								${this.t("upload_photo")}
							</button>
						</div>
						<div class="pd-fields-col">
							<div class="pd-fields-grid">
								<div class="pd-field-item pd-f-name"></div>
								<div class="pd-field-item pd-f-code"></div>
								<div class="pd-field-item pd-f-cat"></div>
								<div class="pd-field-item pd-f-supp"></div>
								<div class="pd-field-item pd-f-stock"></div>
								<div class="pd-field-item pd-f-sold"></div>
							</div>

							<!-- Best Seller Highlights (Top Colors & Sizes) -->
							<div class="pd-highlights-row" id="pd-highlights"></div>
						</div>
					</div>

					<!-- Financial & Stats Summary Cards -->
					<div class="pd-stats-row" id="pd-stats-row"></div>

					<!-- 30-Day Sales Chart -->
					<div class="pd-chart-container">
						<div class="pd-chart-header">
							<span class="pd-chart-title">📊 ${this.t("chart_title")}</span>
							<span class="pd-chart-runway" id="pd-chart-runway"></span>
						</div>
						<div id="pd-sales-chart-wrapper" style="height: 190px;"></div>
					</div>

					<div class="pd-divider pd-color-divider"></div>

					<!-- Color Picker Section -->
					<div class="pd-color-section">
						<div class="pd-section-title">${this.t("color_section_title")}</div>
						<div class="pd-color-wrapper"></div>
					</div>

					<!-- Sizes Table -->
					<div class="pd-sizes-section"></div>
				</div>
			</div>
		`);

		this.make_info_fields();
		this.update_stats_cards(null);
		this.render_highlights(null);
		this.render_sales_chart(null);
		this.bind_image_events();

		const has_colors = d.colors.some((c) => c.color);
		if (has_colors) {
			this.make_color_field();
		} else {
			this.$body.find(".pd-color-divider").hide();
			this.$body.find(".pd-color-section").hide();
		}

		this.render_image();
		this.update_upload_btn_label();

		if (!has_colors) {
			this.render_sizes(d.colors[0]);
		} else if (d.colors.length === 1) {
			this.color_control.set_value(d.colors[0].color);
		} else {
			this.render_sizes(null);
		}
	}

	make_ctl(parent, df, value) {
		const ctl = frappe.ui.form.make_control({
			df: Object.assign({ read_only: 1 }, df),
			parent,
			render_input: true,
		});
		if (value !== undefined) ctl.set_value(value);
		return ctl;
	}

	make_info_fields() {
		const d = this.data;
		this.ctl_name = this.make_ctl(this.$body.find(".pd-f-name"), { fieldtype: "Data", fieldname: "item_name", label: this.t("product_name") }, d.item_name);
		this.ctl_code = this.make_ctl(this.$body.find(".pd-f-code"), { fieldtype: "Data", fieldname: "short_code", label: this.t("code") }, d.short_code || d.item_code);
		this.ctl_cat = this.make_ctl(this.$body.find(".pd-f-cat"), { fieldtype: "Link", options: "Item Group", fieldname: "item_group", label: this.t("category") }, d.item_group);
		this.ctl_supp = this.make_ctl(this.$body.find(".pd-f-supp"), { fieldtype: "Link", options: "Supplier", fieldname: "supplier", label: this.t("supplier") }, d.supplier || "");
		this.ctl_stock = this.make_ctl(this.$body.find(".pd-f-stock"), { fieldtype: "Float", fieldname: "total_stock", label: this.t("total_stock") }, d.total_stock);
		this.ctl_sold = this.make_ctl(this.$body.find(".pd-f-sold"), { fieldtype: "Float", fieldname: "total_sold", label: this.t("total_sold") }, d.total_sold);
	}

	update_stats_cards(colorObj = null) {
		const d = this.data;
		const cur = d.currency;
		const $row = this.$body.find("#pd-stats-row");

		const revenue = colorObj ? colorObj.revenue : d.total_revenue;
		const sold = colorObj ? colorObj.sold : d.total_sold;
		const profit = colorObj ? colorObj.profit : d.total_profit;
		const margin = colorObj ? colorObj.margin_pct : d.margin_pct;
		const sold_30d = colorObj ? colorObj.sold_last_30d : d.sold_last_30d;
		const velocity = colorObj ? colorObj.velocity_per_day : d.velocity_per_day;
		const runway = colorObj ? colorObj.runway_days : d.runway_days;

		const runwayText = runway < 900 ? `${this.t("runway_prefix")}${runway} ${this.t("days")}` : "";
		const scopeLabel = colorObj ? ` <span style="font-weight: 500; font-size: 11px; color: #2563eb;">(${colorObj.color})</span>` : "";

		$row.html(`
			<div class="pd-stat-card">
				<div class="pd-stat-label">${this.t("revenue")}${scopeLabel}</div>
				<div class="pd-stat-value">${format_currency(revenue, cur)}</div>
				<div class="pd-stat-sub">${sold} ${this.lang === "tg" ? "дона фурӯхта шуд" : "шт. продано"}</div>
			</div>
			<div class="pd-stat-card">
				<div class="pd-stat-label">${this.t("profit")}${scopeLabel}</div>
				<div class="pd-stat-value" style="color: #10b981;">+${format_currency(profit, cur)}</div>
				<div class="pd-stat-sub">${this.t("margin")}: ${margin}%</div>
			</div>
			<div class="pd-stat-card">
				<div class="pd-stat-label">${this.t("sales_30d")}${scopeLabel}</div>
				<div class="pd-stat-value">${sold_30d} <span style="font-size: 14px; font-weight: 500;">(${velocity} ${this.t("items_per_day")})</span></div>
				<div class="pd-stat-sub" style="color: #2563eb;">${runwayText}</div>
			</div>
		`);

		const $runwayEl = this.$body.find("#pd-chart-runway");
		if (runwayText) {
			$runwayEl.html(`⏱️ ${runwayText}${scopeLabel}`).show();
		} else {
			$runwayEl.hide();
		}

		// Also update the stock/sold fields in info grid
		if (this.ctl_stock) {
			this.ctl_stock.set_value(colorObj ? colorObj.stock : d.total_stock);
		}
		if (this.ctl_sold) {
			this.ctl_sold.set_value(colorObj ? colorObj.sold : d.total_sold);
		}
	}

	render_highlights(colorObj = null) {
		const d = this.data;
		const $h = this.$body.find("#pd-highlights");
		let html = "";

		// If a color is selected: HIDE the hit color stat completely, show top sizes for this color
		if (colorObj) {
			const sizes = colorObj.top_sizes || [];
			if (sizes.length > 0) {
				html += `
					<div class="pd-highlight-group">
						<span class="pd-highlight-title">🏆 ${this.t("top_sizes_label")} (${colorObj.color}):</span>
						${sizes
							.map(
								(s, i) => `
							<span class="pd-rank-item">
								<span class="pd-rank-tag">#${i + 1}</span>
								<span class="pd-rank-val">${frappe.utils.escape_html(s.name)}</span>
								<span class="pd-rank-pct">(${s.qty} ${this.lang === "tg" ? "дона" : "шт"}, ${s.pct}%)</span>
							</span>
						`
							)
							.join("")}
					</div>
				`;
			}
		} else {
			// No color chosen: show Top Colors AND Top Sizes overall
			if (d.top_colors && d.top_colors.length > 0) {
				html += `
					<div class="pd-highlight-group">
						<span class="pd-highlight-title">🎨 ${this.t("top_colors_label")}:</span>
						${d.top_colors
							.map(
								(c, i) => `
							<span class="pd-rank-item">
								<span class="pd-rank-tag">#${i + 1}</span>
								<span class="pd-rank-val">${frappe.utils.escape_html(c.name)}</span>
								<span class="pd-rank-pct">(${c.qty} ${this.lang === "tg" ? "дона" : "шт"}, ${c.pct}%)</span>
							</span>
						`
							)
							.join("")}
					</div>
				`;
			}

			if (d.top_sizes && d.top_sizes.length > 0) {
				html += `
					<div class="pd-highlight-group">
						<span class="pd-highlight-title">🏆 ${this.t("top_sizes_label")}:</span>
						${d.top_sizes
							.map(
								(s, i) => `
							<span class="pd-rank-item">
								<span class="pd-rank-tag">#${i + 1}</span>
								<span class="pd-rank-val">${frappe.utils.escape_html(s.name)}</span>
								<span class="pd-rank-pct">(${s.qty} ${this.lang === "tg" ? "дона" : "шт"}, ${s.pct}%)</span>
							</span>
						`
							)
							.join("")}
					</div>
				`;
			}
		}

		$h.html(html);
	}

	render_sales_chart(colorName = null) {
		const d = this.data;
		if (!d.chart_labels || d.chart_labels.length === 0) return;

		let values = d.chart_values;
		if (colorName && d.color_chart_values && d.color_chart_values[colorName]) {
			values = d.color_chart_values[colorName];
		}

		const chartEl = this.$body.find("#pd-sales-chart-wrapper")[0];
		if (!chartEl) return;

		const labels = d.chart_labels.map((l, idx) => (idx % 4 === 0 || idx === d.chart_labels.length - 1 ? l : ""));

		const chartData = {
			labels: labels,
			datasets: [
				{
					name: colorName ? `${colorName}` : __("All Sales"),
					values: values,
				},
			],
		};

		if (this.sales_chart) {
			this.sales_chart.update(chartData);
		} else {
			this.sales_chart = new frappe.Chart(chartEl, {
				title: "",
				data: chartData,
				type: "bar",
				height: 160,
				colors: ["#2563eb"],
				axisOptions: {
					xIsSeries: true,
					shortenYAxisNumbers: 1,
				},
				barOptions: {
					spaceRatio: 0.35,
				},
				tooltipOptions: {
					formatTooltipY: (d) => `${d} ${this.lang === "tg" ? "дона" : "шт"}`,
				},
			});
		}
	}

	make_color_field() {
		const options = ["", ...this.data.colors.map((c) => c.color)].join("\n");
		this.color_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "color",
				label: this.t("color"),
				options,
				change: () => this.on_color_change(),
			},
			parent: this.$body.find(".pd-color-wrapper"),
			render_input: true,
		});
		this.color_control.refresh();
	}

	bind_image_events() {
		this.$body.find("#pd-btn-upload, .pd-image-box").on("click", () => {
			this.open_image_uploader();
		});
	}

	open_image_uploader() {
		const currentColor = this.selected_color ? this.selected_color.color : "";
		new frappe.ui.FileUploader({
			doctype: "Item",
			docname: this.item_code,
			folder: "Home/Attachments",
			on_success: (file_doc) => {
				frappe.call({
					method: "erpnext.stock.page.product_detail.product_detail.update_color_image",
					args: {
						item_code: this.item_code,
						color: currentColor,
						image_url: file_doc.file_url,
					},
					callback: (r) => {
						if (r.message && r.message.success) {
							frappe.show_alert({
								message: this.t("photo_saved"),
								indicator: "green",
							});
							if (this.selected_color) {
								this.selected_color.image = file_doc.file_url;
							}
							if (!this.data.image) {
								this.data.image = file_doc.file_url;
							}
							this.render_image();
							this.update_upload_btn_label();
						}
					},
				});
			},
		});
	}

	on_color_change() {
		const value = this.color_control.get_value();
		const color = this.data.colors.find((c) => c.color === value) || null;
		this.selected_color = color;
		this.is_reconciling = false;
		this.render_image();
		this.update_upload_btn_label();
		this.render_sizes(color);
		this.render_sales_chart(color ? color.color : null);
		this.update_stats_cards(color);
		this.render_highlights(color);
	}

	update_upload_btn_label() {
		const $btn = this.$body.find("#pd-btn-upload");
		if (this.selected_color) {
			const hasImg = Boolean(this.selected_color.image);
			const action = hasImg ? this.t("change_photo") : this.t("upload_photo");
			$btn.text(`${action} (${this.selected_color.color})`);
		} else {
			const hasImg = Boolean(this.data.image);
			const action = hasImg ? this.t("change_photo") : this.t("upload_photo");
			$btn.text(action);
		}
	}

	render_image() {
		const d = this.data;
		const src = (this.selected_color && this.selected_color.image) || (this.selected_color ? "" : d.image);
		const $box = this.$body.find(".pd-image-box");
		if (src) {
			$box.html(`<img src="${frappe.utils.escape_html(src)}" alt="${frappe.utils.escape_html(d.item_name)}">`);
		} else {
			const colorText = this.selected_color ? ` (${this.selected_color.color})` : "";
			$box.html(`
				<div class="pd-no-photo">
					<div class="pd-abbr">${frappe.get_abbr(d.item_name)}</div>
					<div>${this.t("no_photo")}${colorText}</div>
					<div style="font-size: 11px; margin-top: 4px; color: #94a3b8;">${__("Click to upload")}</div>
				</div>
			`);
		}
	}

	status_pill(qty) {
		if (qty <= 0) return `<span class="indicator-pill red">${this.t("out")}</span>`;
		if (qty <= 5) return `<span class="indicator-pill orange">${this.t("low")}</span>`;
		return `<span class="indicator-pill green">${this.t("in_stock")}</span>`;
	}

	render_sizes(color) {
		const $s = this.$body.find(".pd-sizes-section");
		if (!color) {
			$s.html(`<div class="pd-hint">${this.t("pick_color_hint")}</div>`);
			return;
		}
		const cur = this.data.currency;
		const isReco = Boolean(this.is_reconciling);

		const rows = color.sizes
			.map(
				(s) => `
			<tr data-item-code="${frappe.utils.escape_html(s.item_code)}">
				<td><b>${frappe.utils.escape_html(s.size)}</b></td>
				<td class="text-muted">${frappe.utils.escape_html(s.short_code)}</td>
				<td class="text-right">${format_currency(s.buying_price, cur)}</td>
				<td class="text-right">${format_currency(s.selling_price, cur)}</td>
				${
					isReco
						? `
					<td class="text-right pd-reconcile-cell">
						<div class="pd-reconcile-field-wrap">
							<span class="pd-reconcile-orig-label" title="${this.t("current_stock")}">${flt(s.stock_qty)} →</span>
							<input type="number" min="0" step="1"
								class="form-control input-sm pd-reconcile-input"
								data-item-code="${frappe.utils.escape_html(s.item_code)}"
								data-orig-qty="${flt(s.stock_qty)}"
								value="${flt(s.stock_qty)}">
							<span class="pd-reconcile-delta-badge" style="display:none;"></span>
						</div>
					</td>
				`
						: `
					<td class="text-right pd-num">${flt(s.stock_qty)}</td>
				`
				}
				<td class="text-right">${flt(s.sold_qty)}</td>
				<td>${this.status_pill(s.stock_qty)}</td>
			</tr>`
			)
			.join("");

		$s.html(`
			<div class="pd-sizes-header">
				<div class="pd-section-title">
					<span>${this.t("sizes")}${color.color ? ` — <span style="color: #2563eb;">${frappe.utils.escape_html(color.color)}</span>` : ""}</span>
				</div>
				<div class="pd-sizes-actions">
					${
						!isReco
							? `
						<button type="button" class="btn btn-default btn-xs pd-btn-reconcile" id="pd-btn-start-reconcile">
							${this.t("reconcile_stock")}
						</button>
					`
							: `
						<div class="pd-reconcile-bar">
							<span class="pd-reconcile-hint">${this.t("reconcile_mode_active")}:</span>
							<select class="form-control input-xs pd-reconcile-reason" id="pd-reconcile-reason">
								<option value="${this.t("reason_audit")}">${this.t("reason_audit")}</option>
								<option value="${this.t("reason_damaged")}">${this.t("reason_damaged")}</option>
								<option value="${this.t("reason_error")}">${this.t("reason_error")}</option>
							</select>
							<button type="button" class="btn btn-primary btn-xs pd-btn-save-reconcile" id="pd-btn-save-reconcile">
								${this.t("save_stock")}
							</button>
							<button type="button" class="btn btn-default btn-xs pd-btn-cancel-reconcile" id="pd-btn-cancel-reconcile">
								${this.t("cancel")}
							</button>
						</div>
					`
					}
				</div>
			</div>
			<div class="pd-table-wrap table-responsive">
				<table class="table pd-table">
					<thead>
						<tr>
							<th>${this.t("size")}</th>
							<th>${this.t("short_code")}</th>
							<th class="text-right">${this.t("cost")}</th>
							<th class="text-right">${this.t("price")}</th>
							<th class="text-right ${isReco ? "pd-th-reconcile" : ""}">${isReco ? this.t("actual_stock_count") : this.t("left")}</th>
							<th class="text-right">${this.t("sold")}</th>
							<th>${this.t("status")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
					<tfoot>
						<tr>
							<td colspan="4"><b>${this.t("total")}</b></td>
							<td class="text-right pd-num pd-tfoot-total-stock">${flt(color.stock)}</td>
							<td class="text-right"><b>${flt(color.sold)}</b></td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);

		this.bind_reconcile_events(color);
	}

	bind_reconcile_events(color) {
		const $s = this.$body.find(".pd-sizes-section");

		$s.find("#pd-btn-start-reconcile").on("click", () => {
			this.is_reconciling = true;
			this.render_sizes(color);
			setTimeout(() => {
				const $firstInput = this.$body.find(".pd-reconcile-input:first");
				if ($firstInput.length) {
					$firstInput.focus().select();
				}
			}, 50);
		});

		$s.find("#pd-btn-cancel-reconcile").on("click", () => {
			this.is_reconciling = false;
			this.render_sizes(color);
		});

		const recalculateTotal = () => {
			let total = 0;
			$s.find(".pd-reconcile-input").each(function () {
				total += flt($(this).val());
			});
			$s.find(".pd-tfoot-total-stock").text(total);
		};

		$s.find(".pd-reconcile-input").on("input change", function () {
			const $input = $(this);
			const orig = flt($input.data("orig-qty"));
			const val = flt($input.val());
			const diff = val - orig;
			const $badge = $input.siblings(".pd-reconcile-delta-badge");

			if (diff === 0 || isNaN(diff)) {
				$badge.hide().text("");
				$input.removeClass("is-changed-pos is-changed-neg");
			} else if (diff > 0) {
				$badge.text(`+${diff}`).attr("class", "pd-reconcile-delta-badge pd-delta-pos").show();
				$input.addClass("is-changed-pos").removeClass("is-changed-neg");
			} else {
				$badge.text(`${diff}`).attr("class", "pd-reconcile-delta-badge pd-delta-neg").show();
				$input.addClass("is-changed-neg").removeClass("is-changed-pos");
			}

			recalculateTotal();
		});

		$s.find("#pd-btn-save-reconcile").on("click", () => {
			const changes = [];
			let hasNegative = false;

			$s.find(".pd-reconcile-input").each(function () {
				const $el = $(this);
				const item_code = $el.data("item-code");
				const orig_qty = flt($el.data("orig-qty"));
				const qty = flt($el.val());

				if (qty < 0) {
					hasNegative = true;
					return false;
				}

				if (qty !== orig_qty) {
					changes.push({ item_code, orig_qty, qty });
				}
			});

			if (hasNegative) {
				frappe.msgprint(__("Quantity cannot be negative"));
				return;
			}

			if (changes.length === 0) {
				frappe.show_alert({
					message: this.t("no_changes_detected"),
					indicator: "orange",
				});
				this.is_reconciling = false;
				this.render_sizes(color);
				return;
			}

			const reason = $s.find("#pd-reconcile-reason").val() || this.t("reason_audit");
			const $btn = $s.find("#pd-btn-save-reconcile");
			$btn.prop("disabled", true).text(this.t("saving"));

			frappe.call({
				method: "erpnext.stock.page.product_detail.product_detail.reconcile_stock",
				args: {
					item_code: this.item_code,
					changes: JSON.stringify(changes),
					reason: reason,
				},
				callback: (r) => {
					$btn.prop("disabled", false).text(this.t("save_stock"));
					if (r.message && r.message.success) {
						frappe.show_alert({
							message: this.t("reconcile_success"),
							indicator: "green",
						});
						this.is_reconciling = false;
						this.load(this.item_code, color ? color.color : null);
					}
				},
				error: () => {
					$btn.prop("disabled", false).text(this.t("save_stock"));
				},
			});
		});
	}
}
