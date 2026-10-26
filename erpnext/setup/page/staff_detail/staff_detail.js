// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["staff-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Employee Detail"),
		single_column: true,
	});

	wrapper.staff_detail_app = new StaffDetailApp(page);
};

frappe.pages["staff-detail"].on_page_show = function (wrapper) {
	const route = frappe.get_route();
	const employee_id = route[1];
	if (employee_id && wrapper.staff_detail_app) {
		wrapper.staff_detail_app.load(decodeURIComponent(employee_id));
	}
};

class StaffDetailApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body).addClass("staff-detail-page");
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.employee = null;
		this.data = null;
		this.period = "this_month";
		this.active_tab = "tab-sales";

		this.setup_header_actions();
	}

	t(key) {
		const dict = {
			back_to_hub: { tg: "⬅️ Хаби кормандон", ru: "⬅️ Назад в Хаб" },
			btn_add_expense: { tg: "🍔 + Хароҷот (Хӯрок/Такси)", ru: "🍔 + Расход (Обед/Такси)" },
			btn_add_incentive: { tg: "🎁 + Бонус / Ҷарима", ru: "🎁 + Бонус / Штраф" },
			btn_add_advance: { tg: "💸 + Аванс", ru: "💸 + Выдать аванс" },
			btn_settle: { tg: "💰 Ҳисоббаробаркунӣ (Пардохт)", ru: "💰 Рассчитать и выплатить" },
			btn_refresh: { tg: "Навсозӣ", ru: "Обновить" },

			kpi_base_salary: { tg: "Маоши асосӣ", ru: "Базовый оклад" },
			kpi_sales: { tg: "Фурӯши корманд", ru: "Продажи сотрудника" },
			kpi_commission: { tg: "Комиссия", ru: "Комиссия" },
			kpi_bonuses: { tg: "Бонусҳо (+)", ru: "Бонусы (+)" },
			kpi_advances: { tg: "Авансҳо (-)", ru: "Авансы (-)" },
			kpi_expenses: { tg: "Хароҷот (Ширкат)", ru: "Расходы (Компания)" },
			kpi_payable: { tg: "Бақияи пардохт", ru: "Итого к выплате" },

			tab_sales: { tg: "🧾 Фурӯш ва комиссияҳо", ru: "🧾 Продажи и комиссии" },
			tab_expenses: { tg: "🍔 Хароҷоти ширкат (Обед/Такси)", ru: "🍔 Расходы компании (Обед/Такси)" },
			tab_incentives: { tg: "🎁 Бонусҳо ва ҷаримаҳо", ru: "🎁 Бонусы и штрафы" },
			tab_advances: { tg: "💸 Авансҳо ва пардохтҳо", ru: "💸 Авансы и выплаты" },
			tab_settings: { tg: "⚙️ Танзимот ва оклад", ru: "⚙️ Настройки и оклад" },

			period_today: { tg: "Имрӯз", ru: "Сегодня" },
			period_week: { tg: "Ин ҳафта", ru: "Эта неделя" },
			period_month: { tg: "Ин моҳ", ru: "Этот месяц" },
			period_last_month: { tg: "Моҳи гузашта", ru: "Прошлый месяц" },

			save_settings_btn: { tg: "💾 Сабти танзимот", ru: "💾 Сохранить настройки" },
			save_success: { tg: "Танзимоти корманд сабт шуд!", ru: "Настройки сотрудника успешно сохранены!" },
			action_success: { tg: "Муваффақона иҷро шуд!", ru: "Успешно выполнено!" },
		};
		return dict[key] ? dict[key][this.lang] : key;
	}

	setup_header_actions() {
		this.page.set_secondary_action(this.t("back_to_hub"), () => {
			frappe.set_route("staff-hub");
		});

		this.page.add_inner_button(this.t("btn_refresh"), () => {
			if (this.employee) this.load(this.employee);
		});
	}

	load(employee_id) {
		this.employee = employee_id;
		this.page.set_title(employee_id);

		frappe.call({
			method: "erpnext.setup.page.staff_detail.staff_detail.get_staff_detail",
			args: {
				employee: this.employee,
				period: this.period,
			},
			callback: (r) => {
				if (r.message) {
					this.data = r.message;
					this.render();
				}
			},
		});
	}

	render() {
		if (!this.data) return;
		const emp = this.data.employee;
		const s = this.data.summary;
		const curr = s.currency || "TJS";

		this.page.set_title(`${emp.employee_name} (${emp.name})`);

		const initials = (emp.employee_name || emp.name || "")
			.split(" ")
			.map((w) => w[0])
			.slice(0, 2)
			.join("")
			.toUpperCase();

		const avatarHtml = emp.image
			? `<img class="staff-detail-avatar" src="${emp.image}" alt="${frappe.utils.escape_html(emp.employee_name)}">`
			: `<div class="staff-detail-avatar">${initials || "👤"}</div>`;

		const statusClass = emp.status === "Active" ? "active" : "inactive";

		this.wrapper.html(`
			<!-- Top Profile Header & Action Buttons -->
			<div class="staff-profile-card">
				<div class="staff-profile-left">
					${avatarHtml}
					<div class="staff-profile-info">
						<div class="staff-profile-name">
							<span>${frappe.utils.escape_html(emp.employee_name)}</span>
							<span class="badge-status ${statusClass}">${emp.status}</span>
						</div>
						<div class="staff-profile-sub">
							<span>💼 ${frappe.utils.escape_html(emp.designation || "Staff")}</span>
							${emp.cell_number ? `<span>📞 ${frappe.utils.escape_html(emp.cell_number)}</span>` : ""}
							${emp.department ? `<span>🏢 ${frappe.utils.escape_html(emp.department)}</span>` : ""}
						</div>
					</div>
				</div>

				<div class="staff-profile-actions">
					<button type="button" class="btn-action" id="btn-modal-expense">${this.t("btn_add_expense")}</button>
					<button type="button" class="btn-action" id="btn-modal-incentive">${this.t("btn_add_incentive")}</button>
					<button type="button" class="btn-action" id="btn-modal-advance">${this.t("btn_add_advance")}</button>
					<button type="button" class="btn-action btn-settle" id="btn-modal-settle">${this.t("btn_settle")}</button>
				</div>
			</div>

			<!-- Period Filter Bar -->
			<div class="detail-period-bar">
				<div class="period-pill-group">
					<button type="button" class="period-pill ${this.period === "today" ? "active" : ""}" data-period="today">${this.t("period_today")}</button>
					<button type="button" class="period-pill ${this.period === "this_week" ? "active" : ""}" data-period="this_week">${this.t("period_week")}</button>
					<button type="button" class="period-pill ${this.period === "this_month" ? "active" : ""}" data-period="this_month">${this.t("period_month")}</button>
					<button type="button" class="period-pill ${this.period === "last_month" ? "active" : ""}" data-period="last_month">${this.t("period_last_month")}</button>
				</div>
			</div>

			<!-- Top Financial KPI Grid -->
			<div class="detail-kpi-grid">
				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_base_salary")}</span>
					<span class="detail-kpi-value">${this.format_currency(s.base_salary, curr)}</span>
					<span class="detail-kpi-sub">${emp.salary_frequency}</span>
				</div>

				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_sales")}</span>
					<span class="detail-kpi-value">${this.format_currency(s.sales_volume, curr)}</span>
					<span class="detail-kpi-sub">${this.lang === "tg" ? "Фоида:" : "Прибыль:"} ${this.format_currency(s.gross_profit, curr)}</span>
				</div>

				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_commission")}</span>
					<span class="detail-kpi-value val-positive">+${this.format_currency(s.commission_amount, curr)}</span>
					<span class="detail-kpi-sub">${s.commission_rate ? s.commission_rate + "%" : "0%"}</span>
				</div>

				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_bonuses")}</span>
					<span class="detail-kpi-value ${s.bonuses_total > 0 ? "val-positive" : ""}">+${this.format_currency(s.bonuses_total, curr)}</span>
					<span class="detail-kpi-sub">${s.penalties_total > 0 ? `-${this.format_currency(s.penalties_total, curr)}` : "0"}</span>
				</div>

				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_advances")}</span>
					<span class="detail-kpi-value ${s.advances_total > 0 ? "val-negative" : ""}">-${this.format_currency(s.advances_total, curr)}</span>
					<span class="detail-kpi-sub">${this.lang === "tg" ? "Аз маош тарҳ" : "Вычет из з/п"}</span>
				</div>

				<div class="detail-kpi-card">
					<span class="detail-kpi-label">${this.t("kpi_expenses")}</span>
					<span class="detail-kpi-value">${this.format_currency(s.expenses_total, curr)}</span>
					<span class="detail-kpi-sub">${this.lang === "tg" ? "Ширкат мепардозад" : "Оплачено фирмой"}</span>
				</div>

				<div class="detail-kpi-card kpi-highlight">
					<span class="detail-kpi-label">${this.t("kpi_payable")}</span>
					<span class="detail-kpi-value">${this.format_currency(s.net_payable, curr)}</span>
					<span class="detail-kpi-sub">${this.lang === "tg" ? "Бақияи холис" : "Чистый остаток"}</span>
				</div>
			</div>

			<!-- Navigation Tabs -->
			<div class="staff-tabs-nav">
				<button type="button" class="staff-tab-btn ${this.active_tab === "tab-sales" ? "active" : ""}" data-tab="tab-sales">
					${this.t("tab_sales")}
					<span class="staff-tab-badge">${(this.data.invoices || []).length}</span>
				</button>
				<button type="button" class="staff-tab-btn ${this.active_tab === "tab-expenses" ? "active" : ""}" data-tab="tab-expenses">
					${this.t("tab_expenses")}
					<span class="staff-tab-badge">${(this.data.expenses || []).length}</span>
				</button>
				<button type="button" class="staff-tab-btn ${this.active_tab === "tab-incentives" ? "active" : ""}" data-tab="tab-incentives">
					${this.t("tab_incentives")}
					<span class="staff-tab-badge">${(this.data.incentives || []).length}</span>
				</button>
				<button type="button" class="staff-tab-btn ${this.active_tab === "tab-advances" ? "active" : ""}" data-tab="tab-advances">
					${this.t("tab_advances")}
					<span class="staff-tab-badge">${(this.data.advances || []).length + (this.data.settlements || []).length}</span>
				</button>
				<button type="button" class="staff-tab-btn ${this.active_tab === "tab-settings" ? "active" : ""}" data-tab="tab-settings">
					${this.t("tab_settings")}
				</button>
			</div>

			<!-- Tab Contents -->
			<div class="staff-tab-content">
				<div class="staff-tab-pane ${this.active_tab === "tab-sales" ? "active" : ""}" id="pane-tab-sales">
					${this.render_sales_tab()}
				</div>
				<div class="staff-tab-pane ${this.active_tab === "tab-expenses" ? "active" : ""}" id="pane-tab-expenses">
					${this.render_expenses_tab()}
				</div>
				<div class="staff-tab-pane ${this.active_tab === "tab-incentives" ? "active" : ""}" id="pane-tab-incentives">
					${this.render_incentives_tab()}
				</div>
				<div class="staff-tab-pane ${this.active_tab === "tab-advances" ? "active" : ""}" id="pane-tab-advances">
					${this.render_advances_tab()}
				</div>
				<div class="staff-tab-pane ${this.active_tab === "tab-settings" ? "active" : ""}" id="pane-tab-settings">
					${this.render_settings_tab()}
				</div>
			</div>
		`);

		this.bind_events();
	}

	render_sales_tab() {
		const invoices = this.data.invoices || [];
		const curr = this.data.summary.currency || "TJS";
		const scheme = this.data.scheme_info;

		let tierProgressHtml = "";
		if (scheme && scheme.calculation_type === "Tiered / Slab Rate" && scheme.tiers && scheme.tiers.length > 0) {
			const basisVal = scheme.basis === "Gross Profit Margin" ? this.data.summary.gross_profit : this.data.summary.sales_volume;
			tierProgressHtml = `
				<div class="commission-tier-box">
					<div style="font-weight: 600; font-size: 13px;">
						⚡ ${this.lang === "tg" ? "Схемаи табақавӣ:" : "Ступенчатая схема:"} <strong>${scheme.name}</strong> 
						(${scheme.basis}) • ${this.lang === "tg" ? "Ҳозира:" : "Текущий объём:"} <strong>${this.format_currency(basisVal, curr)}</strong>
					</div>
					<div class="commission-tier-steps">
						${scheme.tiers
							.map((t) => {
								const fromA = t.from_amount;
								const toA = t.to_amount > 0 ? t.to_amount : "∞";
								const isActive = basisVal >= fromA && (t.to_amount === 0 || basisVal <= t.to_amount);
								return `
									<div class="tier-step ${isActive ? "tier-active" : ""}">
										<span class="tier-step-label">${fromA.toLocaleString("ru-RU")} - ${toA.toLocaleString("ru-RU")} ${curr}</span>
										<span class="tier-step-val">${t.commission_percent}%</span>
									</div>
								`;
							})
							.join("")}
					</div>
				</div>
			`;
		}

		let rowsHtml = "";
		if (invoices.length === 0) {
			rowsHtml = `<tr><td colspan="5" class="staff-empty-state"><div class="staff-empty-text">${this.lang === "tg" ? "Дар ин давра фурӯш ёфт нашуд" : "В этом периоде продаж не найдено"}</div></td></tr>`;
		} else {
			invoices.forEach((inv) => {
				rowsHtml += `
					<tr>
						<td><a href="/app/sales-invoice/${inv.name}"><strong>${inv.name}</strong></a></td>
						<td>${inv.posting_date}</td>
						<td>${frappe.utils.escape_html(inv.customer_name || "-")}</td>
						<td class="text-right"><strong>${this.format_currency(inv.grand_total, curr)}</strong></td>
						<td class="text-right val-positive">${this.format_currency(inv.gross_profit, curr)}</td>
					</tr>
				`;
			});
		}

		return `
			<div class="detail-content-card">
				${tierProgressHtml}
				<div class="staff-table-wrapper">
					<table class="staff-table">
						<thead>
							<tr>
								<th>${this.lang === "tg" ? "Рақами чек / Накладной" : "Накладная / Чек"}</th>
								<th>${this.lang === "tg" ? "Сана" : "Дата"}</th>
								<th>${this.lang === "tg" ? "Мизоҷ" : "Клиент"}</th>
								<th class="text-right">${this.lang === "tg" ? "Ҳаҷми фурӯш" : "Сумма продажи"}</th>
								<th class="text-right">${this.lang === "tg" ? "Фоидаи соф" : "Прибыль (Маржа)"}</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	render_expenses_tab() {
		const expenses = this.data.expenses || [];
		const curr = this.data.summary.currency || "TJS";

		let rowsHtml = "";
		if (expenses.length === 0) {
			rowsHtml = `<tr><td colspan="5" class="staff-empty-state"><div class="staff-empty-text">${this.lang === "tg" ? "Хароҷот сабт нашудааст" : "Расходов не зарегистрировано"}</div></td></tr>`;
		} else {
			expenses.forEach((e) => {
				rowsHtml += `
					<tr>
						<td><a href="/app/quick-expense/${e.name}"><strong>${e.name}</strong></a></td>
						<td>${e.posting_date}</td>
						<td><span class="badge-scheme">🏷️ ${frappe.utils.escape_html(e.expense_category)}</span></td>
						<td>${frappe.utils.escape_html(e.paid_from || "-")} ${e.description ? "• " + frappe.utils.escape_html(e.description) : ""}</td>
						<td class="text-right"><strong>${this.format_currency(e.amount, curr)}</strong></td>
					</tr>
				`;
			});
		}

		return `
			<div class="detail-content-card">
				<div class="detail-card-title">
					<span>🍔 ${this.lang === "tg" ? "Хароҷоти ҳаррӯзаи ширкат барои корманд (Хӯрок, Такси ва ғ.)" : "Ежедневные расходы компании на сотрудника (Обед, Такси и др.)"}</span>
					<button type="button" class="btn-action" id="btn-tab-add-expense">+ ${this.lang === "tg" ? "Сабти хароҷот" : "Добавить расход"}</button>
				</div>
				<p style="font-size: 12.5px; color: var(--text-muted); margin-bottom: 12px;">
					ℹ️ ${this.lang === "tg" ? "Ин хароҷот аз ҳисоби ширкат пардохт мешавад ва аз маоши корманд тарҳ намешавад." : "Эти расходы оплачиваются компанией и НЕ вычитаются из зарплаты сотрудника."}
				</p>
				<div class="staff-table-wrapper">
					<table class="staff-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>${this.lang === "tg" ? "Сана" : "Дата"}</th>
								<th>${this.lang === "tg" ? "Категория" : "Категория"}</th>
								<th>${this.lang === "tg" ? "Аз куҷо пардохт шуд / Тавзеҳ" : "Откуда оплачено / Описание"}</th>
								<th class="text-right">${this.lang === "tg" ? "Маблағ" : "Сумма"}</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	render_incentives_tab() {
		const incentives = this.data.incentives || [];
		const curr = this.data.summary.currency || "TJS";

		let rowsHtml = "";
		if (incentives.length === 0) {
			rowsHtml = `<tr><td colspan="6" class="staff-empty-state"><div class="staff-empty-text">${this.lang === "tg" ? "Бонус ё ҷарима нест" : "Бонусов или штрафов нет"}</div></td></tr>`;
		} else {
			incentives.forEach((i) => {
				const isBonus = i.type === "Bonus";
				rowsHtml += `
					<tr>
						<td><a href="/app/staff-incentive/${i.name}"><strong>${i.name}</strong></a></td>
						<td>${i.posting_date}</td>
						<td><span class="badge-status ${isBonus ? "active" : "inactive"}">${isBonus ? "➕ Бонус" : "➖ Штраф"}</span></td>
						<td>${frappe.utils.escape_html(i.category)}</td>
						<td>${frappe.utils.escape_html(i.reason)}</td>
						<td class="text-right ${isBonus ? "val-positive" : "val-negative"}">
							<strong>${isBonus ? "+" : "-"}${this.format_currency(i.amount, curr)}</strong>
						</td>
					</tr>
				`;
			});
		}

		return `
			<div class="detail-content-card">
				<div class="detail-card-title">
					<span>🎁 ${this.lang === "tg" ? "Бонусҳо ва ҷаримаҳо" : "Бонусы и штрафы"}</span>
					<button type="button" class="btn-action" id="btn-tab-add-incentive">+ ${this.lang === "tg" ? "Иловаи бонус / ҷарима" : "Добавить бонус / штраф"}</button>
				</div>
				<div class="staff-table-wrapper">
					<table class="staff-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>${this.lang === "tg" ? "Сана" : "Дата"}</th>
								<th>${this.lang === "tg" ? "Намуд" : "Тип"}</th>
								<th>${this.lang === "tg" ? "Категория" : "Категория"}</th>
								<th>${this.lang === "tg" ? "Сабаб" : "Причина"}</th>
								<th class="text-right">${this.lang === "tg" ? "Маблағ" : "Сумма"}</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	render_advances_tab() {
		const advances = this.data.advances || [];
		const settlements = this.data.settlements || [];
		const curr = this.data.summary.currency || "TJS";

		let advRowsHtml = "";
		if (advances.length === 0) {
			advRowsHtml = `<tr><td colspan="5" class="staff-empty-state"><div class="staff-empty-text">${this.lang === "tg" ? "Аванс сабт нашудааст" : "Авансов не выдавалось"}</div></td></tr>`;
		} else {
			advances.forEach((a) => {
				advRowsHtml += `
					<tr>
						<td><a href="/app/staff-advance/${a.name}"><strong>${a.name}</strong></a></td>
						<td>${a.posting_date}</td>
						<td>${frappe.utils.escape_html(a.paid_from || "-")}</td>
						<td>${frappe.utils.escape_html(a.reason || "-")}</td>
						<td class="text-right val-negative"><strong>-${this.format_currency(a.amount, curr)}</strong></td>
					</tr>
				`;
			});
		}

		let settRowsHtml = "";
		if (settlements.length === 0) {
			settRowsHtml = `<tr><td colspan="5" class="staff-empty-state"><div class="staff-empty-text">${this.lang === "tg" ? "Таърихи ҳисоббаробаркунӣ нест" : "Истории выплат нет"}</div></td></tr>`;
		} else {
			settlements.forEach((s) => {
				settRowsHtml += `
					<tr>
						<td><a href="/app/staff-settlement/${s.name}"><strong>${s.name}</strong></a></td>
						<td>${s.posting_date}</td>
						<td>${s.start_date} - ${s.end_date}</td>
						<td>${frappe.utils.escape_html(s.paid_from || "-")}</td>
						<td class="text-right val-highlight"><strong>${this.format_currency(s.net_payable, curr)}</strong></td>
					</tr>
				`;
			});
		}

		return `
			<div class="detail-content-card">
				<div class="detail-card-title">
					<span>💸 ${this.lang === "tg" ? "Авансҳои пешакӣ гирифташуда (Аванс)" : "Выданные авансы"}</span>
					<button type="button" class="btn-action" id="btn-tab-add-advance">+ ${this.lang === "tg" ? "Додани аванс" : "Выдать аванс"}</button>
				</div>
				<div class="staff-table-wrapper" style="margin-bottom: 24px;">
					<table class="staff-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>${this.lang === "tg" ? "Сана" : "Дата"}</th>
								<th>${this.lang === "tg" ? "Аз куҷо пардохт шуд" : "Откуда выдано"}</th>
								<th>${this.lang === "tg" ? "Сабаб" : "Причина"}</th>
								<th class="text-right">${this.lang === "tg" ? "Маблағи аванс" : "Сумма аванса"}</th>
							</tr>
						</thead>
						<tbody>
							${advRowsHtml}
						</tbody>
					</table>
				</div>

				<div class="detail-card-title">
					<span>📜 ${this.lang === "tg" ? "Таърихи пардохтҳои маош (Ҳисоббаробаркуниҳо)" : "История выплат зарплаты и расчетов"}</span>
				</div>
				<div class="staff-table-wrapper">
					<table class="staff-table">
						<thead>
							<tr>
								<th>ID</th>
								<th>${this.lang === "tg" ? "Сана" : "Дата"}</th>
								<th>${this.lang === "tg" ? "Давра" : "Период"}</th>
								<th>${this.lang === "tg" ? "Манбаи пардохт" : "Источник выплаты"}</th>
								<th class="text-right">${this.lang === "tg" ? "Маблағи пардохтшуда" : "Выплаченная сумма"}</th>
							</tr>
						</thead>
						<tbody>
							${settRowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`;
	}

	render_settings_tab() {
		const emp = this.data.employee;
		const schemes = this.data.schemes_list || [];
		const sources = this.data.payment_sources || [];

		return `
			<div class="detail-content-card">
				<div class="detail-card-title">
					<span>⚙️ ${this.lang === "tg" ? "Танзимоти маош ва комиссияи корманд" : "Настройки оклада и схемы комиссий"}</span>
				</div>

				<div class="settings-grid">
					<div class="settings-field">
						<label>${this.lang === "tg" ? "Маоши асосӣ (Оклад)" : "Базовый оклад"}</label>
						<input type="number" id="setting-base-salary" value="${emp.base_salary}">
						<small>${this.lang === "tg" ? "Маблағи муқарраршуда" : "Фиксированная часть з/п"}</small>
					</div>

					<div class="settings-field">
						<label>${this.lang === "tg" ? "Басомади пардохт" : "Периодичность оклада"}</label>
						<select id="setting-salary-frequency">
							<option value="Monthly" ${emp.salary_frequency === "Monthly" ? "selected" : ""}>${this.lang === "tg" ? "Моҳона (Monthly)" : "Ежемесячно"}</option>
							<option value="Weekly" ${emp.salary_frequency === "Weekly" ? "selected" : ""}>${this.lang === "tg" ? "Ҳафтаина (Weekly)" : "Еженедельно"}</option>
							<option value="Daily" ${emp.salary_frequency === "Daily" ? "selected" : ""}>${this.lang === "tg" ? "Рӯзона (Daily)" : "Ежедневно"}</option>
						</select>
					</div>

					<div class="settings-field">
						<label>${this.lang === "tg" ? "Схемаи комиссия" : "Схема комиссионных"}</label>
						<select id="setting-commission-scheme">
							<option value="">${this.lang === "tg" ? "-- Бе комиссия --" : "-- Без комиссии --"}</option>
							${schemes
								.map(
									(s) =>
										`<option value="${s.name}" ${emp.custom_commission_scheme === s.name ? "selected" : ""}>${s.name} (${s.calculation_type})</option>`
								)
								.join("")}
						</select>
						<small><a href="/app/staff-commission-scheme" target="_blank">${this.lang === "tg" ? "Мудирияти схемаҳо ↗" : "Управление схемами ↗"}</a></small>
					</div>

					<div class="settings-field">
						<label>${this.lang === "tg" ? "Касса ё суратҳисоби пешфарз" : "Касса/счет по умолчанию"}</label>
						<select id="setting-cash-account">
							<option value="">${this.lang === "tg" ? "-- Интихоб кунед --" : "-- Выберите кассу --"}</option>
							${sources
								.map(
									(src) =>
										`<option value="${src.account}" ${emp.custom_default_cash_account === src.account ? "selected" : ""}>${src.label} (${src.account})</option>`
								)
								.join("")}
						</select>
						<small>${this.lang === "tg" ? "Касса барои додани аванс ва маош" : "Основная касса для выплат"}</small>
					</div>
				</div>

				<button type="button" class="btn-action btn-settle" id="btn-save-staff-settings">
					${this.t("save_settings_btn")}
				</button>
			</div>
		`;
	}

	bind_events() {
		// Tab Switching
		this.wrapper.find(".staff-tab-btn").on("click", (e) => {
			this.wrapper.find(".staff-tab-btn").removeClass("active");
			this.wrapper.find(".staff-tab-pane").removeClass("active");

			const $btn = $(e.currentTarget);
			$btn.addClass("active");
			this.active_tab = $btn.attr("data-tab");
			this.wrapper.find(`#pane-${this.active_tab}`).addClass("active");
		});

		// Period Filter
		this.wrapper.find(".period-pill").on("click", (e) => {
			this.wrapper.find(".period-pill").removeClass("active");
			const $btn = $(e.currentTarget);
			$btn.addClass("active");
			this.period = $btn.attr("data-period");
			this.load(this.employee);
		});

		// Modal Triggers
		this.wrapper.find("#btn-modal-expense, #btn-tab-add-expense").on("click", () => this.show_expense_dialog());
		this.wrapper.find("#btn-modal-incentive, #btn-tab-add-incentive").on("click", () => this.show_incentive_dialog());
		this.wrapper.find("#btn-modal-advance, #btn-tab-add-advance").on("click", () => this.show_advance_dialog());
		this.wrapper.find("#btn-modal-settle").on("click", () => this.show_settlement_dialog());

		// Settings save
		this.wrapper.find("#btn-save-staff-settings").on("click", () => this.save_settings());
	}

	show_expense_dialog() {
		const categories = this.data.categories || [];
		const sources = this.data.payment_sources || [];
		const defaultSource = this.data.employee.custom_default_cash_account || (sources[0] ? sources[0].account : "");

		const d = new frappe.ui.Dialog({
			title: this.lang === "tg" ? "🍔 Сабти хароҷот (Хӯрок, Такси)" : "🍔 Расход компании на сотрудника",
			fields: [
				{
					label: this.lang === "tg" ? "Категория" : "Категория расхода",
					fieldname: "expense_category",
					fieldtype: "Select",
					options: categories.map((c) => c.category_name).join("\n") || "Питание и чай\nТакси и транспорт\nПрочие расходы",
					default: "Питание и чай",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Маблағ" : "Сумма",
					fieldname: "amount",
					fieldtype: "Currency",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Манбаи пардохт (Касса / Сейф)" : "Откуда оплачено (Касса / Сейф / Счет)",
					fieldname: "paid_from",
					fieldtype: "Select",
					options: sources.map((s) => `${s.label} (${s.account})`).join("\n") || defaultSource,
					default: sources[0] ? `${sources[0].label} (${sources[0].account})` : "",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Тавзеҳот" : "Примечание / Заметка",
					fieldname: "description",
					fieldtype: "Small Text",
				},
			],
			primary_action_label: this.lang === "tg" ? "Сабт кардан" : "Записать расход",
			primary_action: (vals) => {
				// Parse account from dropdown format "Label (Account)"
				let paid_from = vals.paid_from;
				const match = vals.paid_from.match(/\((.*?)\)/);
				if (match && match[1]) {
					paid_from = match[1];
				}

				frappe.call({
					method: "erpnext.setup.page.staff_detail.staff_detail.add_staff_expense",
					args: {
						employee: this.employee,
						expense_category: vals.expense_category,
						amount: vals.amount,
						paid_from: paid_from,
						description: vals.description,
					},
					freeze: true,
					callback: (r) => {
						if (r.message && r.message.success) {
							d.hide();
							frappe.show_alert({ message: this.t("action_success"), indicator: "green" });
							this.load(this.employee);
						}
					},
				});
			},
		});
		d.show();
	}

	show_incentive_dialog() {
		const d = new frappe.ui.Dialog({
			title: this.lang === "tg" ? "🎁 Иловаи бонус ё ҷарима" : "🎁 Добавить бонус или штраф",
			fields: [
				{
					label: this.lang === "tg" ? "Намуд" : "Тип операции",
					fieldname: "type",
					fieldtype: "Select",
					options: "Bonus\nPenalty",
					default: "Bonus",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Категория" : "Категория",
					fieldname: "category",
					fieldtype: "Select",
					options: "Daily Sales Target\nWeekly Performance\nMonthly Award\nAttendance / Punctuality\nCustomer Compliment\nDisciplinary\nOther",
					default: "Daily Sales Target",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Маблағ" : "Сумма",
					fieldname: "amount",
					fieldtype: "Currency",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Сабаб" : "Причина / Обоснование",
					fieldname: "reason",
					fieldtype: "Small Text",
					reqd: 1,
				},
			],
			primary_action_label: this.lang === "tg" ? "Сабт кардан" : "Сохранить",
			primary_action: (vals) => {
				frappe.call({
					method: "erpnext.setup.page.staff_detail.staff_detail.add_staff_incentive",
					args: {
						employee: this.employee,
						type: vals.type,
						category: vals.category,
						amount: vals.amount,
						reason: vals.reason,
					},
					freeze: true,
					callback: (r) => {
						if (r.message && r.message.success) {
							d.hide();
							frappe.show_alert({ message: this.t("action_success"), indicator: "green" });
							this.load(this.employee);
						}
					},
				});
			},
		});
		d.show();
	}

	show_advance_dialog() {
		const sources = this.data.payment_sources || [];
		const d = new frappe.ui.Dialog({
			title: this.lang === "tg" ? "💸 Додани аванс ба корманд" : "💸 Выдать аванс сотруднику",
			fields: [
				{
					label: this.lang === "tg" ? "Маблағи аванс" : "Сумма аванса",
					fieldname: "amount",
					fieldtype: "Currency",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Манбаи пардохт (Касса / Сейф)" : "Откуда выдать (Касса / Сейф / Счет)",
					fieldname: "paid_from",
					fieldtype: "Select",
					options: sources.map((s) => `${s.label} (${s.account})`).join("\n"),
					default: sources[0] ? `${sources[0].label} (${sources[0].account})` : "",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Сабаб / Ёддошт" : "Причина / Заметка",
					fieldname: "reason",
					fieldtype: "Small Text",
				},
			],
			primary_action_label: this.lang === "tg" ? "Пардохти аванс" : "Выдать деньги",
			primary_action: (vals) => {
				let paid_from = vals.paid_from;
				const match = vals.paid_from.match(/\((.*?)\)/);
				if (match && match[1]) {
					paid_from = match[1];
				}

				frappe.call({
					method: "erpnext.setup.page.staff_detail.staff_detail.add_staff_advance",
					args: {
						employee: this.employee,
						amount: vals.amount,
						paid_from: paid_from,
						reason: vals.reason,
					},
					freeze: true,
					callback: (r) => {
						if (r.message && r.message.success) {
							d.hide();
							frappe.show_alert({ message: this.t("action_success"), indicator: "green" });
							this.load(this.employee);
						}
					},
				});
			},
		});
		d.show();
	}

	show_settlement_dialog() {
		const s = this.data.summary;
		const curr = s.currency || "TJS";
		const sources = this.data.payment_sources || [];

		const breakdownHtml = `
			<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px; margin-bottom: 14px; font-size: 13px;">
				<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
					<span>${this.lang === "tg" ? "Маоши асосӣ:" : "Базовый оклад:"}</span>
					<strong>+${this.format_currency(s.base_salary, curr)}</strong>
				</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
					<span>${this.lang === "tg" ? "Комиссия аз фурӯш:" : "Комиссионные от продаж:"}</span>
					<strong class="val-positive">+${this.format_currency(s.commission_amount, curr)}</strong>
				</div>
				<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
					<span>${this.lang === "tg" ? "Бонусҳо:" : "Начисленные бонусы:"}</span>
					<strong class="val-positive">+${this.format_currency(s.bonuses_total, curr)}</strong>
				</div>
				${
					s.penalties_total > 0
						? `
					<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
						<span>${this.lang === "tg" ? "Ҷаримаҳо:" : "Штрафы:"}</span>
						<strong class="val-negative">-${this.format_currency(s.penalties_total, curr)}</strong>
					</div>`
						: ""
				}
				<div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
					<span>${this.lang === "tg" ? "Авансҳои гирифташуда:" : "Выданные ранее авансы:"}</span>
					<strong class="val-negative">-${this.format_currency(s.advances_total, curr)}</strong>
				</div>
				<hr style="margin: 8px 0; border: 0; border-top: 1px solid #cbd5e1;">
				<div style="display: flex; justify-content: space-between; font-size: 15px; font-weight: 700;">
					<span>${this.lang === "tg" ? "Ҷамъи пардохтшаванда:" : "Итого к выплате:"}</span>
					<span class="val-highlight">${this.format_currency(s.net_payable, curr)}</span>
				</div>
			</div>
		`;

		const d = new frappe.ui.Dialog({
			title: this.lang === "tg" ? "💰 Ҳисоббаробаркунии ниҳоӣ ва пардохт" : "💰 Окончательный расчет и выплата",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "summary_html",
					options: breakdownHtml,
				},
				{
					label: this.lang === "tg" ? "Манбаи пардохт (Касса / Сейф / Корт)" : "Откуда выплатить (Касса / Сейф / Карта)",
					fieldname: "paid_from",
					fieldtype: "Select",
					options: sources.map((src) => `${src.label} (${src.account})`).join("\n"),
					default: sources[0] ? `${sources[0].label} (${sources[0].account})` : "",
					reqd: 1,
				},
				{
					label: this.lang === "tg" ? "Тавзеҳот" : "Примечание",
					fieldname: "remarks",
					fieldtype: "Small Text",
				},
			],
			primary_action_label: this.lang === "tg" ? "Тасдиқ ва пардохти маош" : "Подтвердить и выплатить",
			primary_action: (vals) => {
				let paid_from = vals.paid_from;
				const match = vals.paid_from.match(/\((.*?)\)/);
				if (match && match[1]) {
					paid_from = match[1];
				}

				frappe.call({
					method: "erpnext.setup.page.staff_detail.staff_detail.settle_staff_balance",
					args: {
						employee: this.employee,
						start_date: s.start_date,
						end_date: s.end_date,
						base_salary: s.base_salary,
						sales_volume: s.sales_volume,
						gross_profit: s.gross_profit,
						commission_amount: s.commission_amount,
						bonuses_total: s.bonuses_total,
						penalties_total: s.penalties_total,
						advances_deducted: s.advances_total,
						expenses_company_paid: s.expenses_total,
						net_payable: s.net_payable,
						paid_from: paid_from,
						remarks: vals.remarks,
					},
					freeze: true,
					callback: (r) => {
						if (r.message && r.message.success) {
							d.hide();
							frappe.show_alert({
								message: this.lang === "tg" ? "Ҳисоббаробаркунӣ муваффақона сабт шуд!" : "Расчет успешно произведен и выплачен!",
								indicator: "green",
							});
							this.load(this.employee);
						}
					},
				});
			},
		});
		d.show();
	}

	save_settings() {
		const base_salary = this.wrapper.find("#setting-base-salary").val();
		const frequency = this.wrapper.find("#setting-salary-frequency").val();
		const scheme = this.wrapper.find("#setting-commission-scheme").val();
		const cash_acc = this.wrapper.find("#setting-cash-account").val();

		frappe.call({
			method: "erpnext.setup.page.staff_detail.staff_detail.save_staff_settings",
			args: {
				employee: this.employee,
				custom_base_salary: base_salary,
				custom_salary_frequency: frequency,
				custom_commission_scheme: scheme,
				custom_default_cash_account: cash_acc,
			},
			freeze: true,
			callback: (r) => {
				if (r.message && r.message.success) {
					frappe.show_alert({ message: this.t("save_success"), indicator: "green" });
					this.load(this.employee);
				}
			},
		});
	}

	format_currency(val, curr) {
		val = flt(val);
		return (
			val.toLocaleString("ru-RU", {
				minimumFractionDigits: 0,
				maximumFractionDigits: 2,
			}) +
			" " +
			curr
		);
	}
}
