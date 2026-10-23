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
			col_date: { tg: "Сана", ru: "Дата" },
			col_bill_no: { tg: "Чек / Борхат", ru: "Чек / Накладная поставщика" },
			col_amount: { tg: "Маблағ", ru: "Сумма поставки" },
			col_debt_left: { tg: "Бақияи қарз", ru: "Остаток долга" },
			col_status: { tg: "Ҳолат", ru: "Статус" },

			col_pay_no: { tg: "Рақами пардохт", ru: "Номер платежа" },
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
					<!-- Tabs Navigation Bar (General Info opened by default) -->
					<div class="sd-tabs-bar">
						<div class="sd-tab-item active" data-tab="tab-general">
							${this.t("tab_general_info")}
						</div>
						<div class="sd-tab-item" data-tab="tab-products">
							${this.t("tab_products")}
							<span class="sd-tab-badge">${(this.data.products || []).length}</span>
						</div>
						<div class="sd-tab-item" data-tab="tab-invoices">
							${this.t("tab_invoices")}
							<span class="sd-tab-badge">${(this.data.invoices || []).length}</span>
						</div>
						<div class="sd-tab-item" data-tab="tab-payments">
							${this.t("tab_payments")}
							<span class="sd-tab-badge">${(this.data.payments || []).length}</span>
						</div>
					</div>

					<!-- Tab Panes -->
					<div class="sd-tab-panes">
						<!-- Tab 1: General Info (Active by default) -->
						<div id="tab-general" class="sd-tab-pane" style="display: block;">
							${this.render_general_info_tab()}
						</div>

						<!-- Tab 2: Products Table (Catalog Style) -->
						<div id="tab-products" class="sd-tab-pane" style="display: none;">
							${this.render_products_tab()}
						</div>

						<!-- Tab 3: Invoices Table -->
						<div id="tab-invoices" class="sd-tab-pane" style="display: none;">
							${this.render_invoices_tab()}
						</div>

						<!-- Tab 4: Payments Table -->
						<div id="tab-payments" class="sd-tab-pane" style="display: none;">
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
				<tr class="sd-table-row" data-item-code="${encodeURIComponent(p.item_code)}">
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

		return `
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
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td colspan="4">
								<strong>${this.t("total_prefix")}: ${prods.length} ${this.t("models_suffix")}</strong>
							</td>
							<td>
								<span class="font-weight-bold">${this.format_num(total_qty, 0)} ${this.t("pcs")}</span>
							</td>
							<td class="text-center text-muted">—</td>
							<td class="text-right">
								<span class="font-weight-bold text-success">${this.format_curr(total_val)}</span>
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
		let rows_html = "";

		invs.forEach((inv) => {
			total_amount += flt(inv.grand_total);
			total_debt += flt(inv.outstanding_amount);

			const is_unpaid = inv.outstanding_amount > 0;
			const debt_badge = is_unpaid
				? `<span class="badge badge-danger" style="font-size: 12px; font-weight: 700;">${this.format_curr(inv.outstanding_amount)}</span>`
				: `<span class="badge badge-success" style="font-size: 11.5px;">🟢 ${this.t("settled")}</span>`;

			const pay_btn = is_unpaid
				? `<button class="btn btn-xs btn-primary btn-pay-invoice" data-invoice="${encodeURIComponent(inv.name)}" data-amount="${inv.outstanding_amount}">💳 ${this.t("btn_pay")}</button>`
				: `<span class="text-muted" style="font-size: 11.5px;">—</span>`;

			rows_html += `
				<tr>
					<td>
						<a href="/app/purchase-invoice/${encodeURIComponent(inv.name)}" target="_blank" class="sd-voucher-link">
							${inv.name}
						</a>
					</td>
					<td class="text-center" style="width: 110px;">${inv.posting_date}</td>
					<td style="width: 180px;">${inv.bill_no || "—"}</td>
					<td class="text-right font-weight-bold" style="width: 160px;">${this.format_curr(inv.grand_total)}</td>
					<td class="text-right" style="width: 170px;">${debt_badge}</td>
					<td class="text-center" style="width: 120px;">
						<span class="badge badge-light">${inv.status}</span>
					</td>
					<td class="text-center" style="width: 110px;">
						${pay_btn}
					</td>
				</tr>
			`;
		});

		return `
			<div class="sd-table-wrapper">
				<table class="table table-bordered table-hover sd-data-table">
					<thead>
						<tr>
							<th>${this.t("col_inv_no")}</th>
							<th class="text-center">${this.t("col_date")}</th>
							<th>${this.t("col_bill_no")}</th>
							<th class="text-right">${this.t("col_amount")}</th>
							<th class="text-right">${this.t("col_debt_left")}</th>
							<th class="text-center">${this.t("col_status")}</th>
							<th class="text-center">${this.t("col_actions")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td colspan="3">
								<strong>${this.t("total_prefix")}: ${invs.length} накладных</strong>
							</td>
							<td class="text-right font-weight-bold">
								${this.format_curr(total_amount)}
							</td>
							<td class="text-right font-weight-bold text-danger">
								${this.format_curr(total_debt)}
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

		payments.forEach((p) => {
			total_paid += flt(p.paid_amount);

			rows_html += `
				<tr>
					<td>
						<a href="/app/payment-entry/${encodeURIComponent(p.name)}" target="_blank" class="sd-voucher-link">
							${p.name}
						</a>
					</td>
					<td class="text-center" style="width: 120px;">${p.posting_date}</td>
					<td class="text-right font-weight-bold text-success" style="width: 170px;">
						${this.format_curr(p.paid_amount)}
					</td>
					<td class="text-center" style="width: 140px;">
						<span class="badge badge-light" style="font-size: 12px;">${p.mode_of_payment}</span>
					</td>
					<td style="width: 180px;">${p.reference_no || "—"}</td>
					<td class="text-muted" style="width: 160px; font-size: 12px;">${p.owner}</td>
				</tr>
			`;
		});

		return `
			<div class="sd-table-wrapper">
				<table class="table table-bordered table-hover sd-data-table">
					<thead>
						<tr>
							<th>${this.t("col_pay_no")}</th>
							<th class="text-center">${this.t("col_date")}</th>
							<th class="text-right">${this.t("col_amount")}</th>
							<th class="text-center">${this.t("col_mode")}</th>
							<th>${this.t("col_reference")}</th>
							<th>${this.t("col_user")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="sd-totals-row">
							<td colspan="2">
								<strong>${this.t("total_prefix")}: ${payments.length} платежей</strong>
							</td>
							<td class="text-right font-weight-bold text-success">
								${this.format_curr(total_paid)}
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
			this.show_payment_dialog(amount);
		});
	}

	show_payment_dialog(default_amount = 0) {
		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_payment_options",
			callback: (r) => {
				const opts = r.message || {};
				const mops = (opts.modes || []).map((m) => m.name);
				const default_mop = mops.includes("Cash") ? "Cash" : mops[0] || "Cash";
				const debt = flt(this.data.kpi.current_debt);

				const d = new frappe.ui.Dialog({
					title: `💳 Оплата поставщику: ${this.data.supplier.supplier_name}`,
					fields: [
						{
							fieldtype: "HTML",
							fieldname: "debt_html",
							options: `
								<div class="alert alert-warning mb-3 d-flex justify-content-between align-items-center">
									<div>
										<div style="font-size: 11px; text-transform: uppercase; font-weight: 600;">Текущий долг:</div>
										<div style="font-size: 18px; font-weight: 700; color: #cf222e;">${this.format_curr(debt)}</div>
									</div>
									${debt > 0 ? `<button type="button" class="btn btn-sm btn-outline-danger font-weight-bold" id="sd-btn-fill-full">⚡ Оплатить весь долг</button>` : ""}
								</div>
							`,
						},
						{
							fieldtype: "Currency",
							fieldname: "amount",
							label: `Сумма к оплате (${this.data.currency || "TJS"})`,
							reqd: 1,
							default: default_amount > 0 ? default_amount : debt,
						},
						{ fieldtype: "Column Break" },
						{
							fieldtype: "Select",
							fieldname: "mode_of_payment",
							label: "Способ оплаты",
							options: mops.length ? mops : ["Cash", "Credit Card", "Wire Transfer"],
							default: default_mop,
							reqd: 1,
						},
						{ fieldtype: "Section Break" },
						{
							fieldtype: "Date",
							fieldname: "posting_date",
							label: "Дата оплаты",
							default: frappe.datetime.get_today(),
							reqd: 1,
						},
						{ fieldtype: "Column Break" },
						{
							fieldtype: "Data",
							fieldname: "reference_no",
							label: "Номер чека / Расписки",
						},
						{ fieldtype: "Section Break" },
						{
							fieldtype: "Small Text",
							fieldname: "remarks",
							label: "Примечание",
						},
					],
					primary_action_label: "💳 Подтвердить оплату",
					primary_action: (values) => {
						if (!values.amount || flt(values.amount) <= 0) {
							frappe.msgprint(__("Введите корректную сумму"));
							return;
						}
						d.get_primary_btn().prop("disabled", true).text("Обработка...");

						frappe.call({
							method: "erpnext.buying.page.supplier_hub.supplier_hub.make_quick_supplier_payment",
							args: {
								supplier: this.supplier,
								amount: values.amount,
								mode_of_payment: values.mode_of_payment,
								posting_date: values.posting_date,
								reference_no: values.reference_no,
								remarks: values.remarks,
							},
							callback: (res) => {
								d.hide();
								if (res.message && res.message.success) {
									frappe.show_alert({ message: `✅ ${res.message.message}`, indicator: "green" }, 6);
									this.load(this.supplier);
								}
							},
							always: () => {
								d.get_primary_btn().prop("disabled", false).text("💳 Подтвердить оплату");
							},
						});
					},
				});

				d.show();
				d.$wrapper.find("#sd-btn-fill-full").on("click", () => {
					d.set_value("amount", debt);
				});
			},
		});
	}
}
