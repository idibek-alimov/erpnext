// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["product-catalog"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Каталоги молҳо (Каталог товаров)"),
		single_column: true,
	});

	new ProductCatalogApp(page);
};

class ProductCatalogApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(this.page.body);
		this.view_mode = "card"; // Default: card view
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.search_query = "";
		this.selected_category = "All";
		this.status_filter = "all";

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
				tg: "Ҷустуҷӯ бо штрихкод, код (1001) ё номи мол...",
				ru: "Поиск по штрихкоду, коду (1001) или названию...",
			},
			new_product: { tg: "+ Моли нав", ru: "+ Новый товар" },
			all_categories: { tg: "Ҳамаи гурӯҳҳо", ru: "Все категории" },
			filter_all: { tg: "Ҳамаи ҳолатҳо", ru: "Все статусы" },
			filter_in_stock: { tg: "Дар анбор", ru: "В наличии" },
			filter_low_stock: { tg: "Кам монд (≤5)", ru: "Мало (≤5)" },
			filter_out_of_stock: { tg: "Тамом шуд (0)", ru: "Нет в наличии (0)" },
			card_view: { tg: "Кортҳо", ru: "Карточки" },
			table_view: { tg: "Ҷадвал", ru: "Таблица" },
			retail_price: { tg: "Нархи фурӯш", ru: "Цена продажи" },
			cost_price: { tg: "Нархи харид", ru: "Цена закупки" },
			stock: { tg: "Бақияи анбор", ru: "Остаток на складе" },
			sold_30d: { tg: "Фурӯхта шуд (30 рӯз)", ru: "Продано (30 дн)" },
			receive_btn: { tg: "📥 Қабули мол", ru: "📥 Приёмка товара" },
			edit_btn: { tg: "👁 Кушодан", ru: "👁 Открыть" },
			from: { tg: "аз", ru: "от" },
		};
		return (dict[key] && dict[key][this.lang]) || key;
	}

	setup_ui() {
		this.wrapper.html(`
			<div class="product-catalog-container">
				<div class="catalog-toolbar">
					<div class="catalog-search-box">
						<span class="search-icon">🔍</span>
						<input type="text" id="catalog-search" placeholder="${this.t("search_placeholder")}">
					</div>

					<div class="catalog-filters">
						<select id="catalog-category-filter" class="catalog-select">
							<option value="All">${this.t("all_categories")}</option>
						</select>

						<select id="catalog-status-filter" class="catalog-select">
							<option value="all">${this.t("filter_all")}</option>
							<option value="in_stock">${this.t("filter_in_stock")}</option>
							<option value="low_stock">${this.t("filter_low_stock")}</option>
							<option value="out_of_stock">${this.t("filter_out_of_stock")}</option>
						</select>

						<div class="catalog-btn-toggle">
							<button type="button" id="toggle-card-view" class="${this.view_mode === "card" ? "active" : ""}">🗂️ ${this.t("card_view")}</button>
							<button type="button" id="toggle-table-view" class="${this.view_mode === "table" ? "active" : ""}">📊 ${this.t("table_view")}</button>
						</div>

						<select id="catalog-lang-toggle" class="catalog-select" style="font-weight: 700;">
							<option value="tg" ${this.lang === "tg" ? "selected" : ""}>🇹🇯 Тоҷикӣ</option>
							<option value="ru" ${this.lang === "ru" ? "selected" : ""}>🇷🇺 Русский</option>
						</select>

						<button type="button" id="btn-create-product" class="btn-new-product">
							${this.t("new_product")}
						</button>
					</div>
				</div>

				<div id="catalog-content-area">
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

		this.wrapper.find("#toggle-card-view").on("click", () => {
			this.view_mode = "card";
			this.wrapper.find("#toggle-card-view").addClass("active");
			this.wrapper.find("#toggle-table-view").removeClass("active");
			this.render_catalog_items();
		});

		this.wrapper.find("#toggle-table-view").on("click", () => {
			this.view_mode = "table";
			this.wrapper.find("#toggle-table-view").addClass("active");
			this.wrapper.find("#toggle-card-view").removeClass("active");
			this.render_catalog_items();
		});

		this.wrapper.find("#catalog-lang-toggle").on("change", (e) => {
			this.lang = e.target.value;
			this.setup_ui();
			this.bind_events();
			this.load_catalog();
		});

		this.wrapper.find("#btn-create-product").on("click", () => {
			frappe.new_doc("Quick Product Intake");
		});
	}

	load_catalog() {
		frappe.call({
			method: "erpnext.stock.page.product_catalog.product_catalog.get_catalog",
			args: {
				search: this.search_query,
				item_group: this.selected_category,
				status_filter: this.status_filter,
			},
			callback: (r) => {
				if (r.message) {
					this.catalog_data = r.message.items || [];
					this.categories = r.message.categories || [];
					this.currency = r.message.currency || "TJS";
					this.update_categories_dropdown();
					this.render_catalog_items();
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

	price_html(p) {
		const prefix = p.price_varies ? `<span class="price-from">${this.t("from")}</span> ` : "";
		return `${prefix}${p.discounted_price} ${p.currency}`;
	}

	action_buttons(p) {
		return `
			<div class="card-actions">
				<button type="button" class="btn-card-restock" data-action="restock" data-item-code="${p.item_code}">${this.t("receive_btn")}</button>
				<button type="button" class="btn-card-edit" data-action="edit" data-item-code="${p.item_code}">${this.t("edit_btn")}</button>
			</div>
		`;
	}

	render_catalog_items() {
		const $area = this.wrapper.find("#catalog-content-area");

		if (!this.catalog_data || this.catalog_data.length === 0) {
			$area.html(`
				<div class="empty-catalog-state">
					<div style="font-size: 48px; margin-bottom: 12px;">📦</div>
					<h4>${this.lang === "tg" ? "Ҳеҷ мол ёфт нашуд" : "Товары не найдены"}</h4>
					<p>${this.lang === "tg" ? "Шумо метавонед бо пахши тугмаи '+ Моли нав' моли аввалинро илова намоед." : "Вы можете нажать '+ Новый товар' для добавления первого товара."}</p>
				</div>
			`);
			return;
		}

		if (this.view_mode === "card") {
			let cards_html = '<div class="catalog-grid">';
			this.catalog_data.forEach((p) => {
				const promo_tag = p.discount_percentage > 0 ? `<span class="promo-badge">-${p.discount_percentage}%</span>` : "";
				const original_price = p.discount_percentage > 0 ? `<span class="product-price-original">${p.selling_price} ${p.currency}</span>` : "";
				const status_label = this.lang === "tg" ? p.status_label_tg : p.status_label_ru;
				const variant_info = p.has_variants ? `(${p.variant_count} ${this.lang === "tg" ? "андоза/ранг" : "размеров"})` : "";

				cards_html += `
					<div class="product-card" style="cursor: pointer;" data-open-item="${p.item_code}">
						<div class="product-card-header">
							<div class="product-card-img">
								${p.image ? `<img src="${p.image}" style="width: 100%; height: 100%; border-radius: 8px; object-fit: cover;">` : "👕"}
							</div>
							<div class="product-card-info">
								<h4 class="product-card-title" title="${p.item_name}">${p.item_name}</h4>
								<span class="product-card-category">${p.item_group} ${variant_info}</span>
							</div>
						</div>

						<div class="product-card-pricing">
							<div class="product-price-row">
								<span class="product-price-current">${this.price_html(p)}</span>
								${original_price}
								${promo_tag}
							</div>
						</div>

						<div class="product-card-stats">
							<span class="stock-badge ${p.status}">● ${p.stock_qty} ${status_label}</span>
							<span class="sales-count">🛒 ${p.sold_qty} ${this.lang === "tg" ? "фурӯхт" : "прод"}</span>
						</div>

						${this.action_buttons(p)}
					</div>
				`;
			});
			cards_html += "</div>";
			$area.html(cards_html);
		} else {
			let table_html = `
				<div class="catalog-table-wrap">
					<table class="catalog-table">
						<thead>
							<tr>
								<th>#</th>
								<th>${this.lang === "tg" ? "Номи мол" : "Название"}</th>
								<th>${this.lang === "tg" ? "Гурӯҳ" : "Категория"}</th>
								<th>${this.t("cost_price")}</th>
								<th>${this.t("retail_price")}</th>
								<th>${this.t("stock")}</th>
								<th>${this.t("sold_30d")}</th>
								<th>${this.lang === "tg" ? "Ҳолат" : "Статус"}</th>
								<th style="min-width: 260px;"></th>
							</tr>
						</thead>
						<tbody>
			`;

			this.catalog_data.forEach((p, idx) => {
				const status_label = this.lang === "tg" ? p.status_label_tg : p.status_label_ru;
				const promo_tag = p.discount_percentage > 0 ? `<span class="promo-badge">-${p.discount_percentage}%</span>` : "";

				table_html += `
					<tr style="cursor: pointer;" data-open-item="${p.item_code}">
						<td style="color: #94a3b8; font-weight: 600;">${p.custom_short_code || idx + 1}</td>
						<td style="font-weight: 700;">${p.item_name} ${p.has_variants ? `(${p.variant_count})` : ""}</td>
						<td><span class="product-card-category">${p.item_group}</span></td>
						<td style="color: #64748b;">${p.buying_price} ${p.currency}</td>
						<td style="font-weight: 800;">${this.price_html(p)} ${promo_tag}</td>
						<td style="font-weight: 800;">${p.stock_qty}</td>
						<td>${p.sold_qty}</td>
						<td><span class="stock-badge ${p.status}">● ${status_label}</span></td>
						<td>${this.action_buttons(p)}</td>
					</tr>
				`;
			});

			table_html += `
						</tbody>
					</table>
				</div>
			`;
			$area.html(table_html);
		}

		$area.find("[data-action]").on("click", (e) => {
			const $btn = $(e.currentTarget);
			const item_code = $btn.attr("data-item-code");
			if ($btn.attr("data-action") === "restock") {
				frappe.new_doc("Quick Product Restock", { item: item_code });
			} else {
				frappe.set_route("product-detail", item_code);
			}
			e.stopPropagation();
		});

		$area.find("[data-open-item]").on("click", (e) => {
			frappe.set_route("product-detail", $(e.currentTarget).attr("data-open-item"));
		});
	}
}
