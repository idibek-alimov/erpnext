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
		is_tg ? __("Хароҷотҳо") : __("Расходы"),
		() => {
			frappe.set_route("expense-desk");
		}
	);

	page.add_inner_button(
		is_tg ? __("Хаби кормандон") : __("Сотрудники"),
		() => {
			frappe.set_route("staff-hub");
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

				<!-- ERP Standard Filter Toolbar for Suppliers -->
				<div class="sd-filter-toolbar">
					<div class="sd-filter-group" style="flex: 1; min-width: 220px;">
						<input type="text" id="supplier-filter-search" class="sd-filter-input" style="width: 100%;" placeholder="🔍 ${this.t("search_placeholder")}">
					</div>

					<div class="sd-filter-group">
						<label class="sd-filter-label">Группа:</label>
						<select id="supplier-filter-group" class="sd-filter-input">
							<option value="all">${this.t("all_groups")}</option>
						</select>
					</div>

					<div class="sd-filter-group">
						<label class="sd-filter-label">Долг:</label>
						<select id="supplier-filter-debt" class="sd-filter-input">
							<option value="all">${this.t("filter_all")}</option>
							<option value="with_debt">${this.t("filter_with_debt")}</option>
							<option value="settled">${this.t("filter_settled")}</option>
						</select>
					</div>

					<div class="sd-filter-group">
						<label class="sd-filter-label">Товар:</label>
						<select id="supplier-filter-stock-op" class="sd-filter-input" style="width: 145px;">
							<option value="all">Все остатки</option>
							<option value="gte">≥ (Остаток на складе)</option>
							<option value="lte">≤ (Меньше или равно)</option>
							<option value="zero">= 0 (Нет на складе)</option>
						</select>
						<input type="number" id="supplier-filter-stock-qty" class="sd-filter-input" style="width: 70px; display: none;" value="5" min="0" step="1">
					</div>

					<div class="sd-filter-group">
						<label class="sd-filter-label">Сортировка:</label>
						<select id="supplier-sort-filter" class="sd-filter-input">
							<option value="debt_desc">${this.t("sort_debt_desc")}</option>
							<option value="stock_val_desc">${this.t("sort_stock_val_desc")}</option>
							<option value="purchased_desc">${this.t("sort_purchased_desc")}</option>
							<option value="name_asc">${this.t("sort_name_asc")}</option>
						</select>
					</div>

					<button type="button" class="btn btn-xs btn-default font-weight-bold" id="supplier-filter-reset" title="Сбросить все фильтры" style="height: 32px; padding: 0 10px;">
						✕ Сбросить
					</button>
				</div>

				<!-- Dynamic Live Calculation Strip -->
				<div class="sd-filter-summary" id="supplier-filter-summary">
					<div class="sd-filter-stat">Поставщиков показано: <b id="hub-flt-count">0</b></div>
					<div class="sd-filter-stat">С долгом: <b class="text-danger" id="hub-flt-debt-count">0</b></div>
					<div class="sd-filter-stat">Общий долг: <b class="text-danger font-weight-bold" id="hub-flt-debt">0.00 ${this.currency}</b></div>
					<div class="sd-filter-stat">Остаток товаров: <b id="hub-flt-qty">0</b> шт (<b class="text-success" id="hub-flt-val">0.00 ${this.currency}</b>)</div>
				</div>

				<!-- Main Supplier Table with Sticky Totals Footer -->
				<div id="supplier-content-area" class="supplier-table-container">
					<div class="text-center py-5"><span class="spinner-border text-primary"></span></div>
				</div>
			</div>
		`);
	}

	bind_events() {
		this.wrapper.find("#supplier-filter-search, #supplier-filter-stock-qty").on("input", () => this.filter_suppliers());
		this.wrapper.find("#supplier-filter-group, #supplier-filter-debt, #supplier-filter-stock-op").on("change", () => this.filter_suppliers());

		this.wrapper.find("#supplier-sort-filter").on("change", (e) => {
			this.sort_by = e.target.value;
			this.sort_and_render();
		});

		this.wrapper.find("#supplier-filter-reset").on("click", () => {
			this.wrapper.find("#supplier-filter-search").val("");
			this.wrapper.find("#supplier-filter-group").val("all");
			this.wrapper.find("#supplier-filter-debt").val("all");
			this.wrapper.find("#supplier-filter-stock-op").val("all");
			this.wrapper.find("#supplier-filter-stock-qty").val("5").hide();
			this.wrapper.find("#supplier-sort-filter").val("debt_desc");
			this.sort_by = "debt_desc";
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
			callback: (r) => {
				if (r.message) {
					this.suppliers_data = r.message.suppliers || [];
					this.summary_data = r.message.summary || {};
					this.currency = r.message.currency || "TJS";
					this.supplier_groups = r.message.supplier_groups || [];
					this.populate_groups_filter();
					this.update_kpi_cards();
					this.sort_and_render();
				}
			},
		});
	}

	populate_groups_filter() {
		const groups = this.supplier_groups || [];
		let opts = `<option value="all">${this.t("all_groups")}</option>`;
		groups.forEach((g) => {
			opts += `<option value="${frappe.utils.escape_html(g)}">${frappe.utils.escape_html(g)}</option>`;
		});
		this.wrapper.find("#supplier-filter-group").html(opts);
	}

	filter_suppliers() {
		const q = (this.wrapper.find("#supplier-filter-search").val() || "").trim().toLowerCase();
		const group = this.wrapper.find("#supplier-filter-group").val() || "all";
		const debt_filter = this.wrapper.find("#supplier-filter-debt").val() || "all";
		const stock_op = this.wrapper.find("#supplier-filter-stock-op").val() || "all";
		const target_qty = flt(this.wrapper.find("#supplier-filter-stock-qty").val() || 0);

		if (stock_op === "all" || stock_op === "zero") {
			this.wrapper.find("#supplier-filter-stock-qty").hide();
		} else {
			this.wrapper.find("#supplier-filter-stock-qty").show();
		}

		let matched_count = 0;
		let matched_debt_count = 0;
		let matched_stock_qty = 0;
		let matched_stock_val = 0;
		let matched_debt = 0;
		let matched_purchased = 0;
		let matched_paid = 0;

		this.wrapper.find(".hub-supplier-row").each((_, el) => {
			const $row = $(el);
			const name = $row.attr("data-name") || "";
			const title = $row.attr("data-title") || "";
			const grp = $row.attr("data-group") || "";
			const phone = $row.attr("data-phone") || "";
			const email = $row.attr("data-email") || "";
			const debt = flt($row.attr("data-debt"));
			const qty = flt($row.attr("data-stock-qty"));
			const val = flt($row.attr("data-stock-val"));
			const purchased = flt($row.attr("data-purchased"));
			const paid = flt($row.attr("data-paid"));

			let match = true;

			if (q && !name.includes(q) && !title.includes(q) && !phone.includes(q) && !email.includes(q)) {
				match = false;
			}

			if (match && group !== "all" && grp !== group) {
				match = false;
			}

			if (match) {
				if (debt_filter === "with_debt" && debt <= 0) {
					match = false;
				} else if (debt_filter === "settled" && debt > 0) {
					match = false;
				}
			}

			if (match) {
				if (stock_op === "gte" && qty < target_qty) {
					match = false;
				} else if (stock_op === "lte" && qty > target_qty) {
					match = false;
				} else if (stock_op === "zero" && qty > 0) {
					match = false;
				}
			}

			if (match) {
				$row.show();
				matched_count += 1;
				if (debt > 0) matched_debt_count += 1;
				matched_stock_qty += qty;
				matched_stock_val += val;
				matched_debt += debt;
				matched_purchased += purchased;
				matched_paid += paid;
			} else {
				$row.hide();
			}
		});

		this.wrapper.find("#hub-flt-count").text(matched_count);
		this.wrapper.find("#hub-flt-debt-count").text(matched_debt_count);
		this.wrapper.find("#hub-flt-debt").text(this.format_curr(matched_debt));
		this.wrapper.find("#hub-flt-qty").text(this.format_num(matched_stock_qty, 0));
		this.wrapper.find("#hub-flt-val").text(this.format_curr(matched_stock_val));

		this.wrapper.find("#hub-foot-count").text(matched_count);
		this.wrapper.find("#hub-foot-qty").text(this.format_num(matched_stock_qty, 0));
		this.wrapper.find("#hub-foot-val").text(this.format_curr(matched_stock_val));
		this.wrapper.find("#hub-foot-debt").text(this.format_curr(matched_debt));
		this.wrapper.find("#hub-foot-purchased").text(this.format_curr(matched_purchased));
		this.wrapper.find("#hub-foot-paid").text(this.format_curr(matched_paid));

		if (matched_count === 0) {
			this.wrapper.find(".hub-suppliers-no-match").show();
		} else {
			this.wrapper.find(".hub-suppliers-no-match").hide();
		}
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

			rows_html += `
				<tr class="supplier-row hub-supplier-row" 
					data-supplier-name="${encodeURIComponent(s.name)}"
					data-name="${frappe.utils.escape_html((s.name || "").toLowerCase())}"
					data-title="${frappe.utils.escape_html((s.supplier_name || "").toLowerCase())}"
					data-group="${frappe.utils.escape_html(s.supplier_group || "")}"
					data-phone="${frappe.utils.escape_html((s.mobile_no || "").toLowerCase())}"
					data-email="${frappe.utils.escape_html((s.email_id || "").toLowerCase())}"
					data-debt="${flt(s.current_debt)}"
					data-stock-qty="${flt(s.stock_qty)}"
					data-stock-val="${flt(s.stock_value)}"
					data-purchased="${flt(s.total_purchased)}"
					data-paid="${flt(s.total_paid)}">
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
				</tr>
			`;
		});

		$area.html(`
			<div class="table-responsive supplier-table-wrapper">
				<table class="table table-bordered table-hover supplier-table">
					<thead>
						<tr>
							<th class="col-supplier">${this.t("col_supplier")}</th>
							<th class="col-products text-center" style="width: 110px;">${this.t("col_products")}</th>
							<th class="col-stock-hand" style="width: 180px;">📦 ${this.t("col_stock_at_hand")}</th>
							<th class="col-debt text-right" style="width: 170px;">💳 ${this.t("col_current_debt")}</th>
							<th class="col-purchased text-right" style="width: 160px;">${this.t("col_total_purchased")}</th>
							<th class="col-paid text-right" style="width: 150px;">${this.t("col_total_paid")}</th>
						</tr>
					</thead>
					<tbody id="hub-suppliers-tbody">
						${rows_html}
						<tr class="hub-suppliers-no-match text-center py-4" style="display: none;">
							<td colspan="6" class="text-muted py-4">
								<div style="font-size: 24px; margin-bottom: 4px;">🔍</div>
								<div>Нет поставщиков, соответствующих выбранным фильтрам</div>
							</td>
						</tr>
					</tbody>
					<tfoot>
						<tr class="supplier-totals-row">
							<td class="col-totals-label text-left">
								<strong>${this.t("total_prefix")}: <span id="hub-foot-count">${total_suppliers}</span> ${this.t("suppliers_suffix")}</strong>
							</td>
							<td class="col-products text-center text-muted">—</td>
							<td class="col-stock-hand">
								<div class="font-weight-bold text-success" id="hub-foot-val">${this.format_curr(total_stock_val)}</div>
								<div class="text-muted" style="font-size: 11px;"><span id="hub-foot-qty">${this.format_num(total_stock_qty, 0)}</span> ${this.t("pcs")}</div>
							</td>
							<td class="col-debt text-right">
								<div class="font-weight-bold text-danger" style="font-size: 14px;" id="hub-foot-debt">${this.format_curr(total_debt)}</div>
							</td>
							<td class="col-purchased text-right font-weight-bold" id="hub-foot-purchased">
								${this.format_curr(total_purchased)}
							</td>
							<td class="col-paid text-right font-weight-bold text-muted" id="hub-foot-paid">
								${this.format_curr(total_paid)}
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);

		// Bind Row click to navigate to Supplier Detail page
		$area.find(".supplier-row").on("click", (e) => {
			const supp = decodeURIComponent($(e.currentTarget).attr("data-supplier-name"));
			frappe.set_route("supplier-detail", supp);
		});

		this.filter_suppliers();
	}

	show_quick_payment_dialog(supplier_name, current_debt) {
		frappe.call({
			method: "erpnext.buying.page.supplier_hub.supplier_hub.get_payment_options",
			callback: (r_opts) => {
				const opts = r_opts.message || this.payment_options || {};
				this.payment_options = opts;

				frappe.call({
					method: "erpnext.buying.page.supplier_hub.supplier_hub.get_unpaid_invoices",
					args: { supplier: supplier_name },
					callback: (r_inv) => {
						const unpaid_invoices = r_inv.message || [];
						if (unpaid_invoices.length === 0) {
							frappe.msgprint(__("У поставщика нет неоплаченных накладных"));
							return;
						}

						let current_inv = unpaid_invoices[0];
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

						const render_banner_html = (inv) => `
							<div class="pay-debt-banner">
								<div class="pay-debt-banner-left">
									<div class="pay-debt-banner-label">
										Остаток долга по накладной <b style="color: #431407;">${frappe.utils.escape_html(inv.name)}</b>:
									</div>
									<div class="pay-debt-banner-amount" id="hub-inv-debt-val">
										${this.format_curr(inv.outstanding_amount)}
									</div>
									${inv.bill_no ? `<div class="pay-debt-banner-sub">Чек / Накладная поставщика: <b>${frappe.utils.escape_html(inv.bill_no)}</b> (${inv.posting_date})</div>` : ""}
								</div>
								<button type="button" class="pay-btn-full-debt" id="hub-btn-fill-full">
									⚡ Оплатить всю сумму
								</button>
							</div>
						`;

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
								<div class="sd-wallet-status-box" id="hub-wallet-status-indicator"></div>
							`;
						};

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
							fieldname: "debt_summary_html",
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
								label: "Сумма к оплате (" + this.currency + ")",
								description: `Максимально к оплате: ${this.format_curr(current_inv.outstanding_amount)}`,
								reqd: 1,
								default: current_inv.outstanding_amount,
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
							title: `${this.t("payment_title")}: ${frappe.utils.escape_html(supplier_name)}`,
							size: "large",
							fields: fields,
							primary_action_label: "💳 Подтвердить оплату",
							primary_action: (values) => {
								const pay_amount = flt(values.amount);
								if (!pay_amount || pay_amount <= 0) {
									frappe.msgprint(__("Введите корректную сумму оплаты"));
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

								frappe.ui.form.is_saving = true;
								d.get_primary_btn().prop("disabled", true).text("Обработка...");

								const sel_wallet_doc = wallets.find((w) => w.name === selected_wallet);

								frappe.call({
									method: "erpnext.buying.page.supplier_hub.supplier_hub.make_quick_supplier_payment",
									args: {
										supplier: supplier_name,
										purchase_invoice: current_inv.name,
										amount: pay_amount,
										wallet: selected_wallet,
										mode_of_payment: sel_wallet_doc ? (sel_wallet_doc.mode_of_payment || null) : values.mode_of_payment,
										posting_date: values.posting_date,
										reference_no: "",
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
												7
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

						const update_status = () => {
							const sel_w = wallets.find((w) => w.name === selected_wallet);
							const cur_amount = flt(d.get_value("amount"));
							const $box = d.$wrapper.find("#hub-wallet-status-indicator");
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
							d.$wrapper.find("#hub-btn-fill-full").off("click").on("click", () => {
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
									d.fields_dict.debt_summary_html.$wrapper.html(render_banner_html(current_inv));
									d.set_df_property("amount", "description", `Максимально к оплате: ${this.format_curr(current_inv.outstanding_amount)}`);
									d.set_value("amount", current_inv.outstanding_amount);
									bind_banner_btn();
									update_status();
								}
							});
						}
					},
				});
			},
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
