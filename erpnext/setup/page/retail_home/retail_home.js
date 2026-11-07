// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["retail-home"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Асосӣ") : __("Главная"),
		single_column: true,
	});

	page.add_inner_button(is_tg ? __("Навсозӣ") : __("Обновить"), () => {
		wrapper.retail_home_app && wrapper.retail_home_app.load();
	});

	wrapper.retail_home_app = new RetailHomeApp(page);
};

frappe.pages["retail-home"].on_page_show = function (wrapper) {
	wrapper.retail_home_app && wrapper.retail_home_app.load();
};

class RetailHomeApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.is_tg = frappe.boot.user.language === "tg";
		this.data = null;
		this.period = "month";
		this.from_date = null;
		this.to_date = null;
		this.pnl = null;
		this.load_sequence = 0;
		this.pnl_sequence = 0;
	}

	t(ru, tg) {
		return this.is_tg ? tg : ru;
	}

	fmt(v) {
		if (v === null || v === undefined) return "—";
		return Number(v).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	load() {
		const sequence = ++this.load_sequence;
		++this.pnl_sequence;
		this.wrapper.html(`<div class="text-muted" role="status">${this.t("Загрузка…", "Боргирӣ…")}</div>`);
		frappe.call({
			method: "erpnext.setup.page.retail_home.retail_home.get_business_pulse",
			callback: (r) => {
				if (sequence !== this.load_sequence) return;
				if (!r.message) return this.show_error();
				this.data = r.message;
				this.pnl = r.message.pnl;
				this.period = "month";
				this.render();
			},
			error: () => { if (sequence === this.load_sequence) this.show_error(); },
		});
	}

	show_error() {
		this.wrapper.html(`<div class="text-muted" role="alert">${this.t("Не удалось загрузить данные или доступ ограничен.", "Маълумот бор нашуд ё дастрасӣ маҳдуд аст.")} <button class="btn btn-default btn-sm rh-retry">${this.t("Повторить", "Такрор")}</button></div>`);
		this.wrapper.find(".rh-retry").on("click", () => this.load());
	}

	load_pnl() {
		const sequence = ++this.pnl_sequence;
		const load_sequence = this.load_sequence;
		this.wrapper.find(".rh-pnl").html(`<div role="status">${this.t("Загрузка…", "Боргирӣ…")}</div>`);
		frappe.call({
			method: "erpnext.setup.page.retail_home.retail_home.get_pnl",
			args: { period: this.period, from_date: this.from_date, to_date: this.to_date },
			callback: (r) => {
				if (sequence !== this.pnl_sequence || load_sequence !== this.load_sequence) return;
				if (!r.message) return this.show_error();
				this.pnl = r.message;
				this.render();
			},
			error: () => { if (sequence === this.pnl_sequence && load_sequence === this.load_sequence) this.show_error(); },
		});
	}

	render() {
		const d = this.data;
		const cur = frappe.utils.escape_html(d.currency);
		this.wrapper.empty();

		const delta =
			d.revenue_delta_percent === null
				? ""
				: `<span class="rh-delta ${d.revenue_delta_percent >= 0 ? "rh-up" : "rh-down"}">${d.revenue_delta_percent >= 0 ? "▲" : "▼"} ${Math.abs(d.revenue_delta_percent)}% ${this.t("к вчера", "ба дирӯз")}</span>`;

		const pulse = (icon, label, value, sub = "", cls = "") => `
			<div class="rh-card ${cls}">
				<div class="rh-card-icon">${icon}</div>
				<div class="rh-card-label">${label}</div>
				<div class="rh-card-value">${value}</div>
				<div class="rh-card-sub">${sub}</div>
			</div>`;

		const tiles = [
			["➕", this.t("Принять товар", "Қабули мол"), "restock"],
			["🏷️", this.t("Создать акцию", "Сохтани аксия"), "discount"],
			["💸", this.t("Внести расход", "Ворид кардани хароҷот"), "expense"],
			["🔄", this.t("Инкассация", "Инкассатсия"), "transfer"],
			["🛒", this.t("Касса (POS)", "Касса (POS)"), "pos"],
		]
			.map(([i, l, a]) => `<button class="rh-tile" data-action="${a}"><span>${i}</span>${l}</button>`)
			.join("");

		const alerts = d.alerts.length
			? d.alerts
					.map(
						(a, i) => `<div class="rh-alert rh-alert-${a.level}" data-idx="${i}">
						<span>${a.icon}</span><span>${frappe.utils.escape_html(a.text)}</span></div>`
					)
					.join("")
			: `<div class="rh-alert rh-alert-ok">✅ ${this.t("Нет доступных уведомлений по выбранной компании", "Барои ширкати интихобшуда огоҳии дастрас нест")}</div>`;

		const layout = $(`
			<div class="rh-layout">
				<div class="rh-pulse">
					${pulse("💵", this.t("Продажи по счетам сегодня", "Фурӯши ҳисобҳои имрӯза"), `${this.fmt(d.revenue_today)} <small>${cur}</small>`, delta, "rh-card-main")}
					${pulse("🛍️", this.t("Чеков пробито", "Чекҳо"), d.checks, `${this.t("Средний чек", "Чеки миёна")}: ${this.fmt(d.avg_check)} ${cur}`)}
					${d.hide_profit ? pulse("🔒", this.t("Доступ ограничен", "Дастрасӣ маҳдуд аст"), "—", "") : pulse("📈", this.t("Результат по проводкам сегодня", "Натиҷаи сабтҳои имрӯза"), `${this.fmt(d.net_profit_today)} <small>${cur}</small>`, `${this.t("За месяц", "Дар моҳ")}: ${this.fmt(d.net_profit_month)} ${cur}`, d.net_profit_today < 0 ? "rh-neg" : "")}
					${d.hide_profit ? "" : pulse("💰", this.t("Всего денег", "Маблағи умумӣ"), `${this.fmt(d.money.total)} <small>${cur}</small>`, `${this.t("Нал", "Нақд")}: ${this.fmt(d.money.cash)} · ${this.t("Безнал", "Ғайринақд")}: ${this.fmt(d.money.non_cash)}`)}
				</div>

				<div class="rh-title">${this.t("Быстрые действия", "Амалҳои зуд")}</div>
				<div class="rh-tiles">${tiles}</div>

				<div class="rh-title">${this.t("Требует внимания", "Диққат талаб")}</div>
				<div class="rh-alerts">${alerts}</div>

				${d.hide_profit ? "" : `				<div class="rh-title">${this.t("Результат по проводкам", "Натиҷаи сабтҳо")}
					<select aria-label="${this.t("Период", "Давра")}" id="rh-period" class="rh-select">
						<option value="today">${this.t("Сегодня", "Имрӯз")}</option>
						<option value="yesterday">${this.t("Вчера", "Дирӯз")}</option>
						<option value="week">${this.t("Эта неделя", "Ин ҳафта")}</option>
						<option value="month">${this.t("Этот месяц", "Ин моҳ")}</option>
						<option value="custom">${this.t("Произвольные даты", "Санаҳои дилхоҳ")}</option>
					</select>
					<span id="rh-custom" style="display:${this.period === "custom" ? "inline" : "none"}">
						<input aria-label="${this.t("Начало периода", "Аввали давра")}" type="date" id="rh-from" value="${this.from_date || ""}" class="rh-select">
						<input aria-label="${this.t("Конец периода", "Охири давра")}" type="date" id="rh-to" value="${this.to_date || ""}" class="rh-select">
					</span>
					<span class="rh-sub">${this.pnl.from} – ${this.pnl.to}</span>
				</div>
				${this.pnl_html(cur)}`}
			</div>
		`);
		this.wrapper.append(layout);

		layout.find("#rh-period").val(this.period).on("change", (e) => {
			this.period = e.target.value;
			if (this.period === "custom") {
				layout.find("#rh-custom").show();
			} else {
				this.load_pnl();
			}
		});
		layout.find("#rh-from, #rh-to").on("change", () => {
			this.from_date = layout.find("#rh-from").val();
			this.to_date = layout.find("#rh-to").val();
			if (this.from_date && this.to_date) this.load_pnl();
		});
		layout.find(".rh-tile").on("click", (e) => this.tile($(e.currentTarget).data("action")));
		layout.find(".rh-alert[data-idx]").on("click", (e) => {
			const a = d.alerts[$(e.currentTarget).data("idx")];
			a && a.route && frappe.set_route(...a.route);
		});
	}

	row(label, value, cur, cls = "", sign = "") {
		return `<div class="rh-pnl-row ${cls}"><span>${label}</span><span>${sign}${this.fmt(value)} ${cur}</span></div>`;
	}

	pnl_html(cur) {
		const p = this.pnl;
		const sales = p.invoice_sales;
		return `
			<div class="rh-pnl">
				${this.row(this.t("Признанный доход", "Даромади сабтшуда"), p.revenue, cur, "rh-pnl-head")}
				${this.row(this.t("Себестоимость по проводкам", "Арзиши мол аз рӯи сабтҳо"), p.cogs, cur)}
				${this.row(this.t("Прочие признанные расходы", "Дигар хароҷоти сабтшуда"), p.expenses, cur)}
				${this.row(this.t("Результат по проводкам", "Натиҷаи сабтҳо"), p.net, cur, "rh-pnl-total " + (p.net < 0 ? "rh-down" : "rh-up"))}
				<div class="rh-pnl-note">${this.t("Предварительно, в пределах доступных проводок. Это не окончательная чистая прибыль. Зарплата и налоги учитываются только при наличии проводок; полнота ещё не проверена.", "Пешакӣ, дар доираи сабтҳои дастрас. Ин фоидаи софи ниҳоӣ нест. Маош ва андоз танҳо бо сабти муҳосибӣ ҳисоб мешаванд; пуррагӣ ҳанӯз санҷида нашудааст.")}</div>
				${this.row(this.t("Продажи по счетам без налогов", "Фурӯш аз рӯи ҳисобҳо бе андоз"), sales.net_sales, cur)}
				${this.row(this.t("Возвраты включены в продажи", "Бозгаштҳо ба фурӯш дохиланд"), sales.returns, cur)}
				${this.row(this.t("POS без объединения (отдельно)", "POS бе муттаҳидсозӣ (алоҳида)"), sales.unmerged_pos_net_sales, cur)}
				<div class="rh-pnl-note">${this.t("Продажи, себестоимость и проводки могут относиться к разным датам. Непереданные офлайн-продажи неизвестны. Распределение по магазинам не настроено.", "Санаҳои фурӯш, арзиши мол ва сабтҳо метавонанд фарқ кунанд. Фурӯши офлайни фиристоданашуда номаълум аст. Тақсимот аз рӯи мағозаҳо танзим нашудааст.")}</div>
				<a class="rh-pnl-source" href="/app/query-report/Profit%20and%20Loss%20Statement?company=${encodeURIComponent(p.company)}&filter_based_on=Date%20Range&period_start_date=${encodeURIComponent(p.from_date)}&period_end_date=${encodeURIComponent(p.to_date)}&periodicity=Monthly&include_default_book_entries=1">${this.t("Открыть полный отчёт ERPNext", "Кушодани ҳисоботи пурраи ERPNext")}</a>
			</div>`;
	}

	tile(action) {
		switch (action) {
			case "restock":
				frappe.new_doc("Quick Product Restock");
				break;
			case "discount":
				frappe.new_doc("Quick Discount");
				break;
			case "expense":
				frappe.set_route("expense-desk");
				break;
			case "transfer":
				frappe.route_options = { open_transfer: 1 };
				frappe.set_route("money-hub");
				break;
			case "pos":
				frappe.set_route("posapp");
				break;
		}
	}
}
