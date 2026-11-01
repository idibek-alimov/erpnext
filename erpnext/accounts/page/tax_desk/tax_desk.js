// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["tax-desk"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Андозҳо (Tax Desk)") : __("Налоги (Tax Desk)"),
		single_column: true,
	});

	page.set_primary_action(is_tg ? __("💳 Пардохти андоз") : __("💳 Оплатить налог"), () => {
		wrapper.tax_desk_app && wrapper.tax_desk_app.open_payment_modal();
	});

	page.add_inner_button(is_tg ? __("📄 Маълумотнома") : __("📄 Справка для бухгалтера"), () => {
		wrapper.tax_desk_app && wrapper.tax_desk_app.open_declaration_modal();
	});

	page.add_inner_button(is_tg ? __("💰 Хазинаҳо (Money Hub)") : __("💰 Кассы и счета (Money Hub)"), () => {
		frappe.set_route("money-hub");
	});

	page.add_inner_button(is_tg ? __("🏷️ Хароҷот (Expense Desk)") : __("🏷️ Расход кассы (Expense Desk)"), () => {
		frappe.set_route("expense-desk");
	});

	page.add_inner_button(is_tg ? __("Навсозӣ") : __("Обновить"), () => {
		wrapper.tax_desk_app && wrapper.tax_desk_app.load();
	});

	// Inject fresh styles
	frappe.call({
		method: "frappe.desk.desk_page.getpage",
		args: { name: "tax-desk" },
		callback: (r) => {
			if (r.docs && r.docs[0] && r.docs[0].style) {
				frappe.dom.set_style(r.docs[0].style);
			}
		},
	});

	wrapper.tax_desk_app = new TaxDeskApp(page);
};

frappe.pages["tax-desk"].on_page_show = function (wrapper) {
	if (wrapper.tax_desk_app) {
		wrapper.tax_desk_app.load();
	}
};

class TaxDeskApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.is_tg = frappe.boot.user.language === "tg";
		this.data = null;

		// Filter & Tab state
		this.period = "month";
		this.from_date = null;
		this.to_date = null;
		this.active_tab = "timeline"; // 'timeline', 'audit', 'payments'

		// Audit state
		this.audit_invoices = [];
		this.audit_total = 0;
		this.audit_page = 1;
		this.audit_search = "";
		this.audit_is_return = "";
		this.search_timer = null;

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
			method: "erpnext.accounts.page.tax_desk.tax_desk.get_tax_desk_data",
			args: {
				period: this.period,
				from_date: this.from_date,
				to_date: this.to_date,
			},
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.render();
				if (this.active_tab === "audit") {
					this.load_audit_invoices();
				}
			},
		});
	}

	load_audit_invoices() {
		frappe.call({
			method: "erpnext.accounts.page.tax_desk.tax_desk.get_tax_audit_invoices",
			args: {
				period: this.period,
				from_date: this.from_date,
				to_date: this.to_date,
				search: this.audit_search,
				is_return: this.audit_is_return,
				page: this.audit_page,
				limit: 50,
			},
			callback: (r) => {
				if (!r.message) return;
				this.audit_invoices = r.message.invoices || [];
				this.audit_total = r.message.total_count || 0;
				this.audit_page_count = r.message.page_count || 1;
				this.render_audit_tab_content();
			},
		});
	}

	render() {
		this.wrapper.empty();
		const m = this.data.metrics || {};
		const curr = this.data.currency || "TJS";
		const rate = this.data.tax_rate || 6.0;

		const layout = $(`
			<div class="td-layout">
				<!-- Period Filter Bar -->
				<div class="td-filter-bar">
					<div class="td-filter-group">
						<button class="td-period-btn ${this.period === 'today' ? 'active' : ''}" data-period="today">
							${this.t("Сегодня", "Имрӯз")}
						</button>
						<button class="td-period-btn ${this.period === 'week' ? 'active' : ''}" data-period="week">
							${this.t("Эта неделя", "Ин ҳафта")}
						</button>
						<button class="td-period-btn ${this.period === 'month' ? 'active' : ''}" data-period="month">
							${this.t("Этот месяц", "Ин моҳ")}
						</button>
						<button class="td-period-btn ${this.period === 'last_month' ? 'active' : ''}" data-period="last_month">
							${this.t("Прошлый месяц", "Моҳи гузашта")}
						</button>
						<button class="td-period-btn ${this.period === 'quarter' ? 'active' : ''}" data-period="quarter">
							${this.t("Квартал", "Семоҳа")}
						</button>
						<button class="td-period-btn ${this.period === 'year' ? 'active' : ''}" data-period="year">
							${this.t("Год", "Сол")}
						</button>
						<button class="td-period-btn ${this.period === 'custom' ? 'active' : ''}" data-period="custom">
							📅 ${this.t("Период...", "Интихоби сана...")}
						</button>
					</div>

					<div class="td-filter-group">
						<span class="td-date-range-badge">
							📅 ${this.data.start_date} → ${this.data.end_date}
						</span>
						<span class="td-regime-pill">
							🏛️ ${this.t(`УСН ${rate}% (Выручка)`, `Андози соддакарда ${rate}%`)}
						</span>
					</div>
				</div>

				<!-- Hero KPI Cards Strip -->
				<div class="td-kpi-strip">
					<!-- Main Hero Card: Balance Due -->
					<div class="td-kpi td-kpi-main">
						<div>
							<div class="td-kpi-label">
								<span>${this.t("⚠️ К УПЛАТЕ ЗА ПЕРИОД", "⚠️ БОҚИМОНДА БАРОИ СУПОРИДАН")}</span>
								${m.balance_due <= 0 ? '<span class="td-badge td-badge-paid" style="color:#065f46;background:#d1fae5">✓ Погашено</span>' : ''}
							</div>
							<div class="td-kpi-value" style="color: ${m.balance_due > 0 ? '#fca5a5' : '#86efac'}">
								${this.fmt(m.balance_due)} ${curr}
							</div>
						</div>
						<div class="td-kpi-sub" style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
							<span>${m.balance_due > 0 ? this.t("Требуется оплата", "Пардохт лозим аст") : this.t("Задолженность отсутствует", "Қарздорӣ нест")}</span>
							${m.balance_due > 0 ? `<button class="btn btn-xs btn-primary td-hero-pay-btn" style="font-weight:700">💳 ${this.t("Оплатить", "Пардохт")}</button>` : ''}
						</div>
					</div>

					<!-- Card 2: Accrued Tax -->
					<div class="td-kpi">
						<div class="td-kpi-label">
							<span>${this.t("🏛️ НАЧИСЛЕНО (6%)", "🏛️ ҲИСОБ ШУД (6%)")}</span>
						</div>
						<div class="td-kpi-value" style="color:#1e293b">
							${this.fmt(m.tax_accrued)} ${curr}
						</div>
						<div class="td-kpi-sub">
							${this.t("Сумма налога к уплате", "Маблағи андоз")}
						</div>
					</div>

					<!-- Card 3: Paid Tax -->
					<div class="td-kpi">
						<div class="td-kpi-label">
							<span>${this.t("✅ УПЛАЧЕНО В БЮДЖЕТ", "✅ БА БЮДҶЕТ СУПОРИДА ШУД")}</span>
						</div>
						<div class="td-kpi-value" style="color:#16a34a">
							${this.fmt(m.tax_paid)} ${curr}
						</div>
						<div class="td-kpi-sub">
							${m.tax_accrued > 0 ? Math.round((m.tax_paid / m.tax_accrued) * 100) + "% " + this.t("от начисленного", "супорида шудааст") : this.t("Платежи за период", "Пардохтҳо дар давра")}
						</div>
					</div>

					<!-- Card 4: Net Turnover -->
					<div class="td-kpi">
						<div class="td-kpi-label">
							<span>${this.t("💰 ВЫРУЧКА (БАЗА)", "💰 ГАРДИШИ МОЛ (ПОЙГОҲ)")}</span>
						</div>
						<div class="td-kpi-value" style="color:#0f172a">
							${this.fmt(m.net_turnover)} ${curr}
						</div>
						<div class="td-kpi-sub" title="Продажи: ${this.fmt(m.gross_sales)} | Возвраты: ${this.fmt(m.returns)}">
							${m.invoice_count} ${this.t("чеков", "чек")} (${this.fmt(m.gross_sales)} - ${this.fmt(m.returns)})
						</div>
					</div>

					<!-- Card 5: Total Historical Outstanding -->
					<div class="td-kpi">
						<div class="td-kpi-label">
							<span>${this.t("📊 ОБЩИЙ ДОЛГ (ВСЁ ВРЕМЯ)", "📊 ҚАРЗИ УМУМӢ")}</span>
						</div>
						<div class="td-kpi-value" style="color:${m.total_outstanding > 0 ? '#b91c1c' : '#16a34a'}">
							${this.fmt(m.total_outstanding)} ${curr}
						</div>
						<div class="td-kpi-sub">
							${this.t("Сальдо счета 6% налога", "Бақияи ҳисоби андоз")}
						</div>
					</div>
				</div>

				<!-- Tabs Bar -->
				<div class="td-tabs-bar">
					<button class="td-tab-btn ${this.active_tab === 'timeline' ? 'active' : ''}" data-tab="timeline">
						📅 ${this.t("По месяцам (Timeline)", "Мувофиқи моҳҳо")}
						<span class="td-tab-badge">12</span>
					</button>
					<button class="td-tab-btn ${this.active_tab === 'audit' ? 'active' : ''}" data-tab="audit">
						🧾 ${this.t("Чеки и накладные (Аудит)", "Чекҳо ва ҳисобномаҳо")}
						<span class="td-tab-badge">${m.invoice_count + m.return_count}</span>
					</button>
					<button class="td-tab-btn ${this.active_tab === 'payments' ? 'active' : ''}" data-tab="payments">
						💳 ${this.t("История уплат", "Таърихи пардохтҳо")}
						<span class="td-tab-badge">${(this.data.payments_history || []).length}</span>
					</button>
				</div>

				<!-- Tab Content Area -->
				<div class="td-tab-content"></div>
			</div>
		`);

		this.wrapper.append(layout);
		this.bind_events();
		this.render_tab_content();
	}

	bind_events() {
		// Period buttons
		this.wrapper.find(".td-period-btn").on("click", (e) => {
			const p = $(e.currentTarget).data("period");
			if (p === "custom") {
				this.pick_custom_range();
			} else {
				this.period = p;
				this.from_date = null;
				this.to_date = null;
				this.load();
			}
		});

		// Hero pay button
		this.wrapper.find(".td-hero-pay-btn").on("click", () => {
			this.open_payment_modal();
		});

		// Tabs navigation
		this.wrapper.find(".td-tab-btn").on("click", (e) => {
			const tab = $(e.currentTarget).data("tab");
			this.active_tab = tab;
			this.wrapper.find(".td-tab-btn").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.render_tab_content();
		});
	}

	pick_custom_range() {
		const d = new frappe.ui.Dialog({
			title: this.t("Выбрать период", "Интихоби давра"),
			fields: [
				{
					fieldname: "from_date",
					label: this.t("Дата с", "Аз санаи"),
					fieldtype: "Date",
					default: this.data.start_date,
					reqd: 1,
				},
				{
					fieldname: "to_date",
					label: this.t("Дата по", "То санаи"),
					fieldtype: "Date",
					default: this.data.end_date,
					reqd: 1,
				},
			],
			primary_action_label: this.t("Применить", "Татбиқ"),
			primary_action: (values) => {
				d.hide();
				this.period = "custom";
				this.from_date = values.from_date;
				this.to_date = values.to_date;
				this.load();
			},
		});
		d.show();
	}

	render_tab_content() {
		const container = this.wrapper.find(".td-tab-content");
		container.empty();

		if (this.active_tab === "timeline") {
			this.render_timeline_tab(container);
		} else if (this.active_tab === "audit") {
			this.render_audit_tab_frame(container);
			this.load_audit_invoices();
		} else if (this.active_tab === "payments") {
			this.render_payments_tab(container);
		}
	}

	/* --- 1. Monthly Timeline Tab --- */
	render_timeline_tab(container) {
		const timeline = this.data.timeline || [];
		const curr = this.data.currency || "TJS";

		let rowsHtml = "";
		timeline.forEach((row) => {
			const label = this.is_tg ? row.tg_label : row.ru_label;
			let statusBadge = "";
			if (row.status === "paid") {
				statusBadge = `<span class="td-badge td-badge-paid">✓ ${this.t("Оплачено", "Супорида шуд")}</span>`;
			} else if (row.status === "partially_paid") {
				statusBadge = `<span class="td-badge td-badge-partial">⚠️ ${this.t("Частично", "Қисман")}</span>`;
			} else if (row.status === "unpaid") {
				statusBadge = `<span class="td-badge td-badge-unpaid">✕ ${this.t("Не оплачено", "Супорида нашуд")}</span>`;
			} else {
				statusBadge = `<span class="td-badge td-badge-zero">${this.t("Нет базы", "Гардиш нест")}</span>`;
			}

			const payBtn = row.balance_due > 0
				? `<button class="td-btn-pay-sm td-month-pay-btn" data-key="${row.key}" data-due="${row.balance_due}" data-start="${row.start_date}" data-end="${row.end_date}">
						💳 ${this.t("Оплатить", "Пардохт")}
				   </button>`
				: `<span style="color:#94a3b8;font-size:12px">—</span>`;

			rowsHtml += `
				<tr>
					<td><strong>${label}</strong></td>
					<td class="td-text-right">${this.fmt(row.gross_sales)} ${curr}</td>
					<td class="td-text-right" style="color:${row.returns > 0 ? '#b91c1c' : '#64748b'}">
						${row.returns > 0 ? "-" + this.fmt(row.returns) : "0.00"} ${curr}
					</td>
					<td class="td-text-right"><strong>${this.fmt(row.net_turnover)}</strong> ${curr}</td>
					<td class="td-text-right" style="color:#1e293b;font-weight:700">
						${this.fmt(row.tax_accrued)} ${curr}
					</td>
					<td class="td-text-right" style="color:#16a34a;font-weight:700">
						${this.fmt(row.tax_paid)} ${curr}
					</td>
					<td class="td-text-right" style="color:${row.balance_due > 0 ? '#dc2626' : '#16a34a'};font-weight:800">
						${this.fmt(row.balance_due)} ${curr}
					</td>
					<td class="td-text-center">${statusBadge}</td>
					<td class="td-text-center">${payBtn}</td>
				</tr>
			`;
		});

		const card = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>📅 ${this.t("График начислений и уплат по месяцам", "Ҷадвали ҳисоб ва пардохти моҳона")}</span>
					</h3>
					<span style="font-size:12px;color:#64748b">
						${this.t("Показаны последние 12 месяцев", "12 моҳи охир нишон дода шудааст")}
					</span>
				</div>
				<div class="td-table-responsive">
					<table class="td-table">
						<thead>
							<tr>
								<th>${this.t("Месяц", "Моҳ")}</th>
								<th class="td-text-right">${this.t("Продажи", "Фурӯш")}</th>
								<th class="td-text-right">${this.t("Возвраты", "Бозгашт")}</th>
								<th class="td-text-right">${this.t("Налоговая база", "Пойгоҳи андоз")}</th>
								<th class="td-text-right">${this.t("Налог 6%", "Андоз 6%")}</th>
								<th class="td-text-right">${this.t("Уплачено", "Супорида шуд")}</th>
								<th class="td-text-right">${this.t("Остаток", "Бақия")}</th>
								<th class="td-text-center">${this.t("Статус", "Ҳолат")}</th>
								<th class="td-text-center">${this.t("Действие", "Амал")}</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`);

		card.find(".td-month-pay-btn").on("click", (e) => {
			const due = $(e.currentTarget).data("due");
			const start = $(e.currentTarget).data("start");
			const end = $(e.currentTarget).data("end");
			const key = $(e.currentTarget).data("key");
			this.open_payment_modal(due, key, start, end);
		});

		container.append(card);
	}

	/* --- 2. Audit Tab (Sales Invoices Reconciliation) --- */
	render_audit_tab_frame(container) {
		const frame = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>🧾 ${this.t("Сверка чеков кассы и накладных", "Муқоисаи чекҳои хазина ва ҳисобномаҳо")}</span>
					</h3>
					<div class="td-filter-group">
						<input type="text" class="form-control input-sm td-audit-search" placeholder="${this.t("Поиск по номеру, клиенту...", "Ҷустуҷӯ...")}" style="width:220px" value="${this.audit_search}">
						<select class="form-control input-sm td-audit-type-filter" style="width:150px">
							<option value="">${this.t("Все документы", "Ҳамаи ҳуҷҷатҳо")}</option>
							<option value="0" ${this.audit_is_return === '0' ? 'selected' : ''}>${this.t("Только продажи", "Танҳо фурӯш")}</option>
							<option value="1" ${this.audit_is_return === '1' ? 'selected' : ''}>${this.t("Только возвраты", "Танҳо бозгашт")}</option>
						</select>
					</div>
				</div>
				<div class="td-audit-body">
					<div style="text-align:center;padding:30px;color:#94a3b8">
						${this.t("Загрузка данных...", "Боргирӣ...")}
					</div>
				</div>
				<div class="td-audit-pagination" style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;padding-top:10px;border-top:1px solid #f1f5f9"></div>
			</div>
		`);

		// Search handler with debounce
		frame.find(".td-audit-search").on("input", (e) => {
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.audit_search = $(e.target).val();
				this.audit_page = 1;
				this.load_audit_invoices();
			}, 300);
		});

		// Type filter handler
		frame.find(".td-audit-type-filter").on("change", (e) => {
			this.audit_is_return = $(e.target).val();
			this.audit_page = 1;
			this.load_audit_invoices();
		});

		container.append(frame);
	}

	render_audit_tab_content() {
		const body = this.wrapper.find(".td-audit-body");
		const pagination = this.wrapper.find(".td-audit-pagination");
		const curr = this.data.currency || "TJS";

		if (!this.audit_invoices || this.audit_invoices.length === 0) {
			body.html(`
				<div style="text-align:center;padding:40px;color:#64748b">
					<div style="font-size:32px;margin-bottom:8px">📭</div>
					<div>${this.t("За выбранный период накладных не найдено", "Дар ин давра ҳуҷҷатҳо ёфт нашуданд")}</div>
				</div>
			`);
			pagination.empty();
			return;
		}

		let rowsHtml = "";
		this.audit_invoices.forEach((inv) => {
			const isRet = inv.is_return;
			const sign = isRet ? "-" : "";
			const typeBadge = isRet
				? `<span class="td-badge td-badge-unpaid">↩️ ${this.t("Возврат", "Бозгашт")}</span>`
				: `<span class="td-badge td-badge-paid">🛒 ${this.t("Чек", "Чек")}</span>`;

			rowsHtml += `
				<tr>
					<td>
						<a href="/app/sales-invoice/${inv.name}" style="font-weight:700;color:var(--primary-color, #2563eb)">
							${inv.name}
						</a>
						<div style="font-size:11px;color:#64748b">${inv.formatted_date} ${inv.posting_time ? inv.posting_time.split('.')[0] : ''}</div>
					</td>
					<td>
						${typeBadge}
					</td>
					<td>
						<div>${inv.customer_name || "Покупатель"}</div>
						<div style="font-size:11px;color:#94a3b8">${inv.pos_profile || ""}</div>
					</td>
					<td class="td-text-right" style="font-weight:700;color:${isRet ? '#b91c1c' : '#0f172a'}">
						${this.fmt(inv.grand_total)} ${curr}
					</td>
					<td class="td-text-right" style="color:#64748b">
						${this.fmt(inv.net_total)} ${curr}
					</td>
					<td class="td-text-right" style="font-weight:800;color:${isRet ? '#b91c1c' : '#2563eb'}">
						${this.fmt(inv.tax_amount)} ${curr}
					</td>
				</tr>
			`;
		});

		body.html(`
			<div class="td-table-responsive">
				<table class="td-table">
					<thead>
						<tr>
							<th>${this.t("Документ", "Ҳуҷҷат")}</th>
							<th>${this.t("Тип", "Намуд")}</th>
							<th>${this.t("Клиент / Касса", "Мизоҷ / Хазина")}</th>
							<th class="td-text-right">${this.t("Сумма чека (брутто)", "Маблағи чек")}</th>
							<th class="td-text-right">${this.t("Нетто (без налога)", "Бе андоз")}</th>
							<th class="td-text-right">${this.t("Налог (6%)", "Андоз (6%)")}</th>
						</tr>
					</thead>
					<tbody>
						${rowsHtml}
					</tbody>
				</table>
			</div>
		`);

		// Render Pagination
		pagination.html(`
			<div style="font-size:12px;color:#64748b">
				${this.t("Всего документов:", "Ҳамагӣ ҳуҷҷатҳо:")} <strong>${this.audit_total}</strong>
				(${this.t("Страница", "Саҳифа")} ${this.audit_page} ${this.t("из", "аз")} ${this.audit_page_count})
			</div>
			<div class="td-filter-group">
				<button class="btn btn-xs btn-default td-page-prev" ${this.audit_page <= 1 ? 'disabled' : ''}>
					← ${this.t("Назад", "Қаблӣ")}
				</button>
				<button class="btn btn-xs btn-default td-page-next" ${this.audit_page >= this.audit_page_count ? 'disabled' : ''}>
					${this.t("Вперёд", "Баъдӣ")} →
				</button>
			</div>
		`);

		pagination.find(".td-page-prev").on("click", () => {
			if (this.audit_page > 1) {
				this.audit_page--;
				this.load_audit_invoices();
			}
		});

		pagination.find(".td-page-next").on("click", () => {
			if (this.audit_page < this.audit_page_count) {
				this.audit_page++;
				this.load_audit_invoices();
			}
		});
	}

	/* --- 3. Payments History Tab --- */
	render_payments_tab(container) {
		const payments = this.data.payments_history || [];
		const curr = this.data.currency || "TJS";

		if (!payments || payments.length === 0) {
			container.html(`
				<div class="td-card">
					<div style="text-align:center;padding:50px;color:#64748b">
						<div style="font-size:36px;margin-bottom:10px">🏛️</div>
						<h4 style="margin-bottom:6px">${this.t("Платежей пока не зарегистрировано", "Ҳоло пардохтҳо нест")}</h4>
						<p style="font-size:13px;max-width:400px;margin:0 auto 16px auto">
							${this.t("Используйте кнопку 'Оплатить налог', чтобы списать средства из кошелька Money Hub в бюджет.", "Тугмаи 'Пардохти андоз'-ро истифода баред.")}
						</p>
						<button class="btn btn-sm btn-primary td-card-pay-btn">
							💳 ${this.t("Оплатить налог прямо сейчас", "Ҳозир пардохт кунед")}
						</button>
					</div>
				</div>
			`);
			container.find(".td-card-pay-btn").on("click", () => this.open_payment_modal());
			return;
		}

		let rowsHtml = "";
		payments.forEach((p) => {
			const route = p.voucher_type === "Journal Entry" ? "journal-entry" : "payment-entry";
			rowsHtml += `
				<tr>
					<td>
						<strong>${p.formatted_date}</strong>
					</td>
					<td>
						<a href="/app/${route}/${p.voucher_no}" style="font-weight:700;color:var(--primary-color, #2563eb)">
							${p.voucher_no}
						</a>
						<div style="font-size:11px;color:#64748b">${p.voucher_type}</div>
					</td>
					<td class="td-text-right" style="font-size:14px;font-weight:800;color:#16a34a">
						${this.fmt(p.amount)} ${curr}
					</td>
					<td>
						<span style="font-weight:600;color:#1e293b">${p.paid_from_account || "Касса / Банк"}</span>
					</td>
					<td>
						<code>${p.ref_no || "—"}</code>
					</td>
					<td>
						<div style="max-width:320px;font-size:12px;color:#475569;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${p.remarks}">
							${p.remarks}
						</div>
					</td>
					<td style="font-size:12px;color:#64748b">
						${p.user}
					</td>
				</tr>
			`;
		});

		const card = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>💳 ${this.t("Журнал уплат налога в бюджет", "Журнали пардохти андоз ба буҷет")}</span>
					</h3>
					<span style="font-size:12px;color:#64748b">
						${payments.length} ${this.t("платежей", "пардохт")}
					</span>
				</div>
				<div class="td-table-responsive">
					<table class="td-table">
						<thead>
							<tr>
								<th>${this.t("Дата уплаты", "Сана")}</th>
								<th>${this.t("Документ (Проводка)", "Ҳуҷҷат")}</th>
								<th class="td-text-right">${this.t("Сумма", "Маблағ")}</th>
								<th>${this.t("Источник (Кошелёк)", "Сарчашма")}</th>
								<th>${this.t("Чек / Платёжка №", "Чек №")}</th>
								<th>${this.t("Назначение / Примечание", "Тавзеҳот")}</th>
								<th>${this.t("Автор", "Иҷрокунанда")}</th>
							</tr>
						</thead>
						<tbody>
							${rowsHtml}
						</tbody>
					</table>
				</div>
			</div>
		`);

		container.append(card);
	}

	/* --- 4. 1-Click Tax Payment Modal --- */
	open_payment_modal(prefill_amount, month_key, start_date, end_date) {
		const m = this.data.metrics || {};
		const defaultAmt = prefill_amount !== undefined ? prefill_amount : (m.balance_due > 0 ? m.balance_due : 0);
		const wallets = this.data.wallets || [];
		const curr = this.data.currency || "TJS";

		let selectedWallet = wallets.length > 0 ? wallets[0].name : null;

		// Build wallet options HTML
		let walletsHtml = "";
		wallets.forEach((w, idx) => {
			const isSel = idx === 0 ? "selected" : "";
			walletsHtml += `
				<div class="td-wallet-option ${isSel}" data-wallet="${w.name}">
					<span class="td-wallet-icon">${w.icon}</span>
					<div class="td-wallet-info">
						<span class="td-wallet-name" title="${w.wallet_name}">${w.wallet_name}</span>
						<span class="td-wallet-bal" style="color:${w.balance < 0 ? '#b91c1c' : '#15803d'}">
							${this.fmt(w.balance)} ${curr}
						</span>
					</div>
				</div>
			`;
		});

		const periodLabel = month_key
			? `${this.t("за месяц", "барои моҳи")} ${month_key}`
			: `${this.t("за период", "барои давраи")} ${this.data.start_date} → ${this.data.end_date}`;

		const d = new frappe.ui.Dialog({
			title: `💳 ${this.t("Оплата налога (УСН 6%)", "Пардохти андоз (6%)")}`,
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "info_banner",
					options: `
						<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:14px">
							<div style="font-size:12px;color:#64748b">${this.t("Текущее обязательство к уплате:", "Қарзи ҳозира барои пардохт:")}</div>
							<div style="font-size:20px;font-weight:800;color:#dc2626">${this.fmt(defaultAmt)} ${curr} <span style="font-size:12px;font-weight:500;color:#64748b">(${periodLabel})</span></div>
						</div>
					`,
				},
				{
					fieldtype: "Currency",
					fieldname: "amount",
					label: this.t("Сумма к списанию", "Маблағи пардохт"),
					default: defaultAmt,
					reqd: 1,
				},
				{
					fieldtype: "HTML",
					fieldname: "wallet_picker",
					options: `
						<div style="margin-bottom:14px">
							<label class="control-label" style="font-size:12px;font-weight:600;margin-bottom:6px;display:block">
								${this.t("Списать из кошелька Money Hub:", "Аз кадом хазина пардохт шавад:")}
							</label>
							<div class="td-wallet-grid">${walletsHtml}</div>
						</div>
					`,
				},
				{
					fieldtype: "Date",
					fieldname: "posting_date",
					label: this.t("Дата уплаты", "Санаи пардохт"),
					default: frappe.datetime.now_date(),
					reqd: 1,
				},
				{
					fieldtype: "Data",
					fieldname: "reference_no",
					label: this.t("Номер чека / Платёжного поручения", "Рақами чек ё супоришнома"),
					default: `TAX-${frappe.datetime.now_date().replace(/-/g, '')}`,
				},
				{
					fieldtype: "Small Text",
					fieldname: "remarks",
					label: this.t("Примечание", "Тавзеҳот"),
					default: `${this.t("Оплата налога", "Пардохти андоз")} ${periodLabel}`,
				},
			],
			primary_action_label: `✅ ${this.t("Списать и провести платёж", "Пардохт кардан")}`,
			primary_action: (values) => {
				if (!selectedWallet) {
					frappe.msgprint(this.t("Пожалуйста, выберите кошелёк для списания", "Лутфан, хазинаро интихоб намоед"));
					return;
				}
				if (Number(values.amount) <= 0) {
					frappe.msgprint(this.t("Сумма должна быть больше нуля", "Маблағ бояд бештар аз 0 бошад"));
					return;
				}

				d.get_primary_btn().prop("disabled", true).text(this.t("Проведение...", "Иҷро шуда истодааст..."));

				frappe.call({
					method: "erpnext.accounts.page.tax_desk.tax_desk.record_tax_payment",
					args: {
						wallet: selectedWallet,
						amount: values.amount,
						posting_date: values.posting_date,
						reference_no: values.reference_no,
						remarks: values.remarks,
					},
					callback: (r) => {
						d.hide();
						if (r.message && r.message.status === "success") {
							frappe.show_alert({
								message: `✅ ${r.message.message}`,
								indicator: "green",
							}, 6);
							this.load();
						}
					},
					always: () => {
						d.get_primary_btn().prop("disabled", false);
					},
				});
			},
		});

		d.show();

		// Bind wallet click selection in dialog
		d.$wrapper.find(".td-wallet-option").on("click", function () {
			d.$wrapper.find(".td-wallet-option").removeClass("selected");
			$(this).addClass("selected");
			selectedWallet = $(this).data("wallet");
		});
	}

	/* --- 5. Printable Declaration Modal --- */
	open_declaration_modal() {
		frappe.call({
			method: "erpnext.accounts.page.tax_desk.tax_desk.get_tax_declaration_data",
			args: {
				period: this.period,
				from_date: this.from_date,
				to_date: this.to_date,
			},
			callback: (r) => {
				if (!r.message) return;
				const decl = r.message;
				const comp = decl.company_details || {};
				const desk = decl.desk_data || {};
				const m = desk.metrics || {};
				const curr = desk.currency || "TJS";

				const d = new frappe.ui.Dialog({
					title: `📄 ${this.t("Справка-расчет налога (УСН 6%)", "Маълумотнома-ҳисоби андоз")}`,
					size: "large",
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "decl_html",
							options: `
								<div class="td-decl-container" id="td-print-area">
									<div class="td-decl-header">
										<h2 class="td-decl-title">СПРАВКА-РАСЧЕТ УПРОЩЕННОГО НАЛОГА</h2>
										<p class="td-decl-subtitle">
											(Специальный налоговый режим: Упрощенная система налогообложения, ставка ${desk.tax_rate}%)
										</p>
									</div>

									<div class="td-decl-meta-grid">
										<div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">Организация:</span>
												<span class="td-decl-meta-val">${comp.company_name || desk.company}</span>
											</div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">ИНН / Tax ID:</span>
												<span class="td-decl-meta-val">${comp.tax_id || "—"}</span>
											</div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">Страна / Юрисдикция:</span>
												<span class="td-decl-meta-val">${comp.country || "Таджикистан"}</span>
											</div>
										</div>
										<div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">Отчетный период:</span>
												<span class="td-decl-meta-val">${desk.start_date} — ${desk.end_date}</span>
											</div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">Дата составления:</span>
												<span class="td-decl-meta-val">${decl.declaration_date}</span>
											</div>
											<div class="td-decl-meta-row">
												<span class="td-decl-meta-label">Исполнитель:</span>
												<span class="td-decl-meta-val">${decl.current_user_fullname}</span>
											</div>
										</div>
									</div>

									<table class="td-decl-table">
										<thead>
											<tr>
												<th>№</th>
												<th>Показатель</th>
												<th style="text-align:right">Сумма (${curr})</th>
											</tr>
										</thead>
										<tbody>
											<tr>
												<td>1</td>
												<td>Валовая выручка от розничных продаж (POS чеки и накладные)</td>
												<td style="text-align:right">${this.fmt(m.gross_sales)}</td>
											</tr>
											<tr>
												<td>2</td>
												<td>Возвраты товаров покупателями (вычитаемые из базы)</td>
												<td style="text-align:right;color:#b91c1c">${m.returns > 0 ? "-" + this.fmt(m.returns) : "0.00"}</td>
											</tr>
											<tr style="background:#f8fafc;font-weight:700">
												<td>3</td>
												<td><strong>Чистая налогооблагаемая база (Стр. 1 - Стр. 2)</strong></td>
												<td style="text-align:right"><strong>${this.fmt(m.net_turnover)}</strong></td>
											</tr>
											<tr>
												<td>4</td>
												<td>Ставка упрощенного налога</td>
												<td style="text-align:right">${desk.tax_rate}%</td>
											</tr>
											<tr class="total-row">
												<td>5</td>
												<td><strong>ИТОГО НАЧИСЛЕНО НАЛОГА ЗА ПЕРИОД (Стр. 3 × ${desk.tax_rate}%)</strong></td>
												<td style="text-align:right;font-size:16px;color:#1e293b"><strong>${this.fmt(m.tax_accrued)}</strong></td>
											</tr>
											<tr>
												<td>6</td>
												<td>Фактически уплачено в бюджет за данный период</td>
												<td style="text-align:right;color:#16a34a;font-weight:700">${this.fmt(m.tax_paid)}</td>
											</tr>
											<tr class="total-row">
												<td>7</td>
												<td><strong>ОСТАТОК К УПЛАТЕ / ЗАДОЛЖЕННОСТЬ (Стр. 5 - Стр. 6)</strong></td>
												<td style="text-align:right;font-size:16px;color:${m.balance_due > 0 ? '#dc2626' : '#16a34a'}">
													<strong>${this.fmt(m.balance_due)}</strong>
												</td>
											</tr>
										</tbody>
									</table>

									<div class="td-decl-signatures">
										<div>
											Руководитель организации:
											<div class="td-decl-sig-line"></div>
											<span style="font-size:11px;color:#64748b">(подпись / Ф.И.О.)</span>
										</div>
										<div>
											Главный бухгалтер:
											<div class="td-decl-sig-line"></div>
											<span style="font-size:11px;color:#64748b">(подпись / Ф.И.О.)</span>
										</div>
									</div>

									<div style="margin-top:30px;text-align:center;font-size:11px;color:#94a3b8">
										М.П. (Место печати) &nbsp;&bull;&nbsp; Сгенерировано автоматически в системе ERPNext Retail OS
									</div>
								</div>
							`,
						},
					],
					primary_action_label: `🖨️ ${this.t("Распечатать / PDF", "Чоп кардан")}`,
					primary_action: () => {
						window.print();
					},
				});

				d.show();
			},
		});
	}
}
