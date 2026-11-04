// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["supplier-hub"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: frappe.boot.user.language === "tg" ? "Таъминкунандагон" : "Поставщики",
		single_column: true,
	});
	wrapper.supplier_hub_app = new SupplierHubApp(page);
};
frappe.pages["supplier-hub"].on_page_show = function (wrapper) {
	if (wrapper.supplier_hub_app?.has_loaded) wrapper.supplier_hub_app.load_data(true);
};

class SupplierHubApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body).addClass("supplier-hub-page");
		this.lang = frappe.boot.user.language === "tg" ? 1 : 0;
		this.filters = this.defaults();
		this.current_page = 1;
		this.page_size = 20;
		this.request_id = 0;
		this.extra_columns = new Set();
		this.setup_actions();
		this.setup_ui();
		this.load_data();
	}
	defaults() {
		return {
			search: "",
			supplier_group: "All",
			debt_filter: "all",
			period: "month",
			company: "",
			warehouse: "",
			stock_filter: "all",
			stock_qty: 0,
			sort_by: "debt_desc",
		};
	}
	t(key) {
		const labels = {
			new_supplier: ["Новый поставщик", "Таъминкунандаи нав"],
			refresh: ["Обновить", "Навсозӣ"],
			columns: ["Столбцы", "Сутунҳо"],
			products: ["Каталог товаров", "Каталоги молҳо"],
			expenses: ["Расходы", "Хароҷотҳо"],
			staff: ["Сотрудники", "Кормандон"],
			taxes: ["Налоги", "Андозҳо"],
			search: ["Название, телефон или email", "Ном, телефон ё почтаи электронӣ"],
			search_label: ["Поиск поставщика", "Ҷустуҷӯи таъминкунанда"],
			group: ["Группа", "Гурӯҳ"],
			all_groups: ["Все группы", "Ҳамаи гурӯҳҳо"],
			status: ["Оплата", "Пардохт"],
			all_statuses: ["Все поставщики", "Ҳамаи таъминкунандагон"],
			with_debt: ["Есть долг", "Қарз доранд"],
			overdue_status: ["Есть просрочка", "Қарзи муҳлатгузашта доранд"],
			settled: ["Без долга", "Бе қарз"],
			period: ["Период закупок", "Давраи харид"],
			month: ["Этот месяц", "Ин моҳ"],
			today: ["Сегодня", "Имрӯз"],
			"7d": ["7 дней", "7 рӯз"],
			"30d": ["30 дней", "30 рӯз"],
			all: ["Всё время", "Ҳамаи давра"],
			additional: ["Дополнительные фильтры", "Филтрҳои иловагӣ"],
			company: ["Компания", "Ширкат"],
			warehouse: ["Склад", "Анбор"],
			all_warehouses: ["Все доступные склады", "Ҳамаи анборҳои дастрас"],
			stock_filter: ["Остаток связанных товаров", "Бақияи молҳои алоқаманд"],
			all_stock: ["Любой остаток", "Ҳар гуна бақия"],
			zero: ["Нет в наличии", "Дар анбор нест"],
			gte: ["Не меньше", "На камтар аз"],
			lte: ["Не больше", "На бештар аз"],
			quantity: ["Количество в единице хранения", "Миқдор бо воҳиди нигоҳдорӣ"],
			quantity_note: [
				"Только товары с общей единицей хранения.",
				"Танҳо молҳо бо воҳиди якхелаи нигоҳдорӣ.",
			],
			sort: ["Сортировка", "Тартиб"],
			debt_desc: ["Больше долга", "Қарзи бештар"],
			overdue_desc: ["Больше просрочки", "Қарзи муҳлатгузаштаи бештар"],
			stock_val_desc: ["Выше стоимость остатка", "Арзиши бештари бақия"],
			purchased_desc: ["Больше закупок за период", "Хариди бештар дар давра"],
			last_purchase_desc: ["Последние закупки", "Харидҳои охирин"],
			name_asc: ["Название: А–Я", "Ном: А–Я"],
			reset: ["Сбросить фильтры", "Тоза кардани филтрҳо"],
			outstanding: ["Долг поставщикам", "Қарз ба таъминкунандагон"],
			overdue: ["Просрочено", "Муҳлатгузашта"],
			purchases: ["Закупки за период", "Харид дар давра"],
			stock_value: ["Стоимость остатка", "Арзиши бақия"],
			now: ["Сейчас", "Ҳоло"],
			overdue_hint: [
				"Неоплаченные суммы с истёкшим сроком",
				"Маблағҳои пардохтнашуда бо муҳлати гузашта",
			],
			purchase_hint: ["С налогами, за вычетом возвратов", "Бо андозҳо, бо тарҳи баргардониҳо"],
			stock_hint: ["Связанные товары, без повторного счёта", "Молҳои алоқаманд, бе ҳисоби такрорӣ"],
			scope_note: [
				"Долг, просрочка и остатки — сейчас. Период относится к закупкам и платежам. Все суммы — в валюте компании; отменённые документы исключены.",
				"Қарз, муҳлатгузашта ва бақияҳо — ҷорӣ. Давра ба харид ва пардохтҳо дахл дорад. Ҳамаи маблағҳо бо асъори ширкатанд; ҳуҷҷатҳои бекоршуда истисно шудаанд.",
			],
			shared_note: [
				"Один товар может быть связан с несколькими поставщиками. В строках показан его полный остаток, в общем итоге он учитывается один раз.",
				"Як мол метавонад бо чанд таъминкунанда алоқаманд бошад. Дар сатрҳо бақияи пурраи он нишон дода мешавад, дар ҷамъбаст як бор ҳисоб мешавад.",
			],
			credits: [
				"Неиспользованные авансы и кредиты",
				"Пешпардохтҳо ва маблағҳои кредитии истифоданашуда",
			],
			credits_hint: [
				"Пока не распределены, они не уменьшают долг по неоплаченным документам.",
				"То тақсим шудан қарзи ҳуҷҷатҳои пардохтнашударо кам намекунанд.",
			],
			matched: ["Найдено поставщиков", "Таъминкунанда ёфт шуд"],
			all_results: [
				"Итоги по всем найденным поставщикам",
				"Ҷамъбаст барои ҳамаи таъминкунандагони ёфтшуда",
			],
			supplier: ["Поставщик", "Таъминкунанда"],
			debt: ["Долг", "Қарз"],
			last_purchase: ["Последняя закупка", "Хариди охирин"],
			models_count: ["Моделей", "Моделҳо"],
			skus_count: ["Вариантов / SKU", "Намудҳо / SKU"],
			stock_qty: ["Остаток, количество", "Бақия, миқдор"],
			mixed_units: ["Разные единицы", "Воҳидҳои гуногун"],
			net_payments: ["Платежи за период, нетто", "Пардохт дар давра, холис"],
			payment_note: [
				"По Payment Entry: выплаты минус возврат денег; без зачётов и списаний.",
				"Аз Payment Entry: пардохтҳо бо тарҳи маблағҳои баргашта; бе ҳисоббаробаркунӣ ва азҳисоббарорӣ.",
			],
			total_purchased: ["Закупки за всё время", "Харид дар ҳамаи давра"],
			shared: ["Есть общие товары", "Молҳои муштарак дорад"],
			inactive: ["Отключён", "Ғайрифаъол"],
			no_access: ["Нет доступа", "Дастрасӣ нест"],
			loading: ["Загрузка поставщиков…", "Таъминкунандагон бор шуда истодаанд…"],
			load_error: ["Не удалось загрузить поставщиков", "Таъминкунандагон бор нашуданд"],
			retry: ["Повторить", "Такрор"],
			empty: ["Поставщики не найдены", "Таъминкунанда ёфт нашуд"],
			empty_hint: [
				"Измените поиск или сбросьте фильтры.",
				"Ҷустуҷӯро тағйир диҳед ё филтрҳоро тоза кунед.",
			],
			previous: ["Назад", "Қафо"],
			next: ["Далее", "Пеш"],
			of: ["из", "аз"],
			per_page: ["Строк на странице", "Сатрҳо дар саҳифа"],
			apply: ["Применить", "Татбиқ"],
		};
		return labels[key]?.[this.lang] || key;
	}
	esc(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}
	money(value) {
		return value == null
			? `<span class="text-muted" title="${this.t("no_access")}">—</span>`
			: format_currency(value, this.data.currency);
	}
	setup_actions() {
		this.page.set_secondary_action(this.t("refresh"), () => this.load_data(true));
		this.page.add_inner_button(this.t("columns"), () => this.choose_columns());
		for (const [label, route] of [
			["products", "product-catalog"],
			["expenses", "expense-desk"],
			["staff", "staff-hub"],
			["taxes", "tax-desk"],
		])
			this.page.add_menu_item(this.t(label), () => frappe.set_route(route));
	}
	select(key, label, options) {
		return `<label class="sh-filter">${this.t(
			label
		)}<select class="form-control" data-filter="${key}">${options
			.map(([v, text]) => `<option value="${this.esc(v)}">${this.esc(text)}</option>`)
			.join("")}</select></label>`;
	}
	setup_ui() {
		this.wrapper
			.html(`<div class="sh-workspace"><div class="sh-toolbar"><div class="sh-search"><label class="sr-only" for="sh-search">${this.t(
			"search_label"
		)}</label><input id="sh-search" class="form-control" type="search" autocomplete="off" placeholder="${this.t(
			"search"
		)}"></div><button class="btn btn-default btn-sm sh-reset">${this.t("reset")}</button></div>
			<div class="sh-filters">${this.select("supplier_group", "group", [
				["All", this.t("all_groups")],
			])}${this.select("debt_filter", "status", [
			["all", this.t("all_statuses")],
			...["with_debt", "overdue", "settled"].map((k) => [
				k,
				this.t(k === "overdue" ? "overdue_status" : k),
			]),
		])}${this.select(
			"period",
			"period",
			["month", "today", "7d", "30d", "all"].map((k) => [k, this.t(k)])
		)}</div>
			<details class="sh-advanced"><summary>${this.t(
				"additional"
			)}</summary><div class="sh-advanced-fields">${this.select("company", "company", [])}${this.select(
			"warehouse",
			"warehouse",
			[["", this.t("all_warehouses")]]
		)}${this.select("stock_filter", "stock_filter", [
			["all", this.t("all_stock")],
			...["zero", "gte", "lte"].map((k) => [k, this.t(k)]),
		])}<label class="sh-filter sh-quantity" hidden>${this.t(
			"quantity"
		)}<input type="number" class="form-control" data-filter="stock_qty" min="0" step="any" value="0"><small>${this.t(
			"quantity_note"
		)}</small></label>${this.select(
			"sort_by",
			"sort",
			[
				"debt_desc",
				"overdue_desc",
				"stock_val_desc",
				"purchased_desc",
				"last_purchase_desc",
				"name_asc",
			].map((k) => [k, this.t(k)])
		)}</div></details>
			<div class="sh-results" aria-busy="true"><div class="sh-summary"></div><p class="sh-scope text-muted"></p><div class="sh-notes text-muted"></div><div class="sh-list-heading"></div><div class="sh-table-area"></div><div class="sh-pagination"></div></div><div class="sh-status" role="status" aria-live="polite"></div></div>`);
		this.wrapper.find("[data-filter]").on("change", (e) => {
			this.filters[e.target.dataset.filter] = e.target.value;
			if (e.target.dataset.filter === "company") this.filters.warehouse = "";
			this.wrapper
				.find(".sh-quantity")
				.prop("hidden", !["gte", "lte"].includes(this.filters.stock_filter));
			this.current_page = 1;
			this.load_data();
		});
		this.wrapper.find("#sh-search").on("input", (e) => {
			++this.request_id;
			this.filters.search = e.target.value;
			this.set_loading();
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.current_page = 1;
				this.load_data();
			}, 300);
		});
		this.wrapper.on("click", ".sh-reset", () => {
			this.filters = this.defaults();
			this.current_page = 1;
			this.wrapper.find("#sh-search").val("");
			this.wrapper.find("[data-filter]").each((i, el) => $(el).val(this.filters[el.dataset.filter]));
			this.wrapper.find(".sh-quantity").prop("hidden", true);
			this.load_data();
		});
		this.wrapper.on("click", ".sh-prev, .sh-next", (e) => {
			this.current_page += $(e.currentTarget).hasClass("sh-prev") ? -1 : 1;
			this.load_data();
		});
		this.wrapper.on("change", ".sh-page-size", (e) => {
			this.page_size = Number(e.target.value);
			this.current_page = 1;
			this.load_data();
		});
		this.wrapper.on("click", ".sh-supplier-link", (e) => {
			if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
			e.preventDefault();
			frappe.route_options = { supplier_company: this.data.company };
			frappe.set_route("supplier-detail", e.currentTarget.dataset.supplier);
		});
	}
	set_loading() {
		this.wrapper.find(".sh-results").attr("aria-busy", "true").addClass("sh-loading");
		this.wrapper.find(".sh-status").text(this.t("loading")).show();
	}
	load_data(force = false) {
		clearTimeout(this.search_timer);
		const request = ++this.request_id;
		const args = { ...this.filters, page: this.current_page, page_size: this.page_size };
		const key = JSON.stringify(args);
		const scope = JSON.stringify(this.filters);
		this.response_cache ||= new Map();
		let cached = force ? null : this.response_cache.get(key);
		if (
			!cached &&
			!force &&
			this.query_snapshot?.scope === scope &&
			this.query_snapshot.data.matching_rows
		) {
			const snapshot = this.query_snapshot;
			const page_size = Math.min(100, Math.max(1, Number(this.page_size) || 20));
			const page = Math.min(
				Math.max(1, this.current_page),
				Math.max(1, Math.ceil(snapshot.data.total / page_size))
			);
			cached = {
				time: snapshot.time,
				data: {
					...snapshot.data,
					page,
					page_size,
					suppliers: snapshot.data.matching_rows.slice((page - 1) * page_size, page * page_size),
				},
			};
		}
		if (cached?.data.revision && Date.now() - cached.time < 20000)
			args.known_revision = cached.data.revision;
		this.set_loading();
		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_supplier_hub_data",
			args,
			callback: (r) => {
				if (request !== this.request_id) return;
				if (!r.message) {
					this.show_error();
					return;
				}
				if (r.message.unchanged && !cached) return this.show_error();
				this.data = r.message.unchanged ? cached.data : r.message;
				this.has_loaded = true;
				this.current_page = this.data.page;
				this.page_size = this.data.page_size;
				this.filters.company = this.data.company;
				const response_key = JSON.stringify({
					...this.filters,
					page: this.current_page,
					page_size: this.page_size,
				});
				if (!r.message.unchanged) {
					this.response_cache.set(response_key, { data: this.data, time: Date.now() });
					this.query_snapshot = {
						scope: JSON.stringify(this.filters),
						data: this.data,
						time: Date.now(),
					};
					if (this.response_cache.size > 20)
						this.response_cache.delete(this.response_cache.keys().next().value);
				}
				this.fill_options("company", this.data.companies);
				this.fill_options("warehouse", this.data.warehouses, ["", this.t("all_warehouses")]);
				this.fill_options("supplier_group", this.data.supplier_groups, ["All", this.t("all_groups")]);
				if (this.data.permissions.create_supplier)
					this.page.set_primary_action(
						this.t("new_supplier"),
						() => frappe.new_doc("Supplier"),
						"add"
					);
				else this.page.clear_primary_action();
				this.render();
				this.wrapper.find(".sh-results").attr("aria-busy", "false").removeClass("sh-loading").show();
				this.wrapper.find(".sh-status").hide();
			},
			error: () => {
				if (request === this.request_id) this.show_error();
			},
		});
	}
	fill_options(key, values, initial) {
		const options = [...(initial ? [initial] : []), ...values.map((v) => [v, v])];
		this.wrapper
			.find(`[data-filter="${key}"]`)
			.html(
				options
					.map(([v, text]) => `<option value="${this.esc(v)}">${this.esc(text)}</option>`)
					.join("")
			)
			.val(this.filters[key]);
	}
	show_error() {
		this.wrapper.find(".sh-results").hide().attr("aria-busy", "false").removeClass("sh-loading");
		this.wrapper
			.find(".sh-status")
			.empty()
			.append($("<p>").text(this.t("load_error")))
			.append(
				$("<button class='btn btn-default btn-sm'>")
					.text(this.t("retry"))
					.on("click", () => this.load_data())
			)
			.show();
	}
	render() {
		const d = this.data,
			s = d.summary;
		const cards = [
			["outstanding", s.total_debt, "now"],
			["overdue", s.overdue, "overdue_hint"],
			["purchases", s.purchases, "purchase_hint"],
			["stock_value", s.total_stock_value, "stock_hint"],
		];
		this.wrapper
			.find(".sh-summary")
			.html(
				cards
					.map(
						([label, value, hint]) =>
							`<div class="sh-summary-item"><span>${this.t(
								label
							)}</span><div class="sh-summary-value ${
								label === "overdue" && value > 0 ? "sh-warning" : ""
							}">${this.money(value)}</div><small class="text-muted">${
								value == null ? this.t("no_access") : this.t(hint)
							}</small></div>`
					)
					.join("")
			);
		const period = `${
			d.from_date ? frappe.datetime.str_to_user(d.from_date) + " – " : ""
		}${frappe.datetime.str_to_user(d.to_date)}`;
		this.wrapper
			.find(".sh-scope")
			.text(
				`${d.company} · ${this.filters.warehouse || this.t("all_warehouses")} · ${this.t(
					this.filters.period
				)} (${period}). ${this.t("scope_note")}`
			);
		let notes = s.has_shared_products ? `<p>${this.t("shared_note")}</p>` : "";
		if (s.credits > 0)
			notes += `<p>${this.t("credits")}: ${this.money(s.credits)}. ${this.t("credits_hint")}</p>`;
		if (this.extra_columns.has("net_payments")) notes += `<p>${this.t("payment_note")}</p>`;
		this.wrapper.find(".sh-notes").html(notes);
		this.wrapper
			.find(".sh-list-heading")
			.html(
				`<span>${this.t("matched")}: <strong>${format_number(
					d.total,
					null,
					0
				)}</strong></span><span class="text-muted">${this.t("all_results")}</span>`
			);
		const columns = [
			"supplier",
			"debt",
			"overdue",
			"stock_value",
			"purchases",
			"last_purchase",
			...this.extra_columns,
		];
		if (!d.suppliers.length)
			this.wrapper
				.find(".sh-table-area")
				.html(
					`<div class="sh-empty"><h4>${this.t("empty")}</h4><p>${this.t(
						"empty_hint"
					)}</p><button class="btn btn-default btn-sm sh-reset">${this.t("reset")}</button></div>`
				);
		else
			this.wrapper
				.find(".sh-table-area")
				.html(
					`<div class="sh-table-scroll" tabindex="0" role="region" aria-label="${this.t(
						"supplier"
					)}"><table class="sh-table"><thead><tr>${columns
						.map(
							(k) =>
								`<th scope="col" class="${
									k === "supplier" ? "sh-identity" : "text-right"
								}">${this.t(k)}</th>`
						)
						.join("")}</tr></thead><tbody>${d.suppliers
						.map(
							(row) =>
								`<tr>${columns
									.map(
										(k) =>
											`<td class="${
												k === "supplier" ? "sh-identity" : "text-right"
											}">${this.cell(k, row)}</td>`
									)
									.join("")}</tr>`
						)
						.join("")}</tbody></table></div>`
				);
		this.render_pagination();
	}
	cell(key, row) {
		if (key === "supplier")
			return `<a class="sh-supplier-link" href="/app/supplier-detail/${encodeURIComponent(
				row.name
			)}?supplier_company=${encodeURIComponent(this.data.company)}" data-supplier="${this.esc(
				row.name
			)}">${this.esc(row.supplier_name)}</a><div class="sh-meta text-muted">${this.esc(
				[row.mobile_no || row.email_id, row.supplier_group].filter(Boolean).join(" · ")
			)}</div>${row.disabled ? `<small class="text-muted">${this.t("inactive")}</small>` : ""}`;
		if (key === "last_purchase")
			return row.last_purchase_invoice
				? `<a class="sh-invoice-link" href="/app/purchase-invoice/${encodeURIComponent(
						row.last_purchase_invoice
				  )}" title="${this.esc(row.last_purchase_invoice)}">${this.esc(
						frappe.datetime.str_to_user(row.last_purchase_date)
				  )}</a>`
				: `<span class="text-muted">—</span>`;
		if (key === "stock_value")
			return `${this.money(row.stock_value)}${
				row.shared_products
					? `<small class="sh-cell-note text-muted">${this.t("shared")}</small>`
					: ""
			}`;
		if (key === "stock_qty")
			return row.stock_qty == null
				? this.money(null)
				: row.stock_uom
				? `${format_number(
						row.stock_qty,
						null,
						Number.isInteger(row.stock_qty) ? 0 : 2
				  )} <span class="text-muted">${this.esc(__(row.stock_uom))}</span>`
				: `<span class="text-muted">${row.skus_count ? this.t("mixed_units") : "—"}</span>`;
		if (["models_count", "skus_count"].includes(key))
			return row[key] == null ? this.money(null) : format_number(row[key], null, 0);
		if (key === "overdue")
			return `<span class="${row.overdue > 0 ? "sh-warning" : ""}">${this.money(row.overdue)}</span>`;
		return this.money(row[key === "debt" ? "current_debt" : key]);
	}
	render_pagination() {
		const d = this.data,
			pages = Math.max(1, Math.ceil(d.total / d.page_size));
		this.wrapper
			.find(".sh-pagination")
			.html(
				`<label>${this.t("per_page")}<select class="form-control sh-page-size">${[20, 50, 100]
					.map((n) => `<option value="${n}" ${n === d.page_size ? "selected" : ""}>${n}</option>`)
					.join(
						""
					)}</select></label><div class="sh-page-navigation"><button class="btn btn-default btn-sm sh-prev" ${
					d.page <= 1 ? "disabled" : ""
				}>${this.t("previous")}</button><span>${d.page} ${this.t(
					"of"
				)} ${pages}</span><button class="btn btn-default btn-sm sh-next" ${
					d.page >= pages ? "disabled" : ""
				}>${this.t("next")}</button></div>`
			);
	}
	choose_columns() {
		const keys = ["models_count", "skus_count", "stock_qty", "net_payments", "total_purchased"];
		const dialog = new frappe.ui.Dialog({
			title: this.t("columns"),
			fields: keys.map((key) => ({
				fieldtype: "Check",
				fieldname: key,
				label: this.t(key),
				default: this.extra_columns.has(key) ? 1 : 0,
			})),
			primary_action_label: this.t("apply"),
			primary_action: (values) => {
				this.extra_columns = new Set(keys.filter((k) => values[k]));
				dialog.hide();
				if (this.data) this.render();
			},
		});
		dialog.show();
	}
}
