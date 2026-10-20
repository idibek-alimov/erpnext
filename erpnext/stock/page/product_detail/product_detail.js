// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["product-detail"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Product"),
		single_column: true,
	});
	wrapper.product_detail = new ProductDetailApp(page);
};

frappe.pages["product-detail"].on_page_show = function (wrapper) {
	const item_code = frappe.get_route()[1];
	if (item_code) {
		wrapper.product_detail.load(decodeURIComponent(item_code));
	}
};

class ProductDetailApp {
	constructor(page) {
		this.page = page;
		this.lang = frappe.boot.user.language === "tg" ? "tg" : "ru";
		this.$body = $(page.body).addClass("product-detail-page");
		this.item_code = null;
		this.selected_color = null;

		this.page.set_secondary_action(__("Back to Catalog"), () => frappe.set_route("product-catalog"));
		this.page.add_menu_item(__("Open full Item form (advanced)"), () => {
			if (this.item_code) frappe.set_route("Form", "Item", this.item_code);
		});
	}

	t(key) {
		const d = {
			product_name: { tg: "Номи мол", ru: "Название товара" },
			code: { tg: "Рамз (ID)", ru: "Код (ID)" },
			category: { tg: "Гурӯҳ", ru: "Категория" },
			supplier: { tg: "Таъминкунанда", ru: "Поставщик" },
			total_stock: { tg: "Дар анбор (ҳамагӣ)", ru: "На складе (всего)" },
			total_sold: { tg: "Фурӯхта шуд (ҳамагӣ)", ru: "Продано (всего)" },
			color: { tg: "Интихоби ранг", ru: "Выбор цвета" },
			color_section_title: { tg: "Ранг ва андозаҳо", ru: "Цвет и размеры" },
			pick_color: { tg: "— Рангро интихоб кунед —", ru: "— Выберите цвет —" },
			pick_color_hint: {
				tg: "Барои дидани андозаҳо ва бақия, лутфан рангро интихоб кунед.",
				ru: "Пожалуйста, выберите цвет, чтобы увидеть размеры и остатки.",
			},
			sizes: { tg: "Андозаҳо", ru: "Размеры" },
			size: { tg: "Андоза", ru: "Размер" },
			short_code: { tg: "Рамз (Код)", ru: "Код" },
			cost: { tg: "Нархи харид", ru: "Закупка" },
			price: { tg: "Нархи фурӯш", ru: "Цена" },
			left: { tg: "Дар анбор", ru: "Остаток" },
			sold: { tg: "Фурӯхта шуд", ru: "Продано" },
			status: { tg: "Ҳолат", ru: "Статус" },
			in_stock: { tg: "Дар анбор", ru: "В наличии" },
			low: { tg: "Кам монд", ru: "Мало" },
			out: { tg: "Тамом шуд", ru: "Нет в наличии" },
			restock: { tg: "📥 Қабули мол", ru: "📥 Приёмка товара" },
			no_photo: { tg: "Акс нест", ru: "Нет фото" },
			total: { tg: "Ҳамагӣ", ru: "Итого" },
			upload_photo: { tg: "📷 Боргирии акс", ru: "📷 Загрузить фото" },
			change_photo: { tg: "📷 Тағйири акс", ru: "📷 Изменить фото" },
			photo_saved: { tg: "Акс бомуваффақият сабт шуд!", ru: "Фото успешно сохранено!" },
		};
		return (d[key] && d[key][this.lang]) || key;
	}

