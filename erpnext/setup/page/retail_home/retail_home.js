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
	}

	t(ru, tg) {
		return this.is_tg ? tg : ru;
	}

	fmt(v) {
		return Number(v || 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	load() {
		frappe.call({
			method: "erpnext.setup.page.retail_home.retail_home.get_business_pulse",
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.pnl = r.message.pnl;
				this.render();
			},
		});
	}

	load_pnl() {
		frappe.call({
			method: "erpnext.setup.page.retail_home.retail_home.get_pnl",
			args: { period: this.period, from_date: this.from_date, to_date: this.to_date },
			callback: (r) => {
				this.pnl = r.message;
				this.render();
			},
		});
	}

	render() {
		const d = this.data;
		const cur = d.currency;
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
			: `<div class="rh-alert rh-alert-ok">✅ ${this.t("Всё в порядке — срочных дел нет", "Ҳама чиз хуб аст")}</div>`;

		const layout = $(`
			<div class="rh-layout">
				<div class="rh-pulse">
					${pulse("💵", this.t("Выручка сегодня", "Фурӯши имрӯза"), `${this.fmt(d.revenue_today)} <small>${cur}</small>`, delta, "rh-card-main")}
					${pulse("🛍️", this.t("Чеков пробито", "Чекҳо"), d.checks, `${this.t("Средний чек", "Чеки миёна")}: ${this.fmt(d.avg_check)} ${cur}`)}
					${pulse("📈", this.t("Чистая прибыль сегодня", "Фоидаи софи"), `${this.fmt(d.net_profit_today)} <small>${cur}</small>`, `${this.t("За месяц", "Дар моҳ")}: ${this.fmt(d.net_profit_month)} ${cur}`, d.net_profit_today < 0 ? "rh-neg" : "")}
					${pulse("💰", this.t("Всего денег", "Маблағи умумӣ"), `${this.fmt(d.money.total)} <small>${cur}</small>`, `${this.t("Нал", "Нақд")}: ${this.fmt(d.money.cash)} · ${this.t("Безнал", "Ғайринақд")}: ${this.fmt(d.money.non_cash)}`)}
				</div>

				<div class="rh-title">${this.t("Быстрые действия", "Амалҳои зуд")}</div>
				<div class="rh-tiles">${tiles}</div>

				<div class="rh-title">${this.t("Требует внимания", "Диққат талаб")}</div>
				<div class="rh-alerts">${alerts}</div>

				<div class="rh-title">${this.t("Прибыль", "Фоида")}
					<select id="rh-period" class="rh-select">
						<option value="today">${this.t("Сегодня", "Имрӯз")}</option>
						<option value="yesterday">${this.t("Вчера", "Дирӯз")}</option>
						<option value="week">${this.t("Эта неделя", "Ин ҳафта")}</option>
						<option value="month">${this.t("Этот месяц", "Ин моҳ")}</option>
						<option value="custom">${this.t("Произвольные даты", "Санаҳои дилхоҳ")}</option>
					</select>
					<span id="rh-custom" style="display:${this.period === "custom" ? "inline" : "none"}">
						<input type="date" id="rh-from" value="${this.from_date || ""}" class="rh-select">
						<input type="date" id="rh-to" value="${this.to_date || ""}" class="rh-select">
					</span>
					<span class="rh-sub">${this.pnl.from} – ${this.pnl.to}</span>
				</div>
				${this.pnl_html(cur)}
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
		return `
			<div class="rh-pnl">
				${this.row(this.t("Выручка", "Фурӯш"), p.revenue, cur, "rh-pnl-head")}
				${this.row(this.t("Себестоимость товара", "Арзиши мол"), p.cogs, cur, "", "− ")}
				${this.row(this.t("Расходы (касса)", "Хароҷоти касса"), p.expenses, cur, "", "− ")}
				${this.row(this.t("Зарплаты и комиссии", "Маош ва комиссия"), p.salaries, cur, "", "− ")}
				${this.row(this.t("Налог", "Андоз"), p.taxes, cur, "", "− ")}
				${this.row(this.t("Чистая прибыль", "Фоидаи софӣ"), p.net, cur, "rh-pnl-total " + (p.net < 0 ? "rh-down" : "rh-up"))}
				<div class="rh-pnl-note">${this.t("Чеков", "Чекҳо")}: ${p.checks} · ${this.t("Валовая прибыль", "Фоидаи умумӣ")}: ${this.fmt(p.gross)} ${cur}</div>
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
