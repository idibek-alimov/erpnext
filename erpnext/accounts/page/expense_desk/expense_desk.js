// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["expense-desk"].on_page_load = function (wrapper) {
	if (wrapper.expense_desk_app) {
		wrapper.expense_desk_app.load_init_data();
		return;
	}

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
		is_tg ? __("Хаби кормандон") : __("Сотрудники"),
		() => frappe.set_route("staff-hub")
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

		// Filter state - default to 'all' so recent expenses are always visible
		this.active_period = "all";
		this.from_date = null;
		this.to_date = null;
		this.active_source_filter = "all";
		this.active_category_filter = "all";
		this.active_employee_filter = "all";
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
		container.empty();
		const curr = this.data.currency || "TJS";

		const form_html = $(`
			<div class="expense-form-wrapper">
				<div class="expense-card-header">
					<div class="header-main">
						<h3 class="expense-card-title">
							<span class="header-icon">💸</span>
							<span>${this.is_tg ? "Сабти хароҷот / Баромад аз касса" : "Регистрация расхода / Выдача из кассы"}</span>
						</h3>
					</div>
					<span class="expense-badge">${this.data.company}</span>
				</div>

				<!-- 1. Source (Paid From) Dropdown -->
				<div class="expense-section">
					<div class="expense-label">
						<span>1. ${this.is_tg ? "Манбаи маблағ (Аз куҷо пардохт мешавад)" : "Источник средств (Откуда списать)"}</span>
						<span class="source-live-badge" id="source-live-badge"></span>
					</div>
					<div class="select-wrapper">
						<select id="expense-source-select" class="expense-select"></select>
					</div>
				</div>

				<!-- 2. Category Chips -->
				<div class="expense-section">
					<div class="expense-label">
						<span>2. ${this.is_tg ? "Категорияи хароҷот" : "Категория расхода"}</span>
					</div>
					<div class="category-chips-grid" id="category-chips"></div>

					<!-- Custom Category Expansion Drawer -->
					<div class="custom-category-box" id="custom-cat-box">
						<div class="form-group-sm">
							<label class="sub-label">
								${this.is_tg ? "Номи категорияи нав:" : "Название новой категории:"}
							</label>
							<input type="text" id="custom-cat-name" class="expense-input" placeholder="${this.is_tg ? 'Масалан: Реклама дар Instagram' : 'Например: Реклама в Instagram'}">
						</div>
						<div class="form-group-sm">
							<label class="sub-label">
								${this.is_tg ? "Ҳисоби баҳисобгирӣ (Expense Account):" : "Счет расходов (Expense Account):"}
							</label>
							<select id="custom-cat-account" class="expense-select"></select>
						</div>
						<div class="checkbox-row">
							<input type="checkbox" id="pin-cat-check" checked>
							<label for="pin-cat-check">
								⭐ ${this.is_tg ? "Барои истифодаи доимӣ сабт кунед" : "Закрепить для постоянного использования"}
							</label>
						</div>
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
						<button type="button" class="quick-add-btn" data-add="10">+10</button>
						<button type="button" class="quick-add-btn" data-add="20">+20</button>
						<button type="button" class="quick-add-btn" data-add="50">+50</button>
						<button type="button" class="quick-add-btn" data-add="100">+100</button>
						<button type="button" class="quick-add-btn" data-add="200">+200</button>
					</div>
				</div>

				<!-- 4. Employee / Recipient (Optional tracking for dinner, taxi, errands) -->
				<div class="expense-section">
					<div class="expense-label">
						<span>4. ${this.is_tg ? "Корманд / Гиранда (Ихтиёрӣ)" : "Сотрудник / Кому выдано (Опционально)"}</span>
					</div>
					<div class="select-wrapper">
						<select id="expense-employee-select" class="expense-select"></select>
					</div>
					<div class="field-hint">
						${this.is_tg 
							? "Барои сабти хӯрок, таксӣ ё харидҳо. Дар таърихи корманд сабт мешавад, аммо аз маош кам намешавад." 
							: "Для обеда, такси или поручений. Записывается за сотрудником для учета, но НЕ удерживается из зарплаты."}
					</div>
				</div>

				<!-- 5. Description / Note -->
				<div class="expense-section">
					<div class="expense-label">
						<span>5. ${this.is_tg ? "Тавсиф ва шарҳ (Ихтиёрӣ)" : "Примечание / Детали (Опционально)"}</span>
					</div>
					<textarea id="expense-desc" class="expense-textarea" rows="2" placeholder="${this.is_tg ? 'Масалан: Хӯроки нисфирӯзӣ барои смена, таксӣ то анбор...' : 'Например: Обед для смены кассиров, Яндекс.Такси до склада, закупка скотча...'}"></textarea>
				</div>

				<!-- 6. Receipt Photo / Attachment -->
				<div class="expense-section">
					<div class="expense-label">
						<span>6. ${this.is_tg ? "Чек ё квитансия (Ихтиёрӣ)" : "Фото чека / Документ (Опционально)"}</span>
					</div>
					<div class="receipt-dropzone" id="receipt-upload-btn">
						<div id="receipt-upload-label">
							<span class="upload-icon">📎</span>
							<span>${this.is_tg ? "Замима кардани чеки харид (Камера / Файл)" : "Прикрепить фото чека (Камера / Файл)"}</span>
						</div>
						<div id="receipt-preview-wrap" style="display: none;"></div>
					</div>
				</div>

				<!-- Action Submit Button -->
				<button type="button" class="btn-record-expense" id="btn-submit-expense">
					<span class="btn-icon">⚡</span>
					<span>${this.is_tg ? "Сабт ва баромад аз касса" : "Провести расход"}</span>
				</button>
			</div>
		`);

		container.append(form_html);
		this.populate_sources(form_html.find("#expense-source-select"));
		this.populate_categories(form_html.find("#category-chips"));
		this.populate_expense_accounts(form_html.find("#custom-cat-account"));
		this.populate_employees(form_html.find("#expense-employee-select"));
		this.bind_form_events(form_html);
	}

	populate_sources(select) {
		select.empty();
		const curr = this.data.currency || "TJS";
		const sources = this.data.payment_sources || [];

		if (sources.length === 0) {
			select.append(`<option value="">-- ${this.is_tg ? "Манбаъ ёфт нашуд" : "Источники не найдены"} --</option>`);
			return;
		}

		sources.forEach((src) => {
			const is_selected = this.selected_source && this.selected_source.id === src.id;
			select.append(
				`<option value="${src.id}" ${is_selected ? "selected" : ""}>` +
				`${src.label} — ${format_currency(src.balance, curr)}` +
				`</option>`
			);
		});

		this.update_source_live_badge();

		select.off("change").on("change", (e) => {
			const selected_id = $(e.currentTarget).val();
			this.selected_source = sources.find((s) => s.id === selected_id) || sources[0];
			this.update_source_live_badge();
		});
	}

	update_source_live_badge() {
		const curr = this.data.currency || "TJS";
		const badge = this.wrapper.find("#source-live-badge");
		if (this.selected_source) {
			badge.html(`
				<span class="badge-label">${this.is_tg ? "Боқимонда:" : "Остаток:"}</span>
				<strong class="badge-val">${format_currency(this.selected_source.balance, curr)}</strong>
			`).show();
		} else {
			badge.hide();
		}
	}

	populate_categories(container) {
		container.empty();
		const categories = this.data.categories || [];

		categories.forEach((cat) => {
			const is_active = !this.is_custom_category && this.selected_category && this.selected_category.name === cat.name;
			const chip = $(`
				<div class="category-chip ${is_active ? 'active' : ''}" data-name="${cat.name}">
					<span class="category-icon">${cat.icon || '🏷️'}</span>
					<span class="category-name">${cat.category_name}</span>
				</div>
			`);

			chip.on("click", () => {
				this.is_custom_category = false;
				container.find(".category-chip").removeClass("active");
				chip.addClass("active");
				this.selected_category = cat;
				this.wrapper.find("#custom-cat-box").removeClass("show");
			});

			container.append(chip);
		});

		// Add '+ Custom' Chip
		const custom_chip = $(`
			<div class="category-chip category-chip-custom ${this.is_custom_category ? 'active' : ''}" id="btn-custom-chip">
				<span class="category-icon">➕</span>
				<span class="category-name">${this.is_tg ? "Дигар хароҷот..." : "Другой расход..."}</span>
			</div>
		`);

		custom_chip.on("click", () => {
			this.is_custom_category = true;
			container.find(".category-chip").removeClass("active");
			custom_chip.addClass("active");
			this.wrapper.find("#custom-cat-box").addClass("show");
			this.wrapper.find("#custom-cat-name").focus();
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
		select.append(`<option value="">-- ${this.is_tg ? "Бе корманд (Хароҷоти умумии ширкат)" : "Без сотрудника (Общий расход компании)"} --</option>`);
		const emps = this.data.employees || [];
		emps.forEach((emp) => {
			select.append(`<option value="${emp.name}">👤 ${emp.employee_name} (${emp.name})</option>`);
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
				make_attachments_public: 1,
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
		const wrap = this.wrapper.find("#receipt-preview-wrap");
		const label = this.wrapper.find("#receipt-upload-label");
		if (this.receipt_url) {
			label.hide();
			const is_img = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(this.receipt_url);
			wrap.html(`
				<div class="receipt-uploaded-card">
					<div class="receipt-thumb-wrap">
						${is_img ? `<img src="${this.receipt_url}" class="receipt-form-thumb" alt="Receipt">` : `<span class="receipt-file-icon">📄</span>`}
					</div>
					<div class="receipt-file-info">
						<div class="receipt-file-name">${this.receipt_url.split('/').pop()}</div>
						<div class="receipt-file-status">✅ ${this.is_tg ? 'Акс замима шуд' : 'Фото прикреплено'}</div>
					</div>
					<button class="btn-remove-receipt" type="button" title="${this.is_tg ? 'Нест кардан' : 'Удалить'}">✕</button>
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
		const wrap = this.wrapper;
		const amount = flt(wrap.find("#expense-amount").val());
		if (amount <= 0) {
			frappe.msgprint({
				title: __("Хатогӣ"),
				indicator: "red",
				message: this.is_tg ? "Лутфан маблағи хароҷотро дуруст ворид намоед." : "Пожалуйста, укажите корректную сумму расхода.",
			});
			wrap.find("#expense-amount").focus();
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
			category_name = (wrap.find("#custom-cat-name").val() || "").trim();
			expense_account = wrap.find("#custom-cat-account").val();
			pin_category = wrap.find("#pin-cat-check").is(":checked");
			if (!category_name) {
				frappe.msgprint({
					title: __("Хатогӣ"),
					indicator: "red",
					message: this.is_tg ? "Лутфан номи категорияи навро нависед." : "Пожалуйста, введите название категории.",
				});
				wrap.find("#custom-cat-name").focus();
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

		// Selected Employee (for dinner, taxi, errands)
		const employee_id = wrap.find("#expense-employee-select").val() || null;
		let party_type = null;
		let party = null;
		let beneficiary_name = null;
		if (employee_id) {
			party_type = "Employee";
			party = employee_id;
			const emp_obj = (this.data.employees || []).find((e) => e.name === employee_id);
			if (emp_obj) {
				beneficiary_name = emp_obj.employee_name;
			}
		}

		const description = (wrap.find("#expense-desc").val() || "").trim();
		const submit_btn = wrap.find("#btn-submit-expense");
		submit_btn.prop("disabled", true).html(`<span>⏳</span> <span>${this.is_tg ? "Сабт шуда истодааст..." : "Проведение..."}</span>`);

		frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.record_quick_expense",
			args: {
				category: category_name,
				amount: amount,
				paid_from: this.selected_source.account,
				pos_profile: this.selected_source.pos_profile,
				description: description,
				beneficiary_name: beneficiary_name,
				expense_account: expense_account,
				party_type: party_type,
				party: party,
				receipt_attachment: this.receipt_url,
				pin_category: pin_category,
				icon: icon,
				company: this.data.company,
			},
			callback: (r) => {
				submit_btn.prop("disabled", false).html(`<span class="btn-icon">⚡</span> <span>${this.is_tg ? "Сабт ва баромад аз касса" : "Провести расход"}</span>`);
				if (r.message) {
					frappe.show_alert({
						message: this.is_tg ? `✅ ${category_name}: ${format_currency(amount, this.data.currency)} сабт шуд!` : `✅ ${category_name}: ${format_currency(amount, this.data.currency)} успешно списано!`,
						indicator: "green",
					});

					wrap.find("#expense-amount").val("");
					wrap.find("#expense-desc").val("");
					wrap.find("#expense-employee-select").val("");
					wrap.find("#custom-cat-name").val("");
					this.receipt_url = null;
					this.update_receipt_preview();

					this.data = r.message;
					this.render();
				}
			},
			error: () => {
				submit_btn.prop("disabled", false).html(`<span class="btn-icon">⚡</span> <span>${this.is_tg ? "Сабт ва баромад аз касса" : "Провести расход"}</span>`);
			},
		});
	}

	render_stream(container) {
		container.empty();
		const curr = this.data.currency || "TJS";
		const summary = this.data.summary || { today_total: 0, period_total: 0, period_count: 0, category_breakdown: [] };
		const sources = this.data.payment_sources || [];
		const categories = this.data.categories || [];
		const employees = this.data.employees || [];

		const is_custom_open = this.active_period === "custom";

		const stream_html = $(`
			<div class="expense-stream-wrapper">
				<div class="expense-card-header">
					<div class="header-main">
						<h3 class="expense-card-title">
							<span class="header-icon">📋</span>
							<span>${this.is_tg ? "Журнали хароҷотҳо" : "Журнал расходов"}</span>
						</h3>
					</div>
					<div class="header-right-meta">
						<span class="expense-badge" id="live-filter-indicator">
							${this.get_active_period_label()}
						</span>
					</div>
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
								📅 ${this.is_tg ? 'Санаҳо...' : 'Период...'}
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

					<!-- Bottom Row: Source, Category, Employee & Search Controls -->
					<div class="filter-row-controls">
						<select id="filter-source-select" class="filter-select">
							<option value="all">-- ${this.is_tg ? 'Ҳамаи манбаҳо' : 'Все источники'} --</option>
							${sources.map(s => `<option value="${s.id}" ${this.active_source_filter === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
						</select>

						<select id="filter-category-select" class="filter-select">
							<option value="all">-- ${this.is_tg ? 'Ҳамаи категорияҳо' : 'Все категории'} --</option>
							${categories.map(c => `<option value="${c.category_name}" ${this.active_category_filter === c.category_name ? 'selected' : ''}>${c.icon || '🏷️'} ${c.category_name}</option>`).join('')}
						</select>

						<select id="filter-employee-select" class="filter-select">
							<option value="all">-- ${this.is_tg ? 'Ҳамаи кормандон' : 'Все сотрудники'} --</option>
							${employees.map(e => `<option value="${e.name}" ${this.active_employee_filter === e.name ? 'selected' : ''}>👤 ${e.employee_name}</option>`).join('')}
						</select>

						<div class="filter-search-box">
							<span class="filter-search-icon">🔍</span>
							<input type="text" id="filter-search-input" class="filter-search-input" placeholder="${this.is_tg ? 'Ҷустуҷӯ...' : 'Поиск по примечанию...'}" value="${this.search_query}">
						</div>

						<button class="btn-reset-filters" id="btn-reset-filters" style="${this.has_active_filters() ? '' : 'display: none;'}">
							✕ ${this.is_tg ? 'Тозакунӣ' : 'Сброс'}
						</button>
					</div>
				</div>

				<!-- Professional KPI Banner (3-metrics) -->
				<div class="expense-kpi-banner">
					<div class="kpi-card">
						<div class="kpi-block-label">${this.is_tg ? 'Хароҷоти интихобшуда' : 'Расход за период'}</div>
						<div class="kpi-block-val" id="summary-period-total">${format_currency(summary.period_total, curr)}</div>
					</div>
					<div class="kpi-card">
						<div class="kpi-block-label">${this.is_tg ? 'Хароҷоти имрӯз' : 'Расход за сегодня'}</div>
						<div class="kpi-block-val text-accent" id="summary-today-total">${format_currency(summary.today_total, curr)}</div>
					</div>
					<div class="kpi-card text-right">
						<div class="kpi-block-label">${this.is_tg ? 'Миқдори сабтҳо' : 'Количество операций'}</div>
						<div class="kpi-block-val" id="summary-period-count">${summary.period_count}</div>
					</div>
				</div>

				<!-- Category Breakdown Progress Bars -->
				<div class="category-bars-wrap" id="category-bars-wrap"></div>

				<!-- Structured Accounting Ledger Table -->
				<div class="expense-ledger-container" id="expense-ledger-container"></div>
			</div>
		`);

		container.append(stream_html);
		this.render_category_bars(stream_html.find("#category-bars-wrap"), summary.category_breakdown);
		this.render_ledger_table(stream_html.find("#expense-ledger-container"), this.data.recent_expenses, summary);
		this.bind_stream_events(stream_html);
	}

	get_active_period_label() {
		const map = {
			today: this.is_tg ? "Имрӯз" : "Сегодня",
			yesterday: this.is_tg ? "Дирӯз" : "Вчера",
			week: this.is_tg ? "Ҳафта" : "Неделя",
			month: this.is_tg ? "Ин моҳ" : "Месяц",
			all: this.is_tg ? "Ҳама давр" : "Все время",
			custom: this.is_tg ? "Период" : "Период",
		};
		return map[this.active_period] || map.today;
	}

	has_active_filters() {
		return (
			this.active_period !== "all" ||
			this.active_source_filter !== "all" ||
			this.active_category_filter !== "all" ||
			this.active_employee_filter !== "all" ||
			(this.search_query && this.search_query.trim().length > 0)
		);
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
						<span><strong>${format_currency(item.total, curr)}</strong> (${item.percent}%)</span>
					</div>
					<div class="cat-bar-track">
						<div class="cat-bar-fill" style="width: ${item.percent}%;"></div>
					</div>
				</div>
			`);
			container.append(bar);
		});
	}

	get_employee_display(exp) {
		if (!exp) return null;
		// If employee_name is already a human name (not HR-EMP-...)
		if (exp.employee_name && !exp.employee_name.startsWith("HR-EMP-")) {
			return exp.employee_name;
		}
		if (exp.beneficiary_name && !exp.beneficiary_name.startsWith("HR-EMP-")) {
			return exp.beneficiary_name;
		}
		// Try matching against loaded employees list
		const employees = this.data?.employees || [];
		const target_id = exp.party || exp.employee_name || exp.beneficiary_name;
		if (target_id) {
			const found = employees.find((e) => e.name === target_id || e.employee_name === target_id);
			if (found) return found.employee_name;
		}
		return exp.employee_name || exp.beneficiary_name || (exp.party_type === "Employee" ? exp.party : null);
	}

	render_ledger_table(container, expenses, summary) {
		container.empty();
		const curr = this.data.currency || "TJS";
		summary = summary || { period_total: 0, period_count: 0 };

		const table_html = $(`
			<div class="expense-ledger-table-wrap">
				<table class="expense-ledger-table">
					<thead>
						<tr>
							<th class="col-cat">${this.is_tg ? 'Категория / Корманд' : 'Категория / Сотрудник'}</th>
							<th class="col-source">${this.is_tg ? 'Манбаи маблағ' : 'Источник списания'}</th>
							<th class="col-receipt text-center">${this.is_tg ? 'Чек' : 'Чек'}</th>
							<th class="col-amount text-right">${this.is_tg ? 'Маблағ' : 'Сумма'}</th>
							<th class="col-action text-center"></th>
						</tr>
					</thead>
					<tbody id="expense-ledger-tbody"></tbody>
					<tfoot id="expense-ledger-tfoot">
						<tr class="ledger-summary-row">
							<td colspan="3" class="summary-label-cell">
								<span class="summary-label-title">${this.is_tg ? 'Ҳамагӣ (Итого):' : 'Итого за выбранный период:'}</span>
								<span class="summary-count-badge">${summary.period_count} ${this.is_tg ? 'амал' : 'операций'}</span>
							</td>
							<td class="summary-amount-cell text-right">
								<strong>-${format_currency(summary.period_total, curr)}</strong>
							</td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);

		const tbody = table_html.find("#expense-ledger-tbody");

		if (!expenses || expenses.length === 0) {
			tbody.html(`
				<tr class="empty-table-row">
					<td colspan="5" class="empty-table-cell">
						<div class="empty-stream-state">
							<div class="empty-icon">🧾</div>
							<div class="empty-text">${this.is_tg ? "Дар ин давра хароҷоте ёфт нашуд" : "По выбранным фильтрам расходов не найдено"}</div>
						</div>
					</td>
				</tr>
			`);
			container.append(table_html);
			return;
		}

		expenses.forEach((exp) => {
			const is_voided = exp.docstatus === 2;
			const safe_receipt_url = exp.receipt_attachment ? encodeURI(exp.receipt_attachment) : null;
			const employee_display = this.get_employee_display(exp);

			const row = $(`
				<tr class="ledger-row ${is_voided ? 'row-voided' : ''} ${safe_receipt_url ? 'has-receipt' : ''}" data-name="${exp.name}" title="${this.is_tg ? 'Барои дидани ҷузъиёт пахш кунед' : 'Нажмите для просмотра деталей операции'}">
					<td class="cell-cat">
						<div class="cat-primary-line">
							<span class="cat-icon">${exp.icon || '🏷️'}</span>
							<span class="cat-name">${exp.expense_category}</span>
							<span class="cell-time-tag">${exp.formatted_date} · ${exp.formatted_time}</span>
						</div>
						${employee_display ? `
							<div class="cat-sub-line">
								<span class="stream-employee-pill">👤 ${frappe.utils.escape_html(employee_display)}</span>
							</div>
						` : ''}
					</td>
					<td class="cell-source">
						<span class="stream-source-tag">
							${exp.pos_profile ? `💵 Касса: ${exp.pos_profile}` : `🔐 ${exp.paid_from}`}
						</span>
					</td>
					<td class="cell-receipt text-center">
						${safe_receipt_url ? `
							<button type="button" class="btn-receipt-preview" title="${this.is_tg ? 'Дидани чек' : 'Посмотреть фото чека'}">
								<img src="${safe_receipt_url}" class="receipt-mini-thumb" onerror="this.style.display='none'">
								<span class="receipt-tag-text">📷 Чек</span>
							</button>
						` : `<span class="cell-empty-dash">—</span>`}
					</td>
					<td class="cell-amount text-right ${is_voided ? 'amount-voided' : ''}">
						<strong>-${format_currency(exp.amount, curr)}</strong>
					</td>
					<td class="cell-action text-center">
						${!is_voided ? `
							<button type="button" class="btn-void-row" data-name="${exp.name}" title="${this.is_tg ? 'Бекор кардан' : 'Аннулировать расход'}">
								✕ ${this.is_tg ? 'Бекор' : 'Аннулировать'}
							</button>
						` : `
							<span class="badge-voided">${this.is_tg ? 'Бекор шуд' : 'Аннулирован'}</span>
						`}
					</td>
				</tr>
			`);

			// On row click: open rich details modal just like in money-hub
			row.on("click", (e) => {
				if ($(e.target).closest(".btn-void-row, .btn-receipt-preview").length) return;
				this.show_expense_detail_modal(exp);
			});

			if (safe_receipt_url) {
				row.find(".btn-receipt-preview").on("click", (e) => {
					e.stopPropagation();
					this.show_receipt_lightbox(exp.receipt_attachment, exp);
				});
			}

			row.find(".btn-void-row").on("click", (e) => {
				e.stopPropagation();
				this.confirm_void_expense(exp.name, exp.amount, exp.expense_category);
			});

			tbody.append(row);
		});

		container.append(table_html);
	}

	bind_stream_events(container) {
		// Period buttons
		container.find(".filter-pill").on("click", (e) => {
			const btn = $(e.currentTarget);
			const period = btn.data("period");

			if (period === "custom") {
				container.find("#custom-date-panel").toggleClass("show");
				return;
			}

			container.find("#custom-date-panel").removeClass("show");
			container.find(".filter-pill").removeClass("active");
			btn.addClass("active");
			this.active_period = period;
			this.from_date = null;
			this.to_date = null;
			this.reload_stream();
		});

		// Custom date apply
		container.find("#btn-apply-custom-dates").on("click", () => {
			const from = container.find("#filter-from-date").val();
			const to = container.find("#filter-to-date").val();
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

		// Employee filter dropdown
		container.find("#filter-employee-select").on("change", (e) => {
			this.active_employee_filter = $(e.currentTarget).val();
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
			this.reset_filters();
		});
	}

	reset_filters() {
		this.active_period = "all";
		this.from_date = null;
		this.to_date = null;
		this.active_source_filter = "all";
		this.active_category_filter = "all";
		this.active_employee_filter = "all";
		this.search_query = "";

		const wrap = this.wrapper;
		wrap.find(".filter-pill").removeClass("active");
		wrap.find('.filter-pill[data-period="all"]').addClass("active");
		wrap.find("#custom-date-panel").removeClass("show");
		wrap.find("#filter-from-date").val("");
		wrap.find("#filter-to-date").val("");
		wrap.find("#filter-source-select").val("all");
		wrap.find("#filter-category-select").val("all");
		wrap.find("#filter-employee-select").val("all");
		wrap.find("#filter-search-input").val("");
		wrap.find("#btn-reset-filters").hide();

		this.reload_stream();
	}

	reload_stream() {
		this.wrapper.find("#btn-reset-filters").toggle(this.has_active_filters());
		this.wrapper.find("#live-filter-indicator").text(this.get_active_period_label());

		frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.get_filtered_expenses",
			args: {
				period: this.active_period,
				from_date: this.from_date,
				to_date: this.to_date,
				source_id: this.active_source_filter,
				category: this.active_category_filter,
				employee: this.active_employee_filter,
				search: this.search_query,
				company: this.data.company,
			},
			callback: (r) => {
				if (r.message) {
					const curr = this.data.currency || "TJS";
					const summary = r.message.summary;
					this.wrapper.find("#summary-period-total").text(format_currency(summary.period_total, curr));
					this.wrapper.find("#summary-period-count").text(summary.period_count);
					if (summary.today_total !== undefined) {
						this.wrapper.find("#summary-today-total").text(format_currency(summary.today_total, curr));
					}
					this.render_category_bars(this.wrapper.find("#category-bars-wrap"), summary.category_breakdown);
					this.render_ledger_table(this.wrapper.find("#expense-ledger-container"), r.message.recent_expenses, summary);
				}
			},
		});
	}

	show_expense_detail_modal(exp) {
		const curr = this.data.currency || "TJS";
		const is_voided = exp.docstatus === 2;
		const safe_receipt_url = exp.receipt_attachment ? encodeURI(exp.receipt_attachment) : null;
		const employee_display = this.get_employee_display(exp);

		const dlg = new frappe.ui.Dialog({
			title: `${exp.icon || "💸"} ${frappe.utils.escape_html(exp.expense_category)}`,
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "detail_area",
				},
			],
		});

		const slip_html = `
			<div class="expense-detail-slip">
				<!-- Hero Amount Header -->
				<div class="expense-slip-hero">
					<div class="expense-slip-type">
						⬆️ ${this.is_tg ? "Баромад аз касса / Хароҷот" : "Расход / Выдача из кассы"}
					</div>
					<div class="expense-slip-amount ${is_voided ? 'amount-voided' : ''}">
						-${format_currency(exp.amount, curr)}
					</div>
					<div>
						${!is_voided ? `
							<span class="badge badge-pill badge-success" style="font-size: 11px; padding: 4px 10px;">
								✓ ${this.is_tg ? "Сабт шудааст" : "Проведено"} (${exp.name})
							</span>
						` : `
							<span class="badge badge-pill badge-danger" style="font-size: 11px; padding: 4px 10px;">
								✕ ${this.is_tg ? "Бекор карда шуд" : "Аннулирован"} (${exp.name})
							</span>
						`}
					</div>
				</div>

				<!-- Attributes Grid (just like Money Hub) -->
				<div class="expense-slip-grid">
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Категория:" : "Категория:"}</span>
						<span class="expense-slip-val font-weight-bold">${exp.icon || '🏷️'} ${frappe.utils.escape_html(exp.expense_category)}</span>
					</div>
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Манбаи маблағ:" : "Источник списания:"}</span>
						<span class="expense-slip-val font-weight-bold">
							${exp.pos_profile ? `💵 Касса: ${exp.pos_profile}` : `🔐 ${exp.paid_from}`}
						</span>
					</div>
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Корманд / Қабулкунанда:" : "Сотрудник / Получатель:"}</span>
						<span class="expense-slip-val ${employee_display ? 'text-primary font-weight-bold' : 'text-muted'}">
							${employee_display ? `👤 ${frappe.utils.escape_html(employee_display)}` : '—'}
						</span>
					</div>
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Сана ва вақт:" : "Дата и время:"}</span>
						<span class="expense-slip-val">${exp.formatted_date} · ⏰ ${exp.formatted_time}</span>
					</div>
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Муаллиф / Кассир:" : "Автор / Кассир:"}</span>
						<span class="expense-slip-val">👤 ${frappe.utils.escape_html(exp.owner || '—')}</span>
					</div>
					<div class="expense-slip-cell">
						<span class="expense-slip-lbl">${this.is_tg ? "Ҳуҷҷати пардохт:" : "Связанный документ:"}</span>
						<span class="expense-slip-val">${exp.payment_entry || exp.journal_entry || exp.name}</span>
					</div>
					<div class="expense-slip-cell span-full">
						<span class="expense-slip-lbl">${this.is_tg ? "Тавсиф / Эзоҳ:" : "Примечание / Описание:"}</span>
						<span class="expense-slip-val text-dark" style="font-size: 13px;">
							${exp.description ? frappe.utils.escape_html(exp.description) : '<span class="text-muted">—</span>'}
						</span>
					</div>
				</div>

				<!-- Receipt Thumbnail inside slip if attached -->
				${safe_receipt_url ? `
					<div class="expense-slip-receipt-box">
						<div class="receipt-box-header">
							<span>📷 ${this.is_tg ? "Чеки замимашуда:" : "Прикрепленный чек:"}</span>
							<button type="button" class="btn btn-xs btn-default btn-open-full-receipt">🔍 ${this.is_tg ? "Калон кардан" : "Увеличить"}</button>
						</div>
						<div class="receipt-box-img-wrap">
							<img src="${safe_receipt_url}" class="receipt-box-img" alt="Receipt">
						</div>
					</div>
				` : ''}

				<!-- Slip Action Buttons -->
				<div class="expense-slip-actions">
					${!is_voided ? `
						<button class="btn btn-sm btn-danger btn-slip-void">
							✕ ${this.is_tg ? "Бекор кардани хароҷот" : "Аннулировать расход"}
						</button>
					` : ''}
					<button class="btn btn-sm btn-primary btn-slip-doc">
						📄 ${this.is_tg ? "Кушодани санад" : "Открыть документ"} (${exp.name})
					</button>
				</div>
			</div>
		`;

		dlg.fields_dict.detail_area.$wrapper.html(slip_html);

		// Event handlers inside detail modal
		dlg.$wrapper.find(".btn-open-full-receipt").on("click", () => {
			this.show_receipt_lightbox(exp.receipt_attachment, exp);
		});

		dlg.$wrapper.find(".receipt-box-img").on("click", () => {
			this.show_receipt_lightbox(exp.receipt_attachment, exp);
		});

		dlg.$wrapper.find(".btn-slip-doc").on("click", () => {
			dlg.hide();
			frappe.set_route("Form", "Quick Expense", exp.name);
		});

		dlg.$wrapper.find(".btn-slip-void").on("click", () => {
			dlg.hide();
			this.confirm_void_expense(exp.name, exp.amount, exp.expense_category);
		});

		dlg.show();
	}

	show_receipt_lightbox(receipt_url, expense) {
		const curr = this.data.currency || "TJS";
		const safe_url = encodeURI(receipt_url);
		const is_img = /\.(jpg|jpeg|png|webp|gif|svg)$/i.test(receipt_url);

		// Remove any existing overlay
		$(".expense-receipt-popup-overlay").remove();

		const emp_display = this.get_employee_display(expense);

		const popup = $(`
			<div class="expense-receipt-popup-overlay">
				<div class="expense-receipt-popup-card">
					<div class="expense-receipt-popup-header">
						<div class="popup-header-title">
							<span class="popup-cat-icon">${expense.icon || '🏷️'}</span>
							<span class="popup-cat-name">${expense.expense_category}</span>
							<span class="popup-amount">-${format_currency(expense.amount, curr)}</span>
							${emp_display ? `<span class="popup-emp-tag">👤 ${frappe.utils.escape_html(emp_display)}</span>` : ''}
							<span class="popup-date-tag">${expense.formatted_date} ${expense.formatted_time}</span>
						</div>
						<button type="button" class="popup-close-btn" title="Закрыть">✕</button>
					</div>

					<div class="expense-receipt-popup-body">
						${is_img ? `
							<img src="${safe_url}" class="expense-popup-img" alt="Receipt">
						` : `
							<div class="expense-popup-file">
								<div style="font-size: 48px; margin-bottom: 8px;">📄</div>
								<div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">${receipt_url.split('/').pop()}</div>
							</div>
						`}
					</div>
				</div>
			</div>
		`);

		$("body").append(popup);

		const close_popup = () => {
			popup.fadeOut(150, () => popup.remove());
			$(document).off("keydown.receipt_popup");
		};

		popup.find(".popup-close-btn").on("click", close_popup);
		popup.on("click", (e) => {
			if ($(e.target).hasClass("expense-receipt-popup-overlay")) {
				close_popup();
			}
		});

		$(document).on("keydown.receipt_popup", (e) => {
			if (e.key === "Escape") {
				close_popup();
			}
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
