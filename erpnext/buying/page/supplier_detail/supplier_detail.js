// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["supplier-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Supplier"), single_column: true });
	wrapper.supplier_detail_app = new SupplierDetailApp(page);
};
frappe.pages["supplier-detail"].on_page_show = function (wrapper) {
	const supplier = frappe.get_route()[1];
	if (supplier) wrapper.supplier_detail_app?.open(decodeURIComponent(supplier));
};

class SupplierDetailApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body).addClass("supplier-detail-page");
		this.lang = frappe.boot.user.language === "tg" ? 1 : 0;
		this.request_id = 0;
		this.columns = new Set();
		this.page.set_secondary_action(this.t("back"), () => frappe.set_route("supplier-hub"));
		this.page.add_inner_button(this.t("refresh"), () => this.load(true));
		this.page.add_menu_item(this.t("erp_form"), () => this.native_supplier());
		this.page.add_menu_item(this.t("statement"), () => this.statement());
	}
	t(key) {
		const labels = {
			back: ["Поставщики", "Таъминкунандагон"],
			refresh: ["Обновить", "Навсозӣ"],
			erp_form: ["Открыть форму ERPNext", "Кушодани шакли ERPNext"],
			statement: ["Акт сверки / выписка", "Санади муқоиса / иқтибос"],
			pay: ["Записать платёж", "Сабти пардохт"],
			receive: ["Принять товар", "Қабули мол"],
			invoices: ["Накладные", "Борхатҳо"],
			payments: ["Платежи", "Пардохтҳо"],
			products: ["Товары", "Молҳо"],
			details: ["Реквизиты", "Маълумот"],
			debt: ["Осталось оплатить", "Бақияи пардохт"],
			overdue: ["Просрочено", "Муҳлатгузашта"],
			purchases: ["Закупки за период", "Харид дар давра"],
			stock_value: ["Стоимость остатка", "Арзиши бақия"],
			now: ["Сейчас", "Ҳоло"],
			period: ["Период закупок и платежей", "Давраи харид ва пардохт"],
			month: ["Этот месяц", "Ин моҳ"],
			today: ["Сегодня", "Имрӯз"],
			"7d": ["7 дней", "7 рӯз"],
			"30d": ["30 дней", "30 рӯз"],
			all_time: ["Всё время", "Ҳамаи давра"],
			company: ["Компания", "Ширкат"],
			warehouse: ["Склад", "Анбор"],
			all_warehouses: ["Все доступные склады", "Ҳамаи анборҳои дастрас"],
			additional: ["Компания и склад", "Ширкат ва анбор"],
			scope: [
				"Долг и остатки — сейчас. Период меняет закупки и платежи. Суммы — в валюте компании.",
				"Қарз ва бақияҳо ҷорӣ ҳастанд. Давра харид ва пардохтҳоро тағйир медиҳад. Маблағҳо бо асъори ширкатанд.",
			],
			purchase_hint: ["С налогами, за вычетом возвратов", "Бо андозҳо, бо тарҳи баргардониҳо"],
			stock_hint: ["Связанные товары в выбранных складах", "Молҳои алоқаманд дар анборҳои интихобшуда"],
			credits: ["Нераспределённые авансы и кредиты", "Пешпардохтҳо ва кредитҳои тақсимнашуда"],
			credit_hint: [
				"Показаны отдельно от неоплаченных накладных.",
				"Аз борхатҳои пардохтнашуда ҷудо нишон дода шудаанд.",
			],
			unpaid: ["Неоплаченные — за всё время", "Пардохтнашуда — ҳамаи давра"],
			overdue_filter: ["Просроченные — за всё время", "Муҳлатгузашта — ҳамаи давра"],
			all: ["Все за период", "Ҳама дар давра"],
			settled: ["Оплаченные за период", "Пардохтшуда дар давра"],
			returns: ["Возвраты за период", "Баргардониҳо дар давра"],
			search: ["Поиск по номеру, названию или примечанию", "Ҷустуҷӯ аз рӯи рақам, ном ё эзоҳ"],
			status: ["Показать", "Нишон додан"],
			date_from: ["С даты", "Аз сана"],
			date_to: ["По дату", "То сана"],
			more_filters: ["Даты документов", "Санаҳои ҳуҷҷатҳо"],
			reset: ["Сбросить", "Тоза кардан"],
			unpaid_note: [
				"Все текущие неоплаченные документы, включая старые долги. Период закупок их не скрывает.",
				"Ҳамаи ҳуҷҷатҳои пардохтнашуда, аз ҷумла қарзҳои пешина. Давраи харид онҳоро пинҳон намекунад.",
			],
			stock_note: [
				"Остатки связанных товаров, а не учёт происхождения каждой единицы. Один товар может быть связан с несколькими поставщиками.",
				"Бақияи молҳои алоқаманд аст, на пайдоиши ҳар воҳид. Як мол метавонад бо чанд таъминкунанда алоқаманд бошад.",
			],
			payment_note: [
				"Фактические Payment Entry: выплаты минус возвраты денег. Зачёты и списания не считаются платежами.",
				"Payment Entry-и воқеӣ: пардохтҳо бо тарҳи маблағҳои баргашта. Ҳисоббаробаркунӣ ва азҳисоббарорӣ пардохт нестанд.",
			],
			invoice: ["Документ", "Ҳуҷҷат"],
			invoice_date: ["Дата", "Сана"],
			due: ["Срок оплаты", "Муҳлати пардохт"],
			no_deadline: ["Срок оплаты не указан", "Муҳлати пардохт муайян нест"],
			amount: ["Сумма", "Маблағ"],
			balance: ["Остаток", "Бақия"],
			state: ["Статус", "Ҳолат"],
			paid: ["Оплачено", "Пардохтшуда"],
			outstanding: ["Не оплачено", "Пардохт нашудааст"],
			returned: ["Возврат", "Баргардонӣ"],
			opening: ["Начальный остаток", "Бақияи ибтидоӣ"],
			days: ["дн. просрочки", "рӯз аз муҳлат"],
			adjustment: ["Корректировка / начальный остаток", "Ислоҳ / бақияи ибтидоӣ"],
			show_items: ["Состав", "Молҳо"],
			hide_items: ["Скрыть состав", "Пинҳон кардани молҳо"],
			product: ["Товар", "Мол"],
			qty: ["Остаток", "Бақия"],
			item_qty: ["Количество", "Миқдор"],
			cost: ["Оценка за единицу", "Арзиши як воҳид"],
			selling_price: ["Прайс продажи", "Нархи фурӯш аз рӯйхат"],
			price_note: [
				"Прайс Standard Selling в валюте компании, за складскую единицу; без индивидуальных скидок.",
				"Нархи Standard Selling бо асъори ширкат барои воҳиди анбор; бе тахфифҳои инфиродӣ.",
			],
			from: ["от", "аз"],
			variants: ["вариантов", "намудҳо"],
			mixed: ["Разные единицы", "Воҳидҳои гуногун"],
			columns: ["Колонки", "Сутунҳо"],
			apply: ["Применить", "Татбиқ"],
			payment: ["Платёж", "Пардохт"],
			account: ["Касса / счёт", "Хазина / ҳисоб"],
			allocation: ["По накладным", "Аз рӯи борхатҳо"],
			reference: ["Номер чека / перевода", "Рақами чек / интиқол"],
			refund: ["Возврат денег", "Баргардонидани маблағ"],
			no_allocation: ["Без доступной привязки", "Пайванди дастрас нест"],
			contact: ["Контактное лицо", "Шахси масъул"],
			phone: ["Телефон", "Телефон"],
			email: ["Email", "Почтаи электронӣ"],
			address: ["Адрес", "Суроға"],
			notes: ["Условия и заметки", "Шартҳо ва эзоҳҳо"],
			edit: ["Изменить реквизиты", "Тағйири маълумот"],
			group: ["Группа поставщика", "Гурӯҳи таъминкунанда"],
			inactive: ["Поставщик отключён", "Таъминкунанда ғайрифаъол аст"],
			loading: ["Загрузка…", "Бор шуда истодааст…"],
			error: ["Не удалось загрузить данные", "Маълумот бор нашуд"],
			retry: ["Повторить", "Такрор"],
			empty: ["Нет подходящих записей", "Сабти мувофиқ нест"],
			empty_hint: [
				"Измените период или сбросьте фильтры.",
				"Давраро тағйир диҳед ё филтрҳоро тоза кунед.",
			],
			no_access: ["Нет доступа", "Дастрасӣ нест"],
			no_access_hint: [
				"Для этого раздела нужны дополнительные права.",
				"Барои ин бахш ҳуқуқи иловагӣ лозим аст.",
			],
			found: ["Найдено", "Ёфт шуд"],
			total: ["Итого по всем найденным", "Ҷамъбасти ҳамаи сабтҳои ёфтшуда"],
			previous: ["Назад", "Қафо"],
			next: ["Далее", "Пеш"],
			of: ["из", "аз"],
			per_page: ["Строк", "Сатрҳо"],
			payment_title: ["Платёж поставщику", "Пардохт ба таъминкунанда"],
			pay_invoice: ["Накладная для оплаты", "Борхат барои пардохт"],
			pay_amount: ["Сумма платежа", "Маблағи пардохт"],
			pay_date: ["Дата платежа", "Санаи пардохт"],
			remarks: ["Примечание", "Эзоҳ"],
			confirm: ["Записать и провести платёж", "Сабт ва тасдиқи пардохт"],
			pay_help: [
				"Оплата одной накладной. Для валютных операций и сложного распределения откройте накладную в ERPNext.",
				"Пардохти як борхат. Барои амалиёти асъорӣ ва тақсимоти мураккаб борхатро дар ERPNext кушоед.",
			],
			choose_invoice: ["Выберите накладную", "Борхатро интихоб кунед"],
			invalid_amount: [
				"Введите сумму в пределах текущего остатка",
				"Маблағро дар ҳудуди бақияи ҷорӣ ворид кунед",
			],
			payment_saved: ["Платёж проведён", "Пардохт тасдиқ шуд"],
			full_amount: ["Весь остаток", "Ҳамаи бақия"],
			no_accounts: [
				"Нет доступных счетов в валюте компании. Используйте форму ERPNext.",
				"Ҳисобҳои дастрас бо асъори ширкат нестанд. Шакли ERPNext-ро истифода баред.",
			],
			statement_hint: [
				"Откроется Главная книга с начальным и конечным остатком. Печать и экспорт доступны в отчёте.",
				"Китоби асосӣ бо бақияи ибтидоӣ ва ниҳоӣ кушода мешавад. Чоп ва содирот дар ҳисобот дастрасанд.",
			],
		};
		return labels[key]?.[this.lang] || key;
	}
	esc(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}
	money(value, currency) {
		return value == null ? "—" : format_currency(value, currency || this.data.currency);
	}
	date(value) {
		return value ? this.esc(frappe.datetime.str_to_user(value)) : "—";
	}
	link(doctype, name, label) {
		const route = {
			"Purchase Invoice": "purchase-invoice",
			"Payment Entry": "payment-entry",
			"Journal Entry": "journal-entry",
			Contact: "contact",
			Address: "address",
		}[doctype];
		return route
			? `<a href="/app/${route}/${encodeURIComponent(name)}">${this.esc(label || name)}</a>`
			: this.esc(name);
	}
	new_state() {
		return Object.fromEntries(
			["invoices", "payments", "products", "details"].map((k) => [
				k,
				{ search: "", status: "unpaid", date_from: "", date_to: "", page: 1, page_size: 20 },
			])
		);
	}
	open(supplier) {
		const route_company =
			frappe.route_options?.supplier_company ||
			new URLSearchParams(window.location.search).get("supplier_company");
		if (frappe.route_options) delete frappe.route_options.supplier_company;
		if (this.supplier !== supplier) {
			this.supplier = supplier;
			this.company = route_company || frappe.defaults.get_user_default("Company");
			this.period = "month";
			this.warehouse = "";
			this.tab = "invoices";
			this.states = this.new_state();
			this.data = null;
			this.setup_ui();
		} else if (route_company && route_company !== this.company) {
			this.company = route_company;
			this.warehouse = "";
		}
		this.load(true);
	}
	select(key, label, options, value) {
		return `<label class="sd-filter">${this.t(
			label
		)}<select class="form-control" data-filter="${key}">${options
			.map(
				([v, text]) =>
					`<option value="${this.esc(v)}" ${v === value ? "selected" : ""}>${this.esc(
						text
					)}</option>`
			)
			.join("")}</select></label>`;
	}
	setup_ui() {
		this.wrapper.off(".supplierDetail").html(`<div class="sd-workspace">
			<div class="sd-identity"></div><div class="sd-scope-controls">
			${this.select(
				"period",
				"period",
				["month", "today", "7d", "30d", "all"].map((k) => [k, this.t(k === "all" ? "all_time" : k)]),
				this.period
			)}
			<details class="sd-scope-options"><summary>${this.t(
				"additional"
			)}</summary><div class="sd-extra-scope">${this.select(
			"company",
			"company",
			[],
			this.company
		)}${this.select(
			"warehouse",
			"warehouse",
			[["", this.t("all_warehouses")]],
			this.warehouse
		)}</div></details><span class="sd-period-caption text-muted"></span></div>
			<div class="sd-metrics"></div><p class="sd-scope-note text-muted">${this.t(
				"scope"
			)}</p><div class="sd-credits text-muted"></div>
			<div class="sd-tabs" role="tablist">${["invoices", "payments", "products", "details"]
				.map(
					(k) =>
						`<button class="sd-tab" role="tab" id="sd-tab-${k}" aria-controls="sd-panel" data-tab="${k}">${this.t(
							k
						)}</button>`
				)
				.join("")}</div>
			<section id="sd-panel" role="tabpanel"><div class="sd-panel-controls"></div><div class="sd-list" aria-busy="true"></div></section>
			<div class="sd-status" role="status" aria-live="polite"></div></div>`);
		this.wrapper.on("change.supplierDetail", "[data-filter]", (e) => {
			const key = e.target.dataset.filter;
			if (["company", "warehouse", "period"].includes(key)) {
				this[key] = e.target.value;
				if (key === "company") this.warehouse = "";
			} else this.states[this.tab][key] = e.target.value;
			this.states[this.tab].page = 1;
			this.load();
		});
		this.wrapper.on("input.supplierDetail", ".sd-search", (e) => {
			this.states[this.tab].search = e.target.value;
			this.states[this.tab].page = 1;
			++this.request_id;
			this.loading();
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => this.load(), 300);
		});
		this.wrapper.on("click.supplierDetail", ".sd-tab", (e) =>
			this.switch_tab(e.currentTarget.dataset.tab)
		);
		this.wrapper.on("keydown.supplierDetail", ".sd-tab", (e) => {
			const tabs = ["invoices", "payments", "products", "details"],
				index = tabs.indexOf(this.tab);
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
			e.preventDefault();
			const next =
				e.key === "Home" ? 0 : e.key === "End" ? 3 : (index + (e.key === "ArrowRight" ? 1 : 3)) % 4;
			this.switch_tab(tabs[next]);
			this.wrapper.find(`[data-tab="${tabs[next]}"]`).trigger("focus");
		});
		this.wrapper.on("click.supplierDetail", ".sd-reset", () => {
			this.states[this.tab] = this.new_state()[this.tab];
			this.render_controls();
			this.load();
		});
		this.wrapper.on("click.supplierDetail", ".sd-prev, .sd-next", (e) => {
			this.states[this.tab].page += e.currentTarget.classList.contains("sd-prev") ? -1 : 1;
			this.load();
		});
		this.wrapper.on("change.supplierDetail", ".sd-page-size", (e) => {
			this.states[this.tab].page_size = Number(e.target.value);
			this.states[this.tab].page = 1;
			this.load();
		});
		this.wrapper.on("click.supplierDetail", ".sd-pay-invoice", (e) =>
			this.show_payment(e.currentTarget.dataset.invoice)
		);
		this.wrapper.on("click.supplierDetail", ".sd-items", (e) => this.toggle_items(e.currentTarget));
		this.wrapper.on("click.supplierDetail", ".sd-columns", () => this.choose_columns());
		this.wrapper.on("click.supplierDetail", ".sd-edit", () => this.native_supplier());
		this.wrapper.on("click.supplierDetail", ".sd-retry", () => this.load());
		this.render_controls();
	}
	switch_tab(tab) {
		this.tab = tab;
		this.render_controls();
		this.load();
	}
	loading() {
		this.is_loading = true;
		this.page.clear_primary_action();
		this.receive_button?.prop("disabled", true);
		this.wrapper.find(".sd-metrics").attr("aria-busy", "true");
		this.wrapper.find(".sd-list").prop("inert", true).attr("aria-busy", "true").addClass("sd-loading");
		this.wrapper.find(".sd-status").text(this.t("loading")).show();
	}
	load(force = false) {
		if (!this.supplier) return;
		clearTimeout(this.search_timer);
		const request = ++this.request_id;
		const scope = JSON.stringify([this.supplier, this.company, this.period, this.warehouse]);
		const args = {
			supplier: this.supplier,
			company: this.company,
			period: this.period,
			warehouse: this.warehouse,
			tab: this.tab,
			...this.states[this.tab],
		};
		const key = JSON.stringify(args);
		this.response_cache ||= new Map();
		const cached = force ? null : this.response_cache.get(key);
		const reuse_summary = !force && this.data && this.summary_scope === scope;
		if (reuse_summary) args.summary_revision = this.summary_revision;
		if (
			cached?.data.revision &&
			Date.now() - cached.time < 20000 &&
			(!cached.data.partial || (reuse_summary && cached.data.revision === this.summary_revision))
		)
			args.known_revision = cached.data.revision;
		this.loading();
		frappe.call({
			method: "erpnext.buying.page.supplier_detail.supplier_detail.get_supplier_detail",
			args,
			callback: (r) => {
				if (request !== this.request_id) return;
				if (!r.message) return this.error();
				if (r.message.unchanged && !cached) return this.error();
				const response = r.message.unchanged ? cached.data : r.message;
				this.data = response.partial ? { ...this.data, ...response } : response;
				this.company = this.data.company;
				if (!response.partial) {
					this.summary_scope = JSON.stringify([
						this.supplier,
						this.company,
						this.period,
						this.warehouse,
					]);
					this.summary_revision = response.revision;
				}
				if (!r.message.unchanged) {
					const response_key = JSON.stringify({
						...args,
						company: this.company,
						summary_revision: undefined,
						known_revision: undefined,
					});
					this.response_cache.set(response_key, { data: response, time: Date.now() });
					if (this.response_cache.size > 20)
						this.response_cache.delete(this.response_cache.keys().next().value);
				}
				if (
					!this.data.permissions.payables &&
					this.tab === "invoices" &&
					this.states.invoices.status !== "all"
				) {
					this.states.invoices.status = "all";
					this.render_controls();
					return this.load();
				}
				Object.assign(this.states[this.tab], {
					page: this.data.listing.page,
					page_size: this.data.listing.page_size,
				});
				this.is_loading = false;
				this.render_header();
				this.render_list();
				this.wrapper.find(".sd-metrics").attr("aria-busy", "false");
				this.wrapper
					.find(".sd-list")
					.prop("inert", false)
					.attr("aria-busy", "false")
					.removeClass("sd-loading");
				this.wrapper.find(".sd-status").hide();
			},
			error: () => {
				if (request === this.request_id) this.error();
			},
		});
	}
	error() {
		this.is_loading = false;
		this.data = null;
		this.receive_button?.remove();
		this.wrapper.find(".sd-metrics, .sd-credits, .sd-period-caption").empty();
		this.wrapper
			.find(".sd-list")
			.prop("inert", false)
			.empty()
			.attr("aria-busy", "false")
			.removeClass("sd-loading");
		this.wrapper
			.find(".sd-status")
			.html(
				`<p>${this.t("error")}</p><button class="btn btn-default btn-sm sd-retry">${this.t(
					"retry"
				)}</button>`
			)
			.show();
	}
	render_header() {
		const d = this.data,
			s = d.supplier,
			k = d.summary;
		this.page.set_title(this.esc(s.supplier_name || s.name));
		if (d.permissions.pay) this.page.set_primary_action(this.t("pay"), () => this.show_payment());
		if (this.receive_button) this.receive_button.remove();
		if (d.permissions.receive)
			this.receive_button = this.page.add_inner_button(this.t("receive"), () =>
				frappe.new_doc("Quick Product Restock", {
					company: d.company,
					supplier: s.name,
					...(this.warehouse ? { target_warehouse: this.warehouse } : {}),
				})
			);
		const contact = s.contact,
			phone = s.mobile_no || contact?.mobile_no || contact?.phone,
			email = s.email_id || contact?.email_id;
		this.wrapper
			.find(".sd-identity")
			.html(
				`<div><h2>${this.esc(
					s.supplier_name || s.name
				)}</h2><div class="sd-contact-line text-muted">${[
					s.name !== s.supplier_name ? this.esc(s.name) : "",
					this.esc(contact?.full_name || ""),
					phone
						? `<a href="tel:${this.esc(phone.replace(/[^\d+]/g, ""))}">${this.esc(phone)}</a>`
						: "",
					email ? `<a href="mailto:${encodeURIComponent(email)}">${this.esc(email)}</a>` : "",
				]
					.filter(Boolean)
					.join("<span>·</span>")}</div>${
					s.disabled ? `<p class="sd-warning">${this.t("inactive")}</p>` : ""
				}</div>`
			);
		this.wrapper.find(".sd-metrics").html(
			[
				["debt", k.current_debt, "now"],
				["overdue", k.overdue, "now"],
				["purchases", k.purchases, "purchase_hint"],
				["stock_value", k.stock_value, "stock_hint"],
			]
				.map(
					([label, value, hint]) =>
						`<div class="sd-metric"><span class="text-muted">${this.t(
							label
						)}</span><div class="sd-metric-value ${
							label === "overdue" && value > 0 ? "sd-warning" : ""
						}">${this.money(value)}</div><small class="text-muted">${this.t(
							value == null ? "no_access" : hint
						)}</small></div>`
				)
				.join("")
		);
		this.wrapper
			.find(".sd-credits")
			.html(
				k.credits > 0
					? `${this.t("credits")}: <strong>${this.money(k.credits)}</strong>. ${this.t(
							"credit_hint"
					  )}`
					: ""
			);
		for (const [key, options] of [
			["company", d.companies.map((v) => [v, v])],
			["warehouse", [["", this.t("all_warehouses")], ...d.warehouses.map((v) => [v, v])]],
		])
			this.wrapper
				.find(`[data-filter="${key}"]`)
				.html(
					options
						.map(([v, text]) => `<option value="${this.esc(v)}">${this.esc(text)}</option>`)
						.join("")
				)
				.val(this[key]);
		this.wrapper
			.find(".sd-period-caption")
			.text(
				`${d.company} · ${this.warehouse || this.t("all_warehouses")} · ${
					this.period === "all" ? this.t("all_time") : frappe.datetime.str_to_user(d.from_date)
				} — ${frappe.datetime.str_to_user(d.to_date)}`
			);
	}
	render_controls() {
		this.wrapper.find(".sd-tab").each((i, el) => {
			const active = el.dataset.tab === this.tab;
			$(el)
				.toggleClass("active", active)
				.attr({ "aria-selected": String(active), tabindex: active ? 0 : -1 });
		});
		this.wrapper.find("#sd-panel").attr("aria-labelledby", `sd-tab-${this.tab}`);
		if (this.tab === "details") {
			this.wrapper.find(".sd-panel-controls").empty();
			return;
		}
		const s = this.states[this.tab];
		this.wrapper.find(".sd-panel-controls").html(
			`<div class="sd-toolbar"><label class="sd-search-label"><span class="sr-only">${this.t(
				"search"
			)}</span><input type="search" class="form-control sd-search" placeholder="${this.t(
				"search"
			)}" value="${this.esc(s.search)}"></label>${
				this.tab === "invoices"
					? this.select(
							"status",
							"status",
							["unpaid", "overdue", "all", "settled", "returns"].map((k) => [
								k,
								this.t(k === "overdue" ? "overdue_filter" : k),
							]),
							s.status
					  )
					: ""
			}<button class="btn btn-default btn-sm sd-reset">${this.t("reset")}</button>${
				this.tab === "products"
					? `<button class="btn btn-default btn-sm sd-columns">${this.t("columns")}</button>`
					: ""
			}</div>${
				this.tab !== "products"
					? `<details class="sd-date-options"><summary>${this.t(
							"more_filters"
					  )}</summary><div class="sd-date-fields">${["date_from", "date_to"]
							.map(
								(k) =>
									`<label class="sd-filter">${this.t(
										k
									)}<input type="date" class="form-control" data-filter="${k}" value="${this.esc(
										s[k]
									)}"></label>`
							)
							.join("")}</div></details>`
					: ""
			}`
		);
	}
	table(columns, rows, kind) {
		return `<div class="sd-table-scroll" tabindex="0" role="region" aria-label="${this.t(
			this.tab
		)}"><table class="sd-table sd-${kind}-table"><thead><tr>${columns
			.map(
				([label, numeric]) =>
					`<th scope="col" class="${numeric ? "text-right" : ""}">${this.t(label)}</th>`
			)
			.join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
	}
	render_list() {
		const d = this.data,
			list = d.listing,
			allowed =
				d.permissions[{ invoices: "purchases", payments: "payments", products: "stock" }[this.tab]];
		if (this.tab === "details") {
			this.render_details();
			return;
		}
		if (!allowed) {
			this.wrapper
				.find(".sd-list")
				.html(
					`<div class="sd-empty"><h4>${this.t("no_access")}</h4><p>${this.t(
						"no_access_hint"
					)}</p></div>`
				);
			return;
		}
		let note =
			this.tab === "products"
				? this.t("stock_note")
				: this.tab === "payments"
				? this.t("payment_note")
				: ["unpaid", "overdue"].includes(this.states.invoices.status)
				? this.t("unpaid_note")
				: "";
		if (this.tab === "products" && this.columns.has("selling_price")) note += " " + this.t("price_note");
		let totals =
			this.tab === "products"
				? `${this.t("stock_value")}: ${this.money(list.stock_value)}`
				: `${this.t("amount")}: ${this.money(list.amount)}`;
		if (this.tab === "invoices" && list.outstanding != null)
			totals += ` · ${this.t("balance")}: ${this.money(list.outstanding)}`;
		const content = !list.rows.length
			? `<div class="sd-empty"><h4>${this.t("empty")}</h4><p>${this.t(
					"empty_hint"
			  )}</p><button class="btn btn-default btn-sm sd-reset">${this.t("reset")}</button></div>`
			: this.tab === "invoices"
			? this.invoices_table(list.rows)
			: this.tab === "payments"
			? this.payments_table(list.rows)
			: this.products_table(list.rows);
		this.wrapper
			.find(".sd-list")
			.html(
				`<p class="sd-table-note text-muted">${note}</p><div class="sd-list-caption"><span>${this.t(
					"found"
				)}: <strong>${list.total}</strong></span><span class="text-muted">${this.t(
					"total"
				)} · ${totals}</span></div>${content}${this.pagination()}`
			);
	}
	invoices_table(rows) {
		const html = rows
			.map((r, index) => {
				const state = r.is_return
					? "returned"
					: r.outstanding == null
					? "no_access"
					: r.days_overdue
					? "overdue"
					: r.outstanding > 0
					? "outstanding"
					: "paid";
				return `<tr><td class="sd-document">${this.link(r.doctype, r.name)}${
					r.bill_no ? `<small class="text-muted">${this.esc(r.bill_no)}</small>` : ""
				}${
					r.doctype !== "Purchase Invoice"
						? `<small class="text-muted">${this.t("adjustment")}</small>`
						: `<button class="sd-text-button sd-items" data-invoice="${this.esc(
								r.name
						  )}" data-row="${index}" aria-expanded="false">${this.t("show_items")}</button>`
				}${
					r.is_opening ? `<small class="text-muted">${this.t("opening")}</small>` : ""
				}</td><td>${this.date(r.posting_date)}</td><td>${
					r.payment_deadline_not_agreed ? this.t("no_deadline") : this.date(r.due_date)
				}${
					r.days_overdue
						? `<small class="sd-warning">${r.days_overdue} ${this.t("days")}</small>`
						: ""
				}</td><td class="text-right">${this.money(r.amount)}</td><td class="text-right">${this.money(
					r.outstanding
				)}</td><td><span class="${r.days_overdue ? "sd-warning" : "text-muted"}">${this.t(
					state
				)}</span>${
					r.can_pay && this.data.permissions.pay
						? `<button class="sd-text-button sd-pay-invoice" data-invoice="${this.esc(
								r.name
						  )}">${this.t("pay")}</button>`
						: ""
				}</td></tr>`;
			})
			.join("");
		return this.table(
			[["invoice"], ["invoice_date"], ["due"], ["amount", true], ["balance", true], ["state"]],
			html,
			"invoice"
		);
	}
	payments_table(rows) {
		return this.table(
			[["payment"], ["invoice_date"], ["amount", true], ["account"], ["allocation"], ["reference"]],
			rows
				.map(
					(r) =>
						`<tr><td>${this.link("Payment Entry", r.name)}${
							r.is_refund ? `<small>${this.t("refund")}</small>` : ""
						}</td><td>${this.date(r.posting_date)}</td><td class="text-right">${this.money(
							r.amount
						)}</td><td>${this.esc(r.account || "—")}<small class="text-muted">${this.esc(
							r.mode_of_payment
						)}</small></td><td>${
							r.invoices?.length
								? `<details><summary>${r.invoices.length} ${this.t(
										"invoices"
								  ).toLowerCase()}</summary>${r.invoices
										.map(
											(i) =>
												`<div class="sd-allocation">${this.link(
													"Purchase Invoice",
													i.name
												)}<small class="text-muted">${this.money(
													i.allocated_amount,
													i.currency
												)}</small></div>`
										)
										.join("")}</details>`
								: `<span class="text-muted">${this.t("no_allocation")}</span>`
						}</td><td>${this.esc(r.reference_no || "—")}${
							r.remarks
								? `<details class="sd-remarks"><summary>${this.t(
										"remarks"
								  )}</summary><p>${this.esc(r.remarks)}</p></details>`
								: ""
						}</td></tr>`
				)
				.join(""),
			"payment"
		);
	}
	products_table(rows) {
		const columns = [
			["product"],
			["qty", true],
			["stock_value", true],
			...[...this.columns].map((k) => [k === "valuation_rate" ? "cost" : k, true]),
		];
		return this.table(
			columns,
			rows
				.map(
					(r) =>
						`<tr><td><a href="/app/product-detail/${encodeURIComponent(
							r.name
						)}?company=${encodeURIComponent(this.company)}${
							this.warehouse ? `&warehouse=${encodeURIComponent(this.warehouse)}` : ""
						}">${this.esc(r.item_name || r.name)}</a><small class="text-muted">${this.esc(
							[r.code, r.item_group].filter(Boolean).join(" · ")
						)}</small>${
							r.variants > 1
								? `<small class="text-muted">${r.variants} ${this.t("variants")}</small>`
								: ""
						}</td><td class="text-right">${
							r.stock_uom
								? `${format_number(
										r.stock_qty,
										null,
										Number.isInteger(r.stock_qty) ? 0 : 2
								  )} <span class="text-muted">${this.esc(__(r.stock_uom))}</span>`
								: this.t("mixed")
						}</td><td class="text-right">${this.money(r.stock_value)}</td>${[...this.columns]
							.map(
								(k) =>
									`<td class="text-right">${
										k === "selling_price" && r.price_varies ? `${this.t("from")} ` : ""
									}${this.money(r[k])}</td>`
							)
							.join("")}</tr>`
				)
				.join(""),
			"product"
		);
	}
	pagination() {
		const l = this.data.listing,
			pages = Math.max(1, Math.ceil(l.total / l.page_size));
		return `<div class="sd-pagination"><label>${this.t(
			"per_page"
		)}<select class="form-control sd-page-size">${[20, 50, 100]
			.map((n) => `<option ${n === l.page_size ? "selected" : ""}>${n}</option>`)
			.join("")}</select></label><div><button class="btn btn-default btn-sm sd-prev" ${
			l.page <= 1 ? "disabled" : ""
		}>${this.t("previous")}</button><span>${l.page} ${this.t(
			"of"
		)} ${pages}</span><button class="btn btn-default btn-sm sd-next" ${
			l.page >= pages ? "disabled" : ""
		}>${this.t("next")}</button></div></div>`;
	}
	render_details() {
		const s = this.data.supplier,
			c = s.contact,
			a = s.address;
		const fields = [
			["contact", c ? this.link("Contact", c.name, c.full_name || c.name) : "—"],
			["phone", this.esc(s.mobile_no || c?.mobile_no || c?.phone || "—")],
			["email", this.esc(s.email_id || c?.email_id || "—")],
			["group", this.esc(s.supplier_group || "—")],
			[
				"address",
				a
					? `${this.link("Address", a.name)}<div>${this.esc(
							[a.city, a.address_line1, a.address_line2, a.country].filter(Boolean).join(", ")
					  )}</div>`
					: "—",
			],
			[
				"notes",
				this.esc(
					frappe.utils.strip_html
						? frappe.utils.strip_html(s.supplier_details || "")
						: s.supplier_details || "—"
				),
			],
		];
		this.wrapper
			.find(".sd-list")
			.html(
				`<dl class="sd-details-grid">${fields
					.map(([label, value]) => `<div><dt>${this.t(label)}</dt><dd>${value}</dd></div>`)
					.join("")}</dl>${
					this.data.permissions.edit
						? `<button class="btn btn-default btn-sm sd-edit">${this.t("edit")}</button>`
						: ""
				}`
			);
	}
	choose_columns() {
		if (!this.data || this.is_loading) return;
		const keys = ["valuation_rate", "selling_price"];
		const d = new frappe.ui.Dialog({
			title: this.t("columns"),
			fields: keys.map((k) => ({
				fieldname: k,
				fieldtype: "Check",
				label: this.t(k === "valuation_rate" ? "cost" : k),
				default: this.columns.has(k) ? 1 : 0,
			})),
			primary_action_label: this.t("apply"),
			primary_action: (values) => {
				this.columns = new Set(keys.filter((k) => values[k]));
				d.hide();
				this.render_list();
			},
		});
		d.show();
	}
	toggle_items(button) {
		const row = $(button).closest("tr"),
			expanded = button.getAttribute("aria-expanded") === "true";
		if (expanded) {
			row.next(".sd-item-expansion").remove();
			$(button).attr("aria-expanded", "false").text(this.t("show_items"));
			return;
		}
		const request = this.request_id,
			supplier = this.supplier,
			company = this.company;
		$(button).prop("disabled", true);
		frappe.call({
			method: "erpnext.buying.page.supplier_detail.supplier_detail.get_invoice_items",
			args: { supplier, company, invoice: button.dataset.invoice },
			callback: (r) => {
				if (request !== this.request_id || !r.message || !button.isConnected) return;
				const d = r.message;
				row.after(
					`<tr class="sd-item-expansion"><td colspan="6"><ul>${d.items
						.map(
							(i) =>
								`<li><span>${this.esc(
									i.item_name || i.item_code
								)} <small class="text-muted">${this.esc(
									i.item_code
								)}</small></span><span>${format_number(i.qty)} ${this.esc(
									__(i.uom)
								)}</span><span>${this.money(i.amount, d.currency)}</span></li>`
						)
						.join("")}</ul></td></tr>`
				);
				$(button).attr("aria-expanded", "true").text(this.t("hide_items"));
			},
			always: () => $(button).prop("disabled", false),
		});
	}
	native_supplier() {
		if (this.supplier) frappe.set_route("Form", "Supplier", this.supplier);
	}
	statement() {
		if (this.is_loading) return;
		if (!this.data?.permissions.statement) {
			frappe.msgprint(this.t("no_access"));
			return;
		}
		const d = new frappe.ui.Dialog({
			title: this.t("statement"),
			fields: [
				{
					fieldtype: "Date",
					fieldname: "from_date",
					label: this.t("date_from"),
					reqd: 1,
					default:
						this.period === "all"
							? `${this.data.to_date.slice(0, 4)}-01-01`
							: this.data.from_date,
				},
				{
					fieldtype: "Date",
					fieldname: "to_date",
					label: this.t("date_to"),
					reqd: 1,
					default: this.data.to_date,
				},
				{ fieldtype: "HTML", options: `<p class="text-muted">${this.t("statement_hint")}</p>` },
			],
			primary_action_label: this.t("statement"),
			primary_action: (values) => {
				if (values.from_date > values.to_date) return frappe.msgprint(this.t("invalid_amount"));
				d.hide();
				frappe.route_options = {
					company: this.company,
					party_type: "Supplier",
					party: [this.supplier],
					from_date: values.from_date,
					to_date: values.to_date,
					categorize_by: "Categorize by Voucher (Consolidated)",
				};
				frappe.set_route("query-report", "General Ledger");
			},
		});
		d.show();
	}
	show_payment(invoice_name) {
		if (!this.data?.permissions.pay || this.is_loading) return;
		const supplier = this.supplier,
			company = this.company,
			currency = this.data.currency,
			request = this.request_id;
		frappe.call({
			method: "erpnext.buying.page.supplier_detail.supplier_detail.get_payment_options",
			args: { company },
			callback: (r) => {
				if (request !== this.request_id || !r.message) return;
				const opts = r.message,
					sources = [
						...opts.wallets.map((w) => ({ value: `wallet:${w.name}`, label: w.wallet_name })),
						...opts.accounts.map((a) => ({
							value: `account:${a.name}`,
							label: a.account_name || a.name,
						})),
					];
				if (!sources.length) return frappe.msgprint(this.t("no_accounts"));
				let current_invoice = null,
					lookup_id = 0,
					pending = false;
				const update_invoice = () => {
					const selected = d.get_value("purchase_invoice"),
						lookup = ++lookup_id;
					current_invoice = null;
					d.get_primary_btn().prop("disabled", true);
					d.fields_dict.balance.$wrapper.text(this.t("loading"));
					if (!selected) {
						d.fields_dict.balance.$wrapper.text(this.t("choose_invoice"));
						return;
					}
					frappe.call({
						method: "erpnext.buying.page.supplier_detail.supplier_detail.get_payment_invoice",
						args: { supplier, company, purchase_invoice: selected },
						callback: (result) => {
							if (lookup !== lookup_id || !result.message) return;
							current_invoice = result.message;
							const eligible =
								current_invoice.currency === currency &&
								current_invoice.party_account_currency === currency &&
								current_invoice.outstanding > 0;
							d.fields_dict.balance.$wrapper.text(
								`${this.t("balance")}: ${this.money(
									current_invoice.outstanding,
									current_invoice.currency
								)}`
							);
							d.set_value("amount", current_invoice.outstanding);
							d.get_primary_btn().prop("disabled", !eligible);
						},
						error: () => {
							if (lookup === lookup_id) d.fields_dict.balance.$wrapper.text(this.t("error"));
						},
					});
				};
				const d = new frappe.ui.Dialog({
					title: this.t("payment_title"),
					fields: [
						{ fieldtype: "HTML", options: `<p class="text-muted">${this.t("pay_help")}</p>` },
						{
							fieldtype: "Link",
							fieldname: "purchase_invoice",
							options: "Purchase Invoice",
							label: this.t("pay_invoice"),
							reqd: 1,
							get_query: () => ({
								filters: {
									supplier,
									company,
									docstatus: 1,
									is_return: 0,
									outstanding_amount: [">", 0],
									currency,
									party_account_currency: currency,
								},
							}),
							onchange: update_invoice,
						},
						{ fieldtype: "HTML", fieldname: "balance" },
						{
							fieldtype: "Currency",
							fieldname: "amount",
							label: `${this.t("pay_amount")} (${currency})`,
							reqd: 1,
						},
						{
							fieldtype: "Select",
							fieldname: "source",
							label: this.t("account"),
							options: sources,
							default: sources[0].value,
							reqd: 1,
						},
						{
							fieldtype: "Date",
							fieldname: "posting_date",
							label: this.t("pay_date"),
							default: frappe.datetime.get_today(),
							reqd: 1,
						},
						{ fieldtype: "Data", fieldname: "reference_no", label: this.t("reference") },
						{ fieldtype: "Small Text", fieldname: "remarks", label: this.t("remarks") },
					],
					primary_action_label: this.t("confirm"),
					primary_action: (values) => {
						if (pending) return;
						if (!current_invoice || current_invoice.name !== values.purchase_invoice)
							return frappe.msgprint(this.t("choose_invoice"));
						if (
							!(Number(values.amount) > 0) ||
							Number(values.amount) > current_invoice.outstanding
						)
							return frappe.msgprint(this.t("invalid_amount"));
						const source = sources.find((s) => s.value === values.source);
						if (!source) return;
						const split = source.value.indexOf(":"),
							kind = source.value.slice(0, split),
							name = source.value.slice(split + 1);
						pending = true;
						d.get_primary_btn().prop("disabled", true);
						frappe.call({
							method: "erpnext.buying.page.supplier_detail.supplier_detail.make_payment",
							args: {
								supplier,
								company,
								purchase_invoice: current_invoice.name,
								amount: values.amount,
								posting_date: values.posting_date,
								reference_no: values.reference_no,
								remarks: values.remarks,
								[kind]: name,
							},
							callback: (result) => {
								if (!result.message?.success) return;
								d.hide();
								frappe.msgprint({
									title: this.t("payment_saved"),
									message: this.link("Payment Entry", result.message.payment_entry),
									indicator: "green",
								});
								if (this.supplier === supplier && this.company === company) this.load(true);
							},
							always: () => {
								pending = false;
								d.get_primary_btn().prop("disabled", false);
							},
						});
					},
				});
				d.show();
				d.get_primary_btn().prop("disabled", true);
				if (invoice_name) d.set_value("purchase_invoice", invoice_name);
			},
		});
	}
}