	load(item_code) {
		this.item_code = item_code;
		this.$body.html(`<div class="text-center text-muted" style="padding:60px;">${__("Loading...")}</div>`);
		frappe.call({
			method: "erpnext.stock.page.product_detail.product_detail.get_product_detail",
			args: { item_code },
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.selected_color = null;
				this.render();
			},
		});
	}

	render() {
		const d = this.data;
		this.page.set_title(d.item_name);
		this.page.clear_primary_action();
		this.page.set_primary_action(this.t("restock"), () =>
			frappe.new_doc("Quick Product Restock", { item: this.item_code })
		);

		this.$body.html(`
			<div class="product-detail-container">
				<div class="pd-card">
					<div class="pd-main-grid">
						<div class="pd-image-col">
							<div class="pd-image-box" title="${this.t("change_photo")}"></div>
							<button type="button" class="pd-upload-btn" id="pd-btn-upload">
								${this.t("upload_photo")}
							</button>
						</div>
						<div class="pd-fields-col">
							<div class="pd-fields-grid">
								<div class="pd-field-item pd-f-name"></div>
								<div class="pd-field-item pd-f-code"></div>
								<div class="pd-field-item pd-f-cat"></div>
								<div class="pd-field-item pd-f-supp"></div>
								<div class="pd-field-item pd-f-stock"></div>
								<div class="pd-field-item pd-f-sold"></div>
							</div>
						</div>
					</div>

					<div class="pd-divider pd-color-divider"></div>

					<div class="pd-color-section">
						<div class="pd-section-title">${this.t("color_section_title")}</div>
						<div class="pd-color-wrapper"></div>
					</div>

					<div class="pd-sizes-section"></div>
				</div>
			</div>
		`);

		this.make_info_fields();
		this.bind_image_events();

		const has_colors = d.colors.some((c) => c.color);
		if (has_colors) {
			this.make_color_field();
		} else {
			this.$body.find(".pd-color-divider").hide();
			this.$body.find(".pd-color-section").hide();
		}

		this.render_image();
		this.update_upload_btn_label();

		if (!has_colors) {
			this.render_sizes(d.colors[0]);
		} else if (d.colors.length === 1) {
			this.color_control.set_value(d.colors[0].color);
		} else {
			this.render_sizes(null);
		}
	}

	make_ctl(parent, df, value) {
		const ctl = frappe.ui.form.make_control({
			df: Object.assign({ read_only: 1 }, df),
			parent,
			render_input: true,
		});
		if (value !== undefined) ctl.set_value(value);
		return ctl;
	}

	make_info_fields() {
		const d = this.data;
		this.make_ctl(this.$body.find(".pd-f-name"), { fieldtype: "Data", fieldname: "item_name", label: this.t("product_name") }, d.item_name);
		this.make_ctl(this.$body.find(".pd-f-code"), { fieldtype: "Data", fieldname: "short_code", label: this.t("code") }, d.short_code || d.item_code);
		this.make_ctl(this.$body.find(".pd-f-cat"), { fieldtype: "Link", options: "Item Group", fieldname: "item_group", label: this.t("category") }, d.item_group);
		this.make_ctl(this.$body.find(".pd-f-supp"), { fieldtype: "Link", options: "Supplier", fieldname: "supplier", label: this.t("supplier") }, d.supplier || "");
		this.make_ctl(this.$body.find(".pd-f-stock"), { fieldtype: "Float", fieldname: "total_stock", label: this.t("total_stock") }, d.total_stock);
		this.make_ctl(this.$body.find(".pd-f-sold"), { fieldtype: "Float", fieldname: "total_sold", label: this.t("total_sold") }, d.total_sold);
	}

	make_color_field() {
		const options = ["", ...this.data.colors.map((c) => c.color)].join("\n");
		this.color_control = frappe.ui.form.make_control({
			df: {
				fieldtype: "Select",
				fieldname: "color",
				label: this.t("color"),
				options,
				change: () => this.on_color_change(),
			},
			parent: this.$body.find(".pd-color-wrapper"),
			render_input: true,
		});
		this.color_control.refresh();
	}

	bind_image_events() {
		this.$body.find("#pd-btn-upload, .pd-image-box").on("click", () => {
			this.open_image_uploader();
		});
	}

	open_image_uploader() {
		const currentColor = this.selected_color ? this.selected_color.color : "";
		new frappe.ui.FileUploader({
			doctype: "Item",
			docname: this.item_code,
			folder: "Home/Attachments",
			on_success: (file_doc) => {
				frappe.call({
					method: "erpnext.stock.page.product_detail.product_detail.update_color_image",
					args: {
						item_code: this.item_code,
						color: currentColor,
						image_url: file_doc.file_url,
					},
					callback: (r) => {
						if (r.message && r.message.success) {
							frappe.show_alert({
								message: this.t("photo_saved"),
								indicator: "green",
							});
							if (this.selected_color) {
								this.selected_color.image = file_doc.file_url;
							}
							if (!this.data.image) {
								this.data.image = file_doc.file_url;
							}
							this.render_image();
							this.update_upload_btn_label();
						}
					},
				});
			},
		});
	}

	on_color_change() {
		const value = this.color_control.get_value();
		const color = this.data.colors.find((c) => c.color === value) || null;
		this.selected_color = color;
		this.render_image();
		this.update_upload_btn_label();
		this.render_sizes(color);
	}

	update_upload_btn_label() {
		const $btn = this.$body.find("#pd-btn-upload");
		if (this.selected_color) {
			const hasImg = Boolean(this.selected_color.image);
			const action = hasImg ? this.t("change_photo") : this.t("upload_photo");
			$btn.text(`${action} (${this.selected_color.color})`);
		} else {
			const hasImg = Boolean(this.data.image);
			const action = hasImg ? this.t("change_photo") : this.t("upload_photo");
			$btn.text(action);
		}
	}

	render_image() {
		const d = this.data;
		const src = (this.selected_color && this.selected_color.image) || (this.selected_color ? "" : d.image);
		const $box = this.$body.find(".pd-image-box");
		if (src) {
			$box.html(`<img src="${frappe.utils.escape_html(src)}" alt="${frappe.utils.escape_html(d.item_name)}">`);
		} else {
			const colorText = this.selected_color ? ` (${this.selected_color.color})` : "";
			$box.html(`
				<div class="pd-no-photo">
					<div class="pd-abbr">${frappe.get_abbr(d.item_name)}</div>
					<div>${this.t("no_photo")}${colorText}</div>
					<div style="font-size: 11px; margin-top: 4px; color: #94a3b8;">${__("Click to upload")}</div>
				</div>
			`);
		}
	}

	status_pill(qty) {
		if (qty <= 0) return `<span class="indicator-pill red">${this.t("out")}</span>`;
		if (qty <= 5) return `<span class="indicator-pill orange">${this.t("low")}</span>`;
		return `<span class="indicator-pill green">${this.t("in_stock")}</span>`;
	}

	render_sizes(color) {
		const $s = this.$body.find(".pd-sizes-section");
		if (!color) {
			$s.html(`<div class="pd-hint">${this.t("pick_color_hint")}</div>`);
			return;
		}
		const cur = this.data.currency;
		const rows = color.sizes
			.map(
				(s) => `
			<tr>
				<td><b>${frappe.utils.escape_html(s.size)}</b></td>
				<td class="text-muted">${frappe.utils.escape_html(s.short_code)}</td>
				<td class="text-right">${format_currency(s.buying_price, cur)}</td>
				<td class="text-right">${format_currency(s.selling_price, cur)}</td>
				<td class="text-right pd-num">${flt(s.stock_qty)}</td>
				<td class="text-right">${flt(s.sold_qty)}</td>
				<td>${this.status_pill(s.stock_qty)}</td>
			</tr>`
			)
			.join("");

		$s.html(`
			<div class="pd-section-title">
				<span>${this.t("sizes")}${color.color ? ` — <span style="color: #2563eb;">${frappe.utils.escape_html(color.color)}</span>` : ""}</span>
			</div>
			<div class="pd-table-wrap table-responsive">
				<table class="table pd-table">
					<thead>
						<tr>
							<th>${this.t("size")}</th>
							<th>${this.t("short_code")}</th>
							<th class="text-right">${this.t("cost")}</th>
							<th class="text-right">${this.t("price")}</th>
							<th class="text-right">${this.t("left")}</th>
							<th class="text-right">${this.t("sold")}</th>
							<th>${this.t("status")}</th>
						</tr>
					</thead>
					<tbody>${rows}</tbody>
					<tfoot>
						<tr>
							<td colspan="4"><b>${this.t("total")}</b></td>
							<td class="text-right pd-num">${flt(color.stock)}</td>
							<td class="text-right"><b>${flt(color.sold)}</b></td>
							<td></td>
						</tr>
					</tfoot>
				</table>
			</div>
		`);
	}
}
