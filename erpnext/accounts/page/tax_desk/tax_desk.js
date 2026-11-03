// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["tax-desk"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Андозҳо") : __("Налоги"),
		single_column: true,
	});

	page.add_inner_button(is_tg ? __("Справка (Декларация)") : __("Справка для бухгалтера"), () => {
		wrapper.tax_desk_app && wrapper.tax_desk_app.open_declaration_modal();
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

		// Timeline Tab state
		this.timeline_month_filter = "";
		this.timeline_status_filter = "";
		this.timeline_year_filter = "";
		this.timeline_sort_field = "key";
		this.timeline_sort_order = "desc";

		// Audit Tab state & filters
		this.audit_invoices = [];
		this.audit_total = 0;
		this.audit_sales_count = 0;
		this.audit_returns_count = 0;
		this.audit_page = 1;
		this.audit_page_count = 1;
		this.audit_search = "";
		this.audit_is_return = "";
		this.audit_pos_profile = "";
		this.audit_sort_field = "posting_date";
		this.audit_sort_order = "desc";
		this.audit_pos_profiles = [];
		this.audit_totals = { grand_total: 0, net_total: 0, tax_amount: 0 };
		this.search_timer = null;

		// Payments History Tab filters & sorting
		this.payments_search = "";
		this.payments_month_filter = "";
		this.payments_wallet_filter = "";
		this.payments_sort_field = "posting_date";
		this.payments_sort_order = "desc";

		this.load();
	}

	t(ru, tg) {
		return this.is_tg ? tg : ru;
	}

	fmt(amount) {
		const n = Number(amount || 0);
		return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	fmtRate(rate) {
		const n = Number(rate || 0);
		return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
	}

	getRegimeShortLabel() {
		const isVat = Boolean(this.data && this.data.is_vat_regime);
		const rateStr = this.fmtRate(this.data ? this.data.tax_rate : 6);
		if (isVat) {
			return this.t(`НДС ${rateStr}%`, `ААИ ${rateStr}%`);
		}
		return this.t(`УСН ${rateStr}%`, `УСН ${rateStr}%`);
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
				pos_profile: this.audit_pos_profile,
				sort_field: this.audit_sort_field || "posting_date",
				sort_order: this.audit_sort_order || "desc",
				page: this.audit_page,
				limit: 50,
			},
			callback: (r) => {
				if (!r.message) return;
				this.audit_invoices = r.message.invoices || [];
				this.audit_total = r.message.total_count || 0;
				this.audit_sales_count = r.message.sales_count || 0;
				this.audit_returns_count = r.message.returns_count || 0;
				this.audit_page_count = r.message.page_count || 1;
				this.audit_pos_profiles = r.message.pos_profiles || [];
				this.audit_totals = r.message.totals || { grand_total: 0, net_total: 0, tax_amount: 0 };
				this.update_audit_toolbar_counts();
				this.update_audit_pos_select();
				this.render_audit_tab_content();
			},
		});
	}

	render() {
		this.wrapper.empty();
		const m = this.data.metrics || {};
		const curr = this.data.currency || "TJS";
		const rateStr = this.fmtRate(this.data.tax_rate || 6.0);
		const isVat = Boolean(this.data.is_vat_regime);

		const regimePillText = isVat
			? this.t(`Общий режим (НДС ${rateStr}%)`, `Низоми умумӣ (ААИ ${rateStr}%)`)
			: this.t(`УСН ${rateStr}% (Выручка)`, `Андози соддакарда ${rateStr}%`);

		const accruedSubText = isVat
			? `${this.t("Продажи:", "Фурӯш:")} ${this.fmt(m.output_tax_accrued)} − ${this.t("Зачёт:", "Харид:")} ${this.fmt(m.input_vat_credit)}`
			: this.t("Рассчитано с чистой выручки", "Аз гардиши соф ҳисоб шудааст");

		const hasDebt = Number(m.balance_due || 0) > 0.009;
		const hasAnyOutstanding = Number(m.total_outstanding || 0) > 0.009;

		let heroBtnHtml = "";
		if (hasDebt) {
			heroBtnHtml = `
				<button type="button" class="td-pay-primary-btn td-hero-pay-btn">
					${this.t("Оплатить", "Пардохт")}
				</button>
			`;
		} else if (hasAnyOutstanding) {
			heroBtnHtml = `
				<button type="button" class="td-pay-primary-btn td-hero-pay-btn" title="${this.t("Оплатить задолженность за прошлые месяцы", "Пардохти қарзи моҳҳои гузашта")}">
					${this.t("Оплатить долг", "Пардохти қарз")}
				</button>
			`;
		} else {
			heroBtnHtml = `
				<button type="button" class="td-pay-primary-btn is-disabled" disabled>
					✓ ${this.t("Оплачено", "Супорида шуд")}
				</button>
			`;
		}

		const layout = $(`
			<div class="td-layout">
				<!-- Top Filter & Regime Bar -->
				<div class="td-filter-bar">
					<div class="td-period-segmented">
						<button class="td-period-btn ${this.period === 'today' ? 'active' : ''}" data-period="today">
							${this.t("Сегодня", "Имрӯз")}
						</button>
						<button class="td-period-btn ${this.period === 'week' ? 'active' : ''}" data-period="week">
							${this.t("Неделя", "Ҳафта")}
						</button>
						<button class="td-period-btn ${this.period === 'month' ? 'active' : ''}" data-period="month">
							${this.t("Месяц", "Моҳ")}
						</button>
						<button class="td-period-btn ${this.period === 'last_month' ? 'active' : ''}" data-period="last_month">
							${this.t("Прошлый мес.", "Моҳи гузашта")}
						</button>
						<button class="td-period-btn ${this.period === 'quarter' ? 'active' : ''}" data-period="quarter">
							${this.t("Квартал", "Семоҳа")}
						</button>
						<button class="td-period-btn ${this.period === 'year' ? 'active' : ''}" data-period="year">
							${this.t("Год", "Сол")}
						</button>
						<button class="td-period-btn ${this.period === 'custom' ? 'active' : ''}" data-period="custom">
							${this.t("Период...", "Сана...")}
						</button>
					</div>

					<div class="td-filter-group">
						<span class="td-date-range-badge">
							${this.data.start_date} — ${this.data.end_date}
						</span>
						<button type="button" class="td-regime-pill td-open-settings" title="${this.t("Изменить налоговый режим или ставку (требуется пароль)", "Танзими низоми андоз")}">
							<span class="td-regime-dot"></span>
							<span>${regimePillText}</span>
							<span style="color:#64748b;font-size:12px">⚙️</span>
						</button>
					</div>
				</div>

				<!-- 4-Column Summary KPI Strip -->
				<div class="td-kpi-strip">
					<!-- Card 1: Balance Due + Action -->
					<div class="td-kpi td-kpi-due-card ${hasDebt ? 'has-debt' : 'is-paid'}">
						<div>
							<div class="td-kpi-label">
								<span>${this.t("К уплате за период", "Барои супоридан")}</span>
								<span class="td-badge ${hasDebt ? 'td-badge-unpaid' : 'td-badge-paid'}">
									${hasDebt ? this.t("К оплате", "Қарз") : this.t("Погашено", "Супорида шуд")}
								</span>
							</div>
							<div class="td-kpi-value" style="color:${hasDebt ? '#dc2626' : '#0f172a'}">
								${this.fmt(m.balance_due)} ${curr}
							</div>
						</div>
						<div class="td-kpi-foot">
							<span>
								${hasAnyOutstanding && Math.abs(m.total_outstanding - m.balance_due) > 0.01
									? `${this.t("Общий долг за все мес.:", "Қарзи умумӣ:")} <strong style="color:#dc2626">${this.fmt(m.total_outstanding)} ${curr}</strong>`
									: (hasDebt ? this.t("Ожидает оплаты в бюджет", "Пардохт лозим аст") : this.t("Задолженности за период нет", "Қарздорӣ нест"))}
							</span>
							${heroBtnHtml}
						</div>
					</div>

					<!-- Card 2: Accrued Tax -->
					<div class="td-kpi">
						<div>
							<div class="td-kpi-label">
								<span>${this.t(`Начислено (${this.getRegimeShortLabel()})`, `Ҳисоб шуд (${this.getRegimeShortLabel()})`)}</span>
							</div>
							<div class="td-kpi-value">
								${this.fmt(m.tax_accrued)} ${curr}
							</div>
						</div>
						<div class="td-kpi-foot">
							<span>${accruedSubText}</span>
						</div>
					</div>

					<!-- Card 3: Paid Tax -->
					<div class="td-kpi">
						<div>
							<div class="td-kpi-label">
								<span>${this.t("Уплачено за период", "Супорида шуд")}</span>
							</div>
							<div class="td-kpi-value" style="color:${m.tax_paid > 0 ? '#15803d' : '#0f172a'}">
								${this.fmt(m.tax_paid)} ${curr}
							</div>
						</div>
						<div class="td-kpi-foot">
							<span>
								${m.tax_accrued > 0
									? `${Math.min(100, Math.round((m.tax_paid / m.tax_accrued) * 100))}% ${this.t("от начисленного", "аз ҳисобшуда")}`
									: this.t("Проведённые платежи", "Пардохтҳои давра")}
							</span>
						</div>
					</div>

					<!-- Card 4: Net Turnover -->
					<div class="td-kpi">
						<div>
							<div class="td-kpi-label">
								<span>${this.t("Выручка (База)", "Гардиш (Пойгоҳ)")}</span>
							</div>
							<div class="td-kpi-value">
								${this.fmt(m.net_turnover)} ${curr}
							</div>
						</div>
						<div class="td-kpi-foot">
							<span>
								${m.invoice_count} ${this.t("чеков", "чек")}
								${m.returns > 0 ? ` • ${this.t("возвраты:", "бозгашт:")} ${this.fmt(m.returns)}` : ""}
							</span>
						</div>
					</div>
				</div>

				<!-- Tabs Navigation -->
				<div class="td-tabs-bar">
					<button class="td-tab-btn ${this.active_tab === 'timeline' ? 'active' : ''}" data-tab="timeline">
						${this.t("По месяцам", "Моҳҳо")}
						<span class="td-tab-badge">12</span>
					</button>
					<button class="td-tab-btn ${this.active_tab === 'audit' ? 'active' : ''}" data-tab="audit">
						${this.t("Чеки и накладные", "Чекҳо")}
						<span class="td-tab-badge">${m.invoice_count + m.return_count}</span>
					</button>
					<button class="td-tab-btn ${this.active_tab === 'payments' ? 'active' : ''}" data-tab="payments">
						${this.t("История уплат", "Пардохтҳо")}
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

		this.wrapper.find(".td-open-settings").on("click", () => {
			this.open_tax_settings_modal();
		});

		this.wrapper.find(".td-hero-pay-btn").on("click", () => {
			this.open_payment_modal();
		});

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

	getSortIcon(col, activeCol, order) {
		if (col !== activeCol) return '<span class="td-sort-icon">↕</span>';
		return `<span class="td-sort-icon">${order === "asc" ? "▲" : "▼"}</span>`;
	}

	/* --- 1. Monthly Timeline Tab (Advanced Segmented Filters, Search & Interactive Sorting) --- */
	render_timeline_tab(container) {
		container.empty();
		const timeline = this.data.timeline || [];

		// Calculate status counts
		const unpaidCount = timeline.filter((r) => Number(r.balance_due || 0) > 0.009).length;
		const paidCount = timeline.filter((r) => r.status === "paid").length;
		const partialCount = timeline.filter((r) => r.status === "partially_paid").length;
		const zeroCount = timeline.filter((r) => r.status === "zero").length;

		// Extract unique years
		const years = Array.from(new Set(timeline.map((r) => r.year).filter(Boolean))).sort((a, b) => b - a);
		let yearOptionsHtml = `<option value="">📅 ${this.t("Все годы", "Ҳамаи солҳо")}</option>`;
		years.forEach((y) => {
			const sel = String(this.timeline_year_filter) === String(y) ? "selected" : "";
			yearOptionsHtml += `<option value="${y}" ${sel}>${y}</option>`;
		});

		const buildMonthOptions = (selectedKey, yearFilter) => {
			let html = `<option value="">🗓️ ${this.t("Все месяцы", "Ҳамаи моҳҳо")}</option>`;
			timeline.forEach((r) => {
				if (yearFilter && String(r.year) !== String(yearFilter)) return;
				const lbl = this.is_tg ? (r.tg_label || r.key) : (r.ru_label || r.key);
				const sel = String(selectedKey) === String(r.key) ? "selected" : "";
				html += `<option value="${r.key}" ${sel}>${frappe.utils.escape_html(lbl)}</option>`;
			});
			return html;
		};

		const card = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>${this.t("Начисления и уплаты по месяцам", "Ҷадвали ҳисоб ва пардохти моҳона")}</span>
						<span class="td-tab-badge">${timeline.length} ${this.t("мес.", "моҳ")}</span>
					</h3>
					<div class="td-results-count td-timeline-results-label"></div>
				</div>

				<!-- Advanced Filter Toolbar -->
				<div class="td-table-toolbar">
					<div class="td-toolbar-left">
						<!-- Segmented Status Chips -->
						<div class="td-filter-chips td-timeline-status-chips">
							<button type="button" class="td-chip-btn ${!this.timeline_status_filter ? 'active' : ''}" data-status="">
								<span>${this.t("Все", "Ҳама")}</span>
								<span class="td-chip-count">${timeline.length}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.timeline_status_filter === 'has_due' ? 'active' : ''}" data-status="has_due">
								<span>🔴 ${this.t("К оплате", "Қарздор")}</span>
								<span class="td-chip-count ${unpaidCount > 0 ? 'red' : ''}">${unpaidCount}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.timeline_status_filter === 'paid' ? 'active' : ''}" data-status="paid">
								<span>🟢 ${this.t("Оплачено", "Супорида")}</span>
								<span class="td-chip-count ${paidCount > 0 ? 'green' : ''}">${paidCount}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.timeline_status_filter === 'partially_paid' ? 'active' : ''}" data-status="partially_paid">
								<span>🟡 ${this.t("Частично", "Қисман")}</span>
								<span class="td-chip-count">${partialCount}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.timeline_status_filter === 'zero' ? 'active' : ''}" data-status="zero">
								<span>⚪ ${this.t("Нет базы", "Гардиш нест")}</span>
								<span class="td-chip-count">${zeroCount}</span>
							</button>
						</div>
					</div>

					<div class="td-toolbar-right">
						<!-- Year Filter -->
						${years.length > 1 ? `
							<select class="form-control td-filter-select td-timeline-year-filter ${this.timeline_year_filter ? 'has-value' : ''}" style="width:125px">
								${yearOptionsHtml}
							</select>
						` : ''}

						<!-- Month Dropdown Filter -->
						<select class="form-control td-filter-select td-timeline-month-filter ${this.timeline_month_filter ? 'has-value' : ''}" style="width:180px">
							${buildMonthOptions(this.timeline_month_filter, this.timeline_year_filter)}
						</select>

						<!-- Reset Filters Button -->
						<button type="button" class="td-btn-clear-filters td-timeline-reset-btn" style="display:none">
							✕ ${this.t("Сбросить", "Тоза кардан")}
						</button>
					</div>
				</div>

				<div class="td-table-responsive">
					<table class="td-table">
						<thead>
							<tr>
								<th class="td-sortable-th" data-col="key">
									${this.t("Месяц", "Моҳ")} ${this.getSortIcon("key", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="gross_sales">
									${this.t("Продажи", "Фурӯш")} ${this.getSortIcon("gross_sales", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="returns">
									${this.t("Возвраты", "Бозгашт")} ${this.getSortIcon("returns", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="net_turnover">
									${this.t("База", "Пойгоҳ")} ${this.getSortIcon("net_turnover", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="tax_accrued">
									${this.t(`Налог (${this.getRegimeShortLabel()})`, `Андоз (${this.getRegimeShortLabel()})`)} ${this.getSortIcon("tax_accrued", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="tax_paid">
									${this.t("Уплачено", "Супорида шуд")} ${this.getSortIcon("tax_paid", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-right td-sortable-th" data-col="balance_due">
									${this.t("Остаток", "Бақия")} ${this.getSortIcon("balance_due", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-center td-sortable-th" data-col="status">
									${this.t("Статус", "Ҳолат")} ${this.getSortIcon("status", this.timeline_sort_field, this.timeline_sort_order)}
								</th>
								<th class="td-text-center">${this.t("Действие", "Амал")}</th>
							</tr>
						</thead>
						<tbody class="td-timeline-tbody"></tbody>
						<tfoot class="td-timeline-tfoot"></tfoot>
					</table>
				</div>
			</div>
		`);

		// Status chips click
		card.find(".td-timeline-status-chips .td-chip-btn").on("click", (e) => {
			card.find(".td-timeline-status-chips .td-chip-btn").removeClass("active");
			const btn = $(e.currentTarget);
			btn.addClass("active");
			this.timeline_status_filter = btn.data("status") || "";
			this.render_timeline_rows(card);
		});

		// Year filter change
		card.find(".td-timeline-year-filter").on("change", (e) => {
			const yVal = $(e.target).val() || "";
			this.timeline_year_filter = yVal;
			if (yVal) {
				$(e.target).addClass("has-value");
				const found = timeline.find((r) => r.key === this.timeline_month_filter);
				if (found && String(found.year) !== String(yVal)) {
					this.timeline_month_filter = "";
				}
			} else {
				$(e.target).removeClass("has-value");
			}
			const monthSelect = card.find(".td-timeline-month-filter");
			monthSelect.html(buildMonthOptions(this.timeline_month_filter, this.timeline_year_filter));
			if (this.timeline_month_filter) {
				monthSelect.addClass("has-value");
			} else {
				monthSelect.removeClass("has-value");
			}
			this.render_timeline_rows(card);
		});

		// Month filter change
		card.find(".td-timeline-month-filter").on("change", (e) => {
			const val = $(e.target).val() || "";
			this.timeline_month_filter = val;
			if (val) {
				$(e.target).addClass("has-value");
				const found = timeline.find((r) => r.key === val);
				if (found && this.timeline_year_filter && String(found.year) !== String(this.timeline_year_filter)) {
					this.timeline_year_filter = "";
					card.find(".td-timeline-year-filter").val("").removeClass("has-value");
				}
			} else {
				$(e.target).removeClass("has-value");
			}
			this.render_timeline_rows(card);
		});

		// Reset all filters button
		card.find(".td-timeline-reset-btn").on("click", () => {
			this.timeline_month_filter = "";
			this.timeline_status_filter = "";
			this.timeline_year_filter = "";
			card.find(".td-timeline-status-chips .td-chip-btn").removeClass("active");
			card.find('.td-timeline-status-chips .td-chip-btn[data-status=""]').addClass("active");
			card.find(".td-timeline-year-filter").val("").removeClass("has-value");
			const monthSelect = card.find(".td-timeline-month-filter");
			monthSelect.html(buildMonthOptions("", "")).val("").removeClass("has-value");
			this.render_timeline_rows(card);
		});

		// Interactive Column Sorting
		card.find(".td-sortable-th").on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			if (this.timeline_sort_field === col) {
				this.timeline_sort_order = this.timeline_sort_order === "asc" ? "desc" : "asc";
			} else {
				this.timeline_sort_field = col;
				this.timeline_sort_order = col === "key" || col === "status" ? "asc" : "desc";
			}
			card.find(".td-sortable-th").each((_, th) => {
				const c = $(th).data("col");
				$(th).find(".td-sort-icon").remove();
				$(th).append(this.getSortIcon(c, this.timeline_sort_field, this.timeline_sort_order));
			});
			this.render_timeline_rows(card);
		});

		container.append(card);
		this.render_timeline_rows(card);
	}

	render_timeline_rows(card) {
		const timeline = this.data.timeline || [];
		const curr = this.data.currency || "TJS";
		const isVat = Boolean(this.data.is_vat_regime);
		const mf = this.timeline_month_filter || "";
		const sf = this.timeline_status_filter || "";
		const yf = this.timeline_year_filter ? String(this.timeline_year_filter) : "";

		// Filter
		const filtered = timeline.filter((row) => {
			if (sf === "has_due") {
				if (!(row.balance_due > 0.009)) return false;
			} else if (sf && row.status !== sf) {
				return false;
			}
			if (yf && String(row.year) !== yf) {
				return false;
			}
			if (mf && row.key !== mf) {
				return false;
			}
			return true;
		});

		// Sort
		const sc = this.timeline_sort_field || "key";
		const isDesc = this.timeline_sort_order === "desc";
		filtered.sort((a, b) => {
			let va = a[sc];
			let vb = b[sc];
			if (sc === "key") {
				va = a.key;
				vb = b.key;
				return isDesc ? vb.localeCompare(va) : va.localeCompare(vb);
			}
			if (typeof va === "number" || !isNaN(Number(va))) {
				va = Number(va || 0);
				vb = Number(vb || 0);
				return isDesc ? vb - va : va - vb;
			}
			va = String(va || "").toLowerCase();
			vb = String(vb || "").toLowerCase();
			if (va < vb) return isDesc ? 1 : -1;
			if (va > vb) return isDesc ? -1 : 1;
			return 0;
		});

		// Update active sort column header classes
		card.find(".td-sortable-th").removeClass("active-sort");
		card.find(`.td-sortable-th[data-col="${sc}"]`).addClass("active-sort");

		// Update reset button and count indicator
		const hasActiveFilter = Boolean(mf || sf || yf);
		card.find(".td-timeline-reset-btn").css("display", hasActiveFilter ? "inline-flex" : "none");
		card.find(".td-timeline-results-label").html(
			hasActiveFilter
				? `${this.t("Показано:", "Нишон дода шуд:")} <strong>${filtered.length}</strong> ${this.t("из", "аз")} ${timeline.length}`
				: ""
		);

		const tbody = card.find(".td-timeline-tbody");
		const tfoot = card.find(".td-timeline-tfoot");

		if (filtered.length === 0) {
			tbody.html(`
				<tr>
					<td colspan="9" style="text-align:center;padding:36px;color:#64748b">
						<div style="font-size:13.5px;font-weight:500;margin-bottom:4px">
							${this.t("По выбранным фильтрам месяцев не найдено", "Бо ин филтр моҳҳо ёфт нашуданд")}
						</div>
						<div style="font-size:12px;color:#94a3b8">
							${this.t("Попробуйте сбросить фильтры или изменить поисковый запрос.", "Лутфан филтрҳоро тоза кунед.")}
						</div>
					</td>
				</tr>
			`);
			tfoot.empty();
			return;
		}

		let rowsHtml = "";
		let sumGross = 0;
		let sumReturns = 0;
		let sumNet = 0;
		let sumTaxAccrued = 0;
		let sumTaxPaid = 0;
		let sumBalanceDue = 0;

		filtered.forEach((row) => {
			sumGross += Number(row.gross_sales || 0);
			sumReturns += Number(row.returns || 0);
			sumNet += Number(row.net_turnover || 0);
			sumTaxAccrued += Number(row.tax_accrued || 0);
			sumTaxPaid += Number(row.tax_paid || 0);
			sumBalanceDue += Number(row.balance_due || 0);

			const label = this.is_tg ? row.tg_label : row.ru_label;
			let statusBadge = "";
			if (row.status === "paid") {
				statusBadge = `<span class="td-badge td-badge-paid">${this.t("Оплачено", "Супорида шуд")}</span>`;
			} else if (row.status === "partially_paid") {
				statusBadge = `<span class="td-badge td-badge-partial">${this.t("Частично", "Қисман")}</span>`;
			} else if (row.status === "unpaid") {
				statusBadge = `<span class="td-badge td-badge-unpaid">${this.t("К оплате", "Қарз")}</span>`;
			} else {
				statusBadge = `<span class="td-badge td-badge-zero">${this.t("Нет базы", "Гардиш нест")}</span>`;
			}

			let actionHtml = `<span style="color:#cbd5e1">—</span>`;
			if (row.balance_due > 0.009) {
				actionHtml = `
					<button class="td-btn-pay-sm td-month-pay-btn" data-key="${row.key}" data-label="${label}" data-due="${row.balance_due}">
						${this.t("Оплатить", "Пардохт")}
					</button>
				`;
			} else if (row.status === "paid") {
				actionHtml = `<span class="td-paid-check">✓ ${this.t("Погашено", "Супорида")}</span>`;
			}

			const vatBreakdownHint = isVat && (row.output_tax_accrued > 0 || row.input_vat_credit > 0)
				? `<div style="font-size:11px;color:#64748b;font-weight:400">${this.fmt(row.output_tax_accrued)} − ${this.fmt(row.input_vat_credit)}</div>`
				: "";

			rowsHtml += `
				<tr>
					<td style="font-weight:600">
						<span class="td-month-clickable" data-key="${row.key}" title="${this.t("Нажмите для фильтрации по этому месяцу", "Барои филтр кардан клик кунед")}">${label}</span>
					</td>
					<td class="td-text-right">${this.fmt(row.gross_sales)} ${curr}</td>
					<td class="td-text-right" style="color:${row.returns > 0 ? '#b91c1c' : '#94a3b8'}">
						${row.returns > 0 ? "-" + this.fmt(row.returns) : "0.00"} ${curr}
					</td>
					<td class="td-text-right" style="font-weight:500">${this.fmt(row.net_turnover)} ${curr}</td>
					<td class="td-text-right" style="font-weight:600">
						${this.fmt(row.tax_accrued)} ${curr}
						${vatBreakdownHint}
					</td>
					<td class="td-text-right" style="color:${row.tax_paid > 0 ? '#15803d' : '#64748b'};font-weight:500">
						${this.fmt(row.tax_paid)} ${curr}
					</td>
					<td class="td-text-right" style="color:${row.balance_due > 0 ? '#dc2626' : '#0f172a'};font-weight:600">
						${this.fmt(row.balance_due)} ${curr}
					</td>
					<td class="td-text-center">${statusBadge}</td>
					<td class="td-text-center">${actionHtml}</td>
				</tr>
			`;
		});

		tbody.html(rowsHtml);

		tfoot.html(`
			<tr>
				<td>${this.t("ИТОГО", "ҲАМАГӢ")} (${filtered.length} ${this.t("мес.", "моҳ")})</td>
				<td class="td-text-right">${this.fmt(sumGross)} ${curr}</td>
				<td class="td-text-right" style="color:${sumReturns > 0 ? '#b91c1c' : '#64748b'}">
					${sumReturns > 0 ? "-" + this.fmt(sumReturns) : "0.00"} ${curr}
				</td>
				<td class="td-text-right">${this.fmt(sumNet)} ${curr}</td>
				<td class="td-text-right">${this.fmt(sumTaxAccrued)} ${curr}</td>
				<td class="td-text-right" style="color:#15803d">${this.fmt(sumTaxPaid)} ${curr}</td>
				<td class="td-text-right" style="color:${sumBalanceDue > 0.009 ? '#dc2626' : '#0f172a'}">
					${this.fmt(sumBalanceDue)} ${curr}
				</td>
				<td></td>
				<td></td>
			</tr>
		`);

		tbody.find(".td-month-pay-btn").on("click", (e) => {
			const due = $(e.currentTarget).data("due");
			const key = $(e.currentTarget).data("key");
			const label = $(e.currentTarget).data("label");
			this.open_payment_modal(due, key, label);
		});

		tbody.find(".td-month-clickable").on("click", (e) => {
			const key = $(e.currentTarget).data("key");
			if (this.timeline_month_filter === key) {
				this.timeline_month_filter = "";
			} else {
				this.timeline_month_filter = key;
			}
			const monthSelect = card.find(".td-timeline-month-filter");
			monthSelect.val(this.timeline_month_filter);
			if (this.timeline_month_filter) {
				monthSelect.addClass("has-value");
			} else {
				monthSelect.removeClass("has-value");
			}
			this.render_timeline_rows(card);
		});
	}

	/* --- 2. Audit Tab (Segmented Document Types, POS Profile Filter & Interactive Sorting) --- */
	render_audit_tab_frame(container) {
		container.empty();
		const frame = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>${this.t("Чеки кассы и накладные", "Чекҳои хазина ва ҳисобномаҳо")}</span>
						<span class="td-tab-badge td-audit-total-badge">${this.audit_total || 0}</span>
					</h3>
					<div class="td-results-count td-audit-results-label"></div>
				</div>

				<!-- Advanced Filter Toolbar -->
				<div class="td-table-toolbar">
					<div class="td-toolbar-left">
						<!-- Segmented Document Type Chips -->
						<div class="td-filter-chips td-audit-type-chips">
							<button type="button" class="td-chip-btn ${!this.audit_is_return ? 'active' : ''}" data-type="">
								<span>${this.t("Все", "Ҳама")}</span>
								<span class="td-chip-count td-audit-count-all">${this.audit_total || 0}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.audit_is_return === '0' ? 'active' : ''}" data-type="0">
								<span>🟢 ${this.t("Продажи", "Фурӯш")}</span>
								<span class="td-chip-count td-audit-count-sales">${this.audit_sales_count || 0}</span>
							</button>
							<button type="button" class="td-chip-btn ${this.audit_is_return === '1' ? 'active' : ''}" data-type="1">
								<span>🔴 ${this.t("Возвраты", "Бозгашт")}</span>
								<span class="td-chip-count red td-audit-count-returns">${this.audit_returns_count || 0}</span>
							</button>
						</div>
					</div>

					<div class="td-toolbar-right">
						<!-- POS Profile Filter -->
						<select class="form-control td-filter-select td-audit-pos-filter ${this.audit_pos_profile ? 'has-value' : ''}" style="width:175px">
							<option value="">🏬 ${this.t("Все кассы", "Ҳамаи хазинаҳо")}</option>
						</select>

						<!-- Search Box with Clear Button -->
						<div class="td-search-box">
							<span class="td-search-icon">🔍</span>
							<input
								type="text"
								class="form-control td-search-input td-audit-search"
								placeholder="${this.t("Поиск по номеру, клиенту...", "Ҷустуҷӯ...")}"
								style="width:210px"
								value="${frappe.utils.escape_html(this.audit_search)}"
							>
							<button type="button" class="td-search-clear td-audit-search-clear" style="display:${this.audit_search ? 'flex' : 'none'}">✕</button>
						</div>

						<!-- Reset Filters Button -->
						<button type="button" class="td-btn-clear-filters td-audit-reset-btn" style="display:none">
							✕ ${this.t("Сбросить", "Тоза кардан")}
						</button>
					</div>
				</div>

				<div class="td-audit-body">
					<div style="text-align:center;padding:32px;color:#94a3b8;font-size:13px">
						${this.t("Загрузка...", "Боргирӣ...")}
					</div>
				</div>
				<div class="td-audit-pagination" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;border-top:1px solid #f1f5f9"></div>
			</div>
		`);

		// Type chips click
		frame.find(".td-audit-type-chips .td-chip-btn").on("click", (e) => {
			frame.find(".td-audit-type-chips .td-chip-btn").removeClass("active");
			const btn = $(e.currentTarget);
			btn.addClass("active");
			this.audit_is_return = btn.data("type") !== undefined ? String(btn.data("type")) : "";
			this.audit_page = 1;
			this.load_audit_invoices();
		});

		// POS Profile filter
		frame.find(".td-audit-pos-filter").on("change", (e) => {
			this.audit_pos_profile = $(e.target).val() || "";
			if (this.audit_pos_profile) {
				$(e.target).addClass("has-value");
			} else {
				$(e.target).removeClass("has-value");
			}
			this.audit_page = 1;
			this.load_audit_invoices();
		});

		// Search input with debounce
		const searchInput = frame.find(".td-audit-search");
		const clearBtn = frame.find(".td-audit-search-clear");
		searchInput.on("input", (e) => {
			const val = $(e.target).val() || "";
			if (val) {
				clearBtn.css("display", "flex");
			} else {
				clearBtn.hide();
			}
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.audit_search = val;
				this.audit_page = 1;
				this.load_audit_invoices();
			}, 300);
		});

		// Clear search icon
		clearBtn.on("click", () => {
			searchInput.val("").trigger("input").focus();
		});

		// Reset filters button
		frame.find(".td-audit-reset-btn").on("click", () => {
			this.audit_search = "";
			this.audit_is_return = "";
			this.audit_pos_profile = "";
			this.audit_page = 1;
			searchInput.val("");
			clearBtn.hide();
			frame.find(".td-audit-type-chips .td-chip-btn").removeClass("active");
			frame.find('.td-audit-type-chips .td-chip-btn[data-type=""]').addClass("active");
			frame.find(".td-audit-pos-filter").val("").removeClass("has-value");
			this.load_audit_invoices();
		});

		container.append(frame);
	}

	update_audit_toolbar_counts() {
		const total = this.audit_total || 0;
		const sales = this.audit_sales_count || 0;
		const returns = this.audit_returns_count || 0;

		this.wrapper.find(".td-audit-total-badge").text(total);
		this.wrapper.find(".td-audit-count-all").text(total);
		this.wrapper.find(".td-audit-count-sales").text(sales);
		this.wrapper.find(".td-audit-count-returns").text(returns);

		const hasActiveFilter = Boolean(this.audit_search || this.audit_is_return || this.audit_pos_profile);
		this.wrapper.find(".td-audit-reset-btn").css("display", hasActiveFilter ? "inline-flex" : "none");
		this.wrapper.find(".td-audit-results-label").html(
			hasActiveFilter
				? `${this.t("Найдено:", "Ёфт шуд:")} <strong>${total}</strong> ${this.t("документов", "ҳуҷҷат")}`
				: ""
		);
	}

	update_audit_pos_select() {
		const sel = this.wrapper.find(".td-audit-pos-filter");
		if (!sel.length) return;
		const profiles = this.audit_pos_profiles || [];
		let html = `<option value="">🏬 ${this.t("Все кассы", "Ҳамаи хазинаҳо")}</option>`;
		profiles.forEach((p) => {
			const isSelected = this.audit_pos_profile === p ? "selected" : "";
			html += `<option value="${frappe.utils.escape_html(p)}" ${isSelected}>${frappe.utils.escape_html(p)}</option>`;
		});
		sel.html(html);
		if (this.audit_pos_profile) {
			sel.addClass("has-value");
		} else {
			sel.removeClass("has-value");
		}
	}

	render_audit_tab_content() {
		const body = this.wrapper.find(".td-audit-body");
		const pagination = this.wrapper.find(".td-audit-pagination");
		const curr = this.data.currency || "TJS";

		if (!this.audit_invoices || this.audit_invoices.length === 0) {
			body.html(`
				<div style="text-align:center;padding:44px 20px;color:#64748b;font-size:13px">
					<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:4px">
						${this.t("Документов не найдено", "Ҳуҷҷатҳо ёфт нашуданд")}
					</div>
					<div style="color:#94a3b8">
						${this.t("Попробуйте сбросить фильтры или изменить поисковый запрос.", "Лутфан филтрҳоро тоза кунед.")}
					</div>
				</div>
			`);
			pagination.empty();
			return;
		}

		let rowsHtml = "";
		let pageSumGrand = 0;
		let pageSumNet = 0;
		let pageSumTax = 0;

		this.audit_invoices.forEach((inv) => {
			const isRet = inv.is_return;
			pageSumGrand += Number(inv.grand_total || 0);
			pageSumNet += Number(inv.net_total || 0);
			pageSumTax += Number(inv.tax_amount || 0);

			const typeBadge = isRet
				? `<span class="td-badge td-badge-unpaid">${this.t("Возврат", "Бозгашт")}</span>`
				: `<span class="td-badge td-badge-paid">${this.t("Продажа", "Фурӯш")}</span>`;

			rowsHtml += `
				<tr>
					<td>
						<a href="/app/sales-invoice/${encodeURIComponent(inv.name)}" class="td-doc-link" title="${this.t("Открыть документ в ERPNext", "Кушодани ҳуҷҷат")}">
							${inv.name} ↗
						</a>
						<div style="font-size:11px;color:#64748b;margin-top:3px">${inv.formatted_date} ${inv.posting_time ? inv.posting_time.split('.')[0] : ''}</div>
					</td>
					<td>${typeBadge}</td>
					<td>
						<div style="font-weight:500">${inv.customer_name || "Покупатель"}</div>
						<div style="font-size:11px;color:#94a3b8">${inv.pos_profile || ""}</div>
					</td>
					<td class="td-text-right" style="font-weight:600;color:${isRet ? '#b91c1c' : '#0f172a'}">
						${this.fmt(inv.grand_total)} ${curr}
					</td>
					<td class="td-text-right" style="color:#64748b">
						${this.fmt(inv.net_total)} ${curr}
					</td>
					<td class="td-text-right" style="font-weight:600;color:${isRet ? '#b91c1c' : '#0f172a'}">
						${this.fmt(inv.tax_amount)} ${curr}
					</td>
				</tr>
			`;
		});

		const tot = this.audit_totals || {
			grand_total: pageSumGrand,
			net_total: pageSumNet,
			tax_amount: pageSumTax,
		};

		let tfootHtml = `
			<tr>
				<td colspan="3">${this.t("ИТОГО", "ҲАМАГӢ")} (${this.audit_total} ${this.t("док.", "ҳуҷҷат")})</td>
				<td class="td-text-right">${this.fmt(tot.grand_total)} ${curr}</td>
				<td class="td-text-right">${this.fmt(tot.net_total)} ${curr}</td>
				<td class="td-text-right">${this.fmt(tot.tax_amount)} ${curr}</td>
			</tr>
		`;

		const sc = this.audit_sort_field || "posting_date";
		const so = this.audit_sort_order || "desc";

		body.html(`
			<div class="td-table-responsive">
				<table class="td-table">
					<thead>
						<tr>
							<th class="td-sortable-th ${sc === 'name' ? 'active-sort' : ''}" data-col="name">
								${this.t("Документ", "Ҳуҷҷат")} ${this.getSortIcon("name", sc, so)}
							</th>
							<th>${this.t("Тип", "Намуд")}</th>
							<th class="td-sortable-th ${sc === 'customer_name' ? 'active-sort' : ''}" data-col="customer_name">
								${this.t("Клиент / Касса", "Мизоҷ / Хазина")} ${this.getSortIcon("customer_name", sc, so)}
							</th>
							<th class="td-text-right td-sortable-th ${sc === 'grand_total' ? 'active-sort' : ''}" data-col="grand_total">
								${this.t("Сумма чека", "Маблағи чек")} ${this.getSortIcon("grand_total", sc, so)}
							</th>
							<th class="td-text-right td-sortable-th ${sc === 'net_total' ? 'active-sort' : ''}" data-col="net_total">
								${this.t("Без налога", "Бе андоз")} ${this.getSortIcon("net_total", sc, so)}
							</th>
							<th class="td-text-right td-sortable-th ${sc === 'tax_amount' ? 'active-sort' : ''}" data-col="tax_amount">
								${this.t(`Налог (${this.getRegimeShortLabel()})`, `Андоз (${this.getRegimeShortLabel()})`)} ${this.getSortIcon("tax_amount", sc, so)}
							</th>
						</tr>
					</thead>
					<tbody>
						${rowsHtml}
					</tbody>
					<tfoot>
						${tfootHtml}
					</tfoot>
				</table>
			</div>
		`);

		// Sort column clicks
		body.find(".td-sortable-th").on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			if (this.audit_sort_field === col) {
				this.audit_sort_order = this.audit_sort_order === "asc" ? "desc" : "asc";
			} else {
				this.audit_sort_field = col;
				this.audit_sort_order = col === "name" || col === "customer_name" ? "asc" : "desc";
			}
			this.load_audit_invoices();
		});

		pagination.html(`
			<div style="font-size:12px;color:#64748b">
				${this.t("Документов:", "Ҳуҷҷатҳо:")} <strong>${this.audit_total}</strong>
				(${this.t("стр.", "саҳ.")} ${this.audit_page} / ${this.audit_page_count})
			</div>
			<div class="td-filter-group">
				<button class="btn btn-xs btn-default td-page-prev" ${this.audit_page <= 1 ? 'disabled' : ''}>
					← ${this.t("Назад", "Қаблӣ")}
				</button>
				<button class="btn btn-xs btn-default td-page-next" ${this.audit_page >= this.audit_page_count ? 'disabled' : ''}>
					${this.t("Далее", "Баъдӣ")} →
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

	/* --- 3. Payments History Tab (Month & Wallet Filters, Interactive Sorting, Summary Row) --- */
	render_payments_tab(container) {
		container.empty();
		const payments = this.data.payments_history || [];

		if (!payments || payments.length === 0) {
			container.html(`
				<div class="td-card">
					<div style="text-align:center;padding:44px 20px;color:#64748b">
						<div style="font-size:14px;font-weight:600;color:#0f172a;margin-bottom:4px">
							${this.t("Платежей пока не зарегистрировано", "Ҳоло пардохтҳо нест")}
						</div>
						<div style="font-size:12.5px;margin-bottom:14px">
							${this.t("Проведённые оплаты налога будут отображаться в этом списке.", "Пардохтҳои андоз дар ин рӯйхат нишон дода мешаванд.")}
						</div>
						<button class="td-pay-primary-btn td-card-pay-btn">
							${this.t("Оплатить налог", "Пардохти андоз")}
						</button>
					</div>
				</div>
			`);
			container.find(".td-card-pay-btn").on("click", () => this.open_payment_modal());
			return;
		}

		// Unique months & wallets for top filters
		const monthMap = new Map();
		const walletSet = new Set();
		payments.forEach((p) => {
			if (p.target_month) {
				const lbl = this.is_tg ? (p.period_tg || p.target_month) : (p.period_ru || p.target_month);
				monthMap.set(p.target_month, lbl);
			}
			if (p.wallet_display) {
				walletSet.add(p.wallet_display);
			}
		});

		let monthOptionsHtml = `<option value="">📅 ${this.t("Все месяцы", "Ҳамаи моҳҳо")}</option>`;
		Array.from(monthMap.entries()).forEach(([key, lbl]) => {
			const sel = this.payments_month_filter === key ? "selected" : "";
			monthOptionsHtml += `<option value="${frappe.utils.escape_html(key)}" ${sel}>${frappe.utils.escape_html(lbl)}</option>`;
		});

		let walletOptionsHtml = `<option value="">👛 ${this.t("Все кассы и счета", "Ҳамаи хазинаҳо")}</option>`;
		Array.from(walletSet).forEach((w) => {
			const sel = this.payments_wallet_filter === w ? "selected" : "";
			walletOptionsHtml += `<option value="${frappe.utils.escape_html(w)}" ${sel}>${frappe.utils.escape_html(w)}</option>`;
		});

		const card = $(`
			<div class="td-card">
				<div class="td-card-header">
					<h3 class="td-card-title">
						<span>${this.t("История уплат налога", "Таърихи пардохтҳои андоз")}</span>
						<span class="td-tab-badge">${payments.length} ${this.t("платежей", "пардохт")}</span>
					</h3>
					<div class="td-results-count td-payments-results-label"></div>
				</div>

				<!-- Advanced Filter Toolbar -->
				<div class="td-table-toolbar">
					<div class="td-toolbar-left">
						<!-- Month Dropdown -->
						<select class="form-control td-filter-select td-payments-month-filter ${this.payments_month_filter ? 'has-value' : ''}" style="width:170px">
							${monthOptionsHtml}
						</select>

						<!-- Wallet Dropdown -->
						<select class="form-control td-filter-select td-payments-wallet-filter ${this.payments_wallet_filter ? 'has-value' : ''}" style="width:200px">
							${walletOptionsHtml}
						</select>
					</div>

					<div class="td-toolbar-right">
						<!-- Search Box with Clear Button -->
						<div class="td-search-box">
							<span class="td-search-icon">🔍</span>
							<input
								type="text"
								class="form-control td-search-input td-payments-search"
								placeholder="${this.t("Поиск по документу, чеку...", "Ҷустуҷӯ...")}"
								style="width:210px"
								value="${frappe.utils.escape_html(this.payments_search)}"
							>
							<button type="button" class="td-search-clear td-payments-search-clear" style="display:${this.payments_search ? 'flex' : 'none'}">✕</button>
						</div>

						<!-- Reset Filters Button -->
						<button type="button" class="td-btn-clear-filters td-payments-reset-btn" style="display:none">
							✕ ${this.t("Сбросить", "Тоза кардан")}
						</button>
					</div>
				</div>

				<div class="td-table-responsive">
					<table class="td-table">
						<thead>
							<tr>
								<th class="td-sortable-th" data-col="voucher_no">
									${this.t("Документ", "Ҳуҷҷат")} ${this.getSortIcon("voucher_no", this.payments_sort_field, this.payments_sort_order)}
								</th>
								<th class="td-sortable-th" data-col="posting_date">
									${this.t("Дата оплаты", "Санаи пардохт")} ${this.getSortIcon("posting_date", this.payments_sort_field, this.payments_sort_order)}
								</th>
								<th class="td-sortable-th" data-col="target_month">
									${this.t("За какой месяц", "Барои кадом моҳ")} ${this.getSortIcon("target_month", this.payments_sort_field, this.payments_sort_order)}
								</th>
								<th class="td-sortable-th" data-col="wallet_display">
									${this.t("Откуда оплачено (Касса / Счёт)", "Аз кадом хазина")} ${this.getSortIcon("wallet_display", this.payments_sort_field, this.payments_sort_order)}
								</th>
								<th>${this.t("Налог", "Намуди андоз")}</th>
								<th class="td-text-right td-sortable-th" data-col="amount">
									${this.t("Сумма", "Маблағ")} ${this.getSortIcon("amount", this.payments_sort_field, this.payments_sort_order)}
								</th>
								<th>${this.t("Кто оплатил", "Кӣ пардохт кард")}</th>
								<th class="td-text-right"></th>
							</tr>
						</thead>
						<tbody class="td-payments-tbody"></tbody>
						<tfoot class="td-payments-tfoot"></tfoot>
					</table>
				</div>
			</div>
		`);

		// Search input
		const searchInput = card.find(".td-payments-search");
		const clearBtn = card.find(".td-payments-search-clear");
		searchInput.on("input", (e) => {
			const val = $(e.target).val() || "";
			this.payments_search = val;
			if (val) {
				clearBtn.css("display", "flex");
			} else {
				clearBtn.hide();
			}
			this.render_payments_rows(card);
		});

		// Clear search icon
		clearBtn.on("click", () => {
			searchInput.val("").trigger("input").focus();
		});

		// Month filter
		card.find(".td-payments-month-filter").on("change", (e) => {
			this.payments_month_filter = $(e.target).val() || "";
			if (this.payments_month_filter) {
				$(e.target).addClass("has-value");
			} else {
				$(e.target).removeClass("has-value");
			}
			this.render_payments_rows(card);
		});

		// Wallet filter
		card.find(".td-payments-wallet-filter").on("change", (e) => {
			this.payments_wallet_filter = $(e.target).val() || "";
			if (this.payments_wallet_filter) {
				$(e.target).addClass("has-value");
			} else {
				$(e.target).removeClass("has-value");
			}
			this.render_payments_rows(card);
		});

		// Reset filters button
		card.find(".td-payments-reset-btn").on("click", () => {
			this.payments_search = "";
			this.payments_month_filter = "";
			this.payments_wallet_filter = "";
			searchInput.val("");
			clearBtn.hide();
			card.find(".td-payments-month-filter").val("").removeClass("has-value");
			card.find(".td-payments-wallet-filter").val("").removeClass("has-value");
			this.render_payments_rows(card);
		});

		// Sort column clicks
		card.find(".td-sortable-th").on("click", (e) => {
			const col = $(e.currentTarget).data("col");
			if (this.payments_sort_field === col) {
				this.payments_sort_order = this.payments_sort_order === "asc" ? "desc" : "asc";
			} else {
				this.payments_sort_field = col;
				this.payments_sort_order = col === "amount" ? "desc" : "asc";
			}
			card.find(".td-sortable-th").each((_, th) => {
				const c = $(th).data("col");
				$(th).find(".td-sort-icon").remove();
				$(th).append(this.getSortIcon(c, this.payments_sort_field, this.payments_sort_order));
			});
			this.render_payments_rows(card);
		});

		container.append(card);
		this.render_payments_rows(card);
	}

	render_payments_rows(card) {
		const payments = this.data.payments_history || [];
		const curr = this.data.currency || "TJS";
		const q = (this.payments_search || "").trim().toLowerCase();
		const mf = this.payments_month_filter || "";
		const wf = this.payments_wallet_filter || "";

		// Filter
		const filtered = payments.filter((p) => {
			if (mf && p.target_month !== mf) return false;
			if (wf && p.wallet_display !== wf) return false;
			if (q) {
				const hay = `${p.voucher_no || ""} ${p.ref_no || ""} ${p.period_ru || ""} ${p.period_tg || ""} ${p.wallet_display || ""} ${p.user || ""} ${p.formatted_date || ""}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});

		// Sort
		const sc = this.payments_sort_field || "posting_date";
		const isDesc = this.payments_sort_order === "desc";
		filtered.sort((a, b) => {
			let va = a[sc];
			let vb = b[sc];
			if (sc === "amount") {
				va = Number(va || 0);
				vb = Number(vb || 0);
				return isDesc ? vb - va : va - vb;
			}
			va = String(va || "").toLowerCase();
			vb = String(vb || "").toLowerCase();
			if (va < vb) return isDesc ? 1 : -1;
			if (va > vb) return isDesc ? -1 : 1;
			return 0;
		});

		// Update active sort column header classes
		card.find(".td-sortable-th").removeClass("active-sort");
		card.find(`.td-sortable-th[data-col="${sc}"]`).addClass("active-sort");

		// Update reset button and count indicator
		const hasActiveFilter = Boolean(q || mf || wf);
		card.find(".td-payments-reset-btn").css("display", hasActiveFilter ? "inline-flex" : "none");
		card.find(".td-payments-results-label").html(
			hasActiveFilter
				? `${this.t("Показано:", "Нишон дода шуд:")} <strong>${filtered.length}</strong> ${this.t("из", "аз")} ${payments.length}`
				: ""
		);

		const tbody = card.find(".td-payments-tbody");
		const tfoot = card.find(".td-payments-tfoot");

		if (filtered.length === 0) {
			tbody.html(`
				<tr>
					<td colspan="8" style="text-align:center;padding:36px;color:#64748b">
						<div style="font-size:13.5px;font-weight:500;margin-bottom:4px">
							${this.t("По выбранным фильтрам платежей не найдено", "Бо ин филтр пардохтҳо ёфт нашуданд")}
						</div>
						<div style="font-size:12px;color:#94a3b8">
							${this.t("Попробуйте сбросить фильтры или изменить поисковый запрос.", "Лутфан филтрҳоро тоза кунед.")}
						</div>
					</td>
				</tr>
			`);
			tfoot.empty();
			return;
		}

		let rowsHtml = "";
		let sumAmount = 0;

		filtered.forEach((p) => {
			sumAmount += Number(p.amount || 0);
			const periodLabel = this.is_tg ? (p.period_tg || p.target_month) : (p.period_ru || p.target_month);
			const docUrl = p.voucher_route || `/app/journal-entry/${encodeURIComponent(p.voucher_no)}`;
			const docCellHtml = p.voucher_no
				? `
					<a href="${docUrl}" class="td-doc-link" title="${this.t("Открыть проводку в ERPNext", "Кушодани ҳуҷҷат дар ERPNext")}">
						${frappe.utils.escape_html(p.voucher_no)} ↗
					</a>
					${p.ref_no ? `<div style="font-size:11px;color:#64748b;margin-top:2px">№ ${frappe.utils.escape_html(p.ref_no)}</div>` : ""}
				`
				: "—";

			rowsHtml += `
				<tr>
					<td>${docCellHtml}</td>
					<td style="font-weight:500">${p.formatted_date}</td>
					<td>
						<span style="font-weight:600;color:#0f172a">${periodLabel}</span>
					</td>
					<td>
						<span style="font-weight:500;color:#1e293b">${p.wallet_display || "Касса / Банк"}</span>
					</td>
					<td>
						<span class="td-badge td-badge-zero">${p.regime_label || this.getRegimeShortLabel()}</span>
					</td>
					<td class="td-text-right" style="font-weight:700;color:#15803d">
						${this.fmt(p.amount)} ${curr}
					</td>
					<td style="font-size:12px;color:#64748b">${p.user}</td>
					<td class="td-text-right">
						<button type="button" class="btn btn-xs btn-default td-cancel-payment-btn" data-voucher="${p.voucher_no}" data-amount="${this.fmt(p.amount)} ${curr}" data-period="${periodLabel}" style="color:#b91c1c">
							${this.t("Отменить", "Бекор кардан")}
						</button>
					</td>
				</tr>
			`;
		});

		tbody.html(rowsHtml);

		tfoot.html(`
			<tr>
				<td colspan="5">${this.t("ИТОГО УПЛАЧЕНО", "ҲАМАГӢ СУПОРИДА ШУД")} (${filtered.length} ${this.t("плат.", "пардохт")})</td>
				<td class="td-text-right" style="color:#15803d">${this.fmt(sumAmount)} ${curr}</td>
				<td></td>
				<td></td>
			</tr>
		`);

		tbody.find(".td-cancel-payment-btn").on("click", (e) => {
			const voucher = $(e.currentTarget).data("voucher");
			const amountStr = $(e.currentTarget).data("amount");
			const periodStr = $(e.currentTarget).data("period");
			frappe.confirm(
				this.t(
					`Отменить платёж налога <strong>${voucher}</strong> на сумму <strong>${amountStr}</strong> за <strong>${periodStr}</strong>? Деньги вернутся обратно на баланс кассы/счёта.`,
					`Оё пардохти андоз <strong>${voucher}</strong> ба маблағи <strong>${amountStr}</strong> (${periodStr}) бекор карда шавад?`
				),
				() => {
					frappe.call({
						method: "erpnext.accounts.page.tax_desk.tax_desk.cancel_tax_payment",
						args: { voucher_no: voucher },
						callback: (r) => {
							if (r.message && r.message.status === "success") {
								frappe.show_alert(
									{
										message: this.t("Платёж отменён", "Пардохт бекор карда шуд"),
										indicator: "orange",
									},
									4
								);
								this.load();
							}
						},
					});
				}
			);
		});
	}

	/* --- 4. Password-Protected Tax Regime & Rate Settings Modal --- */
	open_tax_settings_modal() {
		const ts = (this.data && this.data.tax_settings) || {};
		let selectedRegime = ts.tax_regime || (this.data && this.data.tax_regime) || "Simplified";
		const simpRate = ts.simplified_tax_rate !== undefined ? ts.simplified_tax_rate : 6.0;
		const vatRate = ts.vat_rate !== undefined ? ts.vat_rate : 14.0;

		const d = new frappe.ui.Dialog({
			title: this.t("Налоговый режим и ставка", "Низоми андоз ва меъёр"),
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "regime_cards_html",
					options: `
						<div class="td-regime-cards">
							<div class="td-regime-card ${selectedRegime === 'Simplified' ? 'selected' : ''}" data-regime="Simplified">
								<div class="td-regime-card-title">
									<span>${this.t("Упрощённый режим (УСН)", "Низоми соддакарда (УСН)")}</span>
								</div>
								<div class="td-regime-card-desc">
									${this.t("Налог с выручки. Скрыт в чеке покупателя, рассчитывается в фоне.", "Андоз аз гардиш. Дар чек нишон дода намешавад.")}
								</div>
							</div>
							<div class="td-regime-card ${selectedRegime === 'General (VAT)' ? 'selected' : ''}" data-regime="General (VAT)">
								<div class="td-regime-card-title">
									<span>${this.t("Общий режим (НДС)", "Низоми умумӣ (ААИ / НДС)")}</span>
								</div>
								<div class="td-regime-card-desc">
									${this.t("Включённый НДС отображается на чеке, учитывается зачёт по закупкам.", "ААИ дар чек нишон дода мешавад.")}
								</div>
							</div>
						</div>
					`,
				},
				{
					fieldtype: "Percent",
					fieldname: "simplified_tax_rate",
					label: this.t("Ставка упрощённого налога (%)", "Меъёри УСН (%)"),
					default: simpRate,
					reqd: 1,
				},
				{
					fieldtype: "Percent",
					fieldname: "vat_rate",
					label: this.t("Ставка НДС (%)", "Меъёри ААИ / НДС (%)"),
					default: vatRate,
					reqd: 1,
				},
				{
					fieldtype: "Section Break",
					label: this.t("Подтверждение безопасности", "Тасдиқи амният"),
				},
				{
					fieldtype: "HTML",
					fieldname: "security_warning",
					options: `
						<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:12px;color:#92400e">
							<strong>⚠️ ${this.t("Важное изменение:", "Тағйироти муҳим:")}</strong>
							${this.t("Смена налогового режима или ставки изменит шаблоны налогов во всех кассах магазина. Введите пароль от вашего аккаунта для подтверждения.", "Барои тасдиқи тағйирот рамзи худро ворид кунед.")}
						</div>
					`,
				},
				{
					fieldtype: "Password",
					fieldname: "password",
					label: this.t("Ваш пароль для подтверждения", "Рамзи шумо барои тасдиқ"),
					reqd: 1,
				},
			],
			primary_action_label: this.t("Подтвердить и сохранить", "Тасдиқ ва нигоҳ доштан"),
			primary_action: (values) => {
				if (!values.password) {
					frappe.msgprint(this.t("Введите пароль для подтверждения изменений", "Лутфан рамзро ворид кунед"));
					return;
				}
				d.get_primary_btn().prop("disabled", true).text(this.t("Проверка...", "Санҷиш..."));
				frappe.call({
					method: "erpnext.accounts.page.tax_desk.tax_desk.save_retail_tax_settings",
					args: {
						tax_regime: selectedRegime,
						simplified_tax_rate: values.simplified_tax_rate,
						vat_rate: values.vat_rate,
						password: values.password,
						enable_cashless_split: ts.enable_cashless_split ? 1 : 0,
						simplified_cashless_rate: ts.simplified_cashless_rate || 0,
						vat_cashless_rate: ts.vat_cashless_rate || 0,
					},
					callback: (r) => {
						d.hide();
						if (r.message && r.message.status === "success") {
							frappe.show_alert(
								{
									message: this.t("Налоговый режим и ставка успешно обновлены", "Танзимоти андоз нигоҳ дошта шуд"),
									indicator: "green",
								},
								4
							);
							this.load();
						}
					},
					always: () => {
						d.get_primary_btn().prop("disabled", false).text(this.t("Подтвердить и сохранить", "Тасдиқ ва нигоҳ доштан"));
					},
				});
			},
		});

		const toggleRateInputs = () => {
			const isVat = selectedRegime === "General (VAT)";
			d.set_df_property("simplified_tax_rate", "hidden", isVat ? 1 : 0);
			d.set_df_property("vat_rate", "hidden", isVat ? 0 : 1);
		};

		d.show();
		toggleRateInputs();

		d.$wrapper.find(".td-regime-card").on("click", function () {
			d.$wrapper.find(".td-regime-card").removeClass("selected");
			$(this).addClass("selected");
			selectedRegime = $(this).data("regime");
			toggleRateInputs();
		});
	}

	/* --- 5. 1-Click Tax Payment Modal (with Double-Payment Protection) --- */
	open_payment_modal(prefill_amount, month_key, month_label) {
		const timeline = this.data.timeline || [];
		const wallets = this.data.wallets || [];
		const curr = this.data.currency || "TJS";

		const unpaidMonths = timeline.filter((r) => Number(r.balance_due || 0) > 0.009);
		if (unpaidMonths.length === 0) {
			frappe.msgprint({
				title: this.t("Задолженности нет", "Қарздорӣ нест"),
				indicator: "green",
				message: this.t(
					"Все начисленные налоги полностью оплачены! Повторная оплата не требуется.",
					"Ҳамаи андозҳо пурра пардохт шудаанд!"
				),
			});
			return;
		}

		// Build month options from timeline (showing exact status for each month)
		const monthOptions = timeline.map((row) => {
			const lbl = this.is_tg ? row.tg_label : row.ru_label;
			let suffix = "";
			if (row.balance_due > 0.009) {
				suffix = ` — ${this.t("к оплате:", "қарз:")} ${this.fmt(row.balance_due)} ${curr}`;
			} else if (row.status === "paid") {
				suffix = ` (✓ ${this.t("оплачено", "супорида шуд")})`;
			} else {
				suffix = ` (${this.t("нет начислений", "гардиш нест")})`;
			}
			return {
				value: row.key,
				label: `${lbl}${suffix}`,
				due: row.balance_due,
			};
		});

		let defaultMonthKey = month_key;
		if (!defaultMonthKey) {
			const currentStartMonth = (this.data.start_date || "").slice(0, 7);
			const matchCurrent = unpaidMonths.find((r) => r.key === currentStartMonth);
			defaultMonthKey = (matchCurrent && matchCurrent.key) || unpaidMonths[0].key;
		}

		const matchedRow = timeline.find((r) => r.key === defaultMonthKey) || unpaidMonths[0];
		const defaultAmt =
			prefill_amount !== undefined
				? prefill_amount
				: matchedRow && matchedRow.balance_due > 0
				? matchedRow.balance_due
				: 0;

		let selectedWallet = wallets.length > 0 ? wallets[0].name : null;

		let walletsHtml = "";
		wallets.forEach((w, idx) => {
			const isSel = idx === 0 ? "selected" : "";
			walletsHtml += `
				<div class="td-wallet-option ${isSel}" data-wallet="${w.name}">
					<span class="td-wallet-icon">${w.icon}</span>
					<div class="td-wallet-info">
						<span class="td-wallet-name" title="${w.wallet_name}">${w.wallet_name}</span>
						<span class="td-wallet-bal">
							${this.fmt(w.balance)} ${curr}
						</span>
					</div>
				</div>
			`;
		});

		const d = new frappe.ui.Dialog({
			title: this.t(`Оплата налога (${this.getRegimeShortLabel()})`, `Пардохти андоз (${this.getRegimeShortLabel()})`),
			fields: [
				{
					fieldtype: "Select",
					fieldname: "target_month",
					label: this.t("За какой месяц оплачивается налог", "Барои кадом моҳ"),
					options: monthOptions.map((o) => ({ value: o.value, label: o.label })),
					default: defaultMonthKey,
					reqd: 1,
					change: () => {
						const selKey = d.get_value("target_month");
						const row = timeline.find((r) => r.key === selKey);
						updateMonthGuard(row, true);
					},
				},
				{
					fieldtype: "HTML",
					fieldname: "month_status_banner",
					options: `<div class="td-modal-month-banner"></div>`,
				},
				{
					fieldtype: "Currency",
					fieldname: "amount",
					label: this.t("Сумма к оплате", "Маблағи пардохт"),
					default: defaultAmt,
					reqd: 1,
				},
				{
					fieldtype: "HTML",
					fieldname: "wallet_picker",
					options: `
						<div style="margin-bottom:12px">
							<label class="control-label" style="font-size:12px;font-weight:600;margin-bottom:4px;display:block">
								${this.t("Откуда списать (Касса / Счёт)", "Аз кадом хазина")}
							</label>
							<div class="td-wallet-grid">${walletsHtml}</div>
						</div>
					`,
				},
				{
					fieldtype: "Date",
					fieldname: "posting_date",
					label: this.t("Дата проведения платежа", "Санаи пардохт"),
					default: frappe.datetime.now_date(),
					reqd: 1,
				},
				{
					fieldtype: "Small Text",
					fieldname: "remarks",
					label: this.t("Комментарий (необязательно)", "Тавзеҳот (ихтиёрӣ)"),
				},
			],
			primary_action_label: this.t("Провести оплату", "Пардохт кардан"),
			primary_action: (values) => {
				if (!selectedWallet) {
					frappe.msgprint(this.t("Выберите кассу или счёт", "Лутфан, хазинаро интихоб намоед"));
					return;
				}
				const selRow = timeline.find((r) => r.key === values.target_month);
				if (!selRow || Number(selRow.balance_due || 0) <= 0.009) {
					frappe.msgprint(
						this.t(
							"Налог за выбранный месяц уже полностью оплачен. Повторная оплата невозможна.",
							"Андоз барои ин моҳ аллакай пардохт шудааст."
						)
					);
					return;
				}
				const payAmt = Number(values.amount || 0);
				if (payAmt <= 0) {
					frappe.msgprint(this.t("Сумма должна быть больше нуля", "Маблағ бояд бештар аз 0 бошад"));
					return;
				}
				if (payAmt > Number(selRow.balance_due) + 0.01) {
					frappe.msgprint(
						this.t(
							`Сумма оплаты (${this.fmt(payAmt)} ${curr}) не может превышать остаток долга за выбранный месяц (${this.fmt(selRow.balance_due)} ${curr}).`,
							`Маблағи пардохт аз бақияи қарз (${this.fmt(selRow.balance_due)} ${curr}) зиёд буда наметавонад.`
						)
					);
					return;
				}

				d.get_primary_btn().prop("disabled", true).text(this.t("Проведение...", "Иҷро..."));

				frappe.call({
					method: "erpnext.accounts.page.tax_desk.tax_desk.record_tax_payment",
					args: {
						wallet: selectedWallet,
						amount: payAmt,
						target_month: values.target_month,
						posting_date: values.posting_date,
						remarks: values.remarks || "",
					},
					callback: (r) => {
						d.hide();
						if (r.message && r.message.status === "success") {
							frappe.show_alert({
								message: r.message.message,
								indicator: "green",
							}, 5);
							this.load();
						}
					},
					always: () => {
						d.get_primary_btn().prop("disabled", false).text(this.t("Провести оплату", "Пардохт кардан"));
					},
				});
			},
		});

		const updateMonthGuard = (row, resetAmount) => {
			const bannerEl = d.$wrapper.find(".td-modal-month-banner");
			if (!row) return;
			const due = Number(row.balance_due || 0);
			const lbl = this.is_tg ? row.tg_label : row.ru_label;

			if (resetAmount) {
				d.set_value("amount", due > 0.009 ? due : 0);
			}

			if (due <= 0.009) {
				bannerEl.html(`
					<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:12px;color:#15803d">
						<strong>✓ ${lbl}:</strong>
						${this.t("Налог за этот месяц уже полностью оплачен", "Андоз барои ин моҳ пурра супорида шудааст")}
						(${this.t("начислено:", "ҳисоб шуд:")} ${this.fmt(row.tax_accrued)} ${curr}, ${this.t("уплачено:", "супорида:")} ${this.fmt(row.tax_paid)} ${curr}).
					</div>
				`);
				d.get_primary_btn().prop("disabled", true).text(this.t("Уже оплачено", "Супорида шуд"));
			} else {
				bannerEl.html(`
					<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:9px 12px;margin-bottom:10px;font-size:12px;color:#334155;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px">
						<span>${this.t("Начислено:", "Ҳисоб шуд:")} <strong>${this.fmt(row.tax_accrued)} ${curr}</strong></span>
						<span>${this.t("Уплачено:", "Супорида:")} <strong style="color:#15803d">${this.fmt(row.tax_paid)} ${curr}</strong></span>
						<span>${this.t("Остаток к оплате:", "Бақияи қарз:")} <strong style="color:#dc2626">${this.fmt(due)} ${curr}</strong></span>
					</div>
				`);
				d.get_primary_btn().prop("disabled", false).text(this.t("Провести оплату", "Пардохт кардан"));
			}
		};

		d.show();
		updateMonthGuard(matchedRow, false);

		d.$wrapper.find(".td-wallet-option").on("click", function () {
			d.$wrapper.find(".td-wallet-option").removeClass("selected");
			$(this).addClass("selected");
			selectedWallet = $(this).data("wallet");
		});
	}

	/* --- 6. Printable Declaration Modal --- */
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
				const isVat = Boolean(desk.is_vat_regime);
				const rateStr = this.fmtRate(desk.tax_rate || 6.0);

				const declTitle = isVat
					? "СПРАВКА-РАСЧЕТ НАЛОГА НА ДОБАВЛЕННУЮ СТОИМОСТЬ (НДС)"
					: "СПРАВКА-РАСЧЕТ УПРОЩЕННОГО НАЛОГА";
				const declSubtitle = isVat
					? `(Общий налоговый режим: НДС, ставка ${rateStr}%)`
					: `(Специальный налоговый режим: Упрощенная система налогообложения, ставка ${rateStr}%)`;

				const vatExtraRows = isVat
					? `
						<tr>
							<td>5а</td>
							<td>Начисленный НДС с продаж (Исходящий НДС, ${rateStr}%)</td>
							<td style="text-align:right">${this.fmt(m.output_tax_accrued)}</td>
						</tr>
						<tr>
							<td>5б</td>
							<td>НДС к зачёту по закупкам (Входящий НДС по приходным накладным)</td>
							<td style="text-align:right;color:#15803d">-${this.fmt(m.input_vat_credit)}</td>
						</tr>
					`
					: "";

				const d = new frappe.ui.Dialog({
					title: this.t(`Справка-расчет (${this.getRegimeShortLabel()})`, "Маълумотнома-ҳисоби андоз"),
					size: "large",
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "decl_html",
							options: `
								<div class="td-decl-container" id="td-print-area">
									<div class="td-decl-header">
										<h2 class="td-decl-title">${declTitle}</h2>
										<p class="td-decl-subtitle">${declSubtitle}</p>
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
												<span class="td-decl-meta-label">Юрисдикция:</span>
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
												<td>Возвраты товаров покупателями</td>
												<td style="text-align:right;color:#b91c1c">${m.returns > 0 ? "-" + this.fmt(m.returns) : "0.00"}</td>
											</tr>
											<tr style="background:#f8fafc;font-weight:600">
												<td>3</td>
												<td>Чистая налогооблагаемая база (Стр. 1 - Стр. 2)</td>
												<td style="text-align:right">${this.fmt(m.net_turnover)}</td>
											</tr>
											<tr>
												<td>4</td>
												<td>Налоговая ставка (${isVat ? "НДС" : "УСН"})</td>
												<td style="text-align:right">${rateStr}%</td>
											</tr>
											${vatExtraRows}
											<tr class="total-row">
												<td>5</td>
												<td>ИТОГО НАЧИСЛЕНО К УПЛАТЕ ЗА ПЕРИОД</td>
												<td style="text-align:right">${this.fmt(m.tax_accrued)}</td>
											</tr>
											<tr>
												<td>6</td>
												<td>Фактически уплачено за период</td>
												<td style="text-align:right;color:#15803d;font-weight:600">${this.fmt(m.tax_paid)}</td>
											</tr>
											<tr class="total-row">
												<td>7</td>
												<td>ОСТАТОК К УПЛАТЕ (Стр. 5 - Стр. 6)</td>
												<td style="text-align:right;color:${m.balance_due > 0 ? '#dc2626' : '#0f172a'}">
													${this.fmt(m.balance_due)}
												</td>
											</tr>
										</tbody>
									</table>

									<div class="td-decl-signatures">
										<div>
											Руководитель:
											<div class="td-decl-sig-line"></div>
											<span style="font-size:11px;color:#64748b">(подпись / Ф.И.О.)</span>
										</div>
										<div>
											Бухгалтер:
											<div class="td-decl-sig-line"></div>
											<span style="text-align:11px;color:#64748b">(подпись / Ф.И.О.)</span>
										</div>
									</div>
								</div>
							`,
						},
					],
					primary_action_label: this.t("Печать / PDF", "Чоп кардан"),
					primary_action: () => {
						window.print();
					},
				});

				d.show();
			},
		});
	}
}
