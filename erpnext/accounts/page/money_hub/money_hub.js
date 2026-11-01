// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["money-hub"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Пул (Money Hub)") : __("Деньги (Money Hub)"),
		single_column: true,
	});

	page.set_primary_action(is_tg ? __("🔄 Интиқол") : __("🔄 Перевод / Инкассация"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.open_transfer();
	});
	page.add_inner_button(is_tg ? __("➕ Ҳамёни нав") : __("➕ Создать кошелёк"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.open_creator();
	});

	page.add_inner_button(is_tg ? __("Хароҷотҳо") : __("Расходы"), () => frappe.set_route("expense-desk"));
	page.add_inner_button(is_tg ? __("Андозҳо") : __("Налоги"), () => frappe.set_route("tax-desk"));
	page.add_inner_button(is_tg ? __("Таъминкунандагон") : __("Поставщики"), () => frappe.set_route("supplier-hub"));
	page.add_inner_button(is_tg ? __("Кормандон") : __("Сотрудники"), () => frappe.set_route("staff-hub"));
	page.add_inner_button(is_tg ? __("Каталоги молҳо") : __("Каталог товаров"), () => frappe.set_route("product-catalog"));
	page.add_inner_button(is_tg ? __("Навсозӣ") : __("Обновить"), () => {
		wrapper.money_hub_app && wrapper.money_hub_app.load();
	});

	// Ensure fresh styles even if cached in localStorage
	frappe.call({
		method: "frappe.desk.desk_page.getpage",
		args: { name: "money-hub" },
		callback: (r) => {
			if (r.docs && r.docs[0] && r.docs[0].style) {
				frappe.dom.set_style(r.docs[0].style);
			}
		},
	});

	wrapper.money_hub_app = new MoneyHubApp(page);
};

frappe.pages["money-hub"].on_page_show = function (wrapper) {
	const route = frappe.get_route();
	const target_tab = (route && route[1] === "ledger") ? "ledger" : "accounts";
	if (wrapper.money_hub_app) {
		wrapper.money_hub_app.active_tab = target_tab;
		wrapper.money_hub_app.load();
	}
};

class MoneyHubApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body);
		this.is_tg = frappe.boot.user.language === "tg";
		this.data = null;
		this.feed = [];

		// Read active tab from URL route: #money-hub/ledger or #money-hub/accounts
		const route = frappe.get_route();
		this.active_tab = (route && route[1] === "ledger") ? "ledger" : "accounts";

		// Filters State
		this.search_query = "";
		this.feed_wallet = null;
		this.feed_period = "week";
		this.feed_op_type = "all";
		this.feed_direction = "all";
		this.from_date = "";
		this.to_date = "";
		this.search_timer = null;

		this.load();
	}

	t(ru, tg) {
		return this.is_tg ? tg : ru;
	}

	fmt(amount) {
		const n = Number(amount || 0);
		return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}

	load() {
		frappe.call({
			method: "erpnext.accounts.page.money_hub.money_hub.get_money_hub_data",
			callback: (r) => {
				if (!r.message) return;
				this.data = r.message;
				this.render();
				this.load_feed();
			},
		});
	}

	load_feed() {
		frappe.call({
			method: "erpnext.accounts.page.money_hub.money_hub.get_money_feed",
			args: {
				wallet: this.feed_wallet,
				period: this.feed_period,
				from_date: this.from_date || null,
				to_date: this.to_date || null,
				op_type: this.feed_op_type,
				direction: this.feed_direction,
				search: this.search_query,
				limit: 500,
			},
			callback: (r) => {
				this.feed = r.message || [];
				this.render();
				if (frappe.route_options && frappe.route_options.open_transfer) {
					frappe.route_options = null;
					this.open_transfer();
				}
			},
		});
	}

	apply(r) {
		if (r && r.message) {
			this.data = r.message;
			this.render();
			this.load_feed();
		} else {
			this.load();
		}
	}

	switch_tab(tab_name) {
		this.active_tab = tab_name;
		frappe.set_route("money-hub", tab_name);
		this.wrapper.find(".mh-tab-item").removeClass("active");
		this.wrapper.find(`.mh-tab-item[data-tab="${tab_name}"]`).addClass("active");
		this.wrapper.find(".mh-tab-pane").hide();
		this.wrapper.find(`#mh-pane-${tab_name}`).fadeIn(150);
	}

	render() {
		if (!this.data) return;
		const d = this.data;
		const cur = d.currency || "TJS";
		const tt = d.totals || {};
		const wallets_count = (d.wallets || []).length;
		this.wrapper.empty();

		const net_today = Number(tt.net_today || 0);
		const net_cls = net_today > 0 ? "text-success" : net_today < 0 ? "text-danger" : "";

		// Top KPI Cockpit
		const kpi = (label, value, cls = "", sub = "") => `
			<div class="mh-kpi ${cls}">
				<div class="mh-kpi-label">${label}</div>
				<div class="mh-kpi-value">${this.fmt(value)} <small>${cur}</small></div>
				${sub ? `<div class="mh-kpi-sub">${sub}</div>` : ""}
			</div>`;

		const total_in_feed = this.feed.reduce((acc, f) => {
			const d = Number(f.debit != null ? f.debit : (f.amount > 0 ? f.amount : 0));
			return acc + d;
		}, 0);
		const total_out_feed = this.feed.reduce((acc, f) => {
			const c = Number(f.credit != null ? f.credit : (f.amount < 0 ? Math.abs(f.amount) : 0));
			return acc + c;
		}, 0);
		const net_feed = total_in_feed - total_out_feed;

		const layout = $(`
			<div class="mh-layout">
				<!-- Tab Navigation Bar with URL Routing -->
				<div class="mh-tabs-bar">
					<div class="mh-tab-item ${this.active_tab === "accounts" ? "active" : ""}" data-tab="accounts">
						💼 <span>${this.t("Счета и кассы", "Ҳамёнҳо ва суратҳисобҳо")}</span>
						<span class="mh-tab-badge">${wallets_count}</span>
					</div>
					<div class="mh-tab-item ${this.active_tab === "ledger" ? "active" : ""}" data-tab="ledger">
						📊 <span>${this.t("Лента денег (Движение средств)", "Ленти пул (Ҳаракати маблағҳо)")}</span>
						<span class="mh-tab-badge mh-ledger-count">${this.feed.length}</span>
					</div>
				</div>

				<!-- TAB 1: ACCOUNTS & COCKPIT PANE -->
				<div id="mh-pane-accounts" class="mh-tab-pane" style="${this.active_tab === "accounts" ? "display:block;" : "display:none;"}">
					<!-- Top KPI Cockpit -->
					<div class="mh-kpi-strip">
						${kpi(this.t("Всего денег", "Маблағи умумӣ"), tt.total, "mh-kpi-main", this.t("Общий баланс всех счетов", "Бақияи умумии ҳамаи суратҳисобҳо"))}
						${kpi(this.t("Наличные (Касса + Сейф)", "Нақд (Касса + Сейф)"), tt.cash, "", this.t("Физические деньги", "Пули нақд"))}
						${kpi(this.t("Безналичные (Банк + QR)", "Ғайринақд (Бонк + QR)"), tt.non_cash, "", this.t("Банки и кошельки", "Бонкҳо ва ҳамёнҳо"))}
						${kpi(this.t("Сегодня приход", "Имрӯз даромад"), tt.today_in, "mh-kpi-in", "▲ +")}
						${kpi(this.t("Сегодня расход", "Имрӯз хароҷот"), tt.today_out, "mh-kpi-out", "▼ −")}
						${kpi(this.t("Чистый поток сегодня", "Сальдои имрӯз"), net_today, net_cls, net_today >= 0 ? "🟢 " + this.t("В плюсе", "Дар фоида") : "🔴 " + this.t("Расход превысил приход", "Хароҷот зиёд шуд"))}
					</div>

					<!-- Accounts Sections (Grouped) -->
					<div class="mh-accounts-container">
						${this.render_wallet_groups(cur)}
					</div>
				</div>

				<!-- TAB 2: LEDGER (TRANSACTIONS) PANE -->
				<div id="mh-pane-ledger" class="mh-tab-pane" style="${this.active_tab === "ledger" ? "display:block;" : "display:none;"}">
					<div class="mh-ledger-container">
						<!-- Native Frappe-Style Filter Panel -->
						<div class="mh-frappe-filter-panel">
							<!-- Filter Row 1: Search & Date Presets -->
							<div class="mh-filter-row-top">
								<div class="mh-search-wrapper">
									<span class="mh-search-icon">🔍</span>
									<input type="text" id="mh-search-input" class="form-control form-control-sm mh-search-input"
										placeholder="${this.t("Поиск по номеру чека, накладной, контрагенту, статье, кассиру...", "Ҷустуҷӯ бо рақами чек, шахс, мақола...")}"
										value="${frappe.utils.escape_html(this.search_query)}">
									${this.search_query ? `<span id="mh-clear-search" class="mh-clear-search-btn">✕</span>` : ""}
								</div>

								<!-- Quick Date Preset Pills -->
								<div class="mh-date-presets">
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "today" ? "active" : ""}" data-period="today">${this.t("Сегодня", "Имрӯз")}</button>
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "yesterday" ? "active" : ""}" data-period="yesterday">${this.t("Вчера", "Дирӯз")}</button>
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "week" ? "active" : ""}" data-period="week">${this.t("7 дней", "7 рӯз")}</button>
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "month" ? "active" : ""}" data-period="month">${this.t("Этот месяц", "Ин моҳ")}</button>
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "quarter" ? "active" : ""}" data-period="quarter">${this.t("Квартал", "Семоҳа")}</button>
									<button class="mh-preset-btn ${!this.from_date && this.feed_period === "all" ? "active" : ""}" data-period="all">${this.t("Всё время", "Ҳама")}</button>
									<button class="btn btn-xs btn-default mh-btn-reset-filters" title="${this.t("Сбросить все фильтры", "Тоза кардани филтрҳо")}">
										🔄 ${this.t("Сброс", "Сброс")}
									</button>
								</div>
							</div>

							<!-- Filter Row 2: Structured Frappe Control Inputs -->
							<div class="mh-filter-row-fields">
								<!-- Account / Wallet -->
								<div class="mh-filter-field">
									<label class="mh-field-label">💳 ${this.t("Счёт / Кошелёк", "Ҳамён / Суратҳисоб")}</label>
									<select id="mh-filter-wallet" class="form-control form-control-sm mh-frappe-control">
										<option value="">${this.t("Все счета и кассы", "Ҳамаи суратҳисобҳо")}</option>
										${(d.wallets || []).map((w) => `<option value="${w.name}" ${this.feed_wallet === w.name ? "selected" : ""}>${w.icon || "💰"} ${w.wallet_name}</option>`).join("")}
									</select>
								</div>

								<!-- Operation Type -->
								<div class="mh-filter-field">
									<label class="mh-field-label">🏷️ ${this.t("Тип операции", "Намуди амалиёт")}</label>
									<select id="mh-filter-op-type" class="form-control form-control-sm mh-frappe-control">
										<option value="all" ${this.feed_op_type === "all" ? "selected" : ""}>${this.t("Все типы операций", "Ҳамаи намудҳо")}</option>
										<option value="sales" ${this.feed_op_type === "sales" ? "selected" : ""}>🛒 ${this.t("Продажи и возвраты", "Фурӯш ва бозгашт")}</option>
										<option value="supplier" ${this.feed_op_type === "supplier" ? "selected" : ""}>📦 ${this.t("Оплата поставщикам", "Пардохт ба таъминкунанда")}</option>
										<option value="expense" ${this.feed_op_type === "expense" ? "selected" : ""}>💸 ${this.t("Расходы (Операционные)", "Хароҷотҳо")}</option>
										<option value="transfer" ${this.feed_op_type === "transfer" ? "selected" : ""}>🔄 ${this.t("Переводы и инкассация", "Интиқол ва инкассатсия")}</option>
										<option value="tax" ${this.feed_op_type === "tax" ? "selected" : ""}>🏛️ ${this.t("Оплата налогов", "Пардохти андозҳо")}</option>
										<option value="other" ${this.feed_op_type === "other" ? "selected" : ""}>🏁 ${this.t("Прочее / Корректировки", "Дигарҳо")}</option>
									</select>
								</div>

								<!-- Direction -->
								<div class="mh-filter-field">
									<label class="mh-field-label">↕️ ${this.t("Направление", "Самти пул")}</label>
									<select id="mh-filter-direction" class="form-control form-control-sm mh-frappe-control">
										<option value="all" ${this.feed_direction === "all" ? "selected" : ""}>${this.t("Приход и расход", "Ҳамаи самтҳо")}</option>
										<option value="in" ${this.feed_direction === "in" ? "selected" : ""}>🟢 ${this.t("Только приход (+)", "Танҳо даромад (+)")}</option>
										<option value="out" ${this.feed_direction === "out" ? "selected" : ""}>🔴 ${this.t("Только расход (−)", "Танҳо хароҷот (−)")}</option>
									</select>
								</div>

								<!-- From Date -->
								<div class="mh-filter-field">
									<label class="mh-field-label">📅 ${this.t("С даты", "Аз санаи")}</label>
									<input type="date" id="mh-filter-from-date" class="form-control form-control-sm mh-frappe-control" value="${this.from_date}">
								</div>

								<!-- To Date -->
								<div class="mh-filter-field">
									<label class="mh-field-label">📅 ${this.t("По дату", "То санаи")}</label>
									<input type="date" id="mh-filter-to-date" class="form-control form-control-sm mh-frappe-control" value="${this.to_date}">
								</div>
							</div>
						</div>

						<!-- Ledger Table with Sticky Totals Footer -->
						<div class="retail-table-container">
							${this.render_feed_table(cur, total_in_feed, total_out_feed, net_feed)}
						</div>
					</div>
				</div>
			</div>
		`);

		this.wrapper.append(layout);
		this.bind_ui_events(layout);
	}

	render_wallet_groups(cur) {
		const d = this.data || {};
		const wallets = d.wallets || [];

		// Robust Partitioning with fallback to wallet_type
		const tills = (d.pos_tills && d.pos_tills.length)
			? d.pos_tills
			: wallets.filter((w) => (w.wallet_type || "").trim() === "Till");

		const safes = (d.safes && d.safes.length)
			? d.safes
			: wallets.filter((w) => (w.wallet_type || "").trim() === "Safe");

		const banks = (d.bank_wallets && d.bank_wallets.length)
			? d.bank_wallets
			: wallets.filter((w) => {
				const wt = (w.wallet_type || "").trim();
				return wt !== "Till" && wt !== "Safe";
			});

		const render_group = (title, icon, list, wtype_default) => {
			const subtotal = list.reduce((a, b) => a + (b.balance || 0), 0);
			const cards_html = list.map((w) => this.wallet_card(w, cur)).join("");

			return `
				<div class="mh-group-box">
					<div class="mh-group-header">
						<div class="mh-group-title">
							<span class="mh-group-icon">${icon}</span>
							<span class="mh-group-name">${title}</span>
							<span class="mh-group-count">(${list.length})</span>
						</div>
						<div class="mh-group-subtotal">
							<span class="text-muted" style="font-size: 11px;">${this.t("Итого:", "Ҳамагӣ:")}</span>
							<strong>${this.fmt(subtotal)}</strong> <small>${cur}</small>
						</div>
					</div>
					<div class="mh-grid">
						${cards_html}
						<div class="mh-card mh-card-add" data-wtype="${wtype_default}">
							<div class="mh-add-plus">➕</div>
							<div class="mh-add-text">${this.t("Добавить", "Илова кардан")}</div>
						</div>
					</div>
				</div>
			`;
		};

		return `
			<div class="mh-groups-wrap">
				${render_group(this.t("Торговые кассы (POS)", "Кассаҳои савдо (POS)"), "💵", tills, "Till")}
				${render_group(this.t("Банковские счета и QR-кошельки", "Суратҳисобҳои бонкӣ ва QR-ҳамёнҳо"), "📱", banks, "Mobile Wallet")}
				${render_group(this.t("Сейфы и резервы компании", "Сейфҳо ва фондҳои эҳтиётӣ"), "🔐", safes, "Safe")}
			</div>
		`;
	}

	wallet_card(w, cur) {
		const is_active = this.feed_wallet === w.name;
		const pos_badge = w.accept_in_pos
			? `<span class="mh-badge mh-badge-pos">${this.t("POS касса", "Кассаи POS")}</span>`
			: "";
		const fee = w.commission_percent
			? `<span class="mh-badge mh-badge-fee">${w.commission_percent}%</span>`
			: "";

		return `
			<div class="mh-card ${is_active ? "mh-card-active" : ""}" data-wallet="${frappe.utils.escape_html(w.name)}" style="--mh-accent: ${w.color || "#4a5568"}">
				<div class="mh-card-top">
					<div class="mh-card-icon-wrap" style="background: ${w.color || "#4a5568"}15; color: ${w.color || "#4a5568"};">
						${w.icon || "💰"}
					</div>
					<div class="mh-card-top-right">
						${pos_badge}
						${fee}
						<button class="mh-menu-btn" data-name="${frappe.utils.escape_html(w.name)}" title="${this.t("Настройки кошелька", "Танзимот")}">⋯</button>
					</div>
				</div>

				<div class="mh-card-name" title="${frappe.utils.escape_html(w.wallet_name)}">${frappe.utils.escape_html(w.wallet_name)}</div>
				<div class="mh-card-balance">${this.fmt(w.balance)} <small>${cur}</small></div>

				<div class="mh-card-flow">
					<span class="mh-in" title="${this.t("Приход сегодня", "Даромади имрӯз")}">▲ +${this.fmt(w.today_in)}</span>
					<span class="mh-out" title="${this.t("Расход сегодня", "Хароҷоти имрӯз")}">▼ −${this.fmt(w.today_out)}</span>
				</div>

				<div class="mh-card-actions">
					<button class="btn btn-xs btn-default mh-btn-transfer" data-wallet="${frappe.utils.escape_html(w.name)}">
						🔄 ${this.t("Перевод", "Интиқол")}
					</button>
					<button class="btn btn-xs btn-default mh-btn-statement" data-wallet="${frappe.utils.escape_html(w.name)}">
						📋 ${this.t("Выписка", "Ҳисобот")}
					</button>
				</div>
			</div>`;
	}

	render_feed_table(cur, total_in, total_out, net_feed) {
		if (!this.feed || this.feed.length === 0) {
			return `
				<div class="empty-state text-center py-5">
					<div class="empty-state-icon" style="font-size: 38px; margin-bottom: 8px;">💳</div>
					<h5 style="color: var(--text-color); font-weight: 600;">${this.t("Движений средств не найдено", "Ҳаракати маблағҳо ёфт нашуд")}</h5>
					<p class="text-muted" style="font-size: 13px;">${this.t("Измените фильтры периода, счетов или параметров поиска.", "Филтрҳоро тағйир диҳед.")}</p>
				</div>
			`;
		}

		let rows_html = "";
		this.feed.forEach((r, idx) => {
			const debit = Number(r.debit != null ? r.debit : (r.amount > 0 ? r.amount : 0));
			const credit = Number(r.credit != null ? r.credit : (r.amount < 0 ? Math.abs(r.amount) : 0));
			const is_inflow = debit > 0;
			const is_outflow = credit > 0;

			const in_html = is_inflow
				? `<span class="mh-amount-in font-weight-bold">+${this.fmt(debit)} <small>${cur}</small></span>`
				: `<span class="text-muted">—</span>`;

			const out_html = is_outflow
				? `<span class="mh-amount-out font-weight-bold">−${this.fmt(credit)} <small>${cur}</small></span>`
				: `<span class="text-muted">—</span>`;

			const wallet_icon = r.wallet_icon ? r.wallet_icon + " " : "💰 ";
			const wallet_color = r.wallet_color || "#3182ce";

			rows_html += `
				<tr class="retail-table-row mh-feed-row" data-idx="${idx}">
					<!-- Date & Time -->
					<td class="col-datetime" style="width: 130px;">
						<div class="font-weight-bold text-dark">${r.date}</div>
						<div class="text-muted" style="font-size: 11px;">⏰ ${r.time || "—"}</div>
					</td>

					<!-- Operation Type & Voucher -->
					<td class="col-type" style="width: 220px;">
						<div class="d-flex align-items-center">
							<span class="mh-op-icon mr-2">${r.icon || "💳"}</span>
							<div>
								<div class="font-weight-bold" style="font-size: 13px; color: var(--text-color);">${frappe.utils.escape_html(r.label || r.voucher_type || "Операция")}</div>
								<div class="text-muted font-monospace" style="font-size: 11px;">${r.voucher_no}</div>
							</div>
						</div>
					</td>

					<!-- Wallet Account -->
					<td class="col-wallet" style="width: 170px;">
						<span class="mh-wallet-pill" style="border-left: 3px solid ${wallet_color};">
							${wallet_icon}${frappe.utils.escape_html(r.wallet || "")}
						</span>
					</td>

					<!-- Party / Destination / Description -->
					<td class="col-party">
						${r.party ? `<div class="font-weight-bold text-dark">${frappe.utils.escape_html(r.party)}</div>` : ""}
						<div class="text-muted" style="font-size: 11.5px; line-height: 1.25;">
							${frappe.utils.escape_html(r.notes || "—")}
						</div>
					</td>

					<!-- User / Cashier -->
					<td class="col-user text-muted" style="width: 130px; font-size: 12px;">
						👤 ${frappe.utils.escape_html(r.user || "Система")}
					</td>

					<!-- Inflow (+) -->
					<td class="col-in text-right" style="width: 130px;">
						${in_html}
					</td>

					<!-- Outflow (-) -->
					<td class="col-out text-right" style="width: 130px;">
						${out_html}
					</td>
				</tr>
			`;
		});

		const net_cls = net_feed > 0 ? "text-success" : net_feed < 0 ? "text-danger" : "";

		return `
			<div class="table-responsive retail-table-wrapper">
				<table class="table table-bordered table-hover retail-catalog-table mh-feed-table">
					<thead>
						<tr>
							<th class="col-datetime">${this.t("Дата / Время", "Сана / Вақт")}</th>
							<th class="col-type">${this.t("Тип / Документ", "Намуд / Ҳуҷҷат")}</th>
							<th class="col-wallet">${this.t("Кошелёк / Счёт", "Ҳамён / Суратҳисоб")}</th>
							<th class="col-party">${this.t("Контрагент / Назначение", "Шахс / Мақсад")}</th>
							<th class="col-user">${this.t("Автор / Кассир", "Муаллиф / Кассир")}</th>
							<th class="col-in text-right">🟢 ${this.t("Приход (+)", "Даромад (+)")}</th>
							<th class="col-out text-right">🔴 ${this.t("Расход (−)", "Хароҷот (−)")}</th>
						</tr>
					</thead>
					<tbody>
						${rows_html}
					</tbody>
					<tfoot>
						<tr class="retail-totals-row mh-totals-row">
							<td colspan="2" class="col-totals-label text-left">
								<strong>${this.t("Итого:", "Ҳамагӣ:")} ${this.feed.length} ${this.t("операций", "амалиёт")}</strong>
							</td>
							<td class="text-center text-muted">—</td>
							<td colspan="2" class="text-right">
								<span class="text-muted mr-2">${this.t("Чистое сальдо потока:", "Сальдои соф:")}</span>
								<strong class="${net_cls}" style="font-size: 13.5px;">${net_feed >= 0 ? "+" : ""}${this.fmt(net_feed)} ${cur}</strong>
							</td>
							<td class="col-in text-right">
								<strong class="text-success" style="font-size: 13.5px;">+${this.fmt(total_in)} ${cur}</strong>
							</td>
							<td class="col-out text-right">
								<strong class="text-danger" style="font-size: 13.5px;">−${this.fmt(total_out)} ${cur}</strong>
							</td>
						</tr>
					</tfoot>
				</table>
			</div>
		`;
	}

	bind_ui_events(layout) {
		// Tabs switching
		layout.find(".mh-tab-item").on("click", (e) => {
			const target = $(e.currentTarget).data("tab");
			this.switch_tab(target);
		});

		// Search Input
		layout.find("#mh-search-input").on("input", (e) => {
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => {
				this.search_query = e.target.value.trim();
				this.load_feed();
			}, 300);
		});

		// Clear Search
		layout.find("#mh-clear-search").on("click", () => {
			this.search_query = "";
			layout.find("#mh-search-input").val("");
			this.load_feed();
		});

		// Quick Date Preset Buttons
		layout.find(".mh-preset-btn").on("click", (e) => {
			const p = $(e.currentTarget).data("period");
			this.feed_period = p;
			this.from_date = "";
			this.to_date = "";
			layout.find("#mh-filter-from-date").val("");
			layout.find("#mh-filter-to-date").val("");
			layout.find(".mh-preset-btn").removeClass("active");
			$(e.currentTarget).addClass("active");
			this.load_feed();
		});

		// Custom From Date & To Date
		layout.find("#mh-filter-from-date").on("change", (e) => {
			this.from_date = e.target.value;
			this.feed_period = "";
			layout.find(".mh-preset-btn").removeClass("active");
			this.load_feed();
		});

		layout.find("#mh-filter-to-date").on("change", (e) => {
			this.to_date = e.target.value;
			this.feed_period = "";
			layout.find(".mh-preset-btn").removeClass("active");
			this.load_feed();
		});

		// Reset Filters Button
		layout.find(".mh-btn-reset-filters").on("click", () => {
			this.search_query = "";
			this.feed_wallet = null;
			this.feed_period = "week";
			this.feed_op_type = "all";
			this.feed_direction = "all";
			this.from_date = "";
			this.to_date = "";
			this.load_feed();
		});

		// Operation Type filter
		layout.find("#mh-filter-op-type").on("change", (e) => {
			this.feed_op_type = e.target.value;
			this.load_feed();
		});

		// Wallet filter
		layout.find("#mh-filter-wallet").on("change", (e) => {
			this.feed_wallet = e.target.value || null;
			this.load_feed();
		});

		// Direction filter
		layout.find("#mh-filter-direction").on("change", (e) => {
			this.feed_direction = e.target.value;
			this.load_feed();
		});

		// Quick Transfer from wallet card
		layout.find(".mh-btn-transfer").on("click", (e) => {
			e.stopPropagation();
			const w = $(e.currentTarget).data("wallet");
			this.open_transfer(w);
		});

		// Statement (Выписка) from wallet card -> switches to Tab 2 (ledger) with that wallet pre-selected!
		layout.find(".mh-btn-statement").on("click", (e) => {
			e.stopPropagation();
			const w = $(e.currentTarget).data("wallet");
			this.feed_wallet = w;
			this.switch_tab("ledger");
			this.load_feed();
		});

		// Add Wallet Card
		layout.find(".mh-card-add").on("click", (e) => {
			const def = $(e.currentTarget).data("wtype") || "Mobile Wallet";
			this.open_creator(def);
		});

		// Wallet 3-dot Menu
		layout.find(".mh-menu-btn").on("click", (e) => {
			e.stopPropagation();
			this.open_menu($(e.currentTarget).data("name"));
		});

		// Row click -> Option A Modal (Centered Transaction Slip)
		layout.find(".mh-feed-row").on("click", (e) => {
			e.stopPropagation();
			const idx = $(e.currentTarget).closest(".mh-feed-row").data("idx");
			const item = this.feed[idx];
			if (item) {
				this.show_transaction_modal(item);
			}
		});
	}

	show_transaction_modal(row) {
		const cur = (this.data && this.data.currency) || "TJS";
		const debit = Number(row.debit != null ? row.debit : (row.amount > 0 ? row.amount : 0));
		const credit = Number(row.credit != null ? row.credit : (row.amount < 0 ? Math.abs(row.amount) : 0));
		const is_inflow = debit > 0;
		const amount = is_inflow ? debit : credit;
		const sign = is_inflow ? "+" : "−";
		const sign_color = is_inflow ? "#22c55e" : "#ef4444";

		const dlg = new frappe.ui.Dialog({
			title: `${row.icon || "💳"} ${frappe.utils.escape_html(row.label || row.voucher_type || "Операция")}`,
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "detail_area",
					options: `<div class="text-center py-4"><span class="spinner-border text-primary"></span></div>`,
				},
			],
		});

		dlg.show();

		// Fetch rich transaction details from backend
		frappe.call({
			method: "erpnext.accounts.page.money_hub.money_hub.get_transaction_details",
			args: {
				voucher_type: row.voucher_type,
				voucher_no: row.voucher_no,
			},
			callback: (r) => {
				const det = r.message || {};
				let items_table_html = "";

				if (det.items && det.items.length > 0) {
					const item_rows = det.items
						.map(
							(it, i) => `
						<tr>
							<td class="text-muted" style="width: 30px;">#${i + 1}</td>
							<td>
								<div class="font-weight-bold text-dark">${frappe.utils.escape_html(it.item_name)}</div>
								<div class="text-muted font-monospace" style="font-size: 11px;">${it.item_code}</div>
							</td>
							<td class="text-center">${it.qty} ${it.uom}</td>
							<td class="text-right">${this.fmt(it.rate)}</td>
							<td class="text-right font-weight-bold">${this.fmt(it.amount)}</td>
						</tr>`
						)
						.join("");

					items_table_html = `
						<div class="mh-modal-section-title">📦 ${this.t("Товары в документе", "Молҳо дар ҳуҷҷат")}</div>
						<div class="table-responsive" style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color, #e2e8f0); border-radius: 6px;">
							<table class="table table-sm table-striped mb-0" style="font-size: 12.5px;">
								<thead style="background: #f8fafc; font-size: 11px; text-transform: uppercase;">
									<tr>
										<th>#</th>
										<th>${this.t("Товар", "Мол")}</th>
										<th class="text-center">${this.t("Кол-во", "Миқдор")}</th>
										<th class="text-right">${this.t("Цена", "Нарх")}</th>
										<th class="text-right">${this.t("Сумма", "Маблағ")}</th>
									</tr>
								</thead>
								<tbody>
									${item_rows}
								</tbody>
							</table>
						</div>
					`;
				}

				let payments_html = "";
				if (det.payments && det.payments.length > 0) {
					payments_html = `
						<div class="mh-modal-section-title">💳 ${this.t("Способ оплаты", "Тарзи пардохт")}</div>
						<div class="d-flex gap-2 flex-wrap mb-3">
							${det.payments.map((p) => `<span class="badge badge-light p-2" style="font-size: 12px; border: 1px solid #e2e8f0;">${p.mode_of_payment}: <b>${this.fmt(p.amount)} ${cur}</b></span>`).join("")}
						</div>
					`;
				}

				let ref_html = "";
				if (det.references && det.references.length > 0) {
					ref_html = `
						<div class="mh-modal-section-title">🔗 ${this.t("Связанные накладные", "Ҳуҷҷатҳои алоқаманд")}</div>
						<div class="d-flex gap-2 flex-wrap mb-3">
							${det.references.map((rf) => `<span class="badge badge-light p-2" style="font-size: 12px; border: 1px solid #e2e8f0;">${rf.reference_doctype} <b>${rf.reference_name}</b> (Оплачено: ${this.fmt(rf.allocated_amount)} ${cur})</span>`).join("")}
						</div>
					`;
				}

				const slip_html = `
					<div class="mh-receipt-slip">
						<!-- Hero Amount Header -->
						<div class="mh-receipt-hero" style="border-bottom: 2px dashed var(--border-color, #e2e8f0); padding-bottom: 16px; margin-bottom: 16px; text-align: center;">
							<div class="text-muted" style="font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
								${is_inflow ? "⬇️ " + this.t("Поступление средств", "Даромади маблағ") : "⬆️ " + this.t("Списание средств", "Барориши маблағ")}
							</div>
							<div style="font-size: 32px; font-weight: 800; color: ${sign_color}; margin: 4px 0;">
								${sign}${this.fmt(amount)} <span style="font-size: 18px; font-weight: 600;">${cur}</span>
							</div>
							<div class="badge badge-pill badge-success" style="font-size: 11px; padding: 4px 10px;">
								✓ ${this.t("Проведено", "Гузаронида шуд")} (${row.voucher_no})
							</div>
						</div>

						<!-- Attributes Grid -->
						<div class="mh-receipt-grid">
							<div class="mh-receipt-cell">
								<span class="mh-receipt-lbl">${this.t("Кошелёк / Счёт", "Ҳамён / Суратҳисоб")}:</span>
								<span class="mh-receipt-val font-weight-bold">${row.wallet_icon} ${frappe.utils.escape_html(row.wallet)}</span>
							</div>
							<div class="mh-receipt-cell">
								<span class="mh-receipt-lbl">${this.t("Дата и время", "Сана ва вақт")}:</span>
								<span class="mh-receipt-val">${row.date} ${row.time ? "· ⏰ " + row.time : ""}</span>
							</div>
							<div class="mh-receipt-cell">
								<span class="mh-receipt-lbl">${this.t("Контрагент / Получатель", "Шахс / Қабулкунанда")}:</span>
								<span class="mh-receipt-val font-weight-bold text-dark">${frappe.utils.escape_html(det.party_name || row.party || "—")}</span>
							</div>
							<div class="mh-receipt-cell">
								<span class="mh-receipt-lbl">${this.t("Автор / Кассир", "Муаллиф / Кассир")}:</span>
								<span class="mh-receipt-val">👤 ${frappe.utils.escape_html(det.owner || row.user)}</span>
							</div>
							<div class="mh-receipt-cell" style="grid-column: 1 / -1;">
								<span class="mh-receipt-lbl">${this.t("Примечание / Назначение", "Эзоҳ / Мақсад")}:</span>
								<span class="mh-receipt-val text-muted">${frappe.utils.escape_html(det.remarks || row.notes || "—")}</span>
							</div>
						</div>

						${payments_html}
						${ref_html}
						${items_table_html}

						<!-- Bottom Action Buttons -->
						<div class="mh-receipt-actions" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; border-top: 1px solid var(--border-color, #e2e8f0); padding-top: 14px;">
							<button class="btn btn-sm btn-default" id="mh-modal-print">
								🖨️ ${this.t("Печать квитанции", "Чоп")}
							</button>
							<button class="btn btn-sm btn-primary" id="mh-modal-open-doc">
								📄 ${this.t("Открыть документ", "Кушодани ҳуҷҷат")}
							</button>
						</div>
					</div>
				`;

				dlg.fields_dict.detail_area.$wrapper.html(slip_html);

				// Open Frappe document
				dlg.$wrapper.find("#mh-modal-open-doc").on("click", () => {
					dlg.hide();
					frappe.set_route("Form", row.voucher_type, row.voucher_no);
				});

				// Print Receipt
				dlg.$wrapper.find("#mh-modal-print").on("click", () => {
					window.print();
				});
			},
		});
	}

	wallet_options() {
		return ((this.data && this.data.wallets) || []).filter((w) => w.enabled).map((w) => w.name);
	}

	open_transfer(from_wallet = null) {
		const opts = this.wallet_options();
		const comp = (this.data && this.data.company) || null;

		const dlg = new frappe.ui.Dialog({
			title: this.t("Перевод / Инкассация", "Интиқол / Инкассатсия"),
			fields: [
				{
					fieldname: "kind",
					fieldtype: "Select",
					label: this.t("Тип операции", "Навъи амалиёт"),
					options: ["Инкассация", "Пополнение", "Снятие", "Обычный перевод"],
					default: "Инкассация",
					reqd: 1,
				},
				{
					fieldname: "from_wallet",
					fieldtype: "Select",
					label: this.t("Откуда (Счёт списания)", "Аз куҷо"),
					options: opts,
					default: from_wallet || (opts.length ? opts[0] : null),
					reqd: 1,
				},
				{
					fieldname: "to_wallet",
					fieldtype: "Select",
					label: this.t("Куда (Счёт зачисления)", "Ба куҷо"),
					options: opts,
					default: opts.length > 1 ? (from_wallet === opts[0] ? opts[1] : opts[0]) : null,
					reqd: 1,
				},
				{ fieldname: "amount", fieldtype: "Currency", label: this.t("Сумма", "Маблағ"), reqd: 1 },
				{ fieldname: "note", fieldtype: "Data", label: this.t("Комментарий", "Эзоҳ") },
			],
			primary_action_label: this.t("Перевести", "Интиқол кардан"),
			primary_action: (v) => {
				dlg.get_primary_btn().prop("disabled", true);
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.transfer_money",
					args: { ...v, company: comp },
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
						frappe.show_alert({
							message: this.t("Перевод успешно выполнен", "Интиқол бомуваффақият анҷом шуд"),
							indicator: "green",
						});
					},
					error: () => dlg.get_primary_btn().prop("disabled", false),
				});
			},
		});
		dlg.show();
	}

	open_creator(default_type = "Mobile Wallet") {
		const comp = (this.data && this.data.company) || null;

		const dlg = new frappe.ui.Dialog({
			title: this.t("Новый кошелёк / Касса", "Ҳамёни нав"),
			fields: [
				{ fieldname: "wallet_name", fieldtype: "Data", label: this.t("Название (например: Alif QR)", "Ном"), reqd: 1 },
				{
					fieldname: "wallet_type",
					fieldtype: "Select",
					label: this.t("Тип", "Навъ"),
					options: [
						{ label: "💵 " + this.t("Торговая касса (POS)", "Кассаи савдо (POS)"), value: "Till" },
						{ label: "📱 " + this.t("Мобильный кошелёк / QR", "Ҳамёни мобилӣ / QR"), value: "Mobile Wallet" },
						{ label: "🏦 " + this.t("Банковский расчётный счёт", "Суратҳисоби бонкӣ"), value: "Bank" },
						{ label: "🔐 " + this.t("Сейф / Резерв", "Сейф / Эҳтиётӣ"), value: "Safe" },
					],
					default: default_type,
					reqd: 1,
				},
				{ fieldname: "opening_balance", fieldtype: "Currency", label: this.t("Начальный остаток", "Бақияи аввалия"), default: 0 },
				{ fieldname: "accept_in_pos", fieldtype: "Check", label: this.t("Принимать оплату в POS", "Дар POS қабул шавад"), default: default_type === "Till" || default_type === "Mobile Wallet" ? 1 : 0 },
				{ fieldname: "commission_percent", fieldtype: "Percent", label: this.t("Комиссия банка/сервиса, %", "Комиссия, %"), default: 0 },
			],
			primary_action_label: this.t("Создать", "Сохтан"),
			primary_action: (v) => {
				dlg.get_primary_btn().prop("disabled", true);
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.create_wallet",
					args: { ...v, company: comp },
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
						frappe.show_alert({ message: this.t("Кошелёк создан", "Ҳамён сохта шуд"), indicator: "green" });
					},
					error: () => dlg.get_primary_btn().prop("disabled", false),
				});
			},
		});
		dlg.show();
	}

	open_menu(name) {
		const w = ((this.data && this.data.wallets) || []).find((x) => x.name === name);
		if (!w) return;
		const comp = (this.data && this.data.company) || null;

		const dlg = new frappe.ui.Dialog({
			title: `${w.icon || "💰"} ${w.wallet_name}`,
			fields: [
				{ fieldname: "wallet_name", fieldtype: "Data", label: this.t("Название", "Ном"), default: w.wallet_name, reqd: 1 },
				{ fieldname: "commission_percent", fieldtype: "Percent", label: this.t("Комиссия, %", "Комиссия, %"), default: w.commission_percent },
				{ fieldname: "accept_in_pos", fieldtype: "Check", label: this.t("Принимать оплату в кассе POS", "Дар POS қабул шавад"), default: w.accept_in_pos },
				{ fieldname: "enabled", fieldtype: "Check", label: this.t("Активен / Показывать в хабе", "Фаъол"), default: w.enabled },
			],
			primary_action_label: this.t("Сохранить", "Захира кардан"),
			primary_action: (v) => {
				dlg.get_primary_btn().prop("disabled", true);
				frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.update_wallet",
					args: { name: w.name, company: comp, ...v },
					freeze: true,
					callback: (r) => {
						dlg.hide();
						this.apply(r);
						frappe.show_alert({ message: this.t("Изменения сохранены", "Тағйирот сабт шуд"), indicator: "green" });
					},
					error: () => dlg.get_primary_btn().prop("disabled", false),
				});
			},
		});
		dlg.show();
	}
}
