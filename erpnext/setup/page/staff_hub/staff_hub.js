// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["staff-hub"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Staff Hub"),
		single_column: true,
	});

	wrapper.staff_hub_app = new StaffHubApp(page);
};

frappe.pages["staff-hub"].on_page_show = function (wrapper) {
	if (wrapper.staff_hub_app) {
		wrapper.staff_hub_app.refresh();
	}
};

class StaffHubApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body).addClass("retail-staff-layout");
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.data = null;
		this.period = "this_month";
		this.status = "Active";
		this.search_term = "";

		this.setup_header_actions();
		this.setup_dom();
		this.load_data();
	}

	t(key) {
		const dict = {
			page_title: { tg: "Хаби кормандон (Сотрудники)", ru: "Хаб сотрудников (Персонал)" },
			btn_new_staff: { tg: "➕ Корманди нав", ru: "➕ Новый сотрудник" },
			btn_schemes: { tg: "⚙️ Схемаҳои комиссия", ru: "⚙️ Схемы комиссий" },
			btn_refresh: { tg: "Навсозӣ", ru: "Обновить" },

			kpi_staff: { tg: "Кормандони фаъол", ru: "Активные сотрудники" },
			kpi_sales: { tg: "Ҳаҷми фурӯш", ru: "Объём продаж" },
			kpi_commission: { tg: "Комиссияҳо", ru: "Начислено комиссий" },
			kpi_expenses: { tg: "Хароҷоти ширкат (Хӯрок/Такси)", ru: "Расходы компании (Обед/Такси)" },
			kpi_advances: { tg: "Авансҳои додашуда", ru: "Выданные авансы" },
			kpi_payable: { tg: "Маблағи пардохтшаванда", ru: "К выплате сотрудникам" },

			period_today: { tg: "Имрӯз", ru: "Сегодня" },
			period_week: { tg: "Ин ҳафта", ru: "Эта неделя" },
			period_month: { tg: "Ин моҳ", ru: "Этот месяц" },
			period_last_month: { tg: "Моҳи гузашта", ru: "Прошлый месяц" },

			search_placeholder: { tg: "Ҷустуҷӯи корманд...", ru: "Поиск сотрудника по имени, роли..." },
			status_all: { tg: "Ҳама статусҳо", ru: "Все статусы" },
			status_active: { tg: "Фаъол", ru: "Активные" },
			status_inactive: { tg: "Ғайрифаъол", ru: "Неактивные" },

			th_staff: { tg: "Корманд", ru: "Сотрудник" },
			th_status: { tg: "Статус", ru: "Статус" },
			th_scheme: { tg: "Схемаи комиссия", ru: "Схема комиссии" },
			th_sales: { tg: "Фурӯш / Фоида", ru: "Продажи / Прибыль" },
			th_commission: { tg: "Комиссия", ru: "Комиссия" },
			th_bonuses: { tg: "Бонусҳо (+)", ru: "Бонусы (+)" },
			th_expenses: { tg: "Хароҷот (Хӯрок/Такси)", ru: "Расходы (Обед/Такси)" },
			th_advances: { tg: "Аванс (-)", ru: "Аванс (-)" },
			th_net_payable: { tg: "Бақияи пардохт", ru: "К выплате (Итого)" },

			empty_text: { tg: "Кормандон ёфт нашуданд", ru: "Сотрудники не найдены" },
			no_scheme: { tg: "Бе комиссия", ru: "Без комиссии" },
			profit_prefix: { tg: "Фоида:", ru: "Прибыль:" },
			invoices_prefix: { tg: "чек", ru: "чеков" },
			total_row_label: { tg: "Ҷамъ (Ҳамагӣ)", ru: "Итого" },
			total_staff_suffix: { tg: "нафар", ru: "сотр." },
		};
		return dict[key] ? dict[key][this.lang] : key;
	}

	setup_header_actions() {
		this.page.set_title(this.t("page_title"));

		this.page.set_primary_action(
			this.t("btn_new_staff"),
			() => {
				frappe.new_doc("Employee");
			},
			"add"
		);

		this.page.add_inner_button(
			this.lang === "tg" ? "Каталоги молҳо" : "Каталог товаров",
			() => frappe.set_route("product-catalog")
		);

		this.page.add_inner_button(
			this.lang === "tg" ? "Поставщикҳо" : "Поставщики",
			() => frappe.set_route("supplier-hub")
		);

		this.page.add_inner_button(
			this.lang === "tg" ? "Хароҷотҳо" : "Расходы",
			() => frappe.set_route("expense-desk")
		);

		this.page.add_inner_button(this.t("btn_schemes"), () => {
			frappe.set_route("List", "Staff Commission Scheme");
		});

		this.page.add_inner_button(this.t("btn_refresh"), () => {
			this.refresh();
		});
	}

	setup_dom() {
		this.wrapper.html(`
			<!-- Filters Bar -->
			<div class="staff-filter-bar">
				<div class="staff-filter-left">
					<div class="staff-search-input">
						<span class="search-icon">🔍</span>
						<input type="text" id="staff-search" placeholder="${this.t("search_placeholder")}">
					</div>

					<select id="staff-status-filter" class="staff-filter-select">
						<option value="Active" selected>${this.t("status_active")}</option>
						<option value="All">${this.t("status_all")}</option>
						<option value="Inactive">${this.t("status_inactive")}</option>
					</select>

					<div class="period-pill-group">
						<button type="button" class="period-pill" data-period="today">${this.t("period_today")}</button>
						<button type="button" class="period-pill" data-period="this_week">${this.t("period_week")}</button>
						<button type="button" class="period-pill active" data-period="this_month">${this.t("period_month")}</button>
						<button type="button" class="period-pill" data-period="last_month">${this.t("period_last_month")}</button>
					</div>
				</div>
			</div>

			<!-- Main Staff Table Card -->
			<div class="staff-table-card">
				<div class="staff-table-wrapper">
					<table class="staff-table">
						<thead>
							<tr>
								<th>${this.t("th_staff")}</th>
								<th class="text-center">${this.t("th_status")}</th>
								<th>${this.t("th_scheme")}</th>
								<th class="text-right">${this.t("th_sales")}</th>
								<th class="text-right">${this.t("th_commission")}</th>
								<th class="text-right">${this.t("th_bonuses")}</th>
								<th class="text-right">${this.t("th_expenses")}</th>
								<th class="text-right">${this.t("th_advances")}</th>
								<th class="text-right">${this.t("th_net_payable")}</th>
							</tr>
						</thead>
						<tbody id="staff-table-body">
							<tr>
								<td colspan="9" class="staff-empty-state">
									<div class="staff-empty-icon">⏳</div>
									<div class="staff-empty-text">${this.lang === "tg" ? "Боргирӣ..." : "Загрузка..."}</div>
								</td>
							</tr>
						</tbody>
						<tfoot id="staff-table-foot"></tfoot>
					</table>
				</div>
			</div>
		`);

		this.bind_events();
	}

	bind_events() {
		// Search typing
		let timeout = null;
		this.wrapper.find("#staff-search").on("input", (e) => {
			clearTimeout(timeout);
			this.search_term = $(e.target).val();
			timeout = setTimeout(() => {
				this.load_data();
			}, 300);
		});

		// Status filter
		this.wrapper.find("#staff-status-filter").on("change", (e) => {
			this.status = $(e.target).val();
			this.load_data();
		});

		// Period pills
		this.wrapper.find(".period-pill").on("click", (e) => {
			this.wrapper.find(".period-pill").removeClass("active");
			const $btn = $(e.currentTarget);
			$btn.addClass("active");
			this.period = $btn.attr("data-period");
			this.load_data();
		});
	}

	load_data() {
		frappe.call({
			method: "erpnext.setup.page.staff_hub.staff_hub.get_staff_hub_data",
			args: {
				search: this.search_term,
				status: this.status,
				period: this.period,
			},
			callback: (r) => {
				if (r.message) {
					this.data = r.message;
					this.render_table();
				}
			},
		});
	}

	refresh() {
		this.load_data();
	}

	render_table() {
		const $tbody = this.wrapper.find("#staff-table-body");
		const $tfoot = this.wrapper.find("#staff-table-foot");

		if (!this.data || !this.data.staff || this.data.staff.length === 0) {
			$tbody.html(`
				<tr>
					<td colspan="9" class="staff-empty-state">
						<div class="staff-empty-icon">👥</div>
						<div class="staff-empty-text">${this.t("empty_text")}</div>
					</td>
				</tr>
			`);
			$tfoot.empty();
			return;
		}

		let html = "";
		this.data.staff.forEach((emp) => {
			const curr = emp.currency || "TJS";
			const initials = (emp.employee_name || emp.name || "")
				.split(" ")
				.map((w) => w[0])
				.slice(0, 2)
				.join("")
				.toUpperCase();

			const avatarHtml = emp.image
				? `<img class="staff-avatar" src="${emp.image}" alt="${frappe.utils.escape_html(emp.employee_name)}">`
				: `<div class="staff-avatar">${initials || "👤"}</div>`;

			const statusClass = emp.status === "Active" ? "active" : "inactive";
			const statusLabel = emp.status === "Active" ? this.t("status_active") : this.t("status_inactive");

			const schemeBadge = emp.commission_scheme
				? `<span class="badge-scheme has-scheme" title="${frappe.utils.escape_html(emp.commission_scheme)}">⚡ ${frappe.utils.escape_html(emp.commission_scheme)}</span>`
				: `<span class="badge-scheme">${this.t("no_scheme")}</span>`;

			html += `
				<tr class="staff-row" data-employee="${encodeURIComponent(emp.name)}">
					<td>
						<div class="staff-cell">
							${avatarHtml}
							<div class="staff-meta">
								<span class="staff-name">${frappe.utils.escape_html(emp.employee_name)}</span>
								<span class="staff-role">${frappe.utils.escape_html(emp.designation)} ${emp.department ? "• " + frappe.utils.escape_html(emp.department) : ""}</span>
							</div>
						</div>
					</td>
					<td class="text-center">
						<span class="badge-status ${statusClass}">${statusLabel}</span>
					</td>
					<td>${schemeBadge}</td>
					<td class="text-right">
						<div><strong>${this.format_currency(emp.sales_volume, curr)}</strong></div>
						<div class="val-muted" style="font-size: 11px;">
							${this.t("profit_prefix")} ${this.format_currency(emp.gross_profit, curr)} (${emp.invoice_count} ${this.t("invoices_prefix")})
						</div>
					</td>
					<td class="text-right">
						<div class="val-positive">${this.format_currency(emp.commission_amount, curr)}</div>
						${emp.commission_rate ? `<div class="val-muted" style="font-size: 11px;">${emp.commission_rate}%</div>` : ""}
					</td>
					<td class="text-right">
						<span class="${emp.bonuses > 0 ? "val-positive" : "val-muted"}">
							${emp.bonuses > 0 ? "+" : ""}${this.format_currency(emp.bonuses, curr)}
						</span>
					</td>
					<td class="text-right">
						<span class="${emp.expenses_amount > 0 ? "val-muted" : "val-muted"}">
							${this.format_currency(emp.expenses_amount, curr)}
						</span>
					</td>
					<td class="text-right">
						<span class="${emp.advances > 0 ? "val-negative" : "val-muted"}">
							${emp.advances > 0 ? "-" : ""}${this.format_currency(emp.advances, curr)}
						</span>
					</td>
					<td class="text-right">
						<div class="val-highlight">${this.format_currency(emp.net_payable, curr)}</div>
					</td>
				</tr>
			`;
		});

		$tbody.html(html);

		// Render Total Summary Row at bottom of table
		const s = this.data.summary || {};
		const curr = s.currency || "TJS";
		$tfoot.html(`
			<tr class="staff-total-row">
				<td>
					<div style="font-weight: 700; font-size: 13.5px;">
						${this.t("total_row_label")}
						<span class="val-muted" style="font-size: 11.5px; font-weight: normal; margin-left: 6px;">
							(${s.total_staff || 0} ${this.t("total_staff_suffix")})
						</span>
					</div>
				</td>
				<td class="text-center">-</td>
				<td>-</td>
				<td class="text-right">
					<div><strong>${this.format_currency(s.total_sales, curr)}</strong></div>
					<div class="val-muted" style="font-size: 11px;">
						${this.t("profit_prefix")} ${this.format_currency(s.total_gross_profit, curr)}
					</div>
				</td>
				<td class="text-right">
					<div class="val-positive"><strong>+${this.format_currency(s.total_commission, curr)}</strong></div>
				</td>
				<td class="text-right">
					<span class="${s.total_bonuses > 0 ? "val-positive" : "val-muted"}">
						<strong>${s.total_bonuses > 0 ? "+" : ""}${this.format_currency(s.total_bonuses, curr)}</strong>
					</span>
				</td>
				<td class="text-right">
					<span class="${s.total_expenses > 0 ? "val-muted" : "val-muted"}">
						<strong>${this.format_currency(s.total_expenses, curr)}</strong>
					</span>
				</td>
				<td class="text-right">
					<span class="${s.total_advances > 0 ? "val-negative" : "val-muted"}">
						<strong>${s.total_advances > 0 ? "-" : ""}${this.format_currency(s.total_advances, curr)}</strong>
					</span>
				</td>
				<td class="text-right">
					<div class="val-highlight" style="font-size: 15px;">
						<strong>${this.format_currency(s.total_net_payable, curr)}</strong>
					</div>
				</td>
			</tr>
		`);

		// Clicking row navigates to Staff Detail
		$tbody.find(".staff-row").on("click", (e) => {
			const emp = decodeURIComponent($(e.currentTarget).attr("data-employee"));
			frappe.set_route("staff-detail", emp);
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
