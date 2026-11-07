// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["product-catalog"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: frappe.boot.user.language === "tg" ? "Каталоги молҳо" : "Каталог товаров",
		single_column: true,
	});
	wrapper.product_catalog_app = new ProductCatalogApp(page);
};
frappe.pages["product-catalog"].on_page_show = function (wrapper) {
	if (wrapper.product_catalog_app?.has_loaded) wrapper.product_catalog_app.load_catalog();
};

class ProductCatalogApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body).addClass("product-catalog-page");
		this.lang = frappe.boot.user.language === "tg" ? 1 : 0;
		this.filters = this.defaults();
		this.current_page = 1;
		this.page_size = 20;
		this.request_id = 0;
		this.extra_columns = new Set();
		this.setup_actions();
		this.setup_ui();
		this.load_catalog();
	}
	defaults() {
		return {
			search: "",
			item_group: "All",
			status_filter: "all",
			sort_by: "modified",
			period: "month",
			warehouse: "",
		};
	}
	t(key) {
		const labels = {
			new_product: ["Новый товар", "Моли нав"],
			refresh: ["Обновить", "Навсозӣ"],
			suppliers: ["Поставщики", "Таъминкунандагон"],
			expenses: ["Расходы", "Хароҷотҳо"],
			staff: ["Сотрудники", "Кормандон"],
			search: ["Название, код или штрихкод", "Ном, рамз ё штрихкод"],
			search_label: ["Поиск товара", "Ҷустуҷӯи мол"],
			period: ["Период продаж", "Давраи фурӯш"],
			month: ["Этот месяц", "Ин моҳ"],
			today: ["Сегодня", "Имрӯз"],
			"7d": ["7 дней", "7 рӯз"],
			"30d": ["30 дней", "30 рӯз"],
			all: ["Всё время", "Ҳамаи давра"],
			warehouse: ["Склад", "Анбор"],
			all_warehouses: ["Все склады", "Ҳамаи анборҳо"],
			category: ["Категория", "Гурӯҳ"],
			all_categories: ["Все категории", "Ҳамаи гурӯҳҳо"],
			status: ["Наличие", "Мавҷудият"],
			all_statuses: ["Все товары", "Ҳамаи молҳо"],
			in_stock: ["В наличии", "Дар анбор"],
			low_stock: ["Требуют внимания", "Диққат лозим аст"],
			out_of_stock: ["Нет в наличии", "Тамом шуд"],
			on_sale: ["Со скидкой", "Бо тахфиф"],
			sort: ["Сортировка", "Тартиб"],
			modified: ["Последние изменения", "Тағйироти охирин"],
			name_asc: ["Название: А–Я", "Ном: А–Я"],
			stock_desc: ["Больше остатков", "Бақияи бештар"],
			stock_val_desc: ["Выше стоимость остатка", "Арзиши бештари бақия"],
			sold_desc: ["Больше продаж", "Фурӯши бештар"],
			products: ["Товары", "Молҳо"],
			inventory_value: ["Стоимость остатка", "Арзиши бақия"],
			attention: ["Требуют внимания", "Диққат лозим аст"],
			out: ["Нет в наличии", "Тамом шуд"],
			all_results: ["По всем найденным товарам", "Барои ҳамаи молҳои ёфтшуда"],
			current_valuation: ["Текущая учётная стоимость", "Арзиши ҷории баҳисобгирӣ"],
			attention_hint: ["Мало товара или отдельных вариантов", "Мол ё баъзе намудҳо каманд"],
			out_hint: ["Общий остаток ≤ 0", "Бақияи умумӣ ≤ 0"],
			product: ["Товар", "Мол"],
			stock: ["В наличии сейчас", "Ҳоло дар анбор"],
			sold: ["Продано, нетто", "Фурӯши холис"],
			profit: ["Валовая прибыль", "Фоидаи умумӣ"],
			price: ["Цена продажи", "Нархи фурӯш"],
			cost: ["Цена закупки", "Нархи харид"],
			revenue: ["Выручка", "Даромад"],
			columns: ["Столбцы", "Сутунҳо"],
			apply: ["Применить", "Татбиқ"],
			variants: ["вариантов", "намуд"],
			from: ["от", "аз"],
			pcs: ["шт.", "дона"],
			variants_out: ["вариантов нет в наличии", "намуд тамом шуд"],
			variants_low: ["вариантов мало", "намуд кам монд"],
			returned: ["Возвращено", "Баргардонида шуд"],
			no_sales_access: ["Нет доступа к продажам", "Дастрасӣ ба фурӯш нест"],
			no_price: ["Цена не задана в валюте компании", "Нарх бо асъори ширкат муайян нашудааст"],
			empty: ["Товары не найдены", "Молҳо ёфт нашуданд"],
			empty_hint: ["Измените поиск или фильтры.", "Ҷустуҷӯ ё филтрҳоро тағйир диҳед."],
			reset: ["Сбросить фильтры", "Тоза кардани филтрҳо"],
			retry: ["Повторить", "Такрор"],
			load_error: ["Не удалось загрузить каталог", "Каталог бор нашуд"],
			loading: ["Загрузка…", "Бор шуда истодааст…"],
			previous: ["Назад", "Қафо"],
			next: ["Далее", "Пеш"],
			of: ["из", "аз"],
			per_page: ["На странице", "Дар саҳифа"],
			scope_note: [
				"Остатки и стоимость — сейчас. Продажи, выручка и прибыль — за выбранный период, с учётом возвратов, без отменённых счетов и налогов.",
				"Бақия ва арзиш — ҷорӣ. Фурӯш, даромад ва фоида — барои давраи интихобшуда, бо баргардониҳо, бе ҳисобҳои бекоршуда ва андозҳо.",
			],
		};
		return labels[key]?.[this.lang] || key;
	}
	esc(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}
	num(value) {
		return format_number(value, null, Number.isInteger(flt(value)) ? 0 : 2);
	}
	money(value) {
		return value === null || value === undefined ? "—" : format_currency(value, this.data.currency);
	}
	setup_actions() {
		this.page.set_primary_action(
			this.t("new_product"),
			() => frappe.new_doc("Quick Product Intake"),
			"add"
		);
		this.page.set_secondary_action(this.t("refresh"), () => this.load_catalog());
		this.page.add_inner_button(this.t("columns"), () => this.choose_columns());
		for (const [label, route] of [
			["suppliers", "supplier-hub"],
			["expenses", "expense-desk"],
			["staff", "staff-hub"],
		])
			this.page.add_menu_item(this.t(label), () => frappe.set_route(route));
	}
	select(key, label, options) {
		return `<label class="pc-filter">${this.t(
			label
		)}<select class="form-control" data-filter="${key}">${options
			.map(([v, title]) => `<option value="${this.esc(v)}">${this.esc(title)}</option>`)
			.join("")}</select></label>`;
	}
	setup_ui() {
		this.wrapper.html(`<div class="pc-workspace">
			<div class="pc-toolbar"><div class="pc-search"><label class="sr-only" for="pc-search">${this.t(
				"search_label"
			)}</label><input id="pc-search" class="form-control" type="search" placeholder="${this.t(
			"search"
		)}" autocomplete="off"></div><button class="btn btn-default btn-sm pc-reset">${this.t(
			"reset"
		)}</button></div>
			<div class="pc-filters">
			${this.select(
				"period",
				"period",
				["month", "today", "7d", "30d", "all"].map((k) => [k, this.t(k)])
			)}
			${this.select("warehouse", "warehouse", [["", this.t("all_warehouses")]])}
			${this.select("item_group", "category", [["All", this.t("all_categories")]])}
			${this.select("status_filter", "status", [
				["all", this.t("all_statuses")],
				...["in_stock", "low_stock", "out_of_stock", "on_sale"].map((k) => [k, this.t(k)]),
			])}
			${this.select(
				"sort_by",
				"sort",
				["modified", "name_asc", "stock_desc", "stock_val_desc", "sold_desc"].map((k) => [
					k,
					this.t(k),
				])
			)}</div>
			<div class="pc-results" aria-busy="true"><div class="pc-summary"></div><p class="pc-scope-note text-muted"></p><div class="pc-table-area"></div><div class="pc-pagination"></div></div><div class="pc-status" role="status" aria-live="polite"></div></div>`);
		this.wrapper.find("[data-filter]").on("change", (e) => {
			this.filters[e.target.dataset.filter] = e.target.value;
			this.current_page = 1;
			this.load_catalog();
		});
		this.wrapper.find("#pc-search").on("input", (e) => {
			++this.request_id;
			this.filters.search = e.target.value;
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.current_page = 1;
				this.load_catalog();
			}, 300);
		});
		this.wrapper.on("click", ".pc-reset", () => {
			this.filters = this.defaults();
			this.current_page = 1;
			this.wrapper.find("#pc-search").val("");
			this.wrapper.find("[data-filter]").each((i, el) => $(el).val(this.filters[el.dataset.filter]));
			this.load_catalog();
		});
		this.wrapper.on("click", ".pc-prev, .pc-next", (e) => {
			this.current_page += $(e.currentTarget).hasClass("pc-prev") ? -1 : 1;
			this.load_catalog();
		});
		this.wrapper.on("change", ".pc-page-size", (e) => {
			this.page_size = Number(e.target.value);
			this.current_page = 1;
			this.load_catalog();
		});
		this.wrapper.on("click", ".pc-product-link", (e) => {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			frappe.route_options = {
				catalog_period: this.filters.period,
				catalog_warehouse: this.filters.warehouse,
			};
			frappe.set_route("product-detail", e.currentTarget.dataset.code);
		});
	}
	load_catalog() {
		clearTimeout(this.search_timer);
		const request = ++this.request_id;
		this.wrapper.find(".pc-results").attr("aria-busy", "true").addClass("pc-loading");
		this.wrapper.find(".pc-status").text(this.t("loading")).show();
		frappe.call({
			method: "erpnext.stock.page.product_catalog.product_catalog.get_catalog",
			args: { ...this.filters, page: this.current_page, page_size: this.page_size },
			callback: (r) => {
				if (request !== this.request_id) return;
				if (!r.message) {
					this.show_error();
					return;
				}
				this.data = r.message;
				this.has_loaded = true;
				this.current_page = this.data.page;
				this.page_size = this.data.page_size;
				this.fill_options("item_group", this.data.categories, "All", "all_categories");
				this.fill_options("warehouse", this.data.warehouses, "", "all_warehouses");
				this.render();
				this.wrapper.find(".pc-results").attr("aria-busy", "false").removeClass("pc-loading").show();
				this.wrapper.find(".pc-status").hide();
			},
			error: () => {
				if (request === this.request_id) this.show_error();
			},
		});
	}
	show_error() {
		this.wrapper.find(".pc-results").hide().attr("aria-busy", "false").removeClass("pc-loading");
		this.wrapper
			.find(".pc-status")
			.empty()
			.append($("<p>").text(this.t("load_error")))
			.append(
				$("<button class='btn btn-default btn-sm'>")
					.text(this.t("retry"))
					.on("click", () => this.load_catalog())
			)
			.show();
	}
	fill_options(key, values, empty, label) {
		const select = this.wrapper.find(`[data-filter="${key}"]`).empty();
		select.append($("<option>").val(empty).text(this.t(label)));
		values.forEach((v) => select.append($("<option>").val(v).text(v)));
		select.val(this.filters[key]);
	}
	choose_columns() {
		const dialog = new frappe.ui.Dialog({
			title: this.t("columns"),
			fields: ["cost", "revenue"].map((k) => ({
				fieldname: k,
				fieldtype: "Check",
				label: this.t(k),
				default: this.extra_columns.has(k) ? 1 : 0,
			})),
			primary_action_label: this.t("apply"),
			primary_action: (values) => {
				this.extra_columns = new Set(["cost", "revenue"].filter((k) => values[k]));
				dialog.hide();
				if (this.data) this.render_table();
			},
		});
		dialog.show();
	}
	render() {
		const s = this.data.summary;
		this.wrapper.find(".pc-summary").html(
			[
				["products", this.num(s.products), "all_results"],
				["inventory_value", this.money(s.stock_value), "current_valuation"],
				["attention", this.num(s.attention), "attention_hint"],
				["out", this.num(s.out_of_stock), "out_hint"],
			]
				.map(
					([k, v, hint]) =>
						`<div class="pc-summary-item"><div class="text-muted">${this.t(
							k
						)}</div><div class="pc-summary-value">${v}</div><small class="text-muted">${this.t(
							hint
						)}</small></div>`
				)
				.join("")
		);
		const dates = this.data.from_date
			? `${frappe.datetime.str_to_user(this.data.from_date)} – ${frappe.datetime.str_to_user(
					this.data.to_date
			  )}`
			: this.t("all");
		const missing_cost = this.data.can_read_sales && this.data.items.some((item) => item.gross_profit === null);
		const cost_note = missing_cost ? (this.lang ? "Арзиши таърихӣ нест ё дастрасӣ маҳдуд аст." : "Историческая себестоимость отсутствует или недоступна.") : "";
		this.wrapper.find(".pc-scope-note").text(`${dates}. ${this.t("scope_note")} ${cost_note}`);
		this.render_table();
		this.render_pagination();
	}
	render_table() {
		const d = this.data;
		if (!d.items.length) {
			this.wrapper
				.find(".pc-table-area")
				.html(
					`<div class="pc-empty"><h4>${this.t("empty")}</h4><p class="text-muted">${this.t(
						"empty_hint"
					)}</p><button class="btn btn-default btn-sm pc-reset">${this.t("reset")}</button></div>`
				);
			return;
		}
		const columns = [
			"product",
			"stock",
			"sold",
			"profit",
			"inventory_value",
			"price",
			...this.extra_columns,
		];
		this.wrapper
			.find(".pc-table-area")
			.html(
				`<div class="pc-table-scroll"><table class="table pc-table"><thead><tr>${columns
					.map(
						(k) =>
							`<th scope="col" class="pc-col-${k} ${
								k === "product" ? "" : "text-right"
							}">${this.t(k)}</th>`
					)
					.join("")}</tr></thead><tbody>${d.items
					.map(
						(p) =>
							`<tr>${columns
								.map(
									(k) =>
										`<td class="pc-col-${k} ${
											k === "product" ? "" : "text-right"
										}">${this.cell(k, p)}</td>`
								)
								.join("")}</tr>`
					)
					.join("")}</tbody></table></div>`
			);
		this.wrapper.find(".pc-thumbnail").on("error", function () {
			$(this).hide().siblings(".pc-abbr").show();
		});
	}
	cell(key, p) {
		if (key === "product") {
			const abbr = this.esc(frappe.get_abbr(p.item_name));
			const image = p.image
				? `<img class="pc-thumbnail" src="${this.esc(
						p.image
				  )}" alt="" loading="lazy"><span class="pc-abbr" style="display:none">${abbr}</span>`
				: `<span class="pc-abbr">${abbr}</span>`;
			return `<div class="pc-product"><div class="pc-photo">${image}</div><div class="pc-product-info"><a class="pc-product-link" href="/app/product-detail/${encodeURIComponent(
				p.item_code
			)}" data-code="${this.esc(p.item_code)}">${this.esc(
				p.item_name
			)}</a><div class="pc-product-meta text-muted">${this.esc(
				p.custom_short_code || p.item_code
			)} · ${this.esc(p.item_group)}</div>${
				p.variant_count
					? `<small class="text-muted">${p.variant_count} ${this.t("variants")}</small>`
					: ""
			}</div></div>`;
		}
		if (key === "stock") {
			const status = p.stock_qty <= 0 ? "out_of_stock" : p.needs_attention ? "low_stock" : "in_stock";
			const details = [
				p.out_variant_count ? `${p.out_variant_count} ${this.t("variants_out")}` : "",
				p.low_variant_count ? `${p.low_variant_count} ${this.t("variants_low")}` : "",
			].filter(Boolean);
			return `<div class="pc-stock-number"><span class="pc-stock-dot pc-stock-${status}" aria-hidden="true"></span>${this.num(
				p.stock_qty
			)} <small class="text-muted">${this.esc(
				p.stock_uom === "Nos" ? this.t("pcs") : p.stock_uom
			)}</small></div><small class="pc-stock-description ${
				status === "in_stock" ? "text-muted" : "pc-warning"
			}">${details.length ? details.join(" · ") : this.t(status)}</small>`;
		}
		if (["sold", "profit", "revenue"].includes(key) && !this.data.can_read_sales)
			return `<span class="text-muted" title="${this.t("no_sales_access")}">—</span>`;
		if (key === "sold")
			return `${this.num(p.sold_qty)}${
				p.returned_qty
					? `<small class="text-muted pc-cell-note">${this.t("returned")}: ${this.num(
							p.returned_qty
					  )}</small>`
					: ""
			}`;
		if (key === "profit")
			return `<span class="${p.gross_profit < 0 ? "text-danger" : ""}">${this.money(
				p.gross_profit
			)}</span>`;
		if (key === "inventory_value") return this.money(p.stock_value_cost);
		if (key === "revenue") return this.money(p.sold_amount);
		const value = key === "cost" ? p.buying_price : p.discounted_price;
		if (value == null) return `<span class="text-muted" title="${this.t("no_price")}">—</span>`;
		return `${
			key === "price" && p.price_varies ? `<small class="text-muted">${this.t("from")} </small>` : ""
		}${this.money(value)}`;
	}
	render_pagination() {
		const d = this.data,
			first = d.total ? (d.page - 1) * d.page_size + 1 : 0,
			last = Math.min(d.page * d.page_size, d.total),
			pages = Math.max(1, Math.ceil(d.total / d.page_size));
		this.wrapper
			.find(".pc-pagination")
			.html(
				`<label>${this.t("per_page")}<select class="form-control pc-page-size">${[20, 50, 100, 500]
					.map((n) => `<option value="${n}" ${n === d.page_size ? "selected" : ""}>${n}</option>`)
					.join(
						""
					)}</select></label><div class="pc-page-navigation"><span class="text-muted">${this.num(
					first
				)}–${this.num(last)} ${this.t("of")} ${this.num(
					d.total
				)}</span><button class="btn btn-default btn-sm pc-prev" ${
					d.page <= 1 ? "disabled" : ""
				} aria-label="${this.t("previous")}">‹</button><span class="text-muted">${
					d.page
				} / ${pages}</span><button class="btn btn-default btn-sm pc-next" ${
					d.page >= pages ? "disabled" : ""
				} aria-label="${this.t("next")}">›</button></div>`
			);
	}
}
