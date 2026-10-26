// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["expense-desk"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Хароҷотҳои фаврӣ (Expense Desk)") : __("Учет расходов кассы (Expense Desk)"),
		single_column: true,
	});

	page.add_inner_button(
		is_tg ? __("Каталоги молҳо") : __("Каталог товаров"),
		() => frappe.set_route("product-catalog")
	);

	page.add_inner_button(
		is_tg ? __("Хаби таъминкунандагон") : __("Поставщики"),
		() => frappe.set_route("supplier-hub")
	);

	page.add_inner_button(
		is_tg ? __("Рӯйхати пурра") : __("Все расходы"),
		() => frappe.set_route("List", "Quick Expense")
	);

	page.add_inner_button(
		is_tg ? __("Навсозӣ") : __("Обновить"),
		() => {
			if (wrapper.expense_desk_app) {
				wrapper.expense_desk_app.load_init_data();
			}
		}
	);

	wrapper.expense_desk_app = new ExpenseDeskApp(page);
};

class ExpenseDeskApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body);
		this.is_tg = frappe.boot.user.language === "tg";
		this.data = null;
		this.selected_source = null;
		this.selected_category = null;
		this.is_custom_category = false;
		this.receipt_url = null;

		// Filter state
		this.active_period = "today";
		this.from_date = null;
		this.to_date = null;
		this.active_source_filter = "all";
		this.active_category_filter = "all";
		this.search_query = "";
		this.search_timer = null;

		this.init();
	}

	init() {
		this.load_init_data();
	}

	load_init_data() {
		frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_desk_init_data",
			callback: (r) => {
				if (r.message) {
					this.data = r.message;
					if (!this.selected_source && this.data.payment_sources.length > 0) {
						this.selected_source = this.data.payment_sources[0];
					}
					if (!this.selected_category && this.data.categories.length > 0) {
						this.selected_category = this.data.categories[0];
					}
					this.render();
				}
			},
		});
	}

	render() {
		this.wrapper.empty();
		const layout = $(`
			<div class="expense-desk-layout">
				<div class="expense-desk-container">
					<div class="expense-card expense-form-col"></div>
					<div class="expense-card expense-stream-col"></div>
				</div>
			</div>
		`);

		this.wrapper.append(layout);
		this.render_form(layout.find(".expense-form-col"));
		this.render_stream(layout.find(".expense-stream-col"));
	}

	render_form(container) {
		const curr = this.data.currency || "TJS";
		const sources = this.data.payment_sources || [];
		const categories = this.data.categories || [];

		const form_html = $(`
			<div>
				<div class="expense-card-header">
					<h3 class="expense-card-title">
						<span>💸</span>
						${this.is_tg ? "Сабти хароҷот / Баромад аз касса" : "Регистрация расхода / Выдача из кассы"}
					</h3>
					<span class="expense-badge">${this.data.company}</span>
				</div>

				<!-- 1. Source (Paid From) -->
				<div class="expense-section">
					<div class="expense-label">
						<span>1. ${this.is_tg ? "Манбаи маблағ (Аз куҷо пардохт мешавад)" : "Источник средств (Откуда списать)"}</span>
					</div>
					<div class="source-grid" id="source-grid"></div>
				</div>

				<!-- 2. Category Chips -->
				<div class="expense-section">
					<div class="expense-label">
						<span>2. ${this.is_tg ? "Категорияи хароҷот" : "Категория расхода"}</span>
					</div>
					<div class="category-chips-grid" id="category-chips"></div>

					<!-- Custom Category Expansion Drawer -->
					<div class="custom-category-box" id="custom-cat-box">
						<div style="margin-bottom: 8px;">
							<label style="font-size: 11px; font-weight: 600; color: #718096; margin-bottom: 2px;">
								${this.is_tg ? "Номи категорияи нав:" : "Название новой категории:"}
							</label>
							<input type="text" id="custom-cat-name" class="expense-input" placeholder="${this.is_tg ? 'Масалан: Реклама дар Instagram' : 'Например: Реклама в Instagram'}">
						</div>
						<div style="margin-bottom: 8px;">
							<label style="font-size: 11px; font-weight: 600; color: #718096; margin-bottom: 2px;">
								${this.is_tg ? "Ҳисоби баҳисобгирӣ (Expense Account):" : "Счет расходов (Expense Account):"}
							</label>
							<select id="custom-cat-account" class="expense-select"></select>
						</div>
						<div style="display: flex; align-items: center; gap: 6px;">
							<input type="checkbox" id="pin-cat-check" checked style="cursor: pointer;">
							<label for="pin-cat-check" style="font-size: 12px; font-weight: 500; cursor: pointer; margin: 0;">
								⭐ ${this.is_tg ? "Барои истифодаи доимӣ сабт кунед" : "Закрепить для постоянного использования"}
							</label>
						</div>
					</div>

					<!-- Staff Advance Picker -->
					<div class="custom-category-box" id="staff-advance-box">
						<label style="font-size: 11px; font-weight: 600; color: #718096; margin-bottom: 2px;">
							👤 ${this.is_tg ? "Интихоби корманд:" : "Выберите сотрудника:"}
						</label>
						<select id="staff-employee-select" class="expense-select"></select>
					</div>
				</div>

				<!-- 3. Amount -->
				<div class="expense-section">
					<div class="expense-label">
						<span>3. ${this.is_tg ? "Маблағи хароҷот" : "Сумма расхода"}</span>
					</div>
					<div class="amount-wrapper">
						<span class="amount-currency">${curr}</span>
						<input type="number" step="any" min="0" id="expense-amount" class="amount-input" placeholder="0.00" autofocus>
					</div>
					<div class="quick-add-group">
						<button class="quick-add-btn" data-add="5">+5</button>
						<button class="quick-add-btn" data-add="10">+10</button>
						<button class="quick-add-btn" data-add="20">+20</button>
						<button class="quick-add-btn" data-add="50">+50</button>
						<button class="quick-add-btn" data-add="100">+100</button>
					</div>
				</div>

				<!-- 4. Notes / Description -->
				<div class="expense-section">
					<div class="expense-label">
						<span>4. ${this.is_tg ? "Тавсиф ва шарҳ (Ихтиёрӣ)" : "Примечание / Кому выдано (Опционально)"}</span>
					</div>
					<textarea id="expense-desc" class="expense-textarea" placeholder="${this.is_tg ? 'Масалан: Барои курери фармоиши веб ё чой барои кормандон...' : 'Например: За доставку заказа клиенту, чай и кофе в офис...'}"></textarea>
				</div>

				<!-- 5. Receipt Photo Upload -->
				<div class="expense-section">
					<div class="expense-label">
						<span>5. ${this.is_tg ? "Чек ё акс (Ихтиёрӣ)" : "Фото чека (Опционально)"}</span>
					</div>
					<div class="receipt-dropzone" id="receipt-upload-btn">
						<div id="receipt-upload-label">
							📷 ${this.is_tg ? "Акси чекро замима кунед (Camera / Upload)" : "Прикрепить фото чека (Камера / Файл)"}
						</div>
						<div id="receipt-preview-wrap" style="display: none;"></div>
					</div>
				</div>

				<!-- Action Submit Button -->
				<button class="btn-record-expense" id="btn-submit-expense">
					<span>⚡</span>
					<span>${this.is_tg ? "Сабт ва баромад аз касса" : "Записать и списать"}</span>
				</button>
			</div>
		`);

		container.append(form_html);
		this.populate_sources(form_html.find("#source-grid"));
		this.populate_categories(form_html.find("#category-chips"));
		this.populate_expense_accounts(form_html.find("#custom-cat-account"));
		this.populate_employees(form_html.find("#staff-employee-select"));
		this.bind_form_events(form_html);
	}

	populate_sources(container) {
		container.empty();
		const curr = this.data.currency || "TJS";
		const sources = this.data.payment_sources || [];

		sources.forEach((src) => {
			const is_active = this.selected_source && this.selected_source.id === src.id;
			const btn = $(`
				<div class="source-btn ${is_active ? 'active' : ''}" data-id="${src.id}">
					<div class="source-info">
						<span>${src.label}</span>
					</div>
					<span class="source-balance">${format_currency(src.balance, curr)}</span>
				</div>
			`);

			btn.on("click", () => {
				container.find(".source-btn").removeClass("active");
				btn.addClass("active");
				this.selected_source = src;
			});

			container.append(btn);
		});
	}

	populate_categories(container) {
		container.empty();
		const categories = this.data.categories || [];

		categories.forEach((cat) => {
			const is_active = !this.is_custom_category && this.selected_category && this.selected_category.name === cat.name;
			const chip = $(`
				<div class="category-chip ${is_active ? 'active' : ''}" data-name="${cat.name}">
					<span class="category-icon">${cat.icon || '🏷️'}</span>
					<span>${cat.category_name}</span>
				</div>
			`);

			chip.on("click", () => {
				this.is_custom_category = false;
				container.find(".category-chip").removeClass("active");
				chip.addClass("active");
				this.selected_category = cat;
				$("#custom-cat-box").removeClass("show");

				if (cat.category_name === "Staff Advance" || cat.category_name === "Аванс сотруднику") {
					$("#staff-advance-box").addClass("show");
				} else {
					$("#staff-advance-box").removeClass("show");
				}
			});

			container.append(chip);
		});

		// Add '+ Custom' Chip
		const custom_chip = $(`
			<div class="category-chip category-chip-custom ${this.is_custom_category ? 'active' : ''}" id="btn-custom-chip">
				<span class="category-icon">➕</span>
				<span>${this.is_tg ? "Дигар хароҷот..." : "Другой расход..."}</span>
			</div>
		`);

		custom_chip.on("click", () => {
			this.is_custom_category = true;
			container.find(".category-chip").removeClass("active");
			custom_chip.addClass("active");
			$("#custom-cat-box").addClass("show");
			$("#staff-advance-box").removeClass("show");
			$("#custom-cat-name").focus();
		});

		container.append(custom_chip);
	}

	populate_expense_accounts(select) {
		select.empty();
		select.append(`<option value="">-- ${this.is_tg ? "Ҳисобро интихоб кунед" : "Выберите счет"} --</option>`);
		const accounts = this.data.expense_accounts || [];
		accounts.forEach((acc) => {
			select.append(`<option value="${acc.name}">${acc.account_name} (${acc.name})</option>`);
		});
	}

	populate_employees(select) {
		select.empty();
		select.append(`<option value="">-- ${this.is_tg ? "Кормандро интихоб кунед" : "Выберите сотрудника"} --</option>`);
		const emps = this.data.employees || [];
		emps.forEach((emp) => {
			select.append(`<option value="${emp.name}">${emp.employee_name} (${emp.name})</option>`);
		});
	}

	bind_form_events(form) {
		form.find(".quick-add-btn").on("click", (e) => {
			const add_val = flt($(e.currentTarget).data("add"));
			const amount_input = form.find("#expense-amount");
			const curr_val = flt(amount_input.val()) || 0;
			amount_input.val(curr_val + add_val);
		});

		form.find("#receipt-upload-btn").on("click", (e) => {
			if ($(e.target).closest(".btn-remove-receipt").length) return;
			new frappe.ui.FileUploader({
				make_attachments_public: 0,
				allow_multiple: false,
				on_success: (file_doc) => {
					this.receipt_url = file_doc.file_url;
					this.update_receipt_preview();
				},
			});
		});

		form.find("#btn-submit-expense").on("click", () => {
			this.submit_expense();
		});
	}

	update_receipt_preview() {
		const wrap = $("#receipt-preview-wrap");
		const label = $("#receipt-upload-label");
		if (this.receipt_url) {
			label.hide();
			wrap.html(`
				<div class="receipt-preview">
					<span>📎 ${this.receipt_url.split('/').pop()}</span>
					<button class="btn-remove-receipt" style="background: none; border: none; color: #e53e3e; cursor: pointer; font-weight: bold;">✕</button>
				</div>
			`).show();

			wrap.find(".btn-remove-receipt").on("click", (e) => {
				e.stopPropagation();
				this.receipt_url = null;
				this.update_receipt_preview();
			});
		} else {
			wrap.hide().empty();
			label.show();
		}
	}

	submit_expense() {
		const amount = flt($("#expense-amount").val());
		if (amount <= 0) {
			frappe.msgprint({
				title: __("Хатогӣ"),
				indicator: "red",
				message: this.is_tg ? "Лутфан маблағи хароҷотро дуруст ворид намоед." : "Пожалуйста, укажите корректную сумму расхода.",
			});
			$("#expense-amount").focus();
			return;
		}

		if (!this.selected_source) {
			frappe.msgprint({
				title: __("Хатогӣ"),
				indicator: "red",
				message: this.is_tg ? "Манбаи маблағ интихоб нашудааст." : "Источник средств не выбран.",
			});
			return;
		}

		let category_name = "";
		let icon = "🏷️";
		let expense_account = null;
		let pin_category = false;

		if (this.is_custom_category) {
			category_name = ($("#custom-cat-name").val() || "").trim();
			expense_account = $("#custom-cat-account").val();
			pin_category = $("#pin-cat-check").is(":checked");
			if (!category_name) {
				frappe.msgprint({
					title: __("Хатогӣ"),
					indicator: "red",
					message: this.is_tg ? "Лутфан номи категорияи навро нависед." : "Пожалуйста, введите название категории.",
				});
				$("#custom-cat-name").focus();
				return;
			}
		} else {
			if (!this.selected_category) {
				frappe.msgprint({
					title: __("Хатогӣ"),
					indicator: "red",
					message: this.is_tg ? "Категорияи хароҷотро интихоб намоед." : "Выберите категорию расхода.",
				});
				return;
			}
			category_name = this.selected_category.category_name;
			icon = this.selected_category.icon || "🏷️";
			expense_account = this.selected_category.default_account;
		}

		let party_type = null;
		let party = null;
		if (category_name === "Staff Advance" || category_name === "Аванс сотруднику") {
			party_type = "Employee";
			party = $("#staff-employee-select").val() || null;
		}

		const description = ($("#expense-desc").val() || "").trim();
		const submit_btn = $("#btn-submit-expense");
		submit_btn.prop("disabled", true).html(`<span>⏳</span> <span>${this.is_tg ? "Сабт шуда истодааст..." : "Сохранение..."}</span>`);

		frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.record_quick_expense",
			args: {
				category: category_name,
				amount: amount,
				paid_from: this.selected_source.account,
				pos_profile: this.selected_source.pos_profile,
				description: description,
				expense_account: expense_account,
				party_type: party_type,
				party: party,
				receipt_attachment: this.receipt_url,
				pin_category: pin_category,
				icon: icon,
				company: this.data.company,
			},
			callback: (r) => {
				submit_btn.prop("disabled", false).html(`<span>⚡</span> <span>${this.is_tg ? "Сабт ва баромад аз касса" : "Записать и списать"}</span>`);
				if (r.message) {
					frappe.show_alert({
						message: this.is_tg ? `✅ ${category_name}: ${format_currency(amount, this.data.currency)} сабт шуд!` : `✅ ${category_name}: ${format_currency(amount, this.data.currency)} успешно списано!`,
						indicator: "green",
					});

					$("#expense-amount").val("");
					$("#expense-desc").val("");
					$("#custom-cat-name").val("");
					this.receipt_url = null;
					this.update_receipt_preview();

					this.data = r.message;
					this.render();
				}
			},
			error: () => {
				submit_btn.prop("disabled", false).html(`<span>⚡</span> <span>${this.is_tg ? "Сабт ва баромад аз касса" : "Записать и списать"}</span>`);
			},
		});
	}

	render_stream(container) {
		const curr = this.data.currency || "TJS";
		const summary = this.data.summary || { today_total: 0, period_total: 0, period_count: 0, category_breakdown: [] };
		const sources = this.data.payment_sources || [];
		const categories = this.data.categories || [];

		const is_custom_open = this.active_period === "custom";

		const stream_html = $(`
			<div>
				<div class="expense-card-header">
					<h3 class="expense-card-title">
						<span>📋</span>
						${this.is_tg ? "Ҷараёни хароҷотҳо" : "Лента расходов"}
					</h3>
					<span class="expense-badge" id="live-filter-indicator">
						${this.is_tg ? 'Имрӯз' : 'Сегодня'}
					</span>
				</div>

				<!-- Advanced Filter Box -->
				<div class="stream-filter-box">
					<!-- Top Row: Period Quick Pills + Date Range Toggle -->
					<div class="filter-row-top">
						<div class="filter-pills" id="period-filter-pills">
							<button class="filter-pill ${this.active_period === 'today' ? 'active' : ''}" data-period="today">${this.is_tg ? 'Имрӯз' : 'Сегодня'}</button>
							<button class="filter-pill ${this.active_period === 'yesterday' ? 'active' : ''}" data-period="yesterday">${this.is_tg ? 'Дирӯз' : 'Вчера'}</button>
							<button class="filter-pill ${this.active_period === 'week' ? 'active' : ''}" data-period="week">${this.is_tg ? 'Ҳафта' : 'Неделя'}</button>
							<button class="filter-pill ${this.active_period === 'month' ? 'active' : ''}" data-period="month">${this.is_tg ? 'Ин моҳ' : 'Месяц'}</button>
							<button class="filter-pill ${this.active_period === 'all' ? 'active' : ''}" data-period="all">${this.is_tg ? 'Ҳама' : 'Все'}</button>
							<button class="filter-pill ${this.active_period === 'custom' ? 'active' : ''}" id="btn-toggle-custom-date" data-period="custom">
								📅 ${this.is_tg ? 'Период...' : 'Выбрать даты...'}
							</button>
						</div>
					</div>

					<!-- Collapsible Custom Date Panel -->
					<div class="custom-date-panel ${is_custom_open ? 'show' : ''}" id="custom-date-panel">
						<div class="date-input-group">
							<span>${this.is_tg ? 'Аз:' : 'С:'}</span>
							<input type="date" id="filter-from-date" class="date-input-field" value="${this.from_date || ''}">
						</div>
						<div class="date-input-group">
							<span>${this.is_tg ? 'То:' : 'По:'}</span>
							<input type="date" id="filter-to-date" class="date-input-field" value="${this.to_date || ''}">
						</div>
						<button class="btn-apply-dates" id="btn-apply-custom-dates">
							${this.is_tg ? 'Татбиқ' : 'Применить'}
						</button>
					</div>

					<!-- Bottom Row: Source, Category & Search -->
					<div class="filter-row-controls">
						<select id="filter-source-select" class="filter-select">
							<option value="all">-- ${this.is_tg ? 'Ҳамаи манбаҳо' : 'Все источники'} --</option>
							${sources.map(s => `<option value="${s.id}" ${this.active_source_filter === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
						</select>

						<select id="filter-category-select" class="filter-select">
							<option value="all">-- ${this.is_tg ? 'Ҳамаи категорияҳо' : 'Все категории'} --</option>
							${categories.map(c => `<option value="${c.category_name}" ${this.active_category_filter === c.category_name ? 'selected' : ''}>${c.icon || '🏷️'} ${c.category_name}</option>`).join('')}
						</select>

						<div class="filter-search-box">
							<span class="filter-search-icon">🔍</span>
							<input type="text" id="filter-search-input" class="filter-search-input" placeholder="${this.is_tg ? 'Ҷустуҷӯ аз рӯи тавсиф...' : 'Поиск по примечанию, чеку...'}" value="${this.search_query}">
						</div>

						<button class="btn-reset-filters" id="btn-reset-filters" style="${this.has_active_filters() ? '' : 'display: none;'}">
							✕ ${this.is_tg ? 'Тозакунӣ' : 'Сброс'}
						</button>
					</div>
				</div>

				<!-- KPI Banner -->
				<div class="expense-kpi-banner">
					<div>
						<div class="kpi-block-label">${this.is_tg ? 'Хароҷоти интихобшуда' : 'Расход за период'}</div>
						<div class="kpi-block-val" id="summary-period-total">${format_currency(summary.period_total, curr)}</div>
					</div>
					<div style="text-align: right;">
						<div class="kpi-block-label">${this.is_tg ? 'Миқдори сабтҳо' : 'Количество записей'}</div>
						<div class="kpi-block-val" id="summary-period-count">${summary.period_count}</div>
					</div>
				</div>

				<!-- Category Breakdown Progress Bars -->
				<div class="category-bars-wrap" id="category-bars-wrap"></div>

				<!-- Stream List -->
				<div class="expense-stream-list" id="expense-stream-list"></div>
			</div>
		`);

		container.append(stream_html);
		this.render_category_bars(stream_html.find("#category-bars-wrap"), summary.category_breakdown);
		this.render_stream_items(stream_html.find("#expense-stream-list"), this.data.recent_expenses);
		this.bind_stream_events(stream_html);
	}

	has_active_filters() {
		return this.active_period !== "today" || this.active_source_filter !== "all" || this.active_category_filter !== "all" || (this.search_query && this.search_query.trim().length > 0);
	}

	render_category_bars(container, breakdown) {
		container.empty();
		const curr = this.data.currency || "TJS";
		if (!breakdown || breakdown.length === 0) {
			container.hide();
			return;
		}

		container.show();
		breakdown.slice(0, 5).forEach((item) => {
			const bar = $(`
				<div class="cat-bar-item">
					<div class="cat-bar-header">
						<span>${item.icon || '🏷️'} ${item.category}</span>
						<span>${format_currency(item.total, curr)} (${item.percent}%)</span>
					</div>
					<div class="cat-bar-track">
						<div class="cat-bar-fill" style="width: ${item.percent}%;"></div>
					</div>
				</div>
			`);
			container.append(bar);
		});
	}

	render_stream_items(container, expenses) {
		container.empty();
		const curr = this.data.currency || "TJS";

		if (!expenses || expenses.length === 0) {
			container.html(`
				<div class="empty-stream-state">
					<div style="font-size: 32px; margin-bottom: 8px;">🧾</div>
					<div>${this.is_tg ? "Дар ин давра хароҷоте ёфт нашуд" : "По выбранным фильтрам расходов не найдено"}</div>
				</div>
			`);
			return;
		}

		expenses.forEach((exp) => {
			const is_voided = exp.docstatus === 2;
			const card = $(`
				<div class="stream-card ${is_voided ? 'voided' : ''}" data-name="${exp.name}">
					<div class="stream-left">
						<div class="stream-icon">${exp.icon || '🏷️'}</div>
						<div class="stream-meta">
							<div class="stream-category">${exp.expense_category}</div>
							<div class="stream-details">
								${exp.description ? frappe.utils.escape_html(exp.description) : ''}
								${exp.party ? ` • 👤 ${exp.party}` : ''}
								${exp.beneficiary_name ? ` • 👤 ${exp.beneficiary_name}` : ''}
							</div>
							<div>
								<span class="stream-source-tag">
									${exp.pos_profile ? `💵 Касса: ${exp.pos_profile}` : `🔐 ${exp.paid_from}`}
								</span>
								${exp.receipt_attachment ? `<a href="${exp.receipt_attachment}" target="_blank" style="margin-left: 6px; font-size: 11px; text-decoration: none;">📎 ${this.is_tg ? 'Чек' : 'Чек'}</a>` : ''}
							</div>
						</div>
					</div>

					<div class="stream-right">
						<div class="stream-amount">-${format_currency(exp.amount, curr)}</div>
						<div class="stream-time">${exp.formatted_date} ${exp.formatted_time}</div>
						${!is_voided ? `
							<button class="btn-void-expense" data-name="${exp.name}">
								${this.is_tg ? 'Бекоркунӣ' : 'Аннулировать'}
							</button>
						` : ''}
					</div>
				</div>
			`);

			card.find(".btn-void-expense").on("click", (e) => {
				e.stopPropagation();
				this.confirm_void_expense(exp.name, exp.amount, exp.expense_category);
			});

			container.append(card);
		});
	}

	bind_stream_events(container) {
		// Period buttons
		container.find(".filter-pill").on("click", (e) => {
			const btn = $(e.currentTarget);
			const period = btn.data("period");

			if (period === "custom") {
				$("#custom-date-panel").toggleClass("show");
				return;
			}

			$("#custom-date-panel").removeClass("show");
			container.find(".filter-pill").removeClass("active");
			btn.addClass("active");
			this.active_period = period;
			this.from_date = null;
			this.to_date = null;
			this.reload_stream();
		});

		// Custom date apply
		container.find("#btn-apply-custom-dates").on("click", () => {
			const from = $("#filter-from-date").val();
			const to = $("#filter-to-date").val();
			if (!from || !to) {
				frappe.msgprint({
					title: __("Хатогӣ"),
					indicator: "orange",
					message: this.is_tg ? "Лутфан ҳарду санаро (Аз ва То) интихоб намоед." : "Пожалуйста, укажите обе даты (С и По).",
				});
				return;
			}
			this.active_period = "custom";
			this.from_date = from;
			this.to_date = to;
			container.find(".filter-pill").removeClass("active");
			container.find("#btn-toggle-custom-date").addClass("active");
			this.reload_stream();
		});

		// Source filter dropdown
		container.find("#filter-source-select").on("change", (e) => {
			this.active_source_filter = $(e.currentTarget).val();
			this.reload_stream();
		});

		// Category filter dropdown
		container.find("#filter-category-select").on("change", (e) => {
			this.active_category_filter = $(e.currentTarget).val();
			this.reload_stream();
		});

		// Debounced search
		container.find("#filter-search-input").on("input", (e) => {
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.search_query = $(e.currentTarget).val();
				this.reload_stream();
			}, 300);
		});

		// Reset filters
		container.find("#btn-reset-filters").on("click", () => {
			this.active_period = "today";
			this.from_date = null;
			this.to_date = null;
			this.active_source_filter = "all";
			this.active_category_filter = "all";
			this.search_query = "";
			this.render_stream(this.wrapper.find(".expense-stream-col"));
			this.reload_stream();
		});
	}

	reload_stream() {
		$("#btn-reset-filters").toggle(this.has_active_filters());

		frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.get_filtered_expenses",
			args: {
				period: this.active_period,
				from_date: this.from_date,
				to_date: this.to_date,
				source_id: this.active_source_filter,
				category: this.active_category_filter,
				search: this.search_query,
				company: this.data.company,
			},
			callback: (r) => {
				if (r.message) {
					const curr = this.data.currency || "TJS";
					const summary = r.message.summary;
					$("#summary-period-total").text(format_currency(summary.period_total, curr));
					$("#summary-period-count").text(summary.period_count);
					this.render_category_bars($("#category-bars-wrap"), summary.category_breakdown);
					this.render_stream_items($("#expense-stream-list"), r.message.recent_expenses);
				}
			},
		});
	}

	confirm_void_expense(name, amount, category) {
		const curr = this.data.currency || "TJS";
		frappe.confirm(
			this.is_tg
				? `Оё мутмаин ҳастед, ки мехоҳед хароҷоти <b>${category} (${format_currency(amount, curr)})</b>-ро бекор намоед? Сабти бухгалтерӣ низ баргардонида мешавад.`
				: `Вы уверены, что хотите аннулировать расход <b>${category} (${format_currency(amount, curr)})</b>? Бухгалтерская проводка будет сторнирована.`,
			() => {
				frappe.call({
					method: "erpnext.accounts.page.expense_desk.expense_desk.cancel_quick_expense",
					args: {
						expense_name: name,
						company: this.data.company,
					},
					callback: (r) => {
						if (r.message) {
							frappe.show_alert({
								message: this.is_tg ? "Хароҷот бомуваффақият бекор шуд." : "Расход успешно аннулирован.",
								indicator: "orange",
							});
							this.data = r.message;
							this.render();
						}
					},
				});
			}
		);
	}
}
