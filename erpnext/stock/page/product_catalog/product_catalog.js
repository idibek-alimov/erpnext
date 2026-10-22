// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["product-catalog"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Каталоги молҳо") : __("Каталог товаров"),
		single_column: true,
	});

	page.set_primary_action(
		is_tg ? __("+ Моли нав") : __("+ Новый товар"),
		() => {
			frappe.new_doc("Quick Product Intake");
		},
		"add"
	);

	page.add_inner_button(
		is_tg ? __("Навсозӣ") : __("Обновить"),
		() => {
			if (wrapper.product_catalog_app) {
				wrapper.product_catalog_app.load_catalog();
			}
		}
	);

	wrapper.product_catalog_app = new ProductCatalogApp(page);
};

class ProductCatalogApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body);
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.search_query = "";
		this.selected_category = "All";
		this.status_filter = "all";
		this.sort_by = "modified";
		this.catalog_data = [];
		this.categories = [];
		this.currency = "TJS";

		this.init();
	}

	init() {
		this.setup_ui();
		this.bind_events();
		this.load_catalog();
	}

	t(key) {
		const dict = {
			search_placeholder: {
				tg: "Ҷустуҷӯ бо ном, код (1001), штрихкод...",
				ru: "Поиск по названию, коду (1001), штрихкоду...",
			},
			new_product: { tg: "+ Моли нав", ru: "+ Новый товар" },
			all_categories: { tg: "Ҳамаи гурӯҳҳо", ru: "Все категории" },
			filter_all: { tg: "Ҳамаи ҳолатҳо", ru: "Все статусы" },
			filter_in_stock: { tg: "Дар анбор", ru: "В наличии" },
			filter_low_stock: { tg: "Кам монд (≤5)", ru: "Мало (≤5)" },
			filter_out_of_stock: { tg: "Тамом шуд (0)", ru: "Нет в наличии (0)" },
			filter_on_sale: { tg: "Бо тахфиф", ru: "Со скидкой" },
			sort_recent: { tg: "Охирин иловашуда", ru: "Сначала новые" },
			sort_stock_desc: { tg: "Аз рӯи бақия (камшавӣ)", ru: "По остатку (убыв.)" },
			sort_stock_val_desc: { tg: "Аз рӯи маблағи бақия (камшавӣ)", ru: "По сумме остатка (убыв.)" },
			sort_sold_desc: { tg: "Аз рӯи фурӯш (камшавӣ)", ru: "По продажам (убыв.)" },
			sort_name_asc: { tg: "Аз рӯи ном (А-Я)", ru: "По названию (А-Я)" },
			col_photo: { tg: "Сурат", ru: "Фото" },
			col_code: { tg: "Код", ru: "Код" },
			col_product: { tg: "Номи мол", ru: "Наименование товара" },
			col_category: { tg: "Гурӯҳ", ru: "Категория" },
			col_stock: { tg: "Бақия", ru: "Остаток" },
			col_cost_price: { tg: "Себестоимость", ru: "Себестоимость" },
			col_stock_value: { tg: "Маблағи бақия", ru: "Стоимость остатка" },
			col_retail_price: { tg: "Нархи фурӯш", ru: "Цена продажи" },
			col_sold_30d: { tg: "Фурӯхта шуд (30р)", ru: "Продано (30д)" },
			col_sold_amount: { tg: "Выручка (30р)", ru: "Выручка (30д)" },
			total_prefix: { tg: "Ҳамагӣ", ru: "Итого" },
			items_suffix: { tg: "мол", ru: "позиций" },
			from: { tg: "аз", ru: "от" },
			pcs: { tg: "дона", ru: "шт" },
			sizes: { tg: "андоза", ru: "размеров" },
			empty_title: { tg: "Ҳеҷ мол ёфт нашуд", ru: "Товары не найдены" },
			empty_desc: {
				tg: "Филтрҳоро тағйир диҳед ё тугмаи '+ Моли нав'-ро пахш намоед.",
				ru: "Измените параметры фильтра или нажмите '+ Новый товар'.",
			},
		};
		return (dict[key] && dict[key][this.lang]) || key;
	}

	setup_ui() {
		this.wrapper.html(`
			<div class="retail-catalog-layout">
				<!-- Standard ERPNext Filter Bar -->
				<div class="retail-filter-bar">
					<div class="filter-col search-input-col">
						<div class="frappe-search-box">
							<span class="frappe-search-icon">
								<svg class="icon icon-sm" aria-hidden="true"><use href="#icon-search"></use></svg>
							</span>
							<input type="text" id="catalog-search" class="form-control form-control-sm" placeholder="${this.t("search_placeholder")}">
						</div>
					</div>

					<div class="filter-col select-group-col">
						<select id="catalog-category-filter" class="form-control form-control-sm filter-select">
							<option value="All">${this.t("all_categories")}</option>
						</select>

						<select id="catalog-status-filter" class="form-control form-control-sm filter-select">
							<option value="all">${this.t("filter_all")}</option>
							<option value="in_stock">🟢 ${this.t("filter_in_stock")}</option>
							<option value="low_stock">🟠 ${this.t("filter_low_stock")}</option>
							<option value="out_of_stock">🔴 ${this.t("filter_out_of_stock")}</option>
							<option value="on_sale">🏷️ ${this.t("filter_on_sale")}</option>
						</select>

						<select id="catalog-sort-filter" class="form-control form-control-sm filter-select">
							<option value="modified">${this.t("sort_recent")}</option>
							<option value="stock_desc">${this.t("sort_stock_desc")}</option>
							<option value="stock_val_desc">${this.t("sort_stock_val_desc")}</option>
							<option value="sold_desc">${this.t("sort_sold_desc")}</option>
							<option value="name_asc">${this.t("sort_name_asc")}</option>
						</select>
					</div>
				</div>

				<!-- Main Product Table with Sticky Totals Footer -->
				<div id="catalog-content-area" class="retail-table-container">
					<div class="text-center py-5"><span class="spinner-border text-primary"></span></div>
				</div>
			</div>
		`);
	}

	bind_events() {
		let timeout = null;
		this.wrapper.find("#catalog-search").on("input", (e) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => {
				this.search_query = e.target.value.trim();
				this.load_catalog();
			}, 300);
		});

		this.wrapper.find("#catalog-category-filter").on("change", (e) => {
			this.selected_category = e.target.value;
			this.load_catalog();
		});

		this.wrapper.find("#catalog-status-filter").on("change", (e) => {
			this.status_filter = e.target.value;
			this.load_catalog();
		});

		this.wrapper.find("#catalog-sort-filter").on("change", (e) => {
			this.sort_by = e.target.value;
			this.sort_and_render();
		});
	}

	load_catalog() {
		frappe.call({
			method: "erpnext.stock.page.product_catalog.product_catalog.get_catalog",
			args: {
				search: this.search_query,
				item_group: this.selected_category,
				status_filter: this.status_filter,
				page_size: 300,
			},
			callback: (r) => {
				if (r.message) {
					this.catalog_data = r.message.items || [];
					this.categories = r.message.categories || [];
					this.currency = r.message.currency || "TJS";
					this.update_categories_dropdown();
					this.sort_and_render();
				}
			},
		});
	}

	update_categories_dropdown() {
		const $select = this.wrapper.find("#catalog-category-filter");
		const current = this.selected_category;
		let options = `<option value="All">${this.t("all_categories")}</option>`;
		this.categories.forEach((cat) => {
			options += `<option value="${cat}" ${cat === current ? "selected" : ""}>${cat}</option>`;
		});
		$select.html(options);
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
		if (this.sort_by === "stock_desc") {
			this.catalog_data.sort((a, b) => b.stock_qty - a.stock_qty);
		} else if (this.sort_by === "stock_val_desc") {
			this.catalog_data.sort((a, b) => b.stock_value_cost - a.stock_value_cost);
		} else if (this.sort_by === "sold_desc") {
			this.catalog_data.sort((a, b) => b.sold_qty - a.sold_qty);
		} else if (this.sort_by === "name_asc") {
			this.catalog_data.sort((a, b) => a.item_name.localeCompare(b.item_name));
		}
		this.render_catalog_items();
	}

	render_catalog_items() {
		const $area = this.wrapper.find("#catalog-content-area");

		if (!this.catalog_data || this.catalog_data.length === 0) {
			$area.html(`
				<div class="empty-state text-center py-5">
					<div class="empty-state-icon" style="font-size: 40px; margin-bottom: 12px; color: var(--text-muted);">📦</div>
					<h5 style="color: var(--text-color); font-weight: 600;">${this.t("empty_title")}</h5>
					<p class="text-muted" style="font-size: 13px;">${this.t("empty_desc")}</p>
				</div>
			`);
			return;
		}

		let total_items = this.catalog_data.length;
		let total_stock = 0;
		let total_stock_cost = 0;
		let total_sold = 0;
		let total_revenue = 0;

		let rows_html = "";
		this.catalog_data.forEach((p, idx) => {
			total_stock += flt(p.stock_qty);
			total_stock_cost += flt(p.stock_value_cost);
			total_sold += flt(p.sold_qty);
			total_revenue += flt(p.sold_amount);

			const status_label = this.lang === "tg" ? p.status_label_tg : p.status_label_ru;
			const promo_badge = p.discount_percentage > 0
				? `<span class="badge badge-warning retail-promo-pill">-${p.discount_percentage}%</span>`
				: "";

			const variant_pill = p.has_variants
				? `<span class="retail-variant-pill">${p.variant_count} ${this.t("sizes")}</span>`
				: "";

			const short_code = p.custom_short_code
				? `<span class="retail-code-badge">${p.custom_short_code}</span>`
				: `<span class="text-muted" style="font-size: 12px;">#${idx + 1}</span>`;

			const image_html = p.image
				? `<img src="${p.image}" class="retail-thumb-img" alt="${p.item_name}">`
				: `<div class="retail-thumb-placeholder">👕</div>`;

			let indicator_cls = "indicator-green";
			if (p.status === "out_of_stock") indicator_cls = "indicator-red";
			else if (p.status === "low_stock") indicator_cls = "indicator-orange";

			const prefix_from = p.price_varies ? `<span class="text-muted" style="font-size: 11px;">${this.t("from")} </span>` : "";

			rows_html += `
				<tr class="retail-table-row" data-item-code="${p.item_code}">
					<td class="col-thumb text-center">${image_html}</td>
					<td class="col-code text-center">${short_code}</td>
					<td class="col-name">
						<div class="product-title-row">
							<span class="product-name font-weight-bold" title="${p.item_name}">${p.item_name}</span>
							${variant_pill}
						</div>
					</td>
					<td class="col-category">
						<span class="retail-category-tag">${p.item_group}</span>
					</td>
					<td class="col-stock">
						<div class="d-flex align-items-center">
							<span class="indicator-pill ${indicator_cls}"></span>
							<span class="font-weight-bold ml-1">${this.format_num(p.stock_qty, p.stock_qty % 1 === 0 ? 0 : 2)}</span>
							<span class="text-muted ml-1" style="font-size: 11px;">${p.stock_uom === "Nos" ? this.t("pcs") : p.stock_uom}</span>
						</div>
						<div class="status-subtext text-muted" style="font-size: 11px;">${status_label}</div>
					</td>
					<td class="col-cost text-right">
						<span class="text-muted">${this.format_curr(p.buying_price)}</span>
					</td>
					<td class="col-cost-val text-right">
						<span class="font-weight-bold text-dark">${this.format_curr(p.stock_value_cost)}</span>
					</td>
					<td class="col-retail text-right">
						<div>${prefix_from}<span class="font-weight-bold">${this.format_curr(p.discounted_price)}</span></div>
						${promo_badge}
					</td>
					<td class="col-sold text-center">
						<span class="font-weight-bold">${this.format_num(p.sold_qty, p.sold_qty % 1 === 0 ? 0 : 2)}</span>
					</td>
					<td class="col-revenue text-right">
						<span class="text-dark font-weight-bold">${this.format_curr(p.sold_amount)}</span>
					</td>
				</tr>
			`;
		});

		$area.html(`
			<div class="table-responsive retail-table-wrapper">
				<table class="table table-bordered table-hover retail-catalog-table">
					<thead>
						<tr>
							<th class="col-thumb text-center" style="width: 50px;">${this.t("col_photo")}</th>
							<th class="col-code text-center" style="width: 75px;">${this.t("col_code")}</th>
							<th class="col-name">${this.t("col_product")}</th>
							<th class="col-category" style="width: 140px;">${this.t("col_category")}</th>
							<th class="col-stock" style="width: 140px;">${this.t("col_stock")}</th>
							<th class="col-cost text-right" style="width: 130px;">${this.t("col_cost_price")}</th>
							<th class="col-cost-val text-right" style="width: 160px;">${this.t("col_stock_value")}</th>
							<th class="col-retail text-right" style="width: 140px;">${this.t("col_retail_price")}</th>
							<th class="col-sold text-center" style="width: 120px;">${this.t("col_sold_30d")}</th>
							<th class="col-revenue text-right" style="width: 150px;">${this.t("col_sold_amount")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="retail-totals-row">
							<td colspan="3" class="col-totals-label text-left">
								<strong>${this.t("total_prefix")}: ${total_items} ${this.t("items_suffix")}</strong>
							</td>
							<td class="col-category text-center text-muted">—</td>
							<td class="col-stock">
								<span class="font-weight-bold">${this.format_num(total_stock, total_stock % 1 === 0 ? 0 : 2)}</span>
								<span class="text-muted ml-1" style="font-size: 11px;">${this.t("pcs")}</span>
							</td>
							<td class="col-cost text-center text-muted">—</td>
							<td class="col-cost-val text-right">
								<span class="font-weight-bold text-success" style="font-size: 13.5px;">${this.format_curr(total_stock_cost)}</span>
							</td>
							<td class="col-retail text-center text-muted">—</td>
							<td class="col-sold text-center">
								<span class="font-weight-bold">${this.format_num(total_sold, total_sold % 1 === 0 ? 0 : 2)}</span>
							</td>
							<td class="col-revenue text-right">
								<span class="font-weight-bold text-primary" style="font-size: 13.5px;">${this.format_curr(total_revenue)}</span>
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);

		// Clicking row opens product detail
		$area.find(".retail-table-row").on("click", (e) => {
			const item_code = $(e.currentTarget).attr("data-item-code");
			frappe.set_route("product-detail", item_code);
		});
	}
}
