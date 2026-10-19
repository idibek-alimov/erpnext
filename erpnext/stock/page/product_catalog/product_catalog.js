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
		this.active_product = null;
		this.active_color_filter = "ALL";

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
			new_product: {
				tg: "+ Моли нав",
				ru: "+ Новый товар",
			},
			all_categories: {
				tg: "Ҳамаи гурӯҳҳо",
				ru: "Все категории",
			},
			filter_all: {
				tg: "Ҳамаи ҳолатҳо",
				ru: "Все статусы",
			},
			filter_in_stock: {
				tg: "Дар анбор",
				ru: "В наличии",
			},
			filter_low_stock: {
				tg: "Кам монд (≤5)",
				ru: "Мало (≤5)",
			},
			filter_out_of_stock: {
				tg: "Тамом шуд (0)",
				ru: "Нет в наличии (0)",
			},
			card_view: {
				tg: "Кортҳо",
				ru: "Карточки",
			},
			table_view: {
				tg: "Ҷадвал",
				ru: "Таблица",
			},
			retail_price: {
				tg: "Нархи фурӯш",
				ru: "Цена продажи",
			},
			cost_price: {
				tg: "Нархи харид",
				ru: "Цена закупки",
			},
			promo_discount: {
				tg: "Тахфиф % (0 = бе тахфиф)",
				ru: "Скидка % (0 = без скидки)",
			},
			save_prices_btn: {
				tg: "💾 Сабти нархи нав",
				ru: "💾 Обновить цену",
			},
			stock: {
				tg: "Бақияи анбор",
				ru: "Остаток на складе",
			},
			sold_30d: {
				tg: "Фурӯхта шуд (30 рӯз)",
				ru: "Продано (30 дн)",
			},
			restock_btn: {
				tg: "📥 Қабули мол ба анбор",
				ru: "📦 Оформить приход на склад",
			},
			print_tags_btn: {
				tg: "🏷️ Чопи нархномаҳо (58x40)",
				ru: "🏷️ Печать ценников (58x40)",
			},
			color: {
				tg: "Ранг",
				ru: "Цвет",
			},
			size: {
				tg: "Андоза",
				ru: "Размер",
			},
			barcode: {
				tg: "Штрихкод / Код",
				ru: "Штрихкод / Код",
			},
			add_qty: {
				tg: "Воридот (+дона)",
				ru: "Приход (+шт)",
			},
			supplier_optional: {
				tg: "Таъминкунанда (ихтиёрӣ)",
				ru: "Поставщик (необязательно)",
			},
			restock_section: {
				tg: "📦 Қабули моли нав ба анбор",
				ru: "📦 Поступление нового товара на склад",
			},
			price_section: {
				tg: "💰 Нархгузорӣ ва Тахфифҳо",
				ru: "💰 Изменение цен и скидок",
			},
			color_all: {
				tg: "Ҳамаи рангҳо",
				ru: "Все цвета",
			},
			profit: {
				tg: "Фоида барои 1 дона",
				ru: "Прибыль на 1 шт",
			},
			margin: {
				tg: "Маржа",
				ru: "Маржа",
			},
		};
		return (dict[key] && dict[key][this.lang]) || key;
	}

	setup_ui() {
		this.wrapper.html(`
			<div class="product-catalog-container">
				<!-- Toolbar -->
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
							<button type="button" id="toggle-card-view" class="active">🗂️ ${this.t("card_view")}</button>
							<button type="button" id="toggle-table-view">📊 ${this.t("table_view")}</button>
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

				<!-- Content Area -->
				<div id="catalog-content-area">
					<div class="text-center py-5"><span class="spinner-border text-primary"></span></div>
				</div>

				<!-- Centered Big Modal Backdrop & Container -->
				<div id="modal-backdrop" class="drawer-backdrop"></div>
				<div id="product-modal" class="product-modal"></div>
			</div>
		`);
	}

	bind_events() {
		// Search with debounce
		let timeout = null;
		this.wrapper.find("#catalog-search").on("input", (e) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => {
				this.search_query = e.target.value.trim();
				this.load_catalog();
			}, 300);
		});

		// Category filter
		this.wrapper.find("#catalog-category-filter").on("change", (e) => {
			this.selected_category = e.target.value;
			this.load_catalog();
		});

		// Status filter
		this.wrapper.find("#catalog-status-filter").on("change", (e) => {
			this.status_filter = e.target.value;
			this.load_catalog();
		});

		// View Mode Toggles
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

		// Language Toggle
		this.wrapper.find("#catalog-lang-toggle").on("change", (e) => {
			this.lang = e.target.value;
			this.setup_ui();
			this.bind_events();
			this.load_catalog();
		});

		// New Product Button
		this.wrapper.find("#btn-create-product").on("click", () => {
			frappe.set_route("Form", "Quick Product Intake", "new-quick-product-intake-1");
		});

		// Modal backdrop close
		this.wrapper.find("#modal-backdrop").on("click", () => {
			this.close_modal();
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
					<div class="product-card" data-item-code="${p.item_code}">
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
								<span class="product-price-current">${p.discounted_price} ${p.currency}</span>
								${original_price}
								${promo_tag}
							</div>
						</div>

						<div class="product-card-stats">
							<span class="stock-badge ${p.status}">
								● ${p.stock_qty} ${status_label}
							</span>
							<span class="sales-count">
								🛒 ${p.sold_qty} ${this.lang === "tg" ? "фурӯхт" : "прод"}
							</span>
						</div>
					</div>
				`;
			});
			cards_html += "</div>";
			$area.html(cards_html);
		} else {
			// Table view
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
							</tr>
						</thead>
						<tbody>
			`;

			this.catalog_data.forEach((p, idx) => {
				const status_label = this.lang === "tg" ? p.status_label_tg : p.status_label_ru;
				const promo_tag = p.discount_percentage > 0 ? `<span class="promo-badge">-${p.discount_percentage}%</span>` : "";

				table_html += `
					<tr data-item-code="${p.item_code}">
						<td style="color: #94a3b8; font-weight: 600;">${p.custom_short_code || idx + 1}</td>
						<td style="font-weight: 700;">${p.item_name} ${p.has_variants ? `(${p.variant_count})` : ""}</td>
						<td><span class="product-card-category">${p.item_group}</span></td>
						<td style="color: #64748b;">${p.buying_price} ${p.currency}</td>
						<td style="font-weight: 800;">${p.discounted_price} ${p.currency} ${promo_tag}</td>
						<td style="font-weight: 800;">${p.stock_qty}</td>
						<td>${p.sold_qty}</td>
						<td><span class="stock-badge ${p.status}">● ${status_label}</span></td>
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

		// Click card / row to open large modal
		$area.find("[data-item-code]").on("click", (e) => {
			const item_code = $(e.currentTarget).attr("data-item-code");
			this.open_product_modal(item_code);
		});
	}

	open_product_modal(item_code) {
		const $modal = this.wrapper.find("#product-modal");
		const $backdrop = this.wrapper.find("#modal-backdrop");
		this.active_color_filter = "ALL";

		$modal.html(`
			<div class="text-center py-5" style="margin-top: 80px;">
				<div class="spinner-border text-primary" role="status"></div>
				<p style="margin-top: 12px; color: #64748b; font-weight: 600;">
					${this.lang === "tg" ? "Маълумоти мол боргирӣ шуда истодааст..." : "Загрузка данных товара..."}
				</p>
			</div>
		`);

		$backdrop.addClass("open");
		$modal.addClass("open");

		frappe.call({
			method: "erpnext.stock.page.product_catalog.product_catalog.get_product_details",
			args: { item_code: item_code },
			callback: (r) => {
				if (r.message) {
					this.active_product = r.message;
					this.render_modal_content();
				}
			},
		});
	}

	close_modal() {
		this.wrapper.find("#modal-backdrop").removeClass("open");
		this.wrapper.find("#product-modal").removeClass("open");
		this.active_product = null;
	}

	render_modal_content() {
		const p = this.active_product;
		const $modal = this.wrapper.find("#product-modal");

		// Extract unique colors for filter pills (Solution 2)
		const unique_colors = [];
		(p.variants || []).forEach((v) => {
			if (v.color && v.color !== "-" && !unique_colors.includes(v.color)) {
				unique_colors.push(v.color);
			}
		});

		// Supplier dropdown options
		let suppliers_options = `<option value="">-- ${this.t("supplier_optional")} --</option>`;
		(p.suppliers || []).forEach((sup) => {
			suppliers_options += `<option value="${sup}">${sup}</option>`;
		});

		// Calculate profit margin
		const profit = flt(p.selling_price - p.buying_price, 2);
		const margin = p.selling_price > 0 ? Math.round((profit / p.selling_price) * 100) : 0;

		$modal.html(`
			<div class="modal-header-custom">
				<div style="display: flex; align-items: center; gap: 12px;">
					<div style="font-size: 28px;">👕</div>
					<div>
						<h3>${p.item_name}</h3>
						<span class="product-card-category">${p.item_group} | Code: ${p.custom_short_code || p.item_code} | ${this.t("stock")}: <b>${p.total_stock}</b></span>
					</div>
				</div>
				<button type="button" class="modal-close-btn" id="btn-close-modal">&times;</button>
			</div>

			<div class="modal-body-custom">
				<!-- Integrated Price & Promo Editor Card -->
				<div class="price-editor-card">
					<div class="price-editor-title">
						<span>${this.t("price_section")}</span>
						<span id="live-profit-badge" class="profit-live-badge">
							${this.t("profit")}: +${profit} ${p.currency} (${margin}% ${this.t("margin")})
						</span>
					</div>
					<div class="price-editor-grid">
						<div class="price-field-group">
							<label>${this.t("retail_price")}</label>
							<input type="number" id="inp-selling-price" value="${p.selling_price}" step="any">
						</div>
						<div class="price-field-group">
							<label>${this.t("cost_price")}</label>
							<input type="number" id="inp-buying-price" value="${p.buying_price}" step="any">
						</div>
						<div class="price-field-group">
							<label>${this.t("promo_discount")}</label>
							<input type="number" id="inp-discount-pct" value="${p.discount_percentage}" min="0" max="100">
						</div>
						<button type="button" class="btn-save-prices" id="btn-save-inline-prices">
							${this.t("save_prices_btn")}
						</button>
					</div>
				</div>

				<!-- Restock Section -->
				<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
					<div style="font-size: 15px; font-weight: 800; color: #0f172a;">
						${this.t("restock_section")}
					</div>
					<div style="display: flex; align-items: center; gap: 8px;">
						<label style="font-size: 12px; font-weight: 600; margin: 0; color: #64748b;">
							${this.lang === "tg" ? "Таъминкунанда:" : "Поставщик:"}
						</label>
						<select id="modal-supplier-select" class="catalog-select" style="padding: 5px 10px; font-size: 12px;">
							${suppliers_options}
						</select>
					</div>
				</div>

				<!-- Color Filter Pills (Solution 2) -->
				${unique_colors.length > 1 ? `
					<div class="color-pills-bar" id="color-pills-container">
						<button type="button" class="color-pill active" data-color="ALL">
							${this.t("color_all")} (${p.variants.length})
						</button>
						${unique_colors.map((c) => {
							const count = p.variants.filter((v) => v.color === c).length;
							return `<button type="button" class="color-pill" data-color="${c}">${c} (${count})</button>`;
						}).join("")}
					</div>
				` : ""}

				<!-- Scrollable Matrix Table with Sticky Header -->
				<div class="modal-table-scroller">
					<table class="matrix-modal-table">
						<thead>
							<tr>
								<th>${this.t("color")}</th>
								<th>${this.t("size")}</th>
								<th>${this.t("barcode")}</th>
								<th>${this.t("stock")}</th>
								<th>${this.t("sold_30d")}</th>
								<th style="text-align: center; width: 120px;">${this.t("add_qty")}</th>
							</tr>
						</thead>
						<tbody id="matrix-tbody">
							<!-- Populated by render_matrix_rows -->
						</tbody>
					</table>
				</div>
			</div>

			<div class="modal-footer-custom">
				<button type="button" class="btn btn-secondary" id="btn-print-labels">
					${this.t("print_tags_btn")}
				</button>
				<button type="button" class="btn-action-restock" id="btn-submit-restock">
					${this.t("restock_btn")}
				</button>
			</div>
		`);

		// Render rows
		this.render_matrix_rows();

		// Bind Modal Events
		$modal.find("#btn-close-modal").on("click", () => this.close_modal());

		// Live profit recalculation on input
		const recalc_profit = () => {
			const sell = flt($modal.find("#inp-selling-price").val());
			const buy = flt($modal.find("#inp-buying-price").val());
			const disc = flt($modal.find("#inp-discount-pct").val());

			const net_sell = disc > 0 ? sell * (1 - disc / 100) : sell;
			const p_amt = flt(net_sell - buy, 2);
			const p_margin = net_sell > 0 ? Math.round((p_amt / net_sell) * 100) : 0;

			$modal.find("#live-profit-badge").html(
				`${this.t("profit")}: +${p_amt} ${p.currency} (${p_margin}% ${this.t("margin")})`
			);
		};
		$modal.find("#inp-selling-price, #inp-buying-price, #inp-discount-pct").on("input", recalc_profit);

		// Save Inline Prices Button
		$modal.find("#btn-save-inline-prices").on("click", () => {
			this.handle_save_inline_prices();
		});

		// Color Pills Filtering (Solution 2)
		$modal.find(".color-pill").on("click", (e) => {
			$modal.find(".color-pill").removeClass("active");
			const $btn = $(e.currentTarget);
			$btn.addClass("active");
			this.active_color_filter = $btn.attr("data-color");
			this.render_matrix_rows();
		});

		// Restock Submit
		$modal.find("#btn-submit-restock").on("click", () => {
			this.handle_restock_submit();
		});

		// Print Labels
		$modal.find("#btn-print-labels").on("click", () => {
			this.handle_print_labels_dialog();
		});
	}

	render_matrix_rows() {
		const p = this.active_product;
		const $tbody = this.wrapper.find("#matrix-tbody");
		const filter = this.active_color_filter;

		const filtered_variants = (p.variants || []).filter((v) => {
			if (!filter || filter === "ALL") return true;
			return v.color === filter;
		});

		if (filtered_variants.length === 0) {
			$tbody.html(`
				<tr>
					<td colspan="6" class="text-center text-muted py-4">
						${this.lang === "tg" ? "Ҳеҷ андоза барои ин ранг ёфт нашуд." : "Нет размеров для данного цвета."}
					</td>
				</tr>
			`);
			return;
		}

		let rows_html = "";
		filtered_variants.forEach((v) => {
			const is_out = v.stock_qty <= 0;
			rows_html += `
				<tr data-variant-code="${v.item_code}">
					<td style="font-weight: 700; color: #1e293b;">${v.color || "-"}</td>
					<td style="font-weight: 700; color: #1e293b;">${v.size || "-"}</td>
					<td style="font-family: monospace; color: #64748b;">${v.barcode || v.custom_short_code || "-"}</td>
					<td style="font-weight: 800; color: ${is_out ? "#dc2626" : "#059669"};">
						${v.stock_qty} ${is_out ? "⚠️" : ""}
					</td>
					<td style="color: #64748b;">${v.sold_qty}</td>
					<td style="text-align: center;">
						<input type="number" class="input-restock-qty" min="0" placeholder="+ 0" data-code="${v.item_code}">
					</td>
				</tr>
			`;
		});

		$tbody.html(rows_html);
	}

	handle_save_inline_prices() {
		const p = this.active_product;
		const $modal = this.wrapper.find("#product-modal");

		const selling_price = flt($modal.find("#inp-selling-price").val());
		const buying_price = flt($modal.find("#inp-buying-price").val());
		const discount_pct = flt($modal.find("#inp-discount-pct").val());

		if (selling_price <= 0) {
			frappe.msgprint(this.lang === "tg" ? "Нархи фурӯш бояд аз 0 калон бошад!" : "Цена продажи должна быть больше 0!");
			return;
		}

		frappe.call({
			method: "erpnext.stock.page.product_catalog.product_catalog.update_prices_and_discount",
			args: {
				item_code: p.item_code,
				selling_price: selling_price,
				buying_price: buying_price,
				discount_percentage: discount_pct,
			},
			freeze: true,
			freeze_message: this.lang === "tg" ? "Нархҳо сабт шуда истодаанд..." : "Обновление цен...",
			callback: (r) => {
				if (r.message && r.message.success) {
					frappe.show_alert({
						message: this.lang === "tg" ? "Нарх ва тахфиф бо муваффақият навсозӣ шуданд!" : "Цены и скидки успешно обновлены!",
						indicator: "green",
					});
					this.load_catalog();
					p.selling_price = selling_price;
					p.buying_price = buying_price;
					p.discount_percentage = discount_pct;
				}
			},
		});
	}

	handle_restock_submit() {
		const p = this.active_product;
		const $modal = this.wrapper.find("#product-modal");
		const supplier = $modal.find("#modal-supplier-select").val() || null;

		const items_to_restock = [];
		$modal.find(".input-restock-qty").each((_, input) => {
			const qty = flt($(input).val());
			const code = $(input).attr("data-code");
			if (qty > 0) {
				items_to_restock.push({
					item_code: code,
					qty: qty,
					buying_price: p.buying_price,
				});
			}
		});

		if (items_to_restock.length === 0) {
			frappe.msgprint(
				this.lang === "tg"
					? "Лутфан миқдори воридотро барои ҳадди ақал як андоза ворид намоед."
					: "Пожалуйста, введите количество прихода хотя бы для одного размера."
			);
			return;
		}

		frappe.confirm(
			this.lang === "tg"
				? `Оё мехоҳед ${items_to_restock.length} молро ба анбор қабул намоед?`
				: `Принять на склад ${items_to_restock.length} позиций?`,
			() => {
				frappe.call({
					method: "erpnext.stock.page.product_catalog.product_catalog.restock_items",
					args: {
						item_code: p.item_code,
						items_data: JSON.stringify(items_to_restock),
						supplier: supplier,
					},
					freeze: true,
					freeze_message: this.lang === "tg" ? "Қабули мол ба анбор сабт шуда истодааст..." : "Оформление прихода на склад...",
					callback: (r) => {
						if (r.message && r.message.success) {
							frappe.show_alert({
								message: this.lang === "tg" ? "Молҳо бо муваффақият ба анбор қабул шуданд!" : "Товары успешно приняты на склад!",
								indicator: "green",
							});
							// Reload modal and main catalog
							this.open_product_modal(p.item_code);
							this.load_catalog();
						}
					},
				});
			}
		);
	}

	handle_print_labels_dialog() {
		const p = this.active_product;
		const d = new frappe.ui.Dialog({
			title: this.lang === "tg" ? "Чопи нархномаҳо (58x40mm)" : "Печать ценников (58x40mm)",
			fields: [
				{
					fieldname: "label_template",
					fieldtype: "Select",
					label: this.lang === "tg" ? "Шаблони нархнома" : "Шаблон ценника",
					options: ["Radolfa Minimalist (58x40mm)", "Standard Barcode Tag"],
					default: "Radolfa Minimalist (58x40mm)",
				},
				{
					fieldname: "quantity",
					fieldtype: "Int",
					label: this.lang === "tg" ? "Миқдори стикерҳо барои ҳар як андоза" : "Количество стикеров на каждый размер",
					default: 5,
				},
			],
			primary_action_label: this.lang === "tg" ? "Чоп кардан" : "Печать",
			primary_action: (values) => {
				d.hide();
				const print_url = `/printview?doctype=Item&name=${encodeURIComponent(p.item_code)}&format=${encodeURIComponent(values.label_template)}&no_letterhead=1`;
				window.open(print_url, "_blank");
			},
		});
		d.show();
	}
}
