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
			print_labels: { tg: "🏷️ Чопи ценникҳо", ru: "🏷️ Печать ценников" },
			format_label: { tg: "Формати тамға", ru: "Формат ценника" },
			format_standard: { tg: "Стандартӣ (58 × 40 мм)", ru: "Стандартный (58 × 40 мм)" },
			format_sale: { tg: "Скидка / Акция (58 × 40 мм)", ru: "Скидка / Акция (58 × 40 мм)" },
			presets_label: { tg: "Интихоби тез", ru: "Быстрый выбор" },
			preset_1_each: { tg: "По 1 шт", ru: "По 1 шт" },
			preset_stock: { tg: "Аз рӯи бақия", ru: "По остатку" },
			preset_clear: { tg: "Тоза кардан (0)", ru: "Очистить (0)" },
			preset_fixed: { tg: "Миқдори муайян", ru: "Фиксированное" },
			apply: { tg: "Татбиқ", ru: "Применить" },
			all_colors: { tg: "Ҳамаи рангҳо", ru: "Все цвета" },
			qty_to_print: { tg: "Миқдор барои чоп", ru: "Кол-во для печати" },
			barcode: { tg: "Штрихкод", ru: "Штрихкод" },
			print_action: { tg: "🖨️ Чоп кардан", ru: "🖨️ Распечатать ценники" },
			no_items_selected: { tg: "Ягон мол барои чоп интихоб нашудааст.", ru: "Не выбрано ни одной позиции для печати." },
			selected_variants: { tg: "Интихоб шуд", ru: "Выбрано позиций" },
			total_labels_count: { tg: "Ҳамагӣ наклейка", ru: "Всего наклеек" },
			pcs: { tg: "дона", ru: "шт." },
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
		let pageTitle = frappe.utils.escape_html(d.item_name);
		if (d.effective_discount && d.effective_discount.has_discount) {
			pageTitle += ` <span class="indicator-pill red" style="font-size: 13px; font-weight: 600; vertical-align: middle; margin-left: 8px;">-${flt(d.effective_discount.discount_percentage)}% ${d.effective_discount.tier_badge}</span>`;
		}
		this.page.set_title(pageTitle);
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
		this.page.clear_inner_toolbar();
		this.page.add_inner_button(this.t("print_labels"), () => this.open_print_labels_dialog());

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
			.map((s) => {
				const hasPromo = s.discount && s.discount.has_discount && flt(s.discount.discounted_price) < flt(s.selling_price);
				const priceDisplay = hasPromo
					? `<del class="text-muted" style="font-size: 11px;">${format_currency(s.selling_price, cur)}</del> <strong style="color: #ef4444; font-size: 13px; margin-left: 3px;">${format_currency(s.discount.discounted_price, cur)}</strong> <span class="indicator-pill red" style="font-size: 10px; padding: 1px 5px; margin-left: 3px;">-${flt(s.discount.discount_percentage)}%</span>`
					: format_currency(s.selling_price, cur);

				return `
			<tr data-item-code="${frappe.utils.escape_html(s.item_code)}">
				<td><b>${frappe.utils.escape_html(s.size)}</b></td>
				<td class="text-muted">${frappe.utils.escape_html(s.short_code)}</td>
				<td class="text-right">${format_currency(s.buying_price, cur)}</td>
				<td class="text-right">${priceDisplay}</td>
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
			</tr>`;
			})
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
						<button type="button" class="btn btn-default btn-xs pd-btn-print-labels" id="pd-btn-print-labels">
							${this.t("print_labels")}
						</button>
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
		$s.find("#pd-btn-print-labels").on("click", () => this.open_print_labels_dialog());
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

	open_print_labels_dialog() {
		const d = this.data;
		if (!d || !d.colors) return;

		// Collect all variants across colors
		const all_variants = [];
		d.colors.forEach((c) => {
			(c.sizes || []).forEach((s) => {
				const hasPromo = s.discount && s.discount.has_discount;
				const promoPrice = hasPromo ? flt(s.discount.discounted_price) : flt(s.selling_price);
				const oldPrice = hasPromo ? flt(s.selling_price) : Math.round(flt(s.selling_price) * 1.3);
				const discountPct = hasPromo && s.discount.discount_percentage
					? Math.round(flt(s.discount.discount_percentage))
					: (oldPrice > promoPrice ? Math.round(((oldPrice - promoPrice) / oldPrice) * 100) : 0);

				all_variants.push({
					item_code: s.item_code,
					item_name: s.item_name || d.item_name,
					color: c.color || "",
					size: s.size || "",
					short_code: s.short_code || "",
					barcode: s.barcode || s.item_code,
					stock_qty: flt(s.stock_qty),
					selling_price: flt(s.selling_price),
					discount: s.discount || { has_discount: false },
					promo_price: promoPrice,
					old_price: oldPrice,
					discount_pct: discountPct,
					selected: true,
					print_qty: flt(s.stock_qty) > 0 ? Math.round(flt(s.stock_qty)) : 1,
				});
			});
		});

		if (all_variants.length === 0) {
			frappe.msgprint(__("Нет доступных вариантов для печати"));
			return;
		}

		const has_colors = d.colors.some((c) => c.color);
		let active_color = this.selected_color && this.selected_color.color ? this.selected_color.color : "all";
		let selected_format = "standard"; // "standard" or "sale"

		const dialog = new frappe.ui.Dialog({
			title: `${this.t("print_labels")} — ${frappe.utils.escape_html(d.item_name)}`,
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "matrix_html",
				},
			],
			primary_action_label: this.t("print_action"),
			primary_action: () => {
				const to_print = [];
				all_variants.forEach((v) => {
					if (v.selected && v.print_qty > 0) {
						for (let i = 0; i < v.print_qty; i++) {
							to_print.push({
								item_code: v.item_code,
								item_name: v.item_name,
								color: v.color,
								size: v.size,
								short_code: v.short_code,
								barcode: v.barcode,
								selling_price: selected_format === "sale" ? v.promo_price : v.selling_price,
								old_price: v.old_price,
								discount_pct: v.discount_pct,
								stock_uom: d.stock_uom || "шт",
							});
						}
					}
				});

				if (to_print.length === 0) {
					frappe.show_alert({
						message: this.t("no_items_selected"),
						indicator: "orange",
					});
					return;
				}

				dialog.hide();
				this.print_labels(to_print, selected_format);
			},
		});

		const $wrapper = dialog.get_field("matrix_html").$wrapper;

		// Build color tabs HTML
		let color_tabs_html = "";
		if (has_colors) {
			const color_counts = {};
			all_variants.forEach((v) => {
				if (v.color) color_counts[v.color] = (color_counts[v.color] || 0) + 1;
			});

			color_tabs_html = `
				<div class="pd-print-color-tabs">
					<button type="button" class="pd-color-tab ${active_color === 'all' ? 'active' : ''}" data-color="all">
						${this.t("all_colors")} (${all_variants.length})
					</button>
					${Object.keys(color_counts).map((col) => `
						<button type="button" class="pd-color-tab ${active_color === col ? 'active' : ''}" data-color="${frappe.utils.escape_html(col)}">
							${frappe.utils.escape_html(col)} (${color_counts[col]})
						</button>
					`).join("")}
				</div>
			`;
		}

		$wrapper.html(`
			<div class="pd-print-dialog-wrap">
				<!-- Header toolbar -->
				<div class="pd-print-header-bar">
					<div class="pd-print-format-group">
						<span class="pd-print-bar-label">${this.t("format_label")}:</span>
						<div class="btn-group" role="group">
							<button type="button" class="btn btn-sm btn-default pd-format-btn ${selected_format === 'standard' ? 'active' : ''}" data-format="standard">
								🏷️ ${this.t("format_standard")}
							</button>
							<button type="button" class="btn btn-sm btn-default pd-format-btn ${selected_format === 'sale' ? 'active' : ''}" data-format="sale">
								🔥 ${this.t("format_sale")}
							</button>
						</div>
					</div>

					<div class="pd-print-presets-group">
						<span class="pd-print-bar-label">${this.t("presets_label")}:</span>
						<div class="btn-group" role="group">
							<button type="button" class="btn btn-sm btn-default pd-preset-btn" data-preset="1">
								${this.t("preset_1_each")}
							</button>
							<button type="button" class="btn btn-sm btn-default pd-preset-btn" data-preset="stock">
								${this.t("preset_stock")}
							</button>
							<button type="button" class="btn btn-sm btn-default pd-preset-btn" data-preset="0">
								${this.t("preset_clear")}
							</button>
						</div>
						<div class="pd-fixed-qty-wrap">
							<input type="number" min="1" max="999" value="2" class="form-control input-sm pd-fixed-input" id="pd-fixed-val">
							<button type="button" class="btn btn-sm btn-default" id="pd-btn-apply-fixed">
								${this.t("apply")}
							</button>
						</div>
					</div>
				</div>

				${color_tabs_html}

				<div class="pd-print-table-container">
					<table class="table table-bordered table-hover pd-print-matrix-table">
						<thead>
							<tr>
								<th style="width: 40px; text-align: center;">
									<input type="checkbox" id="pd-print-check-all" checked>
								</th>
								${has_colors ? `<th>${this.t("color")}</th>` : ''}
								<th>${this.t("size")}</th>
								<th>${this.t("short_code")}</th>
								<th>${this.t("barcode")}</th>
								<th class="text-right">${this.t("price")}</th>
								<th class="text-right">${this.t("left")}</th>
								<th style="width: 150px; text-align: center;">${this.t("qty_to_print")}</th>
							</tr>
						</thead>
						<tbody id="pd-print-tbody">
						</tbody>
					</table>
				</div>

				<div class="pd-print-summary-bar">
					<div class="pd-print-summary-text">
						<span class="pd-summary-selected-count">0</span> ${this.t("selected_variants")} &nbsp;|&nbsp;
						<strong><span class="pd-summary-total-labels">0</span> ${this.t("pcs")}</strong> ${this.t("total_labels_count")}
					</div>
				</div>
			</div>
		`);

		const renderTableRows = () => {
			const filtered = active_color === "all" ? all_variants : all_variants.filter((v) => v.color === active_color);
			const tbody = $wrapper.find("#pd-print-tbody");

			const rowsHtml = filtered.map((v) => {
				const hasPromo = v.discount && v.discount.has_discount;
				const priceHtml = hasPromo
					? `<del class="text-muted" style="font-size: 11px;">${flt(v.selling_price).toFixed(2)}</del> <strong style="color: #ef4444;">${flt(v.promo_price).toFixed(2)}</strong> <span class="indicator-pill red" style="font-size: 10px; padding: 1px 4px; margin-left: 2px;">-${v.discount_pct}%</span>`
					: flt(v.selling_price).toFixed(2);

				return `
					<tr class="${v.selected ? 'is-selected' : ''}" data-item-code="${frappe.utils.escape_html(v.item_code)}">
						<td style="text-align: center;">
							<input type="checkbox" class="pd-row-check" data-item-code="${frappe.utils.escape_html(v.item_code)}" ${v.selected ? 'checked' : ''}>
						</td>
						${has_colors ? `<td><span class="indicator-pill gray" style="font-size: 11px;">${frappe.utils.escape_html(v.color || "-")}</span></td>` : ''}
						<td><b>${frappe.utils.escape_html(v.size)}</b></td>
						<td class="text-muted font-monospace">${frappe.utils.escape_html(v.short_code || "-")}</td>
						<td class="font-monospace" style="color: #1e293b;">${frappe.utils.escape_html(v.barcode)}</td>
						<td class="text-right">${priceHtml}</td>
						<td class="text-right pd-num">${v.stock_qty}</td>
						<td style="text-align: center;">
							<div class="pd-stepper-wrap">
								<button type="button" class="btn btn-default btn-xs pd-step-btn pd-step-down" data-item-code="${frappe.utils.escape_html(v.item_code)}">-</button>
								<input type="number" min="0" max="9999" class="form-control input-xs pd-print-qty-input" data-item-code="${frappe.utils.escape_html(v.item_code)}" value="${v.print_qty}">
								<button type="button" class="btn btn-default btn-xs pd-step-btn pd-step-up" data-item-code="${frappe.utils.escape_html(v.item_code)}">+</button>
							</div>
						</td>
					</tr>
				`;
			}).join("");

			tbody.html(rowsHtml);
			updateTotals();
		};

		const updateTotals = () => {
			let selCount = 0;
			let totalLabels = 0;
			all_variants.forEach((v) => {
				if (v.selected && v.print_qty > 0) {
					selCount += 1;
					totalLabels += v.print_qty;
				}
			});

			$wrapper.find(".pd-summary-selected-count").text(selCount);
			$wrapper.find(".pd-summary-total-labels").text(totalLabels);

			const actionBtn = dialog.get_primary_btn();
			if (actionBtn && actionBtn.length) {
				actionBtn.text(`${this.t("print_action")} (${totalLabels} ${this.t("pcs")})`);
				actionBtn.prop("disabled", totalLabels === 0);
			}

			// Update check-all checkbox state for visible items
			const visible = active_color === "all" ? all_variants : all_variants.filter((v) => v.color === active_color);
			const allChecked = visible.length > 0 && visible.every((v) => v.selected && v.print_qty > 0);
			$wrapper.find("#pd-print-check-all").prop("checked", allChecked);
		};

		// Format selection
		$wrapper.find(".pd-format-btn").on("click", function () {
			$wrapper.find(".pd-format-btn").removeClass("active");
			$(this).addClass("active");
			selected_format = $(this).data("format");
		});

		// Color tabs
		$wrapper.find(".pd-color-tab").on("click", function () {
			$wrapper.find(".pd-color-tab").removeClass("active");
			$(this).addClass("active");
			active_color = $(this).data("color");
			renderTableRows();
		});

		// Presets
		$wrapper.find(".pd-preset-btn").on("click", function () {
			const preset = $(this).data("preset");
			const target_variants = active_color === "all" ? all_variants : all_variants.filter((v) => v.color === active_color);

			target_variants.forEach((v) => {
				if (preset === "1") {
					v.print_qty = 1;
					v.selected = true;
				} else if (preset === "stock") {
					v.print_qty = Math.round(v.stock_qty);
					v.selected = v.print_qty > 0;
				} else if (preset === "0") {
					v.print_qty = 0;
					v.selected = false;
				}
			});
			renderTableRows();
		});

		// Apply fixed qty
		$wrapper.find("#pd-btn-apply-fixed").on("click", function () {
			const val = Math.max(0, parseInt($wrapper.find("#pd-fixed-val").val() || 1, 10));
			const target_variants = active_color === "all" ? all_variants : all_variants.filter((v) => v.color === active_color);
			target_variants.forEach((v) => {
				v.print_qty = val;
				v.selected = val > 0;
			});
			renderTableRows();
		});

		// Check all
		$wrapper.find("#pd-print-check-all").on("change", function () {
			const checked = $(this).is(":checked");
			const target_variants = active_color === "all" ? all_variants : all_variants.filter((v) => v.color === active_color);
			target_variants.forEach((v) => {
				v.selected = checked;
				if (checked && v.print_qty === 0) {
					v.print_qty = 1;
				} else if (!checked) {
					v.print_qty = 0;
				}
			});
			renderTableRows();
		});

		// Row events (delegated)
		$wrapper.on("change", ".pd-row-check", function () {
			const code = $(this).data("item-code");
			const v = all_variants.find((x) => x.item_code === code);
			if (v) {
				v.selected = $(this).is(":checked");
				if (v.selected && v.print_qty === 0) {
					v.print_qty = 1;
				} else if (!v.selected) {
					v.print_qty = 0;
				}
				renderTableRows();
			}
		});

		$wrapper.on("click", ".pd-step-down", function () {
			const code = $(this).data("item-code");
			const v = all_variants.find((x) => x.item_code === code);
			if (v && v.print_qty > 0) {
				v.print_qty -= 1;
				if (v.print_qty === 0) v.selected = false;
				renderTableRows();
			}
		});

		$wrapper.on("click", ".pd-step-up", function () {
			const code = $(this).data("item-code");
			const v = all_variants.find((x) => x.item_code === code);
			if (v) {
				v.print_qty += 1;
				v.selected = true;
				renderTableRows();
			}
		});

		$wrapper.on("input change", ".pd-print-qty-input", function () {
			const code = $(this).data("item-code");
			const v = all_variants.find((x) => x.item_code === code);
			if (v) {
				const qty = Math.max(0, parseInt($(this).val() || 0, 10));
				v.print_qty = qty;
				v.selected = qty > 0;
				const $row = $(this).closest("tr");
				$row.find(".pd-row-check").prop("checked", v.selected);
				$row.toggleClass("is-selected", v.selected);
				updateTotals();
			}
		});

		renderTableRows();
		dialog.show();
	}

	print_labels(items, format) {
		const company = this.data.company_name || "Radolfa";
		const cur = this.data.currency || "TJS";
		const today = frappe.datetime.nowdate();

		let labels_html = "";
		items.forEach((item, idx) => {
			const itemTitle = item.item_name || this.data.item_name;
			const colorSize = [item.color, item.size].filter(Boolean).join(" / ");
			const fullTitle = colorSize && !itemTitle.includes(item.size) ? `${itemTitle} (${colorSize})` : itemTitle;
			const displayArt = item.short_code || item.item_code;

			if (format === "sale") {
				labels_html += `
				<div class="label-page">
					<div class="sale-border">
						<div class="sale-badge">СКИДКА / АКЦИЯ</div>
						<div class="sale-title">${frappe.utils.escape_html(fullTitle)}</div>
						<div class="sale-middle">
							<div class="sale-barcode-col">
								<svg id="bc-${idx}"></svg>
								<div class="sale-art">Арт: <b>${frappe.utils.escape_html(displayArt)}</b></div>
							</div>
							<div class="sale-prices-col">
								<div class="sale-old-row">
									<span class="old-price-strike">${flt(item.old_price).toFixed(2)}</span>
									<span class="sale-pct-badge">-${item.discount_pct}%</span>
								</div>
								<div class="new-price-val">${flt(item.selling_price).toFixed(2)}</div>
								${item.size ? `<div class="sale-size">Разм: <b>${frappe.utils.escape_html(item.size)}</b></div>` : ""}
							</div>
						</div>
						<div class="sale-footer">
							<div>${frappe.utils.escape_html(company)}</div>
							<div>${today}</div>
						</div>
					</div>
				</div>`;
			} else {
				labels_html += `
				<div class="label-page">
					<div class="label-border">
						<div class="label-company">${frappe.utils.escape_html(company)}</div>
						<div class="label-title">${frappe.utils.escape_html(fullTitle)}</div>
						<div class="label-barcode">
							<svg id="bc-${idx}"></svg>
						</div>
						<div class="label-bottom">
							<div class="label-meta">
								<div>Арт: <b>${frappe.utils.escape_html(displayArt)}</b></div>
								${item.size ? `<div>Разм: <b>${frappe.utils.escape_html(item.size)}</b></div>` : `<div>Ед: <b>${frappe.utils.escape_html(item.stock_uom)}</b></div>`}
							</div>
							<div class="label-price-block">
								<span class="label-price-val">${flt(item.selling_price).toFixed(2)}</span>
							</div>
						</div>
					</div>
				</div>`;
			}
		});

		const full_html = `
		<!DOCTYPE html>
		<html>
		<head>
			<meta charset="utf-8">
			<title>${frappe.utils.escape_html(this.data.item_name)} - Печать ценников</title>
			<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
			<style>
				@page {
					size: 58mm 40mm;
					margin: 0;
				}
				@media print {
					html, body {
						margin: 0 !important;
						padding: 0 !important;
						width: 58mm;
						height: 40mm;
						background: #fff;
					}
					.label-page {
						page-break-after: always;
						break-after: page;
						margin: 0 !important;
					}
				}
				@media screen {
					body {
						background: #64748b;
						padding: 20px;
						display: flex;
						flex-direction: column;
						align-items: center;
						gap: 15px;
						font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
					}
					.label-page {
						box-shadow: 0 4px 6px -1px rgba(0,0,0,0.2), 0 2px 4px -2px rgba(0,0,0,0.2);
					}
				}
				* {
					box-sizing: border-box;
				}
				.label-page {
					width: 58mm;
					height: 40mm;
					padding: 1.5mm 2mm 1mm 2mm;
					background: #fff;
					overflow: hidden;
					font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
					color: #000;
					display: flex;
					flex-direction: column;
					justify-content: space-between;
				}
				/* Standard 58x40 */
				.label-border {
					border: 1px solid #000;
					border-radius: 1.5mm;
					height: 100%;
					padding: 1mm 1.5mm;
					display: flex;
					flex-direction: column;
					justify-content: space-between;
				}
				.label-company {
					font-size: 6.5pt;
					font-weight: 700;
					text-align: center;
					text-transform: uppercase;
					letter-spacing: 0.3px;
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					border-bottom: 0.5px solid #000;
					padding-bottom: 0.5mm;
				}
				.label-title {
					font-size: 8pt;
					font-weight: 700;
					line-height: 1.15;
					text-align: center;
					max-height: 7.5mm;
					overflow: hidden;
					display: -webkit-box;
					-webkit-line-clamp: 2;
					-webkit-box-orient: vertical;
					margin: 0.5mm 0;
				}
				.label-barcode {
					text-align: center;
					display: flex;
					justify-content: center;
					align-items: center;
					margin: 0 auto;
				}
				.label-barcode svg {
					width: 44mm;
					height: 11mm;
				}
				.label-bottom {
					display: flex;
					justify-content: space-between;
					align-items: flex-end;
					border-top: 0.5px solid #000;
					padding-top: 0.5mm;
				}
				.label-meta {
					font-size: 6.5pt;
					line-height: 1.2;
					text-align: left;
				}
				.label-price-block {
					text-align: right;
				}
				.label-price-val {
					font-size: 13pt;
					font-weight: 900;
					line-height: 1;
				}
				/* Sale 58x40 */
				.sale-border {
					border: 1.5px solid #000;
					border-radius: 1.5mm;
					height: 100%;
					padding: 1mm 1.5mm;
					display: flex;
					flex-direction: column;
					justify-content: space-between;
				}
				.sale-badge {
					background: #000;
					color: #fff;
					font-size: 7pt;
					font-weight: 900;
					text-align: center;
					letter-spacing: 1px;
					padding: 0.6mm 0;
					border-radius: 0.8mm;
					margin-bottom: 0.5mm;
				}
				.sale-title {
					font-size: 8pt;
					font-weight: 700;
					line-height: 1.15;
					text-align: center;
					max-height: 6.8mm;
					overflow: hidden;
					display: -webkit-box;
					-webkit-line-clamp: 2;
					-webkit-box-orient: vertical;
				}
				.sale-middle {
					display: flex;
					justify-content: space-between;
					align-items: center;
					margin: 0.5mm 0;
				}
				.sale-barcode-col {
					width: 29mm;
					text-align: center;
				}
				.sale-barcode-col svg {
					width: 28mm;
					height: 11.5mm;
				}
				.sale-art {
					font-size: 6pt;
					margin-top: 0.5mm;
				}
				.sale-prices-col {
					width: 25mm;
					text-align: right;
				}
				.sale-old-row {
					display: flex;
					align-items: center;
					justify-content: flex-end;
					gap: 3px;
					line-height: 1;
				}
				.old-price-strike {
					font-size: 7.5pt;
					color: #475569;
					text-decoration: line-through;
					font-weight: 600;
					line-height: 1;
				}
				.sale-pct-badge {
					font-size: 6.5pt;
					font-weight: 900;
					background: #000;
					color: #fff;
					padding: 0.5px 3px;
					border-radius: 2px;
					line-height: 1.1;
				}
				.new-price-val {
					font-size: 14pt;
					font-weight: 900;
					color: #000;
					line-height: 1;
					margin-top: 0.8mm;
				}
				.sale-size {
					font-size: 6.5pt;
					font-weight: 700;
					margin-top: 0.5mm;
				}
				.sale-footer {
					display: flex;
					justify-content: space-between;
					font-size: 6pt;
					font-weight: 600;
					border-top: 0.5px solid #000;
					padding-top: 0.5mm;
				}
			</style>
		</head>
		<body>
			${labels_html}
			<script>
				var raw_items = ${JSON.stringify(items.map((it) => it.barcode || it.short_code || it.item_code))};
				
				function renderBarcodes() {
					raw_items.forEach(function(code, idx) {
						var raw = String(code || "").trim();
						var elem = "#bc-" + idx;
						var format = "CODE128";
						if (/^\\d{12,13}$/.test(raw)) {
							format = "EAN13";
						} else if (/^\\d{7,8}$/.test(raw)) {
							format = "EAN8";
						}
						try {
							JsBarcode(elem, raw, {
								format: format,
								width: 1.35,
								height: 38,
								displayValue: true,
								fontSize: 10,
								textMargin: 1,
								margin: 0
							});
						} catch(e) {
							try {
								JsBarcode(elem, raw, {
									format: "CODE128",
									width: 1.25,
									height: 38,
									displayValue: true,
									fontSize: 10,
									margin: 0
								});
							} catch(e2) {
								console.error("Barcode rendering error:", e2);
							}
						}
					});
				}

				window.onload = function() {
					renderBarcodes();
					setTimeout(function() {
						window.print();
					}, 400);
				};
			<\/script>
		</body>
		</html>`;

		const print_win = window.open("", "_blank");
		if (print_win) {
			print_win.document.open();
			print_win.document.write(full_html);
			print_win.document.close();
		} else {
			let $iframe = $("#pd-hidden-print-frame");
			if (!$iframe.length) {
				$iframe = $('<iframe id="pd-hidden-print-frame" style="display:none;width:0;height:0;border:0;"></iframe>').appendTo("body");
			}
			const doc = $iframe[0].contentDocument || $iframe[0].contentWindow.document;
			doc.open();
			doc.write(full_html);
			doc.close();
		}
	}
}

