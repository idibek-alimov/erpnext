// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["money-hub"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Пул (Money Hub)") : __("Деньги (Money Hub)"),
		single_column: true,
	});

	page.set_primary_action(is_tg ? __("➕ Ҳамёни нав") : __("➕ Создать кошелёк"), () => {
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
				if (r.message) {
					this.data = r.message;
					this.render();
				}
			},
		});
	}

	apply(r) {
		if (r.message) {
			this.data = r.message;
			this.render();
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
			</div>
		`);
		this.wrapper.append(layout);

		layout.find("#mh-add-card").on("click", () => this.open_creator());
		layout.find(".mh-menu-btn").on("click", (e) => {
			e.stopPropagation();
			this.open_menu($(e.currentTarget).data("name"));
		});
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
			<div class="mh-card" style="--mh-accent: ${w.color || "#4a5568"}">
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
