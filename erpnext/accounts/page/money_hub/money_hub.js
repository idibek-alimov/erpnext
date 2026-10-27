// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["money-hub"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Пул (Money Hub)") : __("Деньги (Money Hub)"),
		single_column: true,
	});

	page.set_primary_action(is_tg ? __("🔄 Интиқол") : __("🔄 Перевод / Инкассация"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.open_transfer();
	});
	page.add_inner_button(is_tg ? __("➕ Ҳамёни нав") : __("➕ Создать кошелёк"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.open_creator();
	});

	page.add_inner_button(is_tg ? __("Хароҷотҳо") : __("Расходы"), () => frappe.set_route("expense-desk"));
	page.add_inner_button(is_tg ? __("Таъминкунандагон") : __("Поставщики"), () => frappe.set_route("supplier-hub"));
	page.add_inner_button(is_tg ? __("Кормандон") : __("Сотрудники"), () => frappe.set_route("staff-hub"));
	page.add_inner_button(is_tg ? __("Навсозӣ") : __("Обновить"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.load();
	});

	wrapper.money_hub_app = new MoneyHubApp(page);
};

class MoneyHubApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.is_tg = frappe.boot.user.language === "tg";
		this.data = null;
		this.tax = null;
		this.feed = [];
		this.feed_wallet = null;
		this.feed_period = "week";
		this.load();
	}

	t(ru, tg) {
		return this.is_tg ? tg : ru;
	}

	fmt(amount) {
		const n = Number(amount || 0);
		return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	load() {
		frappe.call({
			method: "erpnext.accounts.page.money_hub.money_hub.get_money_hub_data",
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.get_tax_summary",
					callback: (t) => {
						this.tax = t.message;
						this.load_feed();
					},
				});
			},
		});
	}

	load_feed() {
		frappe.call({
			method: "erpnext.accounts.page.money_hub.money_hub.get_money_feed",
			args: { wallet: this.feed_wallet, period: this.feed_period },
			callback: (r) => {
				this.feed = r.message || [];
				this.render();
				if (frappe.route_options && frappe.route_options.open_transfer) {
					frappe.route_options = null;
					this.open_transfer();
				}
			},
		});
	}

	apply(r) {
		if (r.message) {
			this.data = r.message;
			this.load();
		}
	}

	render() {
		const d = this.data;
		const cur = d.currency;
		const tt = d.totals;
		this.wrapper.empty();

		const kpi = (label, value, cls = "") => `
			<div class="mh-kpi ${cls}">
				<div class="mh-kpi-label">${label}</div>
				<div class="mh-kpi-value">${this.fmt(value)} <small>${cur}</small></div>
			</div>`;

		const cards = d.wallets.map((w) => this.wallet_card(w, cur)).join("");

		const layout = $(`
			<div class="mh-layout">
				<div class="mh-kpi-strip">
					${kpi(this.t("Всего денег", "Маблағи умумӣ"), tt.total, "mh-kpi-main")}
					${kpi(this.t("Наличные", "Нақд"), tt.cash)}
					${kpi(this.t("Безналичные", "Ғайринақд"), tt.non_cash)}
					${kpi(this.t("Сегодня приход", "Имрӯз даромад"), tt.today_in, "mh-kpi-in")}
					${kpi(this.t("Сегодня расход", "Имрӯз хароҷот"), tt.today_out, "mh-kpi-out")}
				</div>
				<div class="mh-section-title">${this.t("Мои кошельки", "Ҳамёнҳои ман")}</div>
				<div class="mh-grid">
					${cards}
					<div class="mh-card mh-card-add" id="mh-add-card">
						<div class="mh-add-plus">➕</div>
						<div>${this.t("Создать кошелёк", "Сохтани ҳамён")}</div>
					</div>
				</div>
				${this.tax_html(cur)}
				${this.feed_html(cur)}
			</div>
		`);
		this.wrapper.append(layout);

		layout.find("#mh-add-card").on("click", () => this.open_creator());
		layout.find(".mh-menu-btn").on("click", (e) => {
			e.stopPropagation();
			this.open_menu($(e.currentTarget).data("name"));
		});
		layout.find(".mh-card[data-wallet]").on("click", (e) => {
			const n = $(e.currentTarget).data("wallet");
			this.feed_wallet = this.feed_wallet === n ? null : n;
			this.load_feed();
		});
		layout.find("#mh-tax-setup").on("click", () => this.open_tax_settings());
		layout.find("#mh-tax-pay").on("click", () => this.open_pay_tax());
		layout.find("#mh-feed-period").val(this.feed_period).on("change", (e) => {
			this.feed_period = e.target.value;
			this.load_feed();
		});
		layout.find("#mh-feed-clear").on("click", () => {
			this.feed_wallet = null;
			this.load_feed();
		});
	}

	tax_html(cur) {
		const x = this.tax || {};
		const th = x.threshold || {};
		const pct = Math.min(th.percent || 0, 100);
		const gauge_cls = pct >= 100 ? "mh-gauge-red" : pct >= 80 ? "mh-gauge-orange" : "";
		const gauge = `
			<div class="mh-gauge-wrap">
				<div class="mh-gauge-label">${this.t("Оборот за 12 мес. / порог НДС", "Гардиши 12 моҳ / ҳадди ААИ")}:
					<b>${this.fmt(th.turnover_12m)}</b> / ${this.fmt(th.threshold)} ${cur} (${th.percent || 0}%)</div>
				<div class="mh-gauge"><div class="mh-gauge-bar ${gauge_cls}" style="width:${pct}%"></div></div>
				${th.percent >= 80 ? `<div class="mh-warn">⚠️ ${this.t("Вы приближаетесь к порогу НДС", "Шумо ба ҳадди ААИ наздик мешавед")}</div>` : ""}
			</div>`;
		if (!x.configured) {
			return `
				<div class="mh-section-title">🏛️ ${this.t("Налоги", "Андозҳо")}</div>
				<div class="mh-panel">
					<p>${this.t("Выберите налоговый режим, чтобы видеть налог к уплате.", "Низоми андозро интихоб кунед.")}</p>
					<button class="btn btn-primary btn-sm" id="mh-tax-setup">${this.t("Настроить налоги", "Танзими андоз")}</button>
					${gauge}
				</div>`;
		}
		const regime = { "Turnover Tax": "Упрощёнка", VAT: "НДС", Patent: "Патент" }[x.regime];
		return `
			<div class="mh-section-title">🏛️ ${this.t("Налоги", "Андозҳо")} · ${regime}
				<span class="mh-section-sub">${x.period_start} – ${x.period_end}</span></div>
			<div class="mh-panel">
				<div class="mh-tax-row">
					<div><div class="mh-kpi-label">${this.t("Начислено", "Ҳисоб шуд")}</div><div class="mh-tax-val">${this.fmt(x.accrued)}</div></div>
					<div><div class="mh-kpi-label">${this.t("Уплачено", "Пардохт шуд")}</div><div class="mh-tax-val mh-in">${this.fmt(x.paid)}</div></div>
					<div><div class="mh-kpi-label">${this.t("Остаток к уплате", "Боқимонда")}</div><div class="mh-tax-val mh-out">${this.fmt(x.due)}</div></div>
					<div class="mh-tax-actions">
						<button class="btn btn-primary btn-sm" id="mh-tax-pay">🏛️ ${this.t("Оплатить налог", "Пардохти андоз")}</button>
						<button class="btn btn-default btn-sm" id="mh-tax-setup">⚙️</button>
					</div>
				</div>
				<div class="mh-tax-detail">${x.detail} · ${this.t("Выручка за период", "Фурӯш")}: ${this.fmt(x.turnover)} ${cur}</div>
				${gauge}
			</div>`;
	}

	feed_html(cur) {
		const rows = this.feed
			.map(
				(f) => `
			<div class="mh-feed-row">
				<div class="mh-feed-icon">${f.icon}</div>
				<div class="mh-feed-main">
					<a href="/app/${frappe.router.slug(f.voucher_type)}/${encodeURIComponent(f.voucher_no)}" class="mh-feed-label">${frappe.utils.escape_html(f.label)}</a>
					<div class="mh-feed-meta">${f.wallet || ""} · ${f.user} · ${f.date} ${f.time}</div>
				</div>
				<div class="mh-feed-amount ${f.amount >= 0 ? "mh-in" : "mh-out"}">${f.amount >= 0 ? "+" : "−"}${this.fmt(Math.abs(f.amount))} ${cur}</div>
			</div>`
			)
			.join("");
		return `
			<div class="mh-section-title">${this.t("Лента денег", "Ленти пул")}
				${this.feed_wallet ? `<span class="mh-chip">${frappe.utils.escape_html(this.feed_wallet)} <a id="mh-feed-clear" style="cursor:pointer">✕</a></span>` : ""}
				<select id="mh-feed-period" class="mh-period-select">
					<option value="today">${this.t("Сегодня", "Имрӯз")}</option>
					<option value="week">${this.t("7 дней", "7 рӯз")}</option>
					<option value="month">${this.t("Месяц", "Моҳ")}</option>
					<option value="all">${this.t("Всё", "Ҳама")}</option>
				</select>
			</div>
			<div class="mh-panel mh-feed">${rows || `<div class="mh-empty">${this.t("Движений нет", "Ҳаракат нест")}</div>`}</div>`;
	}

	wallet_options() {
		return this.data.wallets.filter((w) => w.enabled).map((w) => w.name);
	}

	open_transfer() {
		const opts = this.wallet_options();
		const dlg = new frappe.ui.Dialog({
			title: this.t("Перевод / Инкассация", "Интиқол / Инкассатсия"),
			fields: [
				{ fieldname: "kind", fieldtype: "Select", label: this.t("Тип", "Навъ"), options: ["Инкассация", "Пополнение", "Снятие", "Обычный перевод"], default: "Инкассация" },
				{ fieldname: "from_wallet", fieldtype: "Select", label: this.t("Откуда", "Аз"), options: opts, reqd: 1 },
				{ fieldname: "to_wallet", fieldtype: "Select", label: this.t("Куда", "Ба"), options: opts, reqd: 1 },
				{ fieldname: "amount", fieldtype: "Currency", label: this.t("Сумма", "Маблағ"), reqd: 1 },
				{ fieldname: "note", fieldtype: "Data", label: this.t("Комментарий", "Эзоҳ") },
			],
			primary_action_label: this.t("Перевести", "Интиқол"),
			primary_action: (v) => {
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.transfer_money",
					args: v,
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
						frappe.show_alert({ message: this.t("Перевод выполнен", "Интиқол анҷом шуд"), indicator: "green" });
					},
				});
			},
		});
		dlg.show();
	}

	open_tax_settings() {
		const s = (this.tax && this.tax.settings) || {};
		const dlg = new frappe.ui.Dialog({
			title: this.t("Налоговый режим", "Низоми андоз"),
			fields: [
				{ fieldname: "tax_regime", fieldtype: "Select", label: this.t("Режим", "Низом"), options: ["Turnover Tax", "VAT", "Patent"], default: s.tax_regime || "Turnover Tax", reqd: 1,
					description: "Turnover Tax = Упрощёнка · VAT = НДС · Patent = Патент" },
				{ fieldname: "turnover_tax_rate", fieldtype: "Percent", label: this.t("Ставка упрощёнки, %", "Меъёри андоз, %"), default: s.turnover_tax_rate, depends_on: "eval:doc.tax_regime=='Turnover Tax'" },
				{ fieldname: "vat_rate", fieldtype: "Percent", label: this.t("Ставка НДС, %", "Меъёри ААИ, %"), default: s.vat_rate, depends_on: "eval:doc.tax_regime=='VAT'" },
				{ fieldname: "patent_amount", fieldtype: "Currency", label: this.t("Сумма патента за период", "Маблағи патент"), default: s.patent_amount, depends_on: "eval:doc.tax_regime=='Patent'" },
				{ fieldname: "patent_period", fieldtype: "Select", label: this.t("Период патента", "Давраи патент"), options: ["Month", "Quarter", "Year"], default: s.patent_period || "Month", depends_on: "eval:doc.tax_regime=='Patent'" },
				{ fieldname: "vat_threshold", fieldtype: "Currency", label: this.t("Порог НДС (12 мес.)", "Ҳадди ААИ"), default: s.vat_threshold || 1000000 },
			],
			primary_action_label: this.t("Сохранить", "Захира"),
			primary_action: (v) => {
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.save_tax_settings",
					args: v,
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.tax = r.message;
						this.load_feed();
					},
				});
			},
		});
		dlg.show();
	}

	open_pay_tax() {
		const due = (this.tax && this.tax.due) || 0;
		const dlg = new frappe.ui.Dialog({
			title: this.t("Оплатить налог", "Пардохти андоз"),
			fields: [
				{ fieldname: "wallet", fieldtype: "Select", label: this.t("Из кошелька", "Аз ҳамён"), options: this.wallet_options(), reqd: 1 },
				{ fieldname: "amount", fieldtype: "Currency", label: this.t("Сумма", "Маблағ"), default: due, reqd: 1 },
			],
			primary_action_label: this.t("Оплатить", "Пардохт"),
			primary_action: (v) => {
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.pay_tax",
					args: v,
					freeze: true,
					callback: (r) => {
						dlg.hide();
						if (r.message) this.data = r.message.hub;
						this.load();
						frappe.show_alert({ message: this.t("Налог оплачен", "Андоз пардохта шуд"), indicator: "green" });
					},
				});
			},
		});
		dlg.show();
	}

	wallet_card(w, cur) {
		const type_label = {
			Till: this.t("Касса", "Касса"),
			Safe: this.t("Сейф", "Сейф"),
			"Mobile Wallet": this.t("Мобильный кошелёк / QR", "Ҳамёни мобилӣ / QR"),
			Bank: this.t("Банк", "Бонк"),
		}[w.wallet_type];
		const pos_badge = w.accept_in_pos
			? `<span class="mh-chip">${this.t("В кассе POS", "Дар POS")}</span>`
			: "";
		const fee = w.commission_percent
			? `<span class="mh-chip mh-chip-fee">${w.commission_percent}%</span>`
			: "";
		return `
			<div class="mh-card ${this.feed_wallet === w.name ? "mh-card-active" : ""}" data-wallet="${frappe.utils.escape_html(w.name)}" style="--mh-accent: ${w.color || "#4a5568"}; cursor: pointer">
				<div class="mh-card-top">
					<div class="mh-card-icon">${w.icon || "💰"}</div>
					<button class="mh-menu-btn" data-name="${frappe.utils.escape_html(w.name)}">⋯</button>
				</div>
				<div class="mh-card-name">${frappe.utils.escape_html(w.wallet_name)}</div>
				<div class="mh-card-type">${type_label} ${pos_badge} ${fee}</div>
				<div class="mh-card-balance">${this.fmt(w.balance)} <small>${cur}</small></div>
				<div class="mh-card-flow">
					<span class="mh-in">▲ ${this.fmt(w.today_in)}</span>
					<span class="mh-out">▼ ${this.fmt(w.today_out)}</span>
				</div>
			</div>`;
	}

	open_creator() {
		const dlg = new frappe.ui.Dialog({
			title: this.t("Новый кошелёк", "Ҳамёни нав"),
			fields: [
				{ fieldname: "wallet_name", fieldtype: "Data", label: this.t("Название (например: Alif QR)", "Ном"), reqd: 1 },
				{
					fieldname: "wallet_type",
					fieldtype: "Select",
					label: this.t("Тип", "Навъ"),
					options: [
						{ value: "Mobile Wallet", label: this.t("📱 Мобильный кошелёк / QR", "📱 Ҳамёни мобилӣ / QR") },
						{ value: "Till", label: this.t("💵 Касса", "💵 Касса") },
						{ value: "Safe", label: this.t("🔐 Сейф", "🔐 Сейф") },
						{ value: "Bank", label: this.t("🏦 Банк", "🏦 Бонк") },
					],
					default: "Mobile Wallet",
					reqd: 1,
				},
				{ fieldname: "opening_balance", fieldtype: "Currency", label: this.t("Начальный остаток", "Бақияи аввалия"), default: 0 },
				{ fieldname: "accept_in_pos", fieldtype: "Check", label: this.t("Принимать оплату в POS", "Дар POS қабул шавад"), default: 1 },
				{ fieldname: "commission_percent", fieldtype: "Percent", label: this.t("Комиссия, %", "Комиссия, %"), default: 0 },
			],
			primary_action_label: this.t("Создать", "Сохтан"),
			primary_action: (v) => {
				dlg.get_primary_btn().prop("disabled", true);
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.create_wallet",
					args: v,
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
						frappe.show_alert({ message: this.t("Кошелёк создан", "Ҳамён сохта шуд"), indicator: "green" });
					},
					error: () => dlg.get_primary_btn().prop("disabled", false),
				});
			},
		});
		dlg.show();
	}

	open_menu(name) {
		const w = this.data.wallets.find((x) => x.name === name);
		if (!w) return;
		const dlg = new frappe.ui.Dialog({
			title: w.wallet_name,
			fields: [
				{ fieldname: "wallet_name", fieldtype: "Data", label: this.t("Название", "Ном"), default: w.wallet_name },
				{ fieldname: "commission_percent", fieldtype: "Percent", label: this.t("Комиссия, %", "Комиссия, %"), default: w.commission_percent },
				{ fieldname: "enabled", fieldtype: "Check", label: this.t("Показывать", "Нишон дода шавад"), default: 1 },
			],
			primary_action_label: this.t("Сохранить", "Захира"),
			primary_action: (v) => {
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.update_wallet",
					args: { name: w.name, ...v },
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
					},
				});
			},
		});
		dlg.show();
	}
}
