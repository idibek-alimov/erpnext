// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["supplier-hub"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Хаби таъминкунандагон") : __("Поставщики (Supplier Hub)"),
		single_column: true,
	});

	page.set_primary_action(
		is_tg ? __("+ Таъминкунандаи нав") : __("+ Новый поставщик"),
		() => {
			if (wrapper.supplier_hub_app) {
				wrapper.supplier_hub_app.show_new_supplier_dialog();
			}
		},
		"add"
	);

	page.add_inner_button(
		is_tg ? __("Каталоги молҳо") : __("Каталог товаров"),
		() => {
			frappe.set_route("product-catalog");
		}
	);

	page.add_inner_button(
		is_tg ? __("Навсозӣ") : __("Обновить"),
		() => {
			if (wrapper.supplier_hub_app) {
				wrapper.supplier_hub_app.load_data();
			}
		}
	);

	wrapper.supplier_hub_app = new SupplierHubApp(page);
};

class SupplierHubApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body);
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.search_query = "";
		this.selected_group = "All";
		this.debt_filter = "all";
		this.sort_by = "debt_desc";
		this.suppliers_data = [];
		this.summary_data = {};
		this.supplier_groups = [];
		this.currency = "TJS";
		this.payment_options = null;

		this.init();
	}

	init() {
		this.setup_ui();
		this.bind_events();
		this.load_payment_options();
		this.load_data();
	}

	t(key) {
		const dict = {
			search_placeholder: {
				tg: "Ҷустуҷӯ бо номи таъминкунанда, телефон...",
				ru: "Поиск по названию поставщика, телефону...",
			},
			all_groups: { tg: "Ҳамаи гурӯҳҳо", ru: "Все группы" },
			filter_all: { tg: "Ҳамаи ҳолатҳо", ru: "Все поставщики" },
			filter_with_debt: { tg: "🔴 Бо қарздорӣ", ru: "🔴 С долгом" },
			filter_settled: { tg: "🟢 Бе қарз (Ҳисобӣ)", ru: "🟢 Без долга (Рассчитано)" },
			filter_in_stock: { tg: "📦 Бо моли дар анборбуда", ru: "📦 С товаром в наличии" },
			sort_debt_desc: { tg: "Аз рӯи қарз (камшавӣ)", ru: "По долгу (убыв.)" },
			sort_stock_val_desc: { tg: "Аз рӯи маблағи мол (камшавӣ)", ru: "По остатку товара (убыв.)" },
			sort_purchased_desc: { tg: "Аз рӯи ҳаҷми харид (камшавӣ)", ru: "По закупкам (убыв.)" },
			sort_name_asc: { tg: "Аз рӯи ном (А-Я)", ru: "По названию (А-Я)" },

			kpi_total_debt: { tg: "Қарзи умумӣ", ru: "Общий долг поставщикам" },
			kpi_stock_value: { tg: "Товар на складе", ru: "Товар на складе (Себестоимость)" },
			kpi_net_gap: { tg: "Покрытие склада", ru: "Покрытие остатком" },
			kpi_active_suppliers: { tg: "Активные поставщики", ru: "Всего поставщиков" },

			col_supplier: { tg: "Таъминкунанда", ru: "Поставщик" },
			col_products: { tg: "Модел / SKU", ru: "Товаров" },
			col_stock_at_hand: { tg: "Остаток на складе", ru: "Остаток на складе" },
			col_current_debt: { tg: "Текущий долг", ru: "Текущий долг" },
			col_total_purchased: { tg: "Ҳамагӣ харид", ru: "Всего закуплено" },
			col_total_paid: { tg: "Пардохт шуд", ru: "Всего выплачено" },
			col_actions: { tg: "Амалҳо", ru: "Действие" },

			btn_pay: { tg: "Оплатить", ru: "Оплатить" },
			btn_pay_all: { tg: "Оплатить весь долг", ru: "Оплатить весь долг" },
			pcs: { tg: "дона", ru: "шт" },
			total_prefix: { tg: "Ҳамагӣ", ru: "Итого" },
			suppliers_suffix: { tg: "таъминкунанда", ru: "поставщиков" },
			settled_badge: { tg: "Ҳисобӣ", ru: "0 TJS (Рассчитано)" },
			empty_title: { tg: "Таъминкунанда ёфт нашуд", ru: "Поставщики не найдены" },
			empty_desc: {
				tg: "Филтрҳоро тағйир диҳед ё тугмаи '+ Таъминкунандаи нав'-ро пахш намоед.",
				ru: "Измените параметры поиска или нажмите '+ Новый поставщик'.",
			},
			payment_title: { tg: "Сабти пардохт ба таъминкунанда", ru: "Быстрая оплата поставщику" },
			new_supplier_title: { tg: "Таъминкунандаи нав", ru: "Новый поставщик" },
		};
		return (dict[key] && dict[key][this.lang]) || key;
	}

	setup_ui() {
		this.wrapper.html(`
			<div class="retail-supplier-layout">
				<!-- Top KPI Metric Cards Grid -->
				<div id="supplier-kpi-area" class="supplier-kpi-grid">
					<div class="supplier-kpi-card">
						<div class="supplier-kpi-icon icon-debt">💳</div>
						<div class="supplier-kpi-info">
							<span class="supplier-kpi-label">${this.t("kpi_total_debt")}</span>
							<span class="supplier-kpi-value text-danger" id="kpi-total-debt">0.00 ${this.currency}</span>
							<span class="supplier-kpi-sub" id="kpi-debt-count">0 с задолженностью</span>
						</div>
					</div>

					<div class="supplier-kpi-card">
						<div class="supplier-kpi-icon icon-stock">📦</div>
						<div class="supplier-kpi-info">
							<span class="supplier-kpi-label">${this.t("kpi_stock_value")}</span>
							<span class="supplier-kpi-value text-success" id="kpi-stock-value">0.00 ${this.currency}</span>
							<span class="supplier-kpi-sub" id="kpi-stock-qty">0 шт на полках</span>
						</div>
					</div>

					<div class="supplier-kpi-card">
						<div class="supplier-kpi-icon icon-suppliers">👥</div>
						<div class="supplier-kpi-info">
							<span class="supplier-kpi-label">${this.t("kpi_active_suppliers")}</span>
							<span class="supplier-kpi-value" id="kpi-suppliers-count">0</span>
							<span class="supplier-kpi-sub" id="kpi-purchased-sub">0.00 ${this.currency} закуплено</span>
						</div>
					</div>
				</div>

				<!-- ERPNext-Native Filter Bar -->
				<div class="supplier-filter-bar">
					<div class="filter-col search-input-col">
						<div class="frappe-search-box">
							<span class="frappe-search-icon">
								<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-search"></use></svg>
							</span>
							<input type="text" id="supplier-search" class="form-control form-control-sm" placeholder="${this.t("search_placeholder")}">
						</div>
					</div>

					<div class="filter-col select-group-col">
						<select id="supplier-debt-filter" class="form-control form-control-sm filter-select">
							<option value="all">${this.t("filter_all")}</option>
							<option value="with_debt">${this.t("filter_with_debt")}</option>
							<option value="settled">${this.t("filter_settled")}</option>
							<option value="in_stock">${this.t("filter_in_stock")}</option>
						</select>

						<select id="supplier-sort-filter" class="form-control form-control-sm filter-select">
							<option value="debt_desc">${this.t("sort_debt_desc")}</option>
							<option value="stock_val_desc">${this.t("sort_stock_val_desc")}</option>
							<option value="purchased_desc">${this.t("sort_purchased_desc")}</option>
							<option value="name_asc">${this.t("sort_name_asc")}</option>
						</select>
					</div>
				</div>

				<!-- Main Supplier Table with Sticky Totals Footer -->
				<div id="supplier-content-area" class="supplier-table-container">
					<div class="text-center py-5"><span class="spinner-border text-primary"></span></div>
				</div>
			</div>
		`);
	}

	bind_events() {
		let timeout = null;
		this.wrapper.find("#supplier-search").on("input", (e) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => {
				this.search_query = e.target.value.trim();
				this.load_data();
			}, 300);
		});

		this.wrapper.find("#supplier-debt-filter").on("change", (e) => {
			this.debt_filter = e.target.value;
			this.load_data();
		});

		this.wrapper.find("#supplier-sort-filter").on("change", (e) => {
			this.sort_by = e.target.value;
			this.sort_and_render();
		});
	}

	load_payment_options() {
		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_payment_options",
			callback: (r) => {
				if (r.message) {
					this.payment_options = r.message;
				}
			},
		});
	}

	load_data() {
		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_supplier_hub_data",
			args: {
				search: this.search_query,
				debt_filter: this.debt_filter,
			},
			callback: (r) => {
				if (r.message) {
					this.suppliers_data = r.message.suppliers || [];
					this.summary_data = r.message.summary || {};
					this.currency = r.message.currency || "TJS";
					this.update_kpi_cards();
					this.sort_and_render();
				}
			},
		});
	}

	update_kpi_cards() {
		const s = this.summary_data;
		this.wrapper.find("#kpi-total-debt").text(this.format_curr(s.total_debt || 0));
		this.wrapper
			.find("#kpi-debt-count")
			.text(`${s.suppliers_with_debt_count || 0} с задолженностью`);

		this.wrapper.find("#kpi-stock-value").text(this.format_curr(s.total_stock_value || 0));
		this.wrapper
			.find("#kpi-stock-qty")
			.text(`${this.format_num(s.total_stock_qty || 0, 0)} ${this.t("pcs")} на полках`);

		this.wrapper.find("#kpi-suppliers-count").text(s.suppliers_count || 0);
		this.wrapper
			.find("#kpi-purchased-sub")
			.text(`${this.format_curr(s.total_purchased || 0)} закуплено`);
	}

	format_num(val, decimals = 2) {
		const n = flt(val);
		return n.toLocaleString(undefined, {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals,
		});
	}

	format_curr(val) {
		return `${this.format_num(val, 2)} ${this.currency}`;
	}

	sort_and_render() {
		if (this.sort_by === "debt_desc") {
			this.suppliers_data.sort((a, b) => b.current_debt - a.current_debt);
		} else if (this.sort_by === "stock_val_desc") {
			this.suppliers_data.sort((a, b) => b.stock_value - a.stock_value);
		} else if (this.sort_by === "purchased_desc") {
			this.suppliers_data.sort((a, b) => b.total_purchased - a.total_purchased);
		} else if (this.sort_by === "name_asc") {
			this.suppliers_data.sort((a, b) => a.name.localeCompare(b.name));
		}
		this.render_table();
	}

	render_table() {
		const $area = this.wrapper.find("#supplier-content-area");

		if (!this.suppliers_data || this.suppliers_data.length === 0) {
			$area.html(`
				<div class="empty-state text-center py-5">
					<div class="empty-state-icon" style="font-size: 40px; margin-bottom: 12px; color: var(--text-muted);">👥</div>
					<h5 style="color: var(--text-color); font-weight: 600;">${this.t("empty_title")}</h5>
					<p class="text-muted" style="font-size: 13px;">${this.t("empty_desc")}</p>
				</div>
			`);
			return;
		}

		let total_suppliers = this.suppliers_data.length;
		let total_stock_qty = 0;
		let total_stock_val = 0;
		let total_debt = 0;
		let total_purchased = 0;
		let total_paid = 0;

		let rows_html = "";
		this.suppliers_data.forEach((s) => {
			total_stock_qty += flt(s.stock_qty);
			total_stock_val += flt(s.stock_value);
			total_debt += flt(s.current_debt);
			total_purchased += flt(s.total_purchased);
			total_paid += flt(s.total_paid);

			// Contact subtitle
			let contact_str = "";
			if (s.mobile_no) {
				contact_str = `<span>📞 ${s.mobile_no}</span>`;
			} else if (s.email_id) {
				contact_str = `<span>✉️ ${s.email_id}</span>`;
			}

			// Debt badge
			let debt_html = "";
			if (s.current_debt > 0) {
				debt_html = `<span class="debt-pill-owed">${this.format_curr(s.current_debt)}</span>`;
			} else {
				debt_html = `<span class="debt-pill-settled">🟢 ${this.t("settled_badge")}</span>`;
			}

			// Stock at hand badge
			let stock_indicator = "indicator-green";
			if (s.stock_qty <= 0) stock_indicator = "indicator-gray";
			else if (s.stock_qty <= 5) stock_indicator = "indicator-orange";

			const stock_html = `
				<div class="d-flex align-items-center">
					<span class="indicator-pill ${stock_indicator}"></span>
					<span class="font-weight-bold ml-1">${this.format_num(s.stock_qty, s.stock_qty % 1 === 0 ? 0 : 2)}</span>
					<span class="text-muted ml-1" style="font-size: 11px;">${this.t("pcs")}</span>
				</div>
				<div class="text-muted font-weight-bold" style="font-size: 11.5px; margin-top: 2px;">
					${this.format_curr(s.stock_value)}
				</div>
			`;

			// Only Pay button on every row
			const pay_btn = `<button class="btn btn-xs btn-primary btn-quick-pay" data-supplier="${encodeURIComponent(s.name)}" data-debt="${s.current_debt}">💳 ${this.t("btn_pay")}</button>`;

			rows_html += `
				<tr class="supplier-row" data-supplier-name="${encodeURIComponent(s.name)}">
					<td class="col-supplier">
						<div class="supplier-name-title">
							<span>${s.supplier_name || s.name}</span>
						</div>
						${contact_str ? `<div class="supplier-contact-sub">${contact_str}</div>` : ""}
					</td>
					<td class="col-products text-center">
						<div class="font-weight-bold">${s.models_count} <span class="text-muted" style="font-size: 11px;">мод.</span></div>
						<div class="text-muted" style="font-size: 11px;">${s.skus_count} SKU</div>
					</td>
					<td class="col-stock-hand">
						${stock_html}
					</td>
					<td class="col-debt text-right">
						${debt_html}
					</td>
					<td class="col-purchased text-right">
						<span class="text-dark font-weight-bold">${this.format_curr(s.total_purchased)}</span>
						<div class="text-muted" style="font-size: 11px;">${s.invoice_count} накл.</div>
					</td>
					<td class="col-paid text-right">
						<span class="font-weight-bold text-muted">${this.format_curr(s.total_paid)}</span>
					</td>
					<td class="col-actions text-center" onclick="event.stopPropagation();">
						${pay_btn}
					</td>
				</tr>
			`;
		});

		$area.html(`
			<div class="table-responsive supplier-table-wrapper">
				<table class="table table-bordered table-hover supplier-table">
					<thead>
						<tr>
							<th class="col-supplier">${this.t("col_supplier")}</th>
							<th class="col-products text-center" style="width: 100px;">${this.t("col_products")}</th>
							<th class="col-stock-hand" style="width: 170px;">📦 ${this.t("col_stock_at_hand")}</th>
							<th class="col-debt text-right" style="width: 160px;">💳 ${this.t("col_current_debt")}</th>
							<th class="col-purchased text-right" style="width: 150px;">${this.t("col_total_purchased")}</th>
							<th class="col-paid text-right" style="width: 140px;">${this.t("col_total_paid")}</th>
							<th class="col-actions text-center" style="width: 105px;">${this.t("col_actions")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="supplier-totals-row">
							<td class="col-totals-label text-left">
								<strong>${this.t("total_prefix")}: ${total_suppliers} ${this.t("suppliers_suffix")}</strong>
							</td>
							<td class="col-products text-center text-muted">—</td>
							<td class="col-stock-hand">
								<div class="font-weight-bold text-success">${this.format_curr(total_stock_val)}</div>
								<div class="text-muted" style="font-size: 11px;">${this.format_num(total_stock_qty, 0)} ${this.t("pcs")}</div>
							</td>
							<td class="col-debt text-right">
								<div class="font-weight-bold text-danger" style="font-size: 14px;">${this.format_curr(total_debt)}</div>
							</td>
							<td class="col-purchased text-right font-weight-bold">
								${this.format_curr(total_purchased)}
							</td>
							<td class="col-paid text-right font-weight-bold text-muted">
								${this.format_curr(total_paid)}
							</td>
							<td class="col-actions text-center text-muted">—</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);

		// Bind Pay button click
		$area.find(".btn-quick-pay").on("click", (e) => {
			const supp = decodeURIComponent($(e.currentTarget).attr("data-supplier"));
			const debt = flt($(e.currentTarget).attr("data-debt"));
			this.show_quick_payment_dialog(supp, debt);
		});

		// Bind Row click to navigate to Supplier Detail page
		$area.find(".supplier-row").on("click", (e) => {
			const supp = decodeURIComponent($(e.currentTarget).attr("data-supplier-name"));
			frappe.set_route("supplier-detail", supp);
		});
	}

	show_quick_payment_dialog(supplier_name, current_debt) {
		const mops = (this.payment_options && this.payment_options.modes) || [];
		const mop_options = mops.map((m) => m.name);
		const default_mop = mop_options.includes("Cash") ? "Cash" : mop_options[0] || "Cash";

		const d = new frappe.ui.Dialog({
			title: `${this.t("payment_title")}: ${supplier_name}`,
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "debt_summary_html",
					options: `
						<div class="alert alert-warning mb-3" style="display: flex; justify-content: space-between; align-items: center; border-radius: 6px;">
							<div>
								<div style="font-size: 11.5px; text-transform: uppercase; font-weight: 600; opacity: 0.85;">Текущий долг поставщику:</div>
								<div style="font-size: 18px; font-weight: 700; color: #cf222e;">${this.format_curr(current_debt)}</div>
							</div>
							<button type="button" class="btn btn-sm btn-outline-danger font-weight-bold" id="btn-fill-full-debt" style="border-radius: 4px;">
								⚡ ${this.t("btn_pay_all")}
							</button>
						</div>
					`,
				},
				{
					fieldtype: "Currency",
					fieldname: "amount",
					label: "Сумма к оплате (" + this.currency + ")",
					reqd: 1,
					default: current_debt,
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldtype: "Select",
					fieldname: "mode_of_payment",
					label: "Способ оплаты (Откуда)",
					options: mop_options.length ? mop_options : ["Cash", "Credit Card", "Wire Transfer"],
					default: default_mop,
					reqd: 1,
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldtype: "Date",
					fieldname: "posting_date",
					label: "Дата оплаты",
					default: frappe.datetime.get_today(),
					reqd: 1,
				},
				{
					fieldtype: "Column Break",
				},
				{
					fieldtype: "Data",
					fieldname: "reference_no",
					label: "Номер чека / Расписки",
					placeholder: "например, Чек #142",
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldtype: "Small Text",
					fieldname: "remarks",
					label: "Примечание (комментарий)",
					placeholder: "Оплата за поставку товара...",
				},
			],
			primary_action_label: "💳 Подтвердить оплату",
			primary_action: (values) => {
				if (!values.amount || flt(values.amount) <= 0) {
					frappe.msgprint(__("Введите корректную сумму оплаты"));
					return;
				}

				frappe.ui.form.is_saving = true;
				d.get_primary_btn().prop("disabled", true).text("Обработка...");

				frappe.call({
					method: "erpnext.buying.page.supplier_hub.supplier_hub.make_quick_supplier_payment",
					args: {
						supplier: supplier_name,
						amount: values.amount,
						mode_of_payment: values.mode_of_payment,
						posting_date: values.posting_date,
						reference_no: values.reference_no,
						remarks: values.remarks,
					},
					callback: (r) => {
						d.hide();
						if (r.message && r.message.success) {
							frappe.show_alert(
								{
									message: `✅ ${r.message.message}`,
									indicator: "green",
								},
								6
							);
							this.load_data();
						}
					},
					always: () => {
						frappe.ui.form.is_saving = false;
						d.get_primary_btn().prop("disabled", false).text("💳 Подтвердить оплату");
					},
				});
			},
		});

		d.show();

		// Quick fill full debt button
		d.$wrapper.find("#btn-fill-full-debt").on("click", () => {
			d.set_value("amount", current_debt);
		});
	}

	show_new_supplier_dialog() {
		const groups = this.supplier_groups.length ? this.supplier_groups : ["All Supplier Groups"];
		const d = new frappe.ui.Dialog({
			title: this.t("new_supplier_title"),
			fields: [
				{
					fieldtype: "Data",
					fieldname: "supplier_name",
					label: "Название поставщика / Имя",
					reqd: 1,
					placeholder: "например, Nike Dushanbe, ООО Текстиль...",
				},
				{
					fieldtype: "Select",
					fieldname: "supplier_group",
					label: "Группа поставщика",
					options: groups,
					default: groups[0],
					reqd: 1,
				},
				{
					fieldtype: "Section Break",
				},
				{
					fieldtype: "Data",
					fieldname: "mobile_no",
					label: "Номер телефона / Telegram",
					placeholder: "+992 ...",
				},
				{
					fieldtype: "Data",
					fieldname: "email_id",
					label: "Email",
					placeholder: "supplier@gmail.com",
				},
			],
			primary_action_label: "Сохранить",
			primary_action: (values) => {
				frappe.call({
					method: "erpnext.buying.page.supplier_hub.supplier_hub.create_quick_supplier",
					args: values,
					callback: (r) => {
						d.hide();
						if (r.message && r.message.success) {
							frappe.show_alert(
								{
									message: `✅ Поставщик «${r.message.supplier_name}» добавлен`,
									indicator: "green",
								},
								4
							);
							this.load_data();
						}
					},
				});
			},
		});

		d.show();
	}

	show_supplier_detail_modal(supplier_name) {
		const d = new frappe.ui.Dialog({
			title: `📦 ${supplier_name}`,
			size: "large",
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "supplier_detail_html",
				},
			],
		});

		d.show();
		d.fields_dict.supplier_detail_html.$wrapper.html(
			'<div class="text-center py-5"><span class="spinner-border text-primary"></span><div class="mt-2 text-muted">Загрузка данных поставщика...</div></div>'
		);

		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_supplier_details",
			args: { supplier: supplier_name },
			callback: (r) => {
				if (!r.message) return;
				const data = r.message;
				const supp = data.supplier;
				const products = data.products || [];
				const invoices = data.invoices || [];
				const payments = data.payments || [];

				let products_html = "";
				if (products.length === 0) {
					products_html = '<div class="text-center py-4 text-muted">Нет товаров от этого поставщика</div>';
				} else {
					let prod_rows = "";
					products.forEach((p) => {
						const img_html = p.image
							? `<img src="${p.image}" class="supplier-product-thumb" alt="${p.item_name}">`
							: '<div class="supplier-product-thumb d-flex align-items-center justify-content-center bg-light">👕</div>';

						prod_rows += `
							<tr style="cursor: pointer;" onclick="frappe.set_route('product-detail', '${encodeURIComponent(p.item_code)}');">
								<td class="text-center" style="width: 50px;">${img_html}</td>
								<td>
									<div class="font-weight-bold text-dark">${p.item_name}</div>
									<div class="text-muted" style="font-size: 11px;">Код: ${p.custom_short_code || p.item_code} · ${p.item_group}</div>
								</td>
								<td class="text-right">
									<div class="font-weight-bold text-success" style="font-size: 13.5px;">${p.stock_qty} ${p.stock_uom}</div>
								</td>
								<td class="text-right">
									<div class="text-muted" style="font-size: 12px;">${this.format_curr(p.valuation_rate)}</div>
								</td>
								<td class="text-right">
									<div class="font-weight-bold text-dark">${this.format_curr(p.stock_value)}</div>
								</td>
								<td class="text-right">
									<div class="font-weight-bold">${this.format_curr(p.selling_price)}</div>
								</td>
							</tr>
						`;
					});

					products_html = `
						<div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
							<table class="table table-bordered table-sm">
								<thead class="bg-light">
									<tr>
										<th>Фото</th>
										<th>Товар</th>
										<th class="text-right">Остаток</th>
										<th class="text-right">Закупка</th>
										<th class="text-right">Стоимость остатка</th>
										<th class="text-right">Цена продажи</th>
									</tr>
								</thead>
								<tbody>
									${prod_rows}
								</tbody>
							</table>
						</div>
					`;
				}

				let invoices_html = "";
				if (invoices.length === 0) {
					invoices_html = '<div class="text-center py-4 text-muted">Нет накладных</div>';
				} else {
					let inv_rows = "";
					invoices.forEach((inv) => {
						const is_unpaid = inv.outstanding_amount > 0;
						const badge = is_unpaid
							? `<span class="badge badge-danger">Долг: ${this.format_curr(inv.outstanding_amount)}</span>`
							: '<span class="badge badge-success">Оплачено</span>';

						inv_rows += `
							<tr>
								<td>
									<a href="/app/purchase-invoice/${encodeURIComponent(inv.name)}" target="_blank" class="font-weight-bold">${inv.name}</a>
									${inv.bill_no ? `<div class="text-muted" style="font-size: 11px;">Чек/Накладная: ${inv.bill_no}</div>` : ""}
								</td>
								<td class="text-center">${inv.posting_date}</td>
								<td class="text-right font-weight-bold">${this.format_curr(inv.grand_total)}</td>
								<td class="text-right">${this.format_curr(inv.outstanding_amount)}</td>
								<td class="text-center">${badge}</td>
							</tr>
						`;
					});

					invoices_html = `
						<div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
							<table class="table table-bordered table-sm">
								<thead class="bg-light">
									<tr>
										<th>Номер накладной</th>
										<th class="text-center">Дата</th>
										<th class="text-right">Сумма</th>
										<th class="text-right">Остаток долга</th>
										<th class="text-center">Статус</th>
									</tr>
								</thead>
								<tbody>
									${inv_rows}
								</tbody>
							</table>
						</div>
					`;
				}

				let payments_html = "";
				if (payments.length === 0) {
					payments_html = '<div class="text-center py-4 text-muted">Нет оплат</div>';
				} else {
					let pay_rows = "";
					payments.forEach((p) => {
						pay_rows += `
							<tr>
								<td>
									<a href="/app/payment-entry/${encodeURIComponent(p.name)}" target="_blank" class="font-weight-bold">${p.name}</a>
								</td>
								<td class="text-center">${p.posting_date}</td>
								<td class="text-right font-weight-bold text-success">${this.format_curr(p.paid_amount)}</td>
								<td class="text-center"><span class="badge badge-light">${p.mode_of_payment}</span></td>
								<td class="text-center text-muted">${p.reference_no || "—"}</td>
							</tr>
						`;
					});

					payments_html = `
						<div class="table-responsive" style="max-height: 400px; overflow-y: auto;">
							<table class="table table-bordered table-sm">
								<thead class="bg-light">
									<tr>
										<th>Номер платежа</th>
										<th class="text-center">Дата</th>
										<th class="text-right">Выплачено</th>
										<th class="text-center">Способ</th>
										<th class="text-center">Чек / Рассписка</th>
									</tr>
								</thead>
								<tbody>
									${pay_rows}
								</tbody>
							</table>
						</div>
					`;
				}

				d.fields_dict.supplier_detail_html.$wrapper.html(`
					<div class="supplier-modal-content">
						<!-- Subheader Tabs -->
						<div class="supplier-modal-tabs">
							<div class="supplier-modal-tab active" data-tab="tab-products">📦 Товары (${products.length})</div>
							<div class="supplier-modal-tab" data-tab="tab-invoices">🧾 Накладные (${invoices.length})</div>
							<div class="supplier-modal-tab" data-tab="tab-payments">📜 Оплаты (${payments.length})</div>
						</div>

						<div id="tab-products" class="tab-pane active">
							${products_html}
						</div>
						<div id="tab-invoices" class="tab-pane" style="display: none;">
							${invoices_html}
						</div>
						<div id="tab-payments" class="tab-pane" style="display: none;">
							${payments_html}
						</div>
					</div>
				`);

				// Tab switching
				d.$wrapper.find(".supplier-modal-tab").on("click", (e) => {
					const target = $(e.currentTarget).attr("data-tab");
					d.$wrapper.find(".supplier-modal-tab").removeClass("active");
					$(e.currentTarget).addClass("active");
					d.$wrapper.find(".tab-pane").hide();
					d.$wrapper.find(`#${target}`).show();
				});
			},
		});
	}
}
