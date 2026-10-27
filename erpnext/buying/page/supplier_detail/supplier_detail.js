// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["supplier-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Supplier"),
		single_column: true,
	});

	wrapper.supplier_detail_app = new SupplierDetailApp(page);
};

frappe.pages["supplier-detail"].on_page_show = function (wrapper) {
	const route = frappe.get_route();
	const supplier_name = route[1];
	if (supplier_name && wrapper.supplier_detail_app) {
		wrapper.supplier_detail_app.load(decodeURIComponent(supplier_name));
	}
};

class SupplierDetailApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body).addClass("supplier-detail-page");
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.supplier = null;
		this.data = null;
		this.active_tab = "tab-general"; // General Info tab is default
		this.payment_options = null;

		this.setup_header_actions();
	}

	t(key) {
		const dict = {
			supplier_title: { tg: "Таъминкунанда", ru: "Поставщик" },
			back_to_hub: { tg: "⬅️ Хаби таъминкунандагон", ru: "⬅️ Назад в Хаб" },
			btn_pay_debt: { tg: "💳 Пардохти қарз", ru: "💳 Оплатить долг" },
			btn_restock: { tg: "📥 Қабули мол", ru: "📥 Приёмка товара" },
			btn_refresh: { tg: "Навсозӣ", ru: "Обновить" },

			kpi_debt: { tg: "Қарзи ҷорӣ", ru: "Текущий долг" },
			kpi_stock: { tg: "Мол дар анбор", ru: "Товар на складе" },
			kpi_purchased: { tg: "Ҳамагӣ харид", ru: "Всего закуплено" },
			kpi_paid: { tg: "Пардохт шуд", ru: "Всего выплачено" },

			tab_general_info: { tg: "🏢 Маълумоти умумӣ", ru: "🏢 Общая информация" },
			tab_products: { tg: "📦 Молҳо дар анбор", ru: "📦 Товары на складе" },
			tab_invoices: { tg: "🧾 Накладнойҳо", ru: "🧾 Накладные и поставки" },
			tab_payments: { tg: "📜 Таърихи пардохтҳо", ru: "📜 История платежей" },

			field_supplier_name: { tg: "Номи таъминкунанда", ru: "Название поставщика / Организация" },
			field_contact_person: { tg: "Шахси масъул (Контакт)", ru: "Контактное лицо (Менеджер)" },
			field_mobile: { tg: "Телефон / Telegram", ru: "Телефон / Telegram" },
			field_email: { tg: "Почтаи электронӣ (Email)", ru: "Email" },
			field_address: { tg: "Шаҳр / Суроға", ru: "Город / Адрес" },
			field_notes: { tg: "Шартҳои корӣ ва ёддоштҳо", ru: "Условия работы и заметки" },
			btn_save_info: { tg: "💾 Сабти тағйирот", ru: "💾 Сохранить изменения" },
			save_success: { tg: "Маълумоти таъминкунанда сабт шуд!", ru: "Данные поставщика успешно сохранены!" },

			col_photo: { tg: "Акс", ru: "Фото" },
			col_code: { tg: "Код", ru: "Код" },
			col_product: { tg: "Номи мол", ru: "Наименование товара" },
			col_category: { tg: "Гурӯҳ", ru: "Категория" },
			col_stock: { tg: "Бақия", ru: "Остаток" },
			col_cost: { tg: "Себестоимость", ru: "Себестоимость" },
			col_stock_val: { tg: "Маблағи бақия", ru: "Стоимость остатка" },
			col_retail: { tg: "Нархи фурӯш", ru: "Цена продажи" },
			col_actions: { tg: "Амал", ru: "Действие" },

			col_inv_no: { tg: "Рақами накладной", ru: "Номер накладной" },
			col_model_product: { tg: "Модел ва номи мол", ru: "Товар / Модель" },
			col_qty: { tg: "Миқдор", ru: "Кол-во" },
			col_date: { tg: "Сана", ru: "Дата" },
			col_bill_no: { tg: "Чек / Борхат", ru: "Чек / Накладная поставщика" },
			col_amount: { tg: "Маблағ", ru: "Сумма поставки" },
			col_debt_left: { tg: "Бақияи қарз", ru: "Остаток долга" },
			col_status: { tg: "Ҳолат", ru: "Статус" },

			filter_search_placeholder: { tg: "Ҷустуҷӯ аз рӯи модел ё номи мол...", ru: "Поиск по модели, коду или названию товара..." },
			filter_status_all: { tg: "Ҳама поставкаҳо", ru: "Все поставки" },
			filter_status_unpaid: { tg: "Танҳо бо қарз", ru: "Только с долгом" },
			filter_status_paid: { tg: "Пардохтшуда", ru: "Полностью оплаченные" },

			col_pay_no: { tg: "Рақами пардохт", ru: "Номер платежа" },
			col_pay_product: { tg: "Мол / Модел", ru: "Товар / Модель" },
			col_pay_amount: { tg: "Маблағи пардохт", ru: "Сумма оплаты" },
			col_remarks: { tg: "Эзоҳ", ru: "Примечание" },
			col_mode: { tg: "Усули пардохт", ru: "Способ оплаты" },
			col_reference: { tg: "Чек / Расид", ru: "Чек / Расписка" },
			col_user: { tg: "Масъул", ru: "Оформил" },

			pcs: { tg: "дона", ru: "шт" },
			total_prefix: { tg: "Ҳамагӣ", ru: "Итого" },
			items_suffix: { tg: "мол", ru: "позиций" },
			models_suffix: { tg: "модел", ru: "моделей" },
			sizes: { tg: "андоза", ru: "размеров" },
			from: { tg: "аз", ru: "от" },
			btn_pay: { tg: "Оплатить", ru: "Оплатить" },
			btn_open_prod: { tg: "Кушодан", ru: "Открыть" },
			settled: { tg: "Ҳисобӣ шуд", ru: "Оплачено" },
		};
		return (dict[key] && dict[key][this.lang]) || key;
	}

	setup_header_actions() {
		this.page.set_secondary_action(this.t("back_to_hub"), () => {
			frappe.set_route("supplier-hub");
		});

		this.page.add_inner_button(this.t("btn_refresh"), () => {
			if (this.supplier) this.load(this.supplier);
		});
	}

	load(supplier_name) {
		this.supplier = supplier_name;
		this.active_tab = "tab-general"; // General info tab is always opened first
		this.wrapper.html('<div class="text-center py-5"><span class="spinner-border text-primary"></span><div class="mt-2 text-muted">Загрузка данных...</div></div>');

		frappe.call({
			method: "erpnext.buying.page.supplier_detail.supplier_detail.get_supplier_detail",
			args: { supplier: supplier_name },
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.render();
			},
		});
	}

	format_num(val, decimals = 2) {
		const n = flt(val);
		return n.toLocaleString(undefined, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
	}

	format_curr(val) {
		const curr = (this.data && this.data.currency) || "TJS";
		return `${this.format_num(val, 2)} ${curr}`;
	}

	render() {
		const s = this.data.supplier;
		const k = this.data.kpi;
		const curr = this.data.currency || "TJS";

		// Update Page Header Title & Primary Action
		let titleHtml = frappe.utils.escape_html(s.supplier_name || s.name);
		if (k.current_debt > 0) {
			titleHtml += ` <span class="badge badge-danger" style="font-size: 13px; font-weight: 700; vertical-align: middle; margin-left: 8px;">Долг: ${this.format_curr(k.current_debt)}</span>`;
		} else {
			titleHtml += ` <span class="badge badge-success" style="font-size: 13px; font-weight: 600; vertical-align: middle; margin-left: 8px;">🟢 В расчёте</span>`;
		}
		this.page.set_title(titleHtml);

		this.page.clear_primary_action();
		if (k.current_debt > 0) {
			this.page.set_primary_action(
				`💳 ${this.t("btn_pay_debt")} (${this.format_curr(k.current_debt)})`,
				() => this.show_payment_dialog(k.current_debt),
				"credit-card"
			);
		} else {
			this.page.set_primary_action(
				this.t("btn_restock"),
				() => {
					frappe.new_doc("Quick Product Restock", {
						supplier: s.name,
					});
				},
				"add"
			);
		}

		this.wrapper.html(`
			<div class="supplier-detail-container">
				<!-- Top KPI Cards Strip -->
				<div class="sd-kpi-grid">
					<div class="sd-kpi-card">
						<div class="sd-kpi-icon sd-icon-debt">💳</div>
						<div class="sd-kpi-info">
							<span class="sd-kpi-label">${this.t("kpi_debt")}</span>
							<span class="sd-kpi-val ${k.current_debt > 0 ? "text-danger" : "text-success"}">
								${this.format_curr(k.current_debt)}
							</span>
							<span class="sd-kpi-sub">${k.current_debt > 0 ? "Необходимо оплатить" : "Задолженности нет"}</span>
						</div>
					</div>

					<div class="sd-kpi-card">
						<div class="sd-kpi-icon sd-icon-stock">📦</div>
						<div class="sd-kpi-info">
							<span class="sd-kpi-label">${this.t("kpi_stock")}</span>
							<span class="sd-kpi-val text-success">${this.format_curr(k.total_stock_value)}</span>
							<span class="sd-kpi-sub">${this.format_num(k.total_stock_qty, 0)} ${this.t("pcs")} на полках (${k.products_count} мод.)</span>
						</div>
					</div>

					<div class="sd-kpi-card">
						<div class="sd-kpi-icon sd-icon-purchased">💰</div>
						<div class="sd-kpi-info">
							<span class="sd-kpi-label">${this.t("kpi_purchased")}</span>
							<span class="sd-kpi-val">${this.format_curr(k.total_purchased)}</span>
							<span class="sd-kpi-sub">${k.invoices_count} поставок всего</span>
						</div>
					</div>

					<div class="sd-kpi-card">
						<div class="sd-kpi-icon sd-icon-paid">💸</div>
						<div class="sd-kpi-info">
							<span class="sd-kpi-label">${this.t("kpi_paid")}</span>
							<span class="sd-kpi-val text-primary">${this.format_curr(k.total_paid)}</span>
							<span class="sd-kpi-sub">${k.payments_count} платежей всего</span>
						</div>
					</div>
				</div>

				<!-- Card Container with 4 Modern Tabs -->
				<div class="sd-card">
					<!-- Tabs Navigation Bar -->
					<div class="sd-tabs-bar">
						<div class="sd-tab-item ${(this.active_tab || "tab-general") === "tab-general" ? "active" : ""}" data-tab="tab-general">
							${this.t("tab_general_info")}
						</div>
						<div class="sd-tab-item ${(this.active_tab || "tab-general") === "tab-products" ? "active" : ""}" data-tab="tab-products">
							${this.t("tab_products")}
							<span class="sd-tab-badge">${(this.data.products || []).length}</span>
						</div>
						<div class="sd-tab-item ${(this.active_tab || "tab-general") === "tab-invoices" ? "active" : ""}" data-tab="tab-invoices">
							${this.t("tab_invoices")}
							<span class="sd-tab-badge">${(this.data.invoices || []).length}</span>
						</div>
						<div class="sd-tab-item ${(this.active_tab || "tab-general") === "tab-payments" ? "active" : ""}" data-tab="tab-payments">
							${this.t("tab_payments")}
							<span class="sd-tab-badge">${(this.data.payments || []).length}</span>
						</div>
					</div>

					<!-- Tab Panes -->
					<div class="sd-tab-panes">
						<!-- Tab 1: General Info -->
						<div id="tab-general" class="sd-tab-pane" style="display: ${(this.active_tab || "tab-general") === "tab-general" ? "block" : "none"};">
							${this.render_general_info_tab()}
						</div>

						<!-- Tab 2: Products Table (Catalog Style) -->
						<div id="tab-products" class="sd-tab-pane" style="display: ${(this.active_tab || "tab-general") === "tab-products" ? "block" : "none"};">
							${this.render_products_tab()}
						</div>

						<!-- Tab 3: Invoices Table -->
						<div id="tab-invoices" class="sd-tab-pane" style="display: ${(this.active_tab || "tab-general") === "tab-invoices" ? "block" : "none"};">
							${this.render_invoices_tab()}
						</div>

						<!-- Tab 4: Payments Table -->
						<div id="tab-payments" class="sd-tab-pane" style="display: ${(this.active_tab || "tab-general") === "tab-payments" ? "block" : "none"};">
							${this.render_payments_tab()}
						</div>
					</div>
				</div>
			</div>
		`);

		this.bind_tab_events();
		this.bind_general_info_save();
		this.bind_table_actions();
	}

	bind_tab_events() {
		this.wrapper.find(".sd-tab-item").on("click", (e) => {
			const target = $(e.currentTarget).attr("data-tab");
			this.active_tab = target;
			this.wrapper.find(".sd-tab-item").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.wrapper.find(".sd-tab-pane").hide();
			this.wrapper.find(`#${target}`).fadeIn(150);
		});
	}

	render_general_info_tab() {
		const s = this.data.supplier;
		return `
			<form id="sd-general-form">
				<div class="sd-info-form-grid">
					<div class="sd-form-group">
						<label class="sd-form-label">${this.t("field_supplier_name")}</label>
						<input type="text" id="sd-inp-supplier-name" class="sd-form-control" value="${frappe.utils.escape_html(s.supplier_name)}">
					</div>

					<div class="sd-form-group">
						<label class="sd-form-label">${this.t("field_contact_person")}</label>
						<input type="text" id="sd-inp-contact-person" class="sd-form-control" placeholder="ФИО менеджера или торгового представителя" value="${frappe.utils.escape_html(s.contact_person)}">
					</div>

					<div class="sd-form-group">
						<label class="sd-form-label">${this.t("field_mobile")}</label>
						<input type="text" id="sd-inp-mobile" class="sd-form-control" placeholder="+992 900 00 00 00" value="${frappe.utils.escape_html(s.mobile_no)}">
					</div>

					<div class="sd-form-group">
						<label class="sd-form-label">${this.t("field_email")}</label>
						<input type="email" id="sd-inp-email" class="sd-form-control" placeholder="supplier@gmail.com" value="${frappe.utils.escape_html(s.email_id)}">
					</div>

					<div class="sd-form-group" style="grid-column: 1 / -1;">
						<label class="sd-form-label">${this.t("field_address")}</label>
						<input type="text" id="sd-inp-address" class="sd-form-control" placeholder="Город, улица, склад поставщика" value="${frappe.utils.escape_html(s.address)}">
					</div>

					<div class="sd-form-group" style="grid-column: 1 / -1;">
						<label class="sd-form-label">${this.t("field_notes")}</label>
						<textarea id="sd-inp-notes" class="sd-form-control" placeholder="Условия работы, график поставок, дни отсрочки...">${frappe.utils.escape_html(s.notes)}</textarea>
					</div>
				</div>

				<div class="mt-4 pt-3 border-top d-flex justify-content-end">
					<button type="submit" class="sd-save-btn" id="btn-save-supplier-info">
						${this.t("btn_save_info")}
					</button>
				</div>
			</form>
		`;
	}

	bind_general_info_save() {
		this.wrapper.find("#sd-general-form").on("submit", (e) => {
			e.preventDefault();
			const $btn = this.wrapper.find("#btn-save-supplier-info");
			$btn.prop("disabled", true).text("Сохранение...");

			frappe.call({
				method: "erpnext.buying.page.supplier_detail.supplier_detail.save_supplier_info",
				args: {
					supplier: this.supplier,
					supplier_name: this.wrapper.find("#sd-inp-supplier-name").val(),
					contact_person: this.wrapper.find("#sd-inp-contact-person").val(),
					mobile_no: this.wrapper.find("#sd-inp-mobile").val(),
					email_id: this.wrapper.find("#sd-inp-email").val(),
					address: this.wrapper.find("#sd-inp-address").val(),
					notes: this.wrapper.find("#sd-inp-notes").val(),
				},
				callback: (r) => {
					if (r.message && r.message.success) {
						frappe.show_alert({ message: `✅ ${this.t("save_success")}`, indicator: "green" }, 4);
						// Refresh header
						this.data.supplier.supplier_name = this.wrapper.find("#sd-inp-supplier-name").val();
						this.page.set_title(frappe.utils.escape_html(this.data.supplier.supplier_name));
					}
				},
				always: () => {
					$btn.prop("disabled", false).html(this.t("btn_save_info"));
				},
			});
		});
	}

	render_products_tab() {
		const prods = this.data.products || [];
		if (prods.length === 0) {
			return `
				<div class="empty-state text-center py-5">
					<div style="font-size: 38px; margin-bottom: 8px;">📦</div>
					<h5 class="font-weight-bold">Нет товаров от этого поставщика</h5>
					<p class="text-muted" style="font-size: 13px;">Товары появятся здесь после оформления приёмки через Quick Product Intake или Restock.</p>
				</div>
			`;
		}

		let total_qty = 0;
		let total_val = 0;
		let rows_html = "";

		const categories = Array.from(new Set(prods.map((p) => p.item_group).filter(Boolean))).sort();

		prods.forEach((p) => {
			total_qty += flt(p.stock_qty);
			total_val += flt(p.stock_value);

			const thumb = p.image
				? `<img src="${p.image}" class="sd-prod-thumb" alt="${p.item_name}">`
				: '<div class="sd-prod-thumb-placeholder">👕</div>';

			const short_code = p.custom_short_code
				? `<span class="sd-code-badge">${frappe.utils.escape_html(p.custom_short_code)}</span>`
				: `<span class="text-muted" style="font-size: 11.5px;">${frappe.utils.escape_html(p.item_code)}</span>`;

			const variant_pill = p.has_variants
				? `<span class="retail-variant-pill">${p.variant_count} ${this.t("sizes")}</span>`
				: "";

			const prefix_from = p.price_varies ? `<span class="text-muted" style="font-size: 11px;">${this.t("from")} </span>` : "";

			let indicator = "indicator-green";
			if (p.stock_qty <= 0) indicator = "indicator-red";
			else if (p.stock_qty <= 5) indicator = "indicator-orange";

			rows_html += `
				<tr class="sd-table-row sd-prod-row" 
					data-item-code="${encodeURIComponent(p.item_code)}"
					data-product="${frappe.utils.escape_html((p.item_name || "").toLowerCase())}"
					data-code="${frappe.utils.escape_html((p.custom_short_code || p.item_code || "").toLowerCase())}"
					data-category="${frappe.utils.escape_html(p.item_group || "")}"
					data-qty="${p.stock_qty}"
					data-val="${p.stock_value}">
					<td class="text-center" style="width: 50px;">${thumb}</td>
					<td class="text-center" style="width: 80px;">${short_code}</td>
					<td>
						<div class="product-title-row">
							<span class="product-name font-weight-bold" title="${frappe.utils.escape_html(p.item_name)}">${frappe.utils.escape_html(p.item_name)}</span>
							${variant_pill}
						</div>
						<div class="text-muted" style="font-size: 11px;">ID: ${frappe.utils.escape_html(p.item_code)}</div>
					</td>
					<td style="width: 140px;">
						<span class="badge badge-light" style="font-size: 11.5px;">${frappe.utils.escape_html(p.item_group)}</span>
					</td>
					<td style="width: 130px;">
						<div class="d-flex align-items-center">
							<span class="indicator-pill ${indicator}"></span>
							<span class="font-weight-bold ml-1">${this.format_num(p.stock_qty, p.stock_qty % 1 === 0 ? 0 : 2)}</span>
							<span class="text-muted ml-1" style="font-size: 11px;">${p.stock_uom === "Nos" ? this.t("pcs") : p.stock_uom}</span>
						</div>
						<div class="status-subtext text-muted" style="font-size: 11px;">${p.status_label_ru || ""}</div>
					</td>
					<td class="text-right" style="width: 130px;">
						<span class="text-muted">${this.format_curr(p.valuation_rate)}</span>
					</td>
					<td class="text-right" style="width: 150px;">
						<span class="font-weight-bold text-dark">${this.format_curr(p.stock_value)}</span>
					</td>
					<td class="text-right" style="width: 130px;">
						<div>${prefix_from}<span class="font-weight-bold">${this.format_curr(p.selling_price)}</span></div>
					</td>
					<td class="text-center" style="width: 90px;" onclick="event.stopPropagation();">
						<button class="btn btn-xs btn-default btn-open-item" data-item-code="${encodeURIComponent(p.item_code)}">
							${this.t("btn_open_prod")}
						</button>
					</td>
				</tr>
			`;
		});

		const category_options = categories
			.map((c) => `<option value="${frappe.utils.escape_html(c)}">${frappe.utils.escape_html(c)}</option>`)
			.join("");

		return `
			<!-- ERP Standard Filters Toolbar for Products -->
			<div class="sd-filter-toolbar">
				<div class="sd-filter-group" style="flex: 1; min-width: 220px;">
					<input type="text" id="sd-prod-filter-search" class="sd-filter-input" style="width: 100%;" placeholder="🔍 Поиск по модели, коду или названию...">
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">Категория:</label>
					<select id="sd-prod-filter-category" class="sd-filter-input">
						<option value="all">Все категории</option>
						${category_options}
					</select>
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">Остаток:</label>
					<select id="sd-prod-filter-op" class="sd-filter-input" style="width: 145px;">
						<option value="all">Все остатки</option>
						<option value="gte">≥ (Больше или равно)</option>
						<option value="lte">≤ (Меньше или равно)</option>
						<option value="eq">= (Точно равно)</option>
						<option value="zero">= 0 (Закончился)</option>
					</select>
					<input type="number" id="sd-prod-filter-qty" class="sd-filter-input" style="width: 70px; display: none;" value="5" min="0" step="1">
				</div>
				<button type="button" class="btn btn-xs btn-default font-weight-bold" id="sd-prod-filter-reset" title="Сбросить все фильтры" style="height: 32px; padding: 0 10px;">
					✕ Сбросить
				</button>
			</div>

			<!-- Dynamic Live Calculation Strip -->
			<div class="sd-filter-summary">
				<div class="sd-filter-stat">Моделей показано: <b id="sd-stat-prod-count">${prods.length}</b></div>
				<div class="sd-filter-stat">Остаток на складе: <b id="sd-stat-prod-qty">${this.format_num(total_qty, 0)}</b> шт</div>
				<div class="sd-filter-stat">Стоимость остатка: <b class="text-success font-weight-bold" id="sd-stat-prod-val">${this.format_curr(total_val)}</b></div>
			</div>

			<div class="sd-table-wrapper">
				<table class="table table-bordered table-hover sd-catalog-table">
					<thead>
						<tr>
							<th class="text-center">${this.t("col_photo")}</th>
							<th class="text-center">${this.t("col_code")}</th>
							<th>${this.t("col_product")}</th>
							<th>${this.t("col_category")}</th>
							<th>${this.t("col_stock")}</th>
							<th class="text-right">${this.t("col_cost")}</th>
							<th class="text-right">${this.t("col_stock_val")}</th>
							<th class="text-right">${this.t("col_retail")}</th>
							<th class="text-center">${this.t("col_actions")}</th>
						</tr>
					</thead>
					<tbody id="sd-products-tbody">
						${rows_html}
						<tr class="sd-products-no-match text-center py-4" style="display: none;">
							<td colspan="9" class="text-muted py-4">
								<div style="font-size: 24px; margin-bottom: 4px;">🔍</div>
								<div>Нет товаров, соответствующих выбранным фильтрам</div>
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td colspan="4">
								<strong>${this.t("total_prefix")}: <span id="sd-foot-prod-count">${prods.length}</span> ${this.t("models_suffix")}</strong>
							</td>
							<td>
								<span class="font-weight-bold"><span id="sd-foot-prod-qty">${this.format_num(total_qty, 0)}</span> ${this.t("pcs")}</span>
							</td>
							<td class="text-center text-muted">—</td>
							<td class="text-right">
								<span class="font-weight-bold text-success" id="sd-foot-prod-val">${this.format_curr(total_val)}</span>
							</td>
							<td colspan="2" class="text-center text-muted">—</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`;
	}

	render_invoices_tab() {
		const invs = this.data.invoices || [];
		if (invs.length === 0) {
			return `
				<div class="empty-state text-center py-5">
					<div style="font-size: 38px; margin-bottom: 8px;">🧾</div>
					<h5 class="font-weight-bold">Накладные отсутствуют</h5>
					<p class="text-muted" style="font-size: 13px;">Накладные создаются автоматически при оформлении Quick Product Intake или Restock.</p>
				</div>
			`;
		}

		let total_amount = 0;
		let total_debt = 0;
		let total_qty = 0;
		let rows_html = "";

		invs.forEach((inv) => {
			total_amount += flt(inv.grand_total);
			total_debt += flt(inv.outstanding_amount);
			total_qty += flt(inv.total_qty || 0);

			const is_unpaid = inv.outstanding_amount > 0;
			const debt_badge = is_unpaid
				? `<span class="badge badge-danger" style="font-size: 12px; font-weight: 700;">${this.format_curr(inv.outstanding_amount)}</span>`
				: `<span class="badge badge-success" style="font-size: 11.5px;">🟢 ${this.t("settled")}</span>`;

			const pay_btn = is_unpaid
				? `<button class="btn btn-xs btn-primary btn-pay-invoice" data-invoice="${encodeURIComponent(inv.name)}" data-amount="${inv.outstanding_amount}">💳 ${this.t("btn_pay")}</button>`
				: `<span class="text-muted" style="font-size: 11.5px;">—</span>`;

			const img_html = inv.image
				? `<img src="${inv.image}" class="sd-credit-product-img" alt="">`
				: `<div class="sd-credit-product-img-empty">📦</div>`;

			const model_pill = inv.model_id
				? `<span class="sd-model-badge">#${frappe.utils.escape_html(inv.model_id)}</span>`
				: "";

			const bill_note_part = inv.bill_no && !inv.bill_no.startsWith("QPI-") && !inv.bill_no.startsWith("QPR-")
				? ` · Чек: <b>${frappe.utils.escape_html(inv.bill_no)}</b>`
				: "";

			const variants_line = inv.variants_summary
				? `<div class="sd-credit-variants">${frappe.utils.escape_html(inv.variants_summary)}</div>`
				: "";

			rows_html += `
				<tr class="sd-invoice-row" 
					data-invoice="${frappe.utils.escape_html(inv.name)}"
					data-product="${frappe.utils.escape_html((inv.product_name || "").toLowerCase())}"
					data-model="${frappe.utils.escape_html((inv.model_id || "").toLowerCase())}"
					data-date="${inv.posting_date}"
					data-unpaid="${is_unpaid ? 1 : 0}"
					data-amount="${inv.grand_total}"
					data-debt="${inv.outstanding_amount}"
					data-qty="${inv.total_qty || 0}">
					<td>
						<div class="sd-credit-product-cell">
							${img_html}
							<div class="sd-credit-details">
								<div class="sd-credit-name-row">
									${model_pill}
									<span class="sd-credit-name">${frappe.utils.escape_html(inv.product_name || "Товары")}</span>
								</div>
								<div class="sd-credit-sub">
									<a href="/app/purchase-invoice/${encodeURIComponent(inv.name)}" target="_blank" class="sd-voucher-link text-muted" title="Открыть документ в ERP">
										🧾 ${inv.name}
									</a>
									${bill_note_part}
								</div>
								${variants_line}
							</div>
						</div>
					</td>
					<td class="text-center font-weight-bold" style="width: 105px; font-size: 12.5px;">${inv.posting_date}</td>
					<td class="text-center font-weight-bold" style="width: 85px;">
						${inv.total_qty > 0 ? this.format_num(inv.total_qty, inv.total_qty % 1 === 0 ? 0 : 2) + " шт" : "—"}
					</td>
					<td class="text-right font-weight-bold" style="width: 150px;">${this.format_curr(inv.grand_total)}</td>
					<td class="text-right" style="width: 160px;">${debt_badge}</td>
					<td class="text-center" style="width: 110px;">
						<span class="badge ${is_unpaid ? "badge-light" : "badge-success"}">${inv.status}</span>
					</td>
					<td class="text-center" style="width: 110px;">
						${pay_btn}
					</td>
				</tr>
			`;
		});

		return `
			<!-- ERP Standard Filters Toolbar -->
			<div class="sd-filter-toolbar">
				<div class="sd-filter-group" style="flex: 1; min-width: 220px;">
					<input type="text" id="sd-inv-filter-search" class="sd-filter-input" style="width: 100%;" placeholder="🔍 ${this.t("filter_search_placeholder")}">
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">Статус:</label>
					<select id="sd-inv-filter-status" class="sd-filter-input">
						<option value="unpaid" selected>${this.t("filter_status_unpaid")}</option>
						<option value="all">${this.t("filter_status_all")}</option>
						<option value="paid">${this.t("filter_status_paid")}</option>
					</select>
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">С:</label>
					<input type="date" id="sd-inv-filter-from" class="sd-filter-input">
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">По:</label>
					<input type="date" id="sd-inv-filter-to" class="sd-filter-input">
				</div>
				<button type="button" class="btn btn-xs btn-default font-weight-bold" id="sd-inv-filter-reset" title="Сбросить все фильтры" style="height: 32px; padding: 0 10px;">
					✕ Сбросить
				</button>
			</div>

			<!-- Dynamic Live Calculation Strip -->
			<div class="sd-filter-summary">
				<div class="sd-filter-stat">Поставок: <b id="sd-stat-inv-count">${invs.length}</b></div>
				<div class="sd-filter-stat">Товаров: <b id="sd-stat-inv-qty">${this.format_num(total_qty, 0)}</b> шт</div>
				<div class="sd-filter-stat">Сумма поставок: <b id="sd-stat-inv-total">${this.format_curr(total_amount)}</b></div>
				<div class="sd-filter-stat">Остаток долга: <b class="text-danger" id="sd-stat-inv-debt">${this.format_curr(total_debt)}</b></div>
			</div>

			<div class="sd-table-wrapper">
				<table class="table table-bordered table-hover sd-data-table">
					<thead>
						<tr>
							<th>${this.t("col_model_product")}</th>
							<th class="text-center">${this.t("col_date")}</th>
							<th class="text-center">${this.t("col_qty")}</th>
							<th class="text-right">${this.t("col_amount")}</th>
							<th class="text-right">${this.t("col_debt_left")}</th>
							<th class="text-center">${this.t("col_status")}</th>
							<th class="text-center">${this.t("col_actions")}</th>
						</tr>
					</thead>
					<tbody id="sd-invoices-tbody">
						${rows_html}
						<tr class="sd-invoices-no-match text-center py-4" style="display: none;">
							<td colspan="7" class="text-muted py-4">
								<div style="font-size: 24px; margin-bottom: 4px;">🔍</div>
								<div>Нет поставок, соответствующих выбранным фильтрам</div>
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td>
								<strong>${this.t("total_prefix")}: <span id="sd-foot-count">${invs.length}</span> накладных</strong>
							</td>
							<td class="text-center text-muted">—</td>
							<td class="text-center font-weight-bold">
								<span id="sd-foot-qty">${this.format_num(total_qty, 0)}</span> шт
							</td>
							<td class="text-right font-weight-bold">
								<span id="sd-foot-total">${this.format_curr(total_amount)}</span>
							</td>
							<td class="text-right font-weight-bold text-danger">
								<span id="sd-foot-debt">${this.format_curr(total_debt)}</span>
							</td>
							<td colspan="2" class="text-center text-muted">—</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`;
	}

	render_payments_tab() {
		const payments = this.data.payments || [];
		if (payments.length === 0) {
			return `
				<div class="empty-state text-center py-5">
					<div style="font-size: 38px; margin-bottom: 8px;">📜</div>
					<h5 class="font-weight-bold">Платежи ещё не совершались</h5>
					<p class="text-muted" style="font-size: 13px;">История оплат поставщику будет фиксироваться здесь автоматически.</p>
				</div>
			`;
		}

		let total_paid = 0;
		let rows_html = "";

		const modes = Array.from(new Set(payments.map((p) => p.mode_of_payment).filter(Boolean))).sort();
		const mode_options = modes
			.map((m) => `<option value="${frappe.utils.escape_html(m)}">${frappe.utils.escape_html(m)}</option>`)
			.join("");

		payments.forEach((p) => {
			total_paid += flt(p.paid_amount);

			const img_html = p.image
				? `<img src="${encodeURI(p.image)}" class="sd-credit-product-img" alt="">`
				: `<div class="sd-credit-product-img-empty">💳</div>`;

			const model_pill = p.model_id
				? `<span class="sd-model-badge">#${frappe.utils.escape_html(p.model_id)}</span>`
				: "";

			const prod_title = p.product_name || "Товары";

			const invoice_sub = p.invoice_name
				? ` · по <b>${frappe.utils.escape_html(p.invoice_name)}</b>`
				: "";

			const voucher_sub = `
				<div class="sd-credit-sub">
					<a href="/app/payment-entry/${encodeURIComponent(p.name)}" target="_blank" class="sd-voucher-link text-muted" title="Открыть документ в ERP">
						💳 ${frappe.utils.escape_html(p.name)}
					</a>
					${invoice_sub}
				</div>
			`;

			const note_text = p.clean_remarks || p.remarks || "";
			const ref_badge = p.reference_no
				? `<span class="badge badge-light border text-muted mr-1" style="font-size: 11px;">Чек: ${frappe.utils.escape_html(p.reference_no)}</span>`
				: "";

			const note_html = note_text
				? `<span style="font-size: 12.5px; color: #24292f;">${frappe.utils.escape_html(note_text)}</span>`
				: (ref_badge ? "" : `<span class="text-muted">—</span>`);

			rows_html += `
				<tr class="sd-payment-row"
					data-pay="${frappe.utils.escape_html(p.name.toLowerCase())}"
					data-prod="${frappe.utils.escape_html(((p.product_name || "") + " " + (p.model_id || "")).toLowerCase())}"
					data-inv="${frappe.utils.escape_html((p.invoice_name || "").toLowerCase())}"
					data-rem="${frappe.utils.escape_html(((p.clean_remarks || p.remarks || "") + " " + (p.reference_no || "")).toLowerCase())}"
					data-user="${frappe.utils.escape_html((p.owner || "").toLowerCase())}"
					data-mode="${frappe.utils.escape_html(p.mode_of_payment || "")}"
					data-date="${p.posting_date}"
					data-amount="${p.paid_amount}">
					<td style="min-width: 240px;">
						<div class="sd-credit-product-cell">
							${img_html}
							<div class="sd-credit-details">
								<div class="sd-credit-name-row">
									${model_pill}
									<span class="sd-credit-name">${frappe.utils.escape_html(prod_title)}</span>
								</div>
								${voucher_sub}
							</div>
						</div>
					</td>
					<td class="text-center" style="width: 120px;">${p.posting_date}</td>
					<td class="text-right font-weight-bold text-success" style="width: 170px;">
						${this.format_curr(p.paid_amount)}
					</td>
					<td class="text-center" style="width: 140px;">
						${p.wallet_name 
							? `<span class="badge badge-light border" style="font-size: 11.5px; font-weight: 600; padding: 4px 7px;" title="Кошелёк Money Hub: ${frappe.utils.escape_html(p.wallet_name)}">${frappe.utils.escape_html(p.wallet_icon || "💳")} ${frappe.utils.escape_html(p.wallet_name)}</span>`
							: `<span class="badge badge-light" style="font-size: 12px;">${frappe.utils.escape_html(p.mode_of_payment || "—")}</span>`
						}
					</td>
					<td style="min-width: 180px;">
						${ref_badge}${note_html}
					</td>
					<td class="text-muted" style="width: 160px; font-size: 12px;">${p.owner}</td>
				</tr>
			`;
		});

		return `
			<!-- ERP Standard Filters Toolbar for Payments -->
			<div class="sd-filter-toolbar">
				<div class="sd-filter-group" style="flex: 1; min-width: 240px;">
					<input type="text" id="sd-pay-filter-search" class="sd-filter-input" style="width: 100%;" placeholder="🔍 Поиск по товару, модели, примечанию или сотруднику...">
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">Способ:</label>
					<select id="sd-pay-filter-mode" class="sd-filter-input">
						<option value="all">Все способы оплаты</option>
						${mode_options}
					</select>
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">С:</label>
					<input type="date" id="sd-pay-filter-from" class="sd-filter-input">
				</div>
				<div class="sd-filter-group">
					<label class="sd-filter-label">По:</label>
					<input type="date" id="sd-pay-filter-to" class="sd-filter-input">
				</div>
				<button type="button" class="btn btn-xs btn-default font-weight-bold" id="sd-pay-filter-reset" title="Сбросить все фильтры" style="height: 32px; padding: 0 10px;">
					✕ Сбросить
				</button>
			</div>

			<!-- Dynamic Live Calculation Strip -->
			<div class="sd-filter-summary">
				<div class="sd-filter-stat">Платежей показано: <b id="sd-stat-pay-count">${payments.length}</b></div>
				<div class="sd-filter-stat">Всего выплачено: <b class="text-success font-weight-bold" id="sd-stat-pay-total">${this.format_curr(total_paid)}</b></div>
			</div>

			<div class="sd-table-wrapper">
				<table class="table table-bordered table-hover sd-data-table">
					<thead>
						<tr>
							<th>${this.t("col_pay_product")}</th>
							<th class="text-center">${this.t("col_date")}</th>
							<th class="text-right">${this.t("col_pay_amount")}</th>
							<th class="text-center">${this.t("col_mode")}</th>
							<th>${this.t("col_remarks")}</th>
							<th>${this.t("col_user")}</th>
						</tr>
					</thead>
					<tbody id="sd-payments-tbody">
						${rows_html}
						<tr class="sd-payments-no-match text-center py-4" style="display: none;">
							<td colspan="6" class="text-muted py-4">
								<div style="font-size: 24px; margin-bottom: 4px;">🔍</div>
								<div>Нет платежей, соответствующих выбранным фильтрам</div>
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td colspan="2">
								<strong>${this.t("total_prefix")}: <span id="sd-foot-pay-count">${payments.length}</span> платежей</strong>
							</td>
							<td class="text-right font-weight-bold text-success">
								<span id="sd-foot-pay-total">${this.format_curr(total_paid)}</span>
							</td>
							<td colspan="3" class="text-center text-muted">—</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`;
	}

	bind_table_actions() {
		// Clicking a product row or Open button navigates to Product Detail
		this.wrapper.find(".sd-table-row, .btn-open-item").on("click", (e) => {
			const item_code = decodeURIComponent($(e.currentTarget).attr("data-item-code"));
			if (item_code) {
				frappe.set_route("product-detail", item_code);
			}
		});

		// Paying a specific invoice
		this.wrapper.find(".btn-pay-invoice").on("click", (e) => {
			const amount = flt($(e.currentTarget).attr("data-amount"));
			const invoice = decodeURIComponent($(e.currentTarget).attr("data-invoice") || "");
			this.show_payment_dialog(amount, invoice);
		});

		// 1. Live ERP Filters for Products Tab
		const filter_products = () => {
			const q = (this.wrapper.find("#sd-prod-filter-search").val() || "").trim().toLowerCase();
			const cat = this.wrapper.find("#sd-prod-filter-category").val() || "all";
			const op = this.wrapper.find("#sd-prod-filter-op").val() || "all";
			const target_qty = flt(this.wrapper.find("#sd-prod-filter-qty").val() || 0);

			if (op === "all" || op === "zero") {
				this.wrapper.find("#sd-prod-filter-qty").hide();
			} else {
				this.wrapper.find("#sd-prod-filter-qty").show();
			}

			let matched_count = 0;
			let matched_qty = 0;
			let matched_val = 0;

			this.wrapper.find(".sd-prod-row").each((_, el) => {
				const $row = $(el);
				const prod = $row.attr("data-product") || "";
				const code = $row.attr("data-code") || "";
				const category = $row.attr("data-category") || "";
				const qty = flt($row.attr("data-qty"));
				const val = flt($row.attr("data-val"));

				let match = true;

				if (q && !prod.includes(q) && !code.includes(q)) {
					match = false;
				}

				if (match && cat !== "all" && category !== cat) {
					match = false;
				}

				if (match) {
					if (op === "gte" && qty < target_qty) {
						match = false;
					} else if (op === "lte" && qty > target_qty) {
						match = false;
					} else if (op === "eq" && qty !== target_qty) {
						match = false;
					} else if (op === "zero" && qty > 0) {
						match = false;
					}
				}

				if (match) {
					$row.show();
					matched_count += 1;
					matched_qty += qty;
					matched_val += val;
				} else {
					$row.hide();
				}
			});

			this.wrapper.find("#sd-stat-prod-count").text(matched_count);
			this.wrapper.find("#sd-stat-prod-qty").text(this.format_num(matched_qty, matched_qty % 1 === 0 ? 0 : 2));
			this.wrapper.find("#sd-stat-prod-val").text(this.format_curr(matched_val));

			this.wrapper.find("#sd-foot-prod-count").text(matched_count);
			this.wrapper.find("#sd-foot-prod-qty").text(this.format_num(matched_qty, matched_qty % 1 === 0 ? 0 : 2));
			this.wrapper.find("#sd-foot-prod-val").text(this.format_curr(matched_val));

			if (matched_count === 0) {
				this.wrapper.find(".sd-products-no-match").show();
			} else {
				this.wrapper.find(".sd-products-no-match").hide();
			}
		};

		this.wrapper.find("#sd-prod-filter-search, #sd-prod-filter-qty").on("input", filter_products);
		this.wrapper.find("#sd-prod-filter-category, #sd-prod-filter-op").on("change", filter_products);
		this.wrapper.find("#sd-prod-filter-reset").on("click", () => {
			this.wrapper.find("#sd-prod-filter-search").val("");
			this.wrapper.find("#sd-prod-filter-category").val("all");
			this.wrapper.find("#sd-prod-filter-op").val("all");
			this.wrapper.find("#sd-prod-filter-qty").val("5").hide();
			filter_products();
		});

		// 2. Live ERP Filters for Invoices Tab
		const filter_invoices = () => {
			const q = (this.wrapper.find("#sd-inv-filter-search").val() || "").trim().toLowerCase();
			const status = this.wrapper.find("#sd-inv-filter-status").val() || "all";
			const from_d = this.wrapper.find("#sd-inv-filter-from").val();
			const to_d = this.wrapper.find("#sd-inv-filter-to").val();

			let matched_count = 0;
			let matched_qty = 0;
			let matched_total = 0;
			let matched_debt = 0;

			this.wrapper.find(".sd-invoice-row").each((_, el) => {
				const $row = $(el);
				const inv_name = ($row.attr("data-invoice") || "").toLowerCase();
				const prod = $row.attr("data-product") || "";
				const model = $row.attr("data-model") || "";
				const row_date = $row.attr("data-date") || "";
				const is_unpaid = $row.attr("data-unpaid") === "1";
				const amt = flt($row.attr("data-amount"));
				const debt = flt($row.attr("data-debt"));
				const qty = flt($row.attr("data-qty"));

				let match = true;

				if (q && !prod.includes(q) && !model.includes(q) && !inv_name.includes(q)) {
					match = false;
				}

				if (match && status === "unpaid" && !is_unpaid) {
					match = false;
				} else if (match && status === "paid" && is_unpaid) {
					match = false;
				}

				if (match && from_d && row_date < from_d) {
					match = false;
				}
				if (match && to_d && row_date > to_d) {
					match = false;
				}

				if (match) {
					$row.show();
					matched_count += 1;
					matched_qty += qty;
					matched_total += amt;
					matched_debt += debt;
				} else {
					$row.hide();
				}
			});

			this.wrapper.find("#sd-stat-inv-count").text(matched_count);
			this.wrapper.find("#sd-stat-inv-qty").text(this.format_num(matched_qty, matched_qty % 1 === 0 ? 0 : 2));
			this.wrapper.find("#sd-stat-inv-total").text(this.format_curr(matched_total));
			this.wrapper.find("#sd-stat-inv-debt").text(this.format_curr(matched_debt));

			this.wrapper.find("#sd-foot-count").text(matched_count);
			this.wrapper.find("#sd-foot-qty").text(this.format_num(matched_qty, matched_qty % 1 === 0 ? 0 : 2));
			this.wrapper.find("#sd-foot-total").text(this.format_curr(matched_total));
			this.wrapper.find("#sd-foot-debt").text(this.format_curr(matched_debt));

			if (matched_count === 0) {
				this.wrapper.find(".sd-invoices-no-match").show();
			} else {
				this.wrapper.find(".sd-invoices-no-match").hide();
			}
		};

		this.wrapper.find("#sd-inv-filter-search").on("input", filter_invoices);
		this.wrapper.find("#sd-inv-filter-status, #sd-inv-filter-from, #sd-inv-filter-to").on("change", filter_invoices);
		this.wrapper.find("#sd-inv-filter-reset").on("click", () => {
			this.wrapper.find("#sd-inv-filter-search").val("");
			this.wrapper.find("#sd-inv-filter-status").val("all");
			this.wrapper.find("#sd-inv-filter-from").val("");
			this.wrapper.find("#sd-inv-filter-to").val("");
			filter_invoices();
		});

		// 3. Live ERP Filters for Payments Tab
		const filter_payments = () => {
			const q = (this.wrapper.find("#sd-pay-filter-search").val() || "").trim().toLowerCase();
			const mode = this.wrapper.find("#sd-pay-filter-mode").val() || "all";
			const from_d = this.wrapper.find("#sd-pay-filter-from").val();
			const to_d = this.wrapper.find("#sd-pay-filter-to").val();

			let matched_count = 0;
			let matched_total = 0;

			this.wrapper.find(".sd-payment-row").each((_, el) => {
				const $row = $(el);
				const pay = $row.attr("data-pay") || "";
				const prod = $row.attr("data-prod") || "";
				const inv = $row.attr("data-inv") || "";
				const rem = $row.attr("data-rem") || "";
				const user = $row.attr("data-user") || "";
				const pay_mode = $row.attr("data-mode") || "";
				const pay_date = $row.attr("data-date") || "";
				const amt = flt($row.attr("data-amount"));

				let match = true;

				if (q && !prod.includes(q) && !rem.includes(q) && !pay.includes(q) && !inv.includes(q) && !user.includes(q)) {
					match = false;
				}

				if (match && mode !== "all" && pay_mode !== mode) {
					match = false;
				}

				if (match && from_d && pay_date < from_d) {
					match = false;
				}
				if (match && to_d && pay_date > to_d) {
					match = false;
				}

				if (match) {
					$row.show();
					matched_count += 1;
					matched_total += amt;
				} else {
					$row.hide();
				}
			});

			this.wrapper.find("#sd-stat-pay-count").text(matched_count);
			this.wrapper.find("#sd-stat-pay-total").text(this.format_curr(matched_total));

			this.wrapper.find("#sd-foot-pay-count").text(matched_count);
			this.wrapper.find("#sd-foot-pay-total").text(this.format_curr(matched_total));

			if (matched_count === 0) {
				this.wrapper.find(".sd-payments-no-match").show();
			} else {
				this.wrapper.find(".sd-payments-no-match").hide();
			}
		};

		this.wrapper.find("#sd-pay-filter-search").on("input", filter_payments);
		this.wrapper.find("#sd-pay-filter-mode, #sd-pay-filter-from, #sd-pay-filter-to").on("change", filter_payments);
		this.wrapper.find("#sd-pay-filter-reset").on("click", () => {
			this.wrapper.find("#sd-pay-filter-search").val("");
			this.wrapper.find("#sd-pay-filter-mode").val("all");
			this.wrapper.find("#sd-pay-filter-from").val("");
			this.wrapper.find("#sd-pay-filter-to").val("");
			filter_payments();
		});

		// Run initial filters
		filter_products();
		filter_invoices();
		filter_payments();
	}

	show_payment_dialog(default_amount = 0, target_invoice = null) {
		const unpaid_invoices = (this.data.invoices || []).filter((inv) => flt(inv.outstanding_amount) > 0);
		if (unpaid_invoices.length === 0) {
			frappe.msgprint(__("У поставщика нет неоплаченных накладных"));
			return;
		}

		let current_inv = unpaid_invoices.find((i) => i.name === target_invoice) || unpaid_invoices[0];

		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_payment_options",
			callback: (r) => {
				const opts = r.message || {};
				const wallets = opts.wallets || [];
				let selected_wallet = wallets.length ? wallets[0].name : null;
				const mops = (opts.modes || []).map((m) => m.name);
				const default_mop = mops.includes("Cash") ? "Cash" : mops[0] || "Cash";

				const invoice_options = unpaid_invoices.map((inv) => {
					const bill_str = inv.bill_no ? ` | № ${inv.bill_no}` : "";
					return {
						value: inv.name,
						label: `${inv.name} (${inv.posting_date}${bill_str}) — Долг: ${this.format_curr(inv.outstanding_amount)}`,
					};
				});

				const render_banner_html = (inv) => {
					const img_html = inv.image
						? `<img src="${encodeURI(inv.image)}" class="sd-credit-product-img" alt="">`
						: `<div class="sd-credit-product-img-empty">📦</div>`;

					const model_pill = inv.model_id
						? `<span class="sd-model-badge">#${frappe.utils.escape_html(inv.model_id)}</span>`
						: "";

					const bill_note = inv.bill_no && !inv.bill_no.startsWith("QPI-") && !inv.bill_no.startsWith("QPR-")
						? ` · Чек: <b>${frappe.utils.escape_html(inv.bill_no)}</b>`
						: "";

					return `
						<div class="pay-debt-banner">
							<div class="d-flex align-items-center" style="gap: 14px;">
								${img_html}
								<div class="pay-debt-banner-left">
									<div class="d-flex align-items-center" style="gap: 6px;">
										${model_pill}
										<span style="font-weight: 700; font-size: 15px; color: #0f172a;">
											${frappe.utils.escape_html(inv.product_name || "Товары")}
										</span>
									</div>
									<div class="pay-debt-banner-label mt-1">
										Остаток долга: <span class="pay-debt-banner-amount" id="sd-inv-debt-val">${this.format_curr(inv.outstanding_amount)}</span>
									</div>
									<div class="pay-debt-banner-sub">
										Дата поставки: ${inv.posting_date}${bill_note}
									</div>
								</div>
							</div>
							<button type="button" class="pay-btn-full-debt" id="sd-btn-fill-full">
								⚡ Оплатить всю сумму
							</button>
						</div>
					`;
				};

				const render_wallet_cards_html = (current_sel) => {
					if (!wallets.length) return "";
					return `
						<div class="sd-wallet-picker-label">
							💰 Кошелёк списания (Money Hub):
						</div>
						<div class="sd-wallet-grid">
							${wallets.map((w) => {
								const is_sel = w.name === current_sel;
								const bal_class = w.balance > 0 ? "positive" : (w.balance < 0 ? "negative" : "zero");
								return `
									<div class="sd-wallet-card ${is_sel ? "active" : ""}" data-wallet="${frappe.utils.escape_html(w.name)}">
										<div class="sd-wallet-card-icon">${frappe.utils.escape_html(w.icon || "💳")}</div>
										<div class="sd-wallet-card-content">
											<div class="sd-wallet-card-title">${frappe.utils.escape_html(w.wallet_name)}</div>
											<div class="sd-wallet-card-bal ${bal_class}">${frappe.utils.escape_html(w.formatted_balance)}</div>
										</div>
										${is_sel ? '<div class="sd-wallet-check">✓</div>' : ''}
									</div>
								`;
							}).join("")}
						</div>
						<div class="sd-wallet-status-box" id="sd-wallet-status-indicator"></div>
					`;
				};

				const initial_amount =
					default_amount > 0 && default_amount <= current_inv.outstanding_amount
						? default_amount
						: current_inv.outstanding_amount;

				const fields = [];

				if (unpaid_invoices.length > 1) {
					fields.push({
						fieldtype: "Select",
						fieldname: "purchase_invoice",
						label: "Накладная для оплаты",
						options: invoice_options,
						default: current_inv.name,
						reqd: 1,
					});
				}

				fields.push({
					fieldtype: "HTML",
					fieldname: "invoice_banner",
					options: render_banner_html(current_inv),
				});

				if (wallets.length > 0) {
					fields.push({
						fieldtype: "HTML",
						fieldname: "wallet_picker_html",
						options: render_wallet_cards_html(selected_wallet),
					});
				} else {
					fields.push({
						fieldtype: "Select",
						fieldname: "mode_of_payment",
						label: "Способ оплаты (Касса / Счёт)",
						options: mops.length ? mops : ["Cash", "Credit Card", "Wire Transfer"],
						default: default_mop,
						reqd: 1,
					});
				}

				fields.push(
					{
						fieldtype: "Currency",
						fieldname: "amount",
						label: `Сумма к оплате (${this.data.currency || "TJS"})`,
						description: `Максимально к оплате: ${this.format_curr(current_inv.outstanding_amount)}`,
						reqd: 1,
						default: initial_amount,
					},
					{ fieldtype: "Column Break" },
					{
						fieldtype: "Date",
						fieldname: "posting_date",
						label: "Дата оплаты",
						default: frappe.datetime.get_today(),
						reqd: 1,
					},
					{
						fieldtype: "Section Break",
					},
					{
						fieldtype: "Data",
						fieldname: "remarks",
						label: "Примечание (комментарий, чек)",
						placeholder: "например, Чек #142, через водителя...",
					}
				);

				const d = new frappe.ui.Dialog({
					title: `💳 Оплата: ${frappe.utils.escape_html(this.data.supplier.supplier_name)}`,
					size: "large",
					fields: fields,
					primary_action_label: "💳 Подтвердить оплату",
					primary_action: (values) => {
						const pay_amount = flt(values.amount);
						if (!pay_amount || pay_amount <= 0) {
							frappe.msgprint(__("Введите корректную сумму"));
							return;
						}

						const max_allowed = flt(current_inv.outstanding_amount);
						if (pay_amount > max_allowed + 0.001) {
							frappe.msgprint(
								__("Сумма оплаты ({0}) не может превышать остаток по накладной ({1})", [
									this.format_curr(pay_amount),
									this.format_curr(max_allowed),
								])
							);
							return;
						}

						d.get_primary_btn().prop("disabled", true).text("Обработка...");

						const sel_wallet_doc = wallets.find((w) => w.name === selected_wallet);

						frappe.call({
							method: "erpnext.buying.page.supplier_hub.supplier_hub.make_quick_supplier_payment",
							args: {
								supplier: this.supplier,
								purchase_invoice: current_inv.name,
								amount: pay_amount,
								wallet: selected_wallet,
								mode_of_payment: sel_wallet_doc ? (sel_wallet_doc.mode_of_payment || null) : values.mode_of_payment,
								posting_date: values.posting_date,
								reference_no: "",
								remarks: values.remarks,
							},
							callback: (res) => {
								d.hide();
								if (res.message && res.message.success) {
									frappe.show_alert({ message: `✅ ${res.message.message}`, indicator: "green" }, 7);
									this.load(this.supplier);
								}
							},
							always: () => {
								d.get_primary_btn().prop("disabled", false).text("💳 Подтвердить оплату");
							},
						});
					},
				});

				const update_status = () => {
					const sel_w = wallets.find((w) => w.name === selected_wallet);
					const cur_amount = flt(d.get_value("amount"));
					const $box = d.$wrapper.find("#sd-wallet-status-indicator");
					if (!sel_w || !$box.length) return;

					if (sel_w.balance >= cur_amount) {
						const rem = sel_w.balance - cur_amount;
						$box.html(`
							<div class="sd-status-ok">
								🟢 <b>Достаточно средств</b>: на балансе «${frappe.utils.escape_html(sel_w.wallet_name)}» останется <b>${this.format_curr(rem)}</b>
							</div>
						`);
					} else {
						const deficit = cur_amount - sel_w.balance;
						$box.html(`
							<div class="sd-status-warn">
								⚠️ <b>Внимание</b>: на кошельке «${frappe.utils.escape_html(sel_w.wallet_name)}» остаток <b>${this.format_curr(sel_w.balance)}</b> (не хватает <b>${this.format_curr(deficit)}</b>)
							</div>
						`);
					}
				};

				const bind_wallet_cards = () => {
					d.$wrapper.find(".sd-wallet-card").off("click").on("click", (e) => {
						const w_name = $(e.currentTarget).attr("data-wallet");
						if (w_name) {
							selected_wallet = w_name;
							if (d.fields_dict.wallet_picker_html) {
								d.fields_dict.wallet_picker_html.$wrapper.html(render_wallet_cards_html(selected_wallet));
							}
							bind_wallet_cards();
							update_status();
						}
					});
				};

				const bind_banner_btn = () => {
					d.$wrapper.find("#sd-btn-fill-full").off("click").on("click", () => {
						d.set_value("amount", current_inv.outstanding_amount);
						update_status();
					});
				};

				d.show();
				d.$wrapper.addClass("supplier-pay-modal");
				d.$wrapper.find(".modal-dialog").addClass("modal-dialog-centered");
				bind_banner_btn();
				bind_wallet_cards();
				update_status();

				// Realtime status updating on amount change
				if (d.fields_dict.amount && d.fields_dict.amount.$input) {
					d.fields_dict.amount.$input.on("input change", () => update_status());

					// Append quick percentage pills under amount
					const quick_html = `
						<div class="sd-quick-amounts">
							<button type="button" class="sd-quick-amt-btn" data-ratio="1.0">⚡ 100% (Вся сумма)</button>
							<button type="button" class="sd-quick-amt-btn" data-ratio="0.5">50%</button>
							<button type="button" class="sd-quick-amt-btn" data-ratio="0.25">25%</button>
						</div>
					`;
					d.fields_dict.amount.$wrapper.append(quick_html);
					d.fields_dict.amount.$wrapper.find(".sd-quick-amt-btn").on("click", (e) => {
						const ratio = flt($(e.currentTarget).attr("data-ratio"));
						if (ratio > 0 && current_inv.outstanding_amount > 0) {
							const new_amt = Math.round(current_inv.outstanding_amount * ratio * 100) / 100;
							d.set_value("amount", new_amt);
							update_status();
						}
					});
				}

				// Invoice dropdown change
				if (d.fields_dict.purchase_invoice && d.fields_dict.purchase_invoice.$input) {
					d.fields_dict.purchase_invoice.$input.on("change", () => {
						const sel_name = d.get_value("purchase_invoice");
						const inv = unpaid_invoices.find((i) => i.name === sel_name);
						if (inv) {
							current_inv = inv;
							d.fields_dict.invoice_banner.$wrapper.html(render_banner_html(current_inv));
							d.set_df_property("amount", "description", `Максимально к оплате: ${this.format_curr(current_inv.outstanding_amount)}`);
							d.set_value("amount", current_inv.outstanding_amount);
							bind_banner_btn();
							update_status();
						}
					});
				}
			},
		});
	}
}
