// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["money-hub"].on_page_load = function (wrapper) {
	const is_tg = frappe.boot.user.language === "tg";
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: is_tg ? __("Пул") : __("Деньги"),
		single_column: true,
	});

	page.set_primary_action(is_tg ? __("Хароҷотҳо") : __("Расходы"), () => frappe.set_route("expense-desk"));
	page.add_inner_button(is_tg ? __("Интиқол") : __("Перевод"), () => wrapper.money_hub_app?.open_transfer());
	page.add_menu_item(is_tg ? __("Маблағи соҳиб") : __("Средства владельца"), () => wrapper.money_hub_app?.open_owner_money());
	page.add_inner_button(is_tg ? __("Навсозӣ") : __("Обновить"), () => wrapper.money_hub_app?.load());
	if (frappe.model.can_create("Money Wallet")) page.add_menu_item(is_tg ? __("Ҳамёни нав") : __("Создать кошелёк"), () => wrapper.money_hub_app?.open_creator());
	page.add_menu_item(is_tg ? __("Танзими ҳамёнҳо") : __("Настройка кошельков"), () => frappe.set_route("List", "Money Wallet"));
	for (const [ru, tg, route] of [
		["Налоги", "Андозҳо", "tax-desk"], ["Поставщики", "Таъминкунандагон", "supplier-hub"],
		["Сотрудники", "Кормандон", "staff-hub"], ["Каталог товаров", "Каталоги молҳо", "product-catalog"],
	]) page.add_menu_item(is_tg ? __(tg) : __(ru), () => frappe.set_route(route));

	frappe.call({
		method: "erpnext.accounts.page.expense_desk.expense_desk.get_shift_review_navigation",
	}).then(response => {
		if (response.message?.available) page.add_menu_item(__("Shift Review"), () => frappe.set_route("shift-review"));
	}).catch(() => { /* Optional POS page does not block Money Hub. */ });

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
		this.feed_result = null;
		this.feed_start = 0;
		this.include_hidden = false;

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

	fmt(amount, currency = this.data?.currency) {
		const n = Number(amount || 0);
		const precision = this.data?.currency_precisions?.[currency] ?? 2;
		return n.toLocaleString(this.is_tg ? "tg" : "ru-RU", { minimumFractionDigits: precision, maximumFractionDigits: precision });
	}

	async load() {
		const sequence = this.load_sequence = (this.load_sequence || 0) + 1;
		this.feed_sequence = (this.feed_sequence || 0) + 1;
		this.wrapper.text(__("Loading…"));
		try {
			const response = await frappe.call({method: "erpnext.accounts.page.money_hub.money_hub.get_money_hub_data", args: {include_hidden: this.include_hidden ? 1 : 0}, silent: true});
			if (sequence !== this.load_sequence) return;
			if (!response.message) throw new Error(__("Could not load account balances."));
			this.data = response.message;
			if (this.feed_wallet && !this.data.wallets.some((wallet) => wallet.name === this.feed_wallet)) this.feed_wallet = null;
			this.feed_result = null;
			this.feed = [];
			this.render();
			this.load_feed();
		} catch (error) {
			if (sequence !== this.load_sequence) return;
			this.data = null;
			this.feed = [];
			this.read_error(error);
		}
	}

	read_error(error) {
		this.wrapper.html(`<p role="alert">${frappe.utils.escape_html(error.message || __("Could not load account balances."))}</p><button class="btn btn-default mh-retry">${__("Retry")}</button>`);
		this.wrapper.find(".mh-retry").on("click", () => this.load());
	}

	async load_feed(start = 0) {
		clearTimeout(this.search_timer);
		if (!this.data) return;
		const sequence = this.feed_sequence = (this.feed_sequence || 0) + 1;
		this.feed_start = start;
		this.feed_loading = true;
		this.feed_error = false;
		this.render_feed_state();
		try {
			const response = await frappe.call({
				method: "erpnext.accounts.page.money_hub.money_hub.get_money_movements",
				args: {
					company: this.data.company, include_hidden: this.include_hidden ? 1 : 0,
					wallet: this.feed_wallet, period: this.feed_period,
					from_date: this.from_date || null, to_date: this.to_date || null,
					op_type: this.feed_op_type, direction: this.feed_direction,
					search: this.search_query, start, page_length: 50,
				},
				silent: true,
			});
			if (sequence !== this.feed_sequence) return;
			if (!response.message || !Array.isArray(response.message.rows) || response.message.company !== this.data.company) throw new Error(__("Could not load account movements."));
			this.feed_result = response.message;
			this.feed_start = response.message.start;
			this.feed = response.message.rows;
			this.feed_loading = false;
			this.render_feed_state();
			if (frappe.route_options && frappe.route_options.open_transfer) {
				frappe.route_options = null;
				this.open_transfer();
			}
		} catch (error) {
			if (sequence !== this.feed_sequence) return;
			this.feed = [];
			this.feed_result = null;
			this.feed_loading = false;
			this.feed_error = true;
			this.render_feed_state();
		}
	}

	apply() {
		// Write responses may use the default active scope; reload the chosen scope.
		this.load();
	}

	switch_tab(tab_name) {
		this.active_tab = tab_name;
		frappe.set_route("money-hub", tab_name);
		this.render();
	}

	render_feed_state() {
		if (this.active_tab === "accounts") {
			// Background history loads must not replace the focused account table.
			this.wrapper.find(".mh-ledger-count").text(this.feed_loading ? "…" : this.feed_result?.total_count ?? "—");
		} else {
			this.render();
		}
	}

	render() {
		if (!this.data) return;
		const focused = document.activeElement;
		const focus_id = focused?.id;
		const selection = focused?.selectionStart;
		const d = this.data;
		const cur = d.currency || "TJS";
		const tt = d.totals || {};
		const accounts_count = (d.accounts || []).length;
		this.wrapper.empty();

		const summary = this.feed_result?.summary || {};
		const total_in_feed = summary.debit || 0;
		const total_out_feed = summary.credit || 0;
		const net_feed = summary.net || 0;

		const layout = $(`
			<div class="mh-layout">
				<!-- Tab Navigation Bar with URL Routing -->
				<div class="mh-tabs-bar">
					<button type="button" class="mh-tab-item ${this.active_tab === "accounts" ? "active" : ""}" data-tab="accounts">
						<span>${this.t("Счета и кассы", "Ҳамёнҳо ва суратҳисобҳо")}</span>
						<span class="mh-tab-badge">${accounts_count}</span>
					</button>
					<button type="button" class="mh-tab-item ${this.active_tab === "ledger" ? "active" : ""}" data-tab="ledger">
						<span>${this.t("Движение денег", "Ҳаракати пул")}</span>
						<span class="mh-tab-badge mh-ledger-count">${this.feed_loading ? "…" : this.feed_result?.total_count ?? "—"}</span>
					</button>
				</div>

				<div class="mh-account-scope">
					<span class="text-muted">${frappe.utils.escape_html(d.company)} · ${frappe.utils.escape_html(d.as_of || "")} · ${frappe.utils.escape_html(cur)}</span>
					<label><input type="checkbox" class="mh-include-hidden" ${this.include_hidden ? "checked" : ""}> ${this.t("Включить неактивные кошельки", "Ҳамёнҳои ғайрифаъолро дохил кардан")}</label>
				</div>
				<div id="mh-pane-accounts" class="mh-tab-pane" style="${this.active_tab === "accounts" ? "display:block;" : "display:none;"}">
					${this.render_accounts(cur, tt)}
				</div>

				<!-- TAB 2: LEDGER (TRANSACTIONS) PANE -->
				<div id="mh-pane-ledger" class="mh-tab-pane" style="${this.active_tab === "ledger" ? "display:block;" : "display:none;"}">
					<div class="mh-ledger-container">
						<!-- Native Frappe-Style Filter Panel -->
						<div class="mh-frappe-filter-panel">
							<!-- Filter Row 1: Search & Date Presets -->
							<div class="mh-filter-row-top">
								<div class="mh-search-wrapper">
									<span class="mh-search-icon"></span>
									<input type="text" id="mh-search-input" aria-label="${this.t("Поиск движений", "Ҷустуҷӯи ҳаракатҳо")}" class="form-control form-control-sm mh-search-input"
										placeholder="${this.t("Поиск по номеру чека, накладной, контрагенту, статье, кассиру...", "Ҷустуҷӯ бо рақами чек, шахс, мақола...")}"
										value="${frappe.utils.escape_html(this.search_query)}">
									${this.search_query ? `<button id="mh-clear-search" class="btn btn-link mh-clear-search-btn" aria-label="${this.t("Очистить поиск", "Тоза кардани ҷустуҷӯ")}">×</button>` : ""}
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
										${this.t("Сброс", "Сброс")}
									</button>
								</div>
							</div>

							<!-- Filter Row 2: Structured Frappe Control Inputs -->
							<div class="mh-filter-row-fields">
								<!-- Account / Wallet -->
								<div class="mh-filter-field">
									<label class="mh-field-label" for="mh-filter-wallet">${this.t("Счёт / Кошелёк", "Ҳамён / Суратҳисоб")}</label>
									<select id="mh-filter-wallet" class="form-control form-control-sm mh-frappe-control">
										<option value="">${this.t("Все счета и кассы", "Ҳамаи суратҳисобҳо")}</option>
										${(d.wallets || []).map((w) => `<option value="${frappe.utils.escape_html(w.name)}" ${this.feed_wallet === w.name ? "selected" : ""}>${frappe.utils.escape_html(w.wallet_name)}</option>`).join("")}
									</select>
								</div>

								<!-- Operation Type -->
								<div class="mh-filter-field">
									<label class="mh-field-label" for="mh-filter-op-type">${this.t("Тип операции", "Намуди амалиёт")}</label>
									<select id="mh-filter-op-type" class="form-control form-control-sm mh-frappe-control">
										<option value="all" ${this.feed_op_type === "all" ? "selected" : ""}>${this.t("Все типы операций", "Ҳамаи намудҳо")}</option>
										<option value="sales" ${this.feed_op_type === "sales" ? "selected" : ""}>${this.t("Продажи и возвраты", "Фурӯш ва бозгашт")}</option>
										<option value="supplier" ${this.feed_op_type === "supplier" ? "selected" : ""}>${this.t("Оплата поставщикам", "Пардохт ба таъминкунанда")}</option>
										<option value="expense" ${this.feed_op_type === "expense" ? "selected" : ""}>${this.t("Расходы (Операционные)", "Хароҷотҳо")}</option>
										<option value="transfer" ${this.feed_op_type === "transfer" ? "selected" : ""}>${this.t("Переводы и инкассация", "Интиқол ва инкассатсия")}</option>
										<option value="employee" ${this.feed_op_type === "employee" ? "selected" : ""}>${this.t("Платежи сотрудникам", "Пардохтҳои кормандон")}</option>
										<option value="owner" ${this.feed_op_type === "owner" ? "selected" : ""}>${this.t("Средства и займы владельца", "Маблағ ва қарзҳои соҳиб")}</option>
										<option value="other" ${this.feed_op_type === "other" ? "selected" : ""}>${this.t("Прочее / Корректировки", "Дигарҳо")}</option>
									</select>
								</div>

								<!-- Direction -->
								<div class="mh-filter-field">
									<label class="mh-field-label" for="mh-filter-direction">${this.t("Направление", "Самти пул")}</label>
									<select id="mh-filter-direction" class="form-control form-control-sm mh-frappe-control">
										<option value="all" ${this.feed_direction === "all" ? "selected" : ""}>${this.t("Приход и расход", "Ҳамаи самтҳо")}</option>
										<option value="in" ${this.feed_direction === "in" ? "selected" : ""}>${this.t("Только приход (+)", "Танҳо даромад (+)")}</option>
										<option value="out" ${this.feed_direction === "out" ? "selected" : ""}>${this.t("Только расход (−)", "Танҳо хароҷот (−)")}</option>
									</select>
								</div>

								<!-- From Date -->
								<div class="mh-filter-field">
									<label class="mh-field-label" for="mh-filter-from-date">${this.t("С даты", "Аз санаи")}</label>
									<input type="date" id="mh-filter-from-date" class="form-control form-control-sm mh-frappe-control" value="${this.from_date}">
								</div>

								<!-- To Date -->
								<div class="mh-filter-field">
									<label class="mh-field-label" for="mh-filter-to-date">${this.t("По дату", "То санаи")}</label>
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
		if (focus_id) {
			const control = this.wrapper.find("[id]").toArray().find((node) => node.id === focus_id);
			if (control) {
				control.focus({preventScroll: true});
				if (selection != null && control.setSelectionRange) control.setSelectionRange(selection, selection);
			}
		}
	}

	render_accounts(cur, totals) {
		const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
		const t = (ru, tg) => this.t(ru, tg);
		const money = (value, code = cur) => value == null ? "—" : esc(this.fmt(value, code));
		const accounts = this.data.accounts || [];
		const metric = (label, value) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`;
		const rows = accounts.map((account) => `<tr>
			<td><a href="${esc(frappe.utils.get_form_link("Account", account.account))}">${esc(account.account)}</a>
				<div class="text-muted mh-account-aliases">${esc(account.wallet_names.join(" / "))}${account.enabled ? "" : " · " + t("Неактивен", "Ғайрифаъол")}</div></td>
			<td class="text-right ${account.balance < 0 ? "text-danger" : ""}">${money(account.balance)}
				${account.account_currency && account.account_currency !== cur ? `<div class="text-muted">${money(account.account_balance, account.account_currency)} ${esc(account.account_currency)}</div>` : ""}
				${account.balance == null ? `<div class="text-muted">${t("Ограничено правами", "Дастрасӣ маҳдуд аст")}</div>` : ""}</td>
			<td class="text-right">${money(account.opening_balance)}</td>
			<td class="text-right">${money(account.today_in)}</td>
			<td class="text-right">${money(account.today_out)}</td>
			<td><button type="button" class="btn btn-default btn-xs mh-btn-statement" data-wallet="${esc(account.primary_wallet)}">${t("Движения", "Ҳаракатҳо")}</button></td>
		</tr>`).join("");
		return `<section class="mh-account-overview">
			<div class="mh-account-summary">
				${metric(t("Деньги на счетах", "Маблағ дар суратҳисобҳо"), totals.total)}
				${metric(t("Наличные", "Нақд"), totals.cash)}
				${metric(t("Банк и кошельки", "Бонк ва ҳамёнҳо"), totals.non_cash)}
				${metric(t("Изменение за сегодня", "Тағйироти имрӯз"), totals.net_today)}
			</div>
			<p class="text-muted mh-account-note">${t("Остатки по доступным проводкам на указанную дату. Все суммы в", "Бақия аз рӯи сабтҳои дастрас то санаи нишондодашуда. Ҳамаи маблағҳо бо")} ${esc(cur)}.
				${t("Приход и расход включают переводы. Изменение денег не является прибылью.", "Воридот ва пардохт интиқолҳоро дар бар мегиранд. Тағйири пул фоида нест.")}</p>
			${rows ? `<div class="mh-account-table" tabindex="0" role="region" aria-label="${t("Остатки по счетам", "Бақияҳои суратҳисобҳо")}"><table class="table table-hover"><thead><tr>
				${[t("Счёт / кошельки", "Суратҳисоб / ҳамёнҳо"), t("Остаток", "Бақия"), t("На начало дня", "Аввали рӯз"), t("Приход сегодня", "Воридоти имрӯз"), t("Расход сегодня", "Пардохти имрӯз"), ""].map((label, i) => `<th scope="col" class="${i > 0 && i < 5 ? "text-right" : ""}">${label}</th>`).join("")}
				</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="mh-history-state">${t("Нет доступных счетов. Проверьте доступ или включите неактивные кошельки.", "Суратҳисобҳои дастрас нестанд. Дастрасиро санҷед ё ҳамёнҳои ғайрифаъолро дохил кунед.")}</p>`}
			<details class="text-muted mh-account-explanation"><summary>${t("Как читать остатки", "Бақияҳоро чӣ гуна хондан лозим")}</summary>
				<p>${t("Начало дня + приход − расход = остаток. Учитываются проведённые записи до конца указанной даты, без будущих дат и отменённых проводок. Кошельки одного счёта показаны в одной строке и считаются один раз.", "Аввали рӯз + воридот − пардохт = бақия. Сабтҳо то охири санаи нишондодашуда, бе санаҳои оянда ва сабтҳои бекоршуда ҳисоб мешаванд. Ҳамёнҳои як суратҳисоб дар як сатр нишон дода шуда, як бор ҳисоб мешаванд.")}</p>
				<p>${t("Отключённые кошельки входят в обе вкладки только при включённом флажке выше. Если у счёта есть активный кошелёк, учитывается весь доступный счёт. Это не физический пересчёт кассы и не итог смены. Несинхронизированные продажи POS пока не входят в учёт.", "Ҳамёнҳои ғайрифаъол ба ҳар ду ҷадвал танҳо бо аломати боло дохил мешаванд. Агар суратҳисоб ҳамёни фаъол дошта бошад, тамоми суратҳисоби дастрас ҳисоб мешавад. Ин ҳисобкунии нақд ё натиҷаи баст нест. Фурӯшҳои ҳамоҳангнашудаи POS ҳоло ба ҳисоб дохил намешаванд.")}</p>
				<p>${t("Остатки используют все доступные проводки. Вкладка движений дополнительно ограничена доступом к документам и поддерживаемыми типами источников, поэтому её итоги могут отличаться.", "Бақияҳо ҳамаи сабтҳои дастрасро истифода мебаранд. Ҷадвали ҳаракатҳо инчунин аз рӯи дастрасӣ ба ҳуҷҷатҳо ва намудҳои манбаъҳои дастгиришаванда маҳдуд аст, бинобар ин ҷамъбаст фарқ карда метавонад.")}</p>
			</details>
		</section>`;
	}

	render_feed_table(cur, total_in, total_out, net_feed) {
		const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
		const t = (ru, tg) => this.t(ru, tg);
		if (this.feed_loading) return `<p role="status" aria-live="polite" class="mh-history-state">${t("Загрузка движений…", "Боркунии ҳаракатҳо…")}</p>`;
		if (this.feed_error) return `<div role="alert" class="mh-history-state"><p>${t("Не удалось загрузить движения. Проверьте период и доступ.", "Боркунии ҳаракатҳо нашуд. Давра ва дастрасиро санҷед.")}</p><button class="btn btn-default mh-feed-retry">${__("Retry")}</button></div>`;
		if (!this.feed_result) return "";
		const result = this.feed_result;
		const date_scope = (result.from_date || "…") + " — " + (result.to_date || "…");
		const money = (n) => esc(this.fmt(n));
		const rows = this.feed.map((row, idx) => {
			const original = (row.movements || [row]).filter((leg) => leg.account_currency && leg.account_currency !== cur && leg.account_amount != null)
				.map((leg) => `<div class="text-muted">${esc(this.fmt(leg.account_amount, leg.account_currency))} ${esc(leg.account_currency)}</div>`).join("");
			const wallet_label = row.transfer_from && row.transfer_to
				? (row.transfer_from.join(" / ") || t("Вне выбранных счетов", "Берун аз суратҳисобҳои интихобшуда")) + " → " +
					(row.transfer_to.join(" / ") || t("Вне выбранных счетов", "Берун аз суратҳисобҳои интихобшуда")) : row.wallet;
			const transfer = row.transfer_amount ? `<div class="text-muted">${t("Переведено", "Интиқол шуд")}: ${money(row.transfer_amount)} ${esc(cur)}</div>` : "";
			return `<tr class="mh-feed-row" data-idx="${idx}">
				<td>${esc(row.date)}</td>
				<td><button class="btn btn-link mh-detail-button" data-idx="${idx}">${esc(this.is_tg ? row.label_tg || row.label : row.label)}</button>
					<div><a href="${esc(frappe.utils.get_form_link(row.voucher_type, row.voucher_no))}">${esc(row.voucher_no)}</a></div></td>
				<td>${esc(wallet_label)}${original}${transfer}</td>
				<td>${esc(row.party || "—")}<div class="text-muted mh-history-note">${esc(row.notes)}</div></td>
				<td class="text-right">${row.debit ? money(row.debit) : "—"}</td>
				<td class="text-right">${row.credit ? money(row.credit) : "—"}</td>
			</tr>`;
		}).join("");
		return `<div class="mh-history">
			<p class="text-muted mh-history-scope">${esc(result.company)} · ${esc(date_scope)} · ${esc(cur)}<br>
				${t("Только доступные проведённые документы и счета. Движение денег не является прибылью.", "Танҳо ҳуҷҷатҳои сабтшуда ва суратҳисобҳои дастрас. Ҳаракати пул фоида нест.")}
				${this.feed_wallet ? t("Выбранный счёт: включая переводы.", "Суратҳисоби интихобшуда: бо интиқолҳо.") : t("Парные переводы между доступными счетами исключены из прихода и расхода; разница остаётся в движении.", "Интиқолҳои ҷуфт байни суратҳисобҳои дастрас аз воридот ва пардохт хориҷ шудаанд; фарқият дар ҳаракат мемонад.")}</p>
			<details class="mh-history-coverage text-muted"><summary>${t("Какие документы включены", "Кадом ҳуҷҷатҳо дохил шудаанд")}</summary>
				${t("Платёжные поручения, бухгалтерские проводки, счета продаж/POS и закупок. Другие типы документов пока не включены. Итоги могут отличаться от полного остатка счёта из-за доступа к документам.", "Пардохтҳо, сабтҳои муҳосибӣ, ҳисобҳои фурӯш/POS ва харид. Дигар намудҳои ҳуҷҷатҳо ҳоло дохил нашудаанд. Ҷамъбаст аз бақияи пурраи суратҳисоб аз сабаби дастрасӣ ба ҳуҷҷатҳо фарқ карда метавонад.")}
			</details>
			<div class="mh-history-summary" aria-label="${t("Итоги всех результатов", "Ҷамъбасти ҳамаи натиҷаҳо")}">
				<div><span>${t("Приход", "Воридот")}</span><strong>${money(total_in)}</strong></div>
				<div><span>${t("Расход", "Пардохт")}</span><strong>${money(total_out)}</strong></div>
				<div><span>${t("Изменение остатка", "Тағйири бақия")}</span><strong>${money(net_feed)}</strong></div>
				<div><span>${t("Переводы внутри выбранных счетов", "Интиқол байни суратҳисобҳои интихобшуда")}</span><strong>${money(result.summary.transfer_amount)}</strong></div>
			</div>
			<p class="text-muted">${t("Итоги по всем результатам", "Ҷамъбасти ҳамаи натиҷаҳо")}: ${result.total_count}</p>
			${rows ? `<div class="mh-history-table" tabindex="0" role="region" aria-label="${t("История движения денег", "Таърихи ҳаракати пул")}"><table class="table table-hover mh-feed-table"><thead><tr>
				${[t("Дата", "Сана"), t("Операция / документ", "Амалиёт / ҳуҷҷат"), t("Счёт", "Суратҳисоб"), t("Контрагент / назначение", "Тараф / мақсад"), t("Приход", "Воридот"), t("Расход", "Пардохт")].map((label, i) => `<th scope="col" class="${i >= 4 ? "text-right" : ""}">${label}</th>`).join("")}
				</tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="mh-history-state">${t("Движений не найдено. Измените фильтры.", "Ҳаракатҳо ёфт нашуданд. Филтрҳоро тағйир диҳед.")}</p>`}
			<div class="mh-history-pagination">
				<button class="btn btn-default btn-sm mh-feed-prev" ${result.start === 0 ? "disabled" : ""}>${t("Назад", "Қафо")}</button>
				<span role="status">${result.total_count ? result.start + 1 : 0}–${result.start + this.feed.length} / ${result.total_count}</span>
				<button class="btn btn-default btn-sm mh-feed-next" ${result.has_more ? "" : "disabled"}>${t("Далее", "Баъд")}</button>
			</div>
		</div>`;
	}

	bind_ui_events(layout) {
		layout.find(".mh-include-hidden").on("change", (event) => {
			this.include_hidden = event.target.checked;
			this.load();
		});
		layout.find(".mh-feed-retry").on("click", () => this.load_feed(this.feed_start));
		layout.find(".mh-feed-prev").on("click", () => this.load_feed(Math.max(0, this.feed_start - 50)));
		layout.find(".mh-feed-next").on("click", () => this.load_feed(this.feed_start + 50));
		// Tabs switching
		layout.find(".mh-tab-item").on("click", (e) => {
			const target = $(e.currentTarget).data("tab");
			this.switch_tab(target);
		});

		// Search Input
		layout.find("#mh-search-input").on("input", (e) => {
			clearTimeout(this.search_timer);
			this.feed_sequence = (this.feed_sequence || 0) + 1;
			this.search_query = e.target.value.trim();
			this.search_timer = setTimeout(() => {
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
			if ($(e.target).closest("a").length) return;
			e.stopPropagation();
			const idx = $(e.currentTarget).closest(".mh-feed-row").data("idx");
			const item = this.feed[idx];
			if (item) {
				this.show_transaction_modal(item);
			}
		});
	}

	show_transaction_modal(row) {
		const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
		const t = (ru, tg) => this.t(ru, tg);
		const money = (value, currency) => value == null || !currency ? "—" : esc(this.fmt(value, currency)) + " " + esc(currency);
		const link = (doctype, name, label = name) => '<a href="' + esc(frappe.utils.get_form_link(doctype, name)) + '">' + esc(label) + '</a>';
		const table = (headers, rows) => '<div class="mh-transaction-table" tabindex="0" role="region" aria-label="' + esc(headers.join(", ")) + '"><table class="table table-sm"><thead><tr>' +
			headers.map((label) => '<th scope="col">' + esc(label) + '</th>').join("") + '</tr></thead><tbody>' +
			rows.map((cells) => '<tr>' + cells.map((cell) => '<td>' + cell + '</td>').join("") + '</tr>').join("") + '</tbody></table></div>';
		const section = (label, content) => '<h6>' + esc(label) + '</h6>' + content;
		let active = true;
		let request = 0;
		const dlg = new frappe.ui.Dialog({
			title: t("Детали операции", "Тафсилоти амалиёт"),
			size: "large",
			fields: [{ fieldtype: "HTML", fieldname: "detail_area" }],
			onhide: () => { active = false; },
		});
		const area = dlg.fields_dict.detail_area.$wrapper;
		const load = async () => {
			const sequence = ++request;
			area.html('<div class="mh-transaction-details" role="status" aria-live="polite">' + esc(t("Загрузка операции…", "Боркунии амалиёт…")) + '</div>');
			try {
				const response = await frappe.call({
					method: "erpnext.accounts.page.money_hub.money_hub.get_transaction_details",
					args: { voucher_type: row.voucher_type, voucher_no: row.voucher_no, company: this.data.company },
					silent: true,
				});
				if (!active || sequence !== request) return;
				const det = response.message;
				if (!det || det.company !== this.data.company || det.docstatus !== 1 || !Array.isArray(det.movements) || !det.movements.length) {
					throw new Error(t("Операция недоступна. Обновите историю.", "Амалиёт дастнорас аст. Таърихро нав кунед."));
				}
				const movement = det.movements.find((item) => item.gl_name === row.gl_name);
				if (!movement) throw new Error(t("Движение больше недоступно. Обновите историю.", "Амалиёт дигар дастнорас аст. Таърихро нав кунед."));
				const amount = movement.debit == null || movement.credit == null ? null : movement.debit - movement.credit;
				const attributes = [
					[t("Документ", "Ҳуҷҷат"), link(det.voucher_type, det.voucher_no)],
					[t("Статус", "Ҳолат"), esc(__(det.status))],
					[t("Дата", "Сана"), esc(det.posting_date + (det.posting_time ? " " + det.posting_time : ""))],
					[t("Компания", "Ширкат"), esc(det.company)],
					[t("Контрагент", "Тарафи муомила"), esc(det.party_name || "—")],
					[t("Автор", "Муаллиф"), esc(det.owner)],
				];
				let html = '<div class="mh-transaction-details"><div class="mh-transaction-summary"><span>' +
					esc(movement.wallet) + '</span><strong>' + money(amount, movement.currency) + '</strong></div>' +
					'<dl class="mh-transaction-meta">' + attributes.map(([label, value]) => '<div><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>').join("") + '</dl>';
				if (det.remarks) html += '<p class="mh-transaction-note">' + esc(det.remarks) + '</p>';
				html += section(t("Движения по доступным счетам", "Амалиётҳои суратҳисобҳои дастрас"), table(
					[t("Счёт", "Суратҳисоб"), t("Поступило", "Воридот"), t("Выбыло", "Барориш"), t("В валюте счёта", "Бо асъори суратҳисоб")],
					det.movements.map((item) => [esc(item.wallet), money(item.debit, item.currency), money(item.credit, item.currency),
						item.account_currency !== item.currency ? money(item.account_debit == null || item.account_credit == null ? null : item.account_debit - item.account_credit, item.account_currency) : "—"])
				));
				if (det.paid_from || det.paid_to) html += section(t("Платёж", "Пардохт"), table(
					[t("Откуда / куда", "Аз куҷо / ба куҷо"), t("Счёт", "Суратҳисоб"), t("Сумма", "Маблағ")],
					[[esc(t("Откуда", "Аз куҷо")), esc(det.paid_from || "—"), money(det.paid_amount, det.paid_from_account_currency)],
						[esc(t("Куда", "Ба куҷо")), esc(det.paid_to || "—"), money(det.received_amount, det.paid_to_account_currency)]]
				));
				if (det.items?.length) html += section(t("Товары", "Молҳо"), table(
					[t("Товар", "Мол"), t("Количество", "Миқдор"), t("Цена", "Нарх"), t("Сумма", "Маблағ")],
					det.items.map((item) => [esc(item.item_name || item.item_code || "—"), esc(item.qty ?? "—") + " " + esc(item.uom), money(item.rate, item.currency), money(item.amount, item.currency)])
				));
				if (det.grand_total != null) html += '<p>' + esc(t("Итого по документу", "Ҷамъи ҳуҷҷат")) + ': ' + money(det.grand_total, det.currency) + '</p>';
				if (det.payments?.length) html += section(t("Способы оплаты", "Тарзҳои пардохт"), table(
					[t("Способ оплаты", "Тарзи пардохт"), t("Сумма", "Маблағ")], det.payments.map((item) => [esc(item.mode_of_payment), money(item.amount, item.currency)])
				));
				if (det.references?.length) html += section(t("Связанные документы", "Ҳуҷҷатҳои алоқаманд"), table(
					[t("Документ", "Ҳуҷҷат"), t("Распределено", "Тақсимшуда")],
					det.references.map((item) => [link(item.reference_doctype, item.reference_name), money(item.allocated_amount, item.currency)])
				));
				if (det.accounts?.length) html += section(t("Счета документа", "Суратҳисобҳои ҳуҷҷат"), table(
					[t("Счёт", "Суратҳисоб"), t("Дебет", "Дебет"), t("Кредит", "Кредит")],
					det.accounts.map((item) => [esc(item.account), money(item.debit, item.currency), money(item.credit, item.currency)])
				));
				if (det.references_restricted || det.accounts_restricted) html += '<p class="text-muted">' +
					esc(t("Некоторые связанные документы или счета ограничены правами доступа.", "Баъзе ҳуҷҷатҳо ё суратҳисобҳои алоқаманд бо ҳуқуқи дастрасӣ маҳдуданд.")) + '</p>';
				html += '</div>';
				area.html(html);
			} catch (error) {
				if (!active || sequence !== request) return;
				area.html('<div class="mh-transaction-details" role="alert"><p>' +
					esc(t("Не удалось загрузить операцию. Возможно, документ изменён или доступ ограничен.", "Амалиёт бор нашуд. Шояд ҳуҷҷат тағйир ёфтааст ё дастрасӣ маҳдуд аст.")) +
					'</p><button type="button" class="btn btn-default btn-sm" data-action="retry-transaction">' + esc(t("Повторить", "Такрор")) + '</button></div>');
				area.find('[data-action="retry-transaction"]').on("click", load);
			}
		};
		dlg.show();
		return load();
	}

	wallet_options() {
		return ((this.data && this.data.wallets) || []).filter((w) => w.enabled).map((w) => w.name);
	}

	transfer_key(kind = "transfer") {
		return `money-hub-${kind}:${frappe.session.user}:${this.data.company}`;
	}

	pending_transfer(kind = "transfer") {
		const saved = localStorage.getItem(this.transfer_key(kind));
		return saved ? JSON.parse(saved) : null;
	}

	async run_transfer(values, expected_id = null, kind = "transfer", display = null) {
		if (values.company !== this.data?.company) throw new Error(this.t("Компания изменилась. Откройте перевод снова.", "Ширкат тағйир ёфт. Интиқолро аз нав кушоед."));
		const key = this.transfer_key(kind);
		let pending = this.pending_transfer(kind);
		if (expected_id && pending && pending.id !== expected_id) {
			throw new Error(this.t("Запрос изменился в другом окне. Откройте форму снова.", "Дархост дар равзанаи дигар тағйир ёфт. Шаклро аз нав кушоед."));
		}
		if (pending && JSON.stringify(pending.args) !== JSON.stringify(values)) {
			throw new Error(kind === "owner" ? this.t("Сначала проверьте предыдущую операцию владельца. Откройте форму снова.", "Аввал амалиёти пешинаи соҳибро санҷед. Шаклро аз нав кушоед.") : this.t("Сначала проверьте предыдущий перевод. Откройте форму снова.", "Аввал интиқоли пешинаро санҷед. Шаклро аз нав кушоед."));
		}
		if (!pending) {
			// An already-open recovery dialog must retain its ID even if another
			// tab has since confirmed/cleared the shared pending operation.
			pending = {id: expected_id || crypto.randomUUID(), args: values, display};
			// Persist before sending. A storage failure must prevent posting.
			localStorage.setItem(key, JSON.stringify(pending));
		}
		const clear = () => {
			if (JSON.parse(localStorage.getItem(key) || "null")?.id === pending.id) localStorage.removeItem(key);
		};
		try {
			const response = await frappe.call({
				method: `erpnext.accounts.page.money_hub.money_hub.${kind === "owner" ? "record_owner_money_movement" : "record_money_transfer"}`,
				args: {...pending.args, client_request_id: pending.id},
			});
			const result = response.message;
			if (!result?.name || ![1, 2].includes(result.docstatus) || result.company !== values.company) {
				throw new Error(this.t("Результат не подтверждён. Повторите проверку.", "Натиҷа тасдиқ нашуд. Санҷишро такрор кунед."));
			}
			clear();
			return result;
		} catch (error) {
			// Only an explicit server rejection plus a serialized missing receipt
			// permits editing. A timeout/unknown response retains the exact intent.
			if (error?.responseJSON?.exc_type || error?.exc_type) {
				try {
					const response = await frappe.call({
						method: `erpnext.accounts.page.money_hub.money_hub.${kind === "owner" ? "get_owner_money_request_outcome" : "get_transfer_request_outcome"}`,
						args: {client_request_id: pending.id, company: values.company},
					});
					if (response.message?.status === "not_found") clear();
				} catch { /* Unknown outcome keeps its original request. */ }
			}
			throw error;
		}
	}

	async open_owner_money() {
		const company = this.data?.company;
		if (!company) return;
		let pending;
		try { pending = this.pending_transfer("owner"); }
		catch (error) { frappe.msgprint(String(error.message)); return; }
		const t = (ru, tg) => this.t(ru, tg), esc = value => frappe.utils.escape_html(String(value ?? ""));
		const fields = [
			{fieldname: "explanation", fieldtype: "HTML", options: `<p>${esc(t("Личные средства владельца: внесение или изъятие. Заём учитывается отдельно. Эти операции не являются продажами или расходами бизнеса. Возмещение уже учтённых расходов оформляйте через исходный документ.", "Маблағи шахсии соҳиб: ворид кардан ё гирифтан. Қарз алоҳида ҳисоб мешавад. Ин амалиётҳо фурӯш ё хароҷоти тиҷорат нестанд. Ҷуброни хароҷоти қаблан сабтшударо тавассути ҳуҷҷати аслӣ иҷро кунед."))}</p>`},
			{fieldname: "status", fieldtype: "HTML"},
			{fieldname: "show_loans", fieldtype: "Check", label: t("Показать займы и возврат займов", "Намоиши қарзҳо ва баргардонидани онҳо"), default: pending?.args.operation.startsWith("loan_") ? 1 : 0, read_only: !!pending},
			{fieldname: "operation", fieldtype: "Select", reqd: 1, label: t("Операция", "Амалиёт"), default: pending?.args.operation || "contribution", options: [
				{value: "contribution", label: t("Внести средства владельца", "Ворид кардани маблағи соҳиб")},
				{value: "withdrawal", label: t("Изъять средства владельца", "Гирифтани маблағи соҳиб")},
				{value: "loan_received", label: t("Получить заём от владельца", "Гирифтани қарз аз соҳиб")},
				{value: "loan_repayment", label: t("Вернуть заём владельцу", "Баргардонидани қарз ба соҳиб")},
			]},
			{fieldname: "wallet", fieldtype: "Select", label: t("Счёт / кошелёк", "Суратҳисоб / ҳамён"), reqd: 1, options: pending ? [pending.args.wallet] : []},
			{fieldname: "amount", fieldtype: "Currency", label: t("Сумма", "Маблағ"), reqd: 1},
			{fieldname: "exchange_rate", fieldtype: "Float", precision: 9, label: t("Курс", "Қурб"), hidden: 1},
			{fieldname: "note", fieldtype: "Data", label: t("Комментарий", "Эзоҳ")},
			{fieldname: "error", fieldtype: "HTML"},
		];
		for (const field of fields) if (pending && Object.hasOwn(pending.args, field.fieldname)) {
			field.default = pending.args[field.fieldname]; field.read_only = 1;
		}
		let context = null, sequence = 0, closed = false;
		const dlg = new frappe.ui.Dialog({
			title: t("Средства владельца", "Маблағи соҳиб"), fields,
			primary_action_label: pending ? t("Проверить / повторить", "Санҷидан / такрор") : t("Записать", "Сабт кардан"),
			primary_action: async values => {
				if (dlg.owner_busy || (!pending && !context?.can_record)) return;
				dlg.owner_busy = true; dlg.get_primary_btn().prop("disabled", true);
				try {
					const args = pending?.args || {company, operation: values.operation, wallet: values.wallet,
						amount: values.amount, exchange_rate: values.exchange_rate || null, note: values.note || ""};
					for (const field of fields.filter(field => field.fieldtype !== "HTML")) dlg.set_df_property(field.fieldname, "read_only", 1);
					const display = pending?.display || {currency: context?.wallets.find(wallet => wallet.name === args.wallet)?.currency || this.data?.currency};
					const result = await this.run_transfer(args, pending?.id, "owner", display);
					if (!closed) dlg.hide();
					const label = result.docstatus === 2 ? t("Операция отменена", "Амалиёт бекор шудааст") : t("Операция записана", "Амалиёт сабт шуд");
					frappe.msgprint(`${esc(label)}: <a href="${esc(frappe.utils.get_form_link("Journal Entry", result.name))}">${esc(result.name)}</a>`);
					this.load();
				} catch (error) {
					if (!closed) {
						dlg.fields_dict.error.$wrapper.text(t("Результат не подтверждён. Повторите тот же запрос или откройте форму снова.", "Натиҷа тасдиқ нашуд. Ҳамон дархостро такрор кунед ё шаклро аз нав кушоед.") + " " + (error.message || ""));
						pending = this.pending_transfer("owner");
						for (const field of fields.filter(field => field.fieldtype !== "HTML")) dlg.set_df_property(field.fieldname, "read_only", !!pending);
					}
				} finally {
					dlg.owner_busy = false;
					if (!closed) dlg.get_primary_btn().prop("disabled", !(pending || context?.can_record));
				}
			},
		});
		dlg.onhide = () => { closed = true; sequence++; };
		const currency = () => {
			const code = pending?.display?.currency || context?.wallets.find(wallet => wallet.name === dlg.get_value("wallet"))?.currency || this.data?.currency;
			dlg.set_df_property("amount", "label", `${t("Сумма", "Маблағ")} (${code})`);
			dlg.set_df_property("amount", "options", code);
			const foreign = !!code && code !== this.data?.currency;
			dlg.set_df_property("exchange_rate", "hidden", !foreign);
			dlg.set_df_property("exchange_rate", "reqd", foreign);
			dlg.set_df_property("exchange_rate", "description", `1 ${code} = … ${this.data?.currency}`);
			if (!foreign && !pending) dlg.set_value("exchange_rate", null);
		};
		const operations = fields.find(field => field.fieldname === "operation").options;
		const update_operations = () => {
			const options = dlg.get_value("show_loans") ? operations : operations.slice(0, 2);
			dlg.set_df_property("operation", "options", options);
			if (!pending && !options.some(option => option.value === dlg.get_value("operation"))) dlg.set_value("operation", "contribution");
		};
		dlg.fields_dict.show_loans.df.onchange = update_operations;
		dlg.fields_dict.wallet.df.onchange = currency;
		const load = async () => {
			const current = ++sequence;
			dlg.get_primary_btn().prop("disabled", !pending);
			dlg.fields_dict.status.$wrapper.text(t("Загрузка…", "Боркунӣ…"));
			try {
				const response = await frappe.call({method: "erpnext.accounts.page.money_hub.money_hub.get_owner_money_context", args: {company}, silent: true});
				if (closed || current !== sequence || this.data?.company !== company) return;
				context = response.message;
				if (!context || context.company !== company) throw new Error(t("Не удалось проверить настройки.", "Танзимот санҷида нашуд."));
				const area = dlg.fields_dict.status.$wrapper;
				if (context.upgrade_required) {
					area.text(t("Администратору нужно завершить обновление системы для операций владельца.", "Маъмур бояд навсозии низомро барои амалиёти соҳиб анҷом диҳад."));
					return;
				}
				if (!context.configured) {
					area.html(`<p>${esc(t("Сначала настройте отдельные счета владельца. Продажи, расходы, зарплата и поставщики сохраняют свои документы.", "Аввал суратҳисобҳои алоҳидаи соҳибро танзим кунед. Фурӯш, хароҷот, маош ва таъминкунандагон ҳуҷҷатҳои худро доранд."))}</p>` + (context.can_configure ? `<button type="button" class="btn btn-default btn-sm" data-owner-setup>${esc(t("Создать отдельные счета владельца", "Сохтани суратҳисобҳои алоҳидаи соҳиб"))}</button> <a href="/app/owner-money-settings/new">${esc(t("Выбрать существующие счета", "Интихоби суратҳисобҳои мавҷуда"))}</a>` : `<p>${esc(t("Настройку выполняет владелец или бухгалтер.", "Танзимро соҳиб ё муҳосиб анҷом медиҳад."))}</p>`));
					area.find("[data-owner-setup]").on("click", async event => {
						if (closed || this.data?.company !== company) return;
						event.currentTarget.disabled = true;
						try { await frappe.call({method: "erpnext.accounts.page.money_hub.money_hub.setup_owner_money", args: {company}}); if (!closed) await load(); }
						catch (error) { if (!closed) { dlg.fields_dict.error.$wrapper.text(error.message || t("Не удалось сохранить настройки.", "Танзимот захира нашуд.")); event.currentTarget.disabled = false; } }
					});
					return;
				}
				const owed = context.loan_balance;
				const status = (!context.loans_enabled ? t("Займы необязательны. Для них настройте отдельный счёт.", "Қарзҳо ихтиёрӣ мебошанд. Барои онҳо суратҳисоби алоҳида танзим кунед.") : owed === null ? t("Баланс займа недоступен.", "Бақияи қарз дастрас нест.") : `${t("Займы владельца, баланс по доступным проводкам", "Қарзҳои соҳиб, бақия аз сабтҳои дастрас")}: ${this.fmt(owed, context.currency)} ${context.currency}. `) + (!context.can_record ? t("Запись доступна владельцу или уполномоченному бухгалтеру.", "Сабт ба соҳиб ё муҳосиби ваколатдор дастрас аст.") : "");
				area.html(`<p>${esc(status)}</p>` + (context.can_configure && context.settings ? `<a href="${esc(frappe.utils.get_form_link("Owner Money Settings", context.settings))}">${esc(t("Настроить счета владельца", "Танзими суратҳисобҳои соҳиб"))}</a>` : ""));
				const options = context.wallets.map(wallet => wallet.name);
				if (pending && !options.includes(pending.args.wallet)) options.push(pending.args.wallet);
				dlg.set_df_property("wallet", "options", options);
				if (!pending) await dlg.set_value("wallet", options[0]);
				currency();
				dlg.get_primary_btn().prop("disabled", !(pending || context.can_record));
			} catch (error) {
				if (closed || current !== sequence) return;
				dlg.fields_dict.status.$wrapper.html(`<p role="alert">${esc(t("Не удалось загрузить настройки. Проверьте доступ и повторите.", "Танзимот бор нашуд. Дастрасиро санҷида такрор кунед."))}</p><button type="button" class="btn btn-default btn-sm" data-owner-retry>${esc(t("Повторить", "Такрор"))}</button>`);
				dlg.fields_dict.status.$wrapper.find("[data-owner-retry]").on("click", load);
				dlg.get_primary_btn().prop("disabled", !pending);
			}
		};
		dlg.show();
		update_operations();
		await load();
	}

	open_transfer(from_wallet = null) {
		const comp = this.data?.company;
		if (!comp) return;
		const wallets = (this.data.wallets || []).filter(wallet => wallet.enabled);
		let pending;
		try { pending = this.pending_transfer(); }
		catch (error) { frappe.msgprint(String(error.message)); return; }
		const opts = wallets.map(wallet => wallet.name);
		for (const value of [pending?.args.from_wallet, pending?.args.to_wallet]) {
			if (value && !opts.includes(value)) opts.push(value);
		}
		const source = from_wallet || opts[0];
		const source_account = wallets.find(wallet => wallet.name === source)?.account;
		const destination = wallets.find(wallet => wallet.account !== source_account)?.name;
		const fields = [
			{fieldname: "explanation", fieldtype: "HTML", options: `<p>${frappe.utils.escape_html(this.t(
				"Перевод между счетами не является расходом или прибылью. Комиссии и курсовые разницы оформляются в платёжном документе.",
				"Интиқол байни суратҳисобҳо хароҷот ё фоида нест. Комиссияҳо ва фарқи қурб дар ҳуҷҷати пардохт сабт мешаванд."))}</p>`},
			{fieldname: "kind", fieldtype: "Select", label: this.t("Тип операции", "Навъи амалиёт"), options: [
				{value: "Инкассация", label: this.t("Инкассация", "Инкассатсия")},
				{value: "Пополнение", label: this.t("Пополнение", "Пур кардан")},
				{value: "Снятие", label: this.t("Снятие", "Гирифтани пул")},
				{value: "Обычный перевод", label: this.t("Обычный перевод", "Интиқоли одӣ")},
			], default: "Инкассация", reqd: 1},
			{fieldname: "from_wallet", fieldtype: "Select", label: this.t("Откуда", "Аз куҷо"), options: opts, default: source, reqd: 1},
			{fieldname: "to_wallet", fieldtype: "Select", label: this.t("Куда", "Ба куҷо"), options: opts, default: destination, reqd: 1},
			{fieldname: "amount", fieldtype: "Currency", label: this.t("Сумма списания", "Маблағи аз ҳисоб баровардан"), reqd: 1},
			{fieldname: "received_amount", fieldtype: "Currency", label: this.t("Сумма зачисления", "Маблағи воридшавӣ")},
			{fieldname: "source_exchange_rate", fieldtype: "Float", precision: 9, label: this.t("Курс списания", "Қурби баровардан")},
			{fieldname: "target_exchange_rate", fieldtype: "Float", precision: 9, label: this.t("Курс зачисления", "Қурби воридшавӣ")},
			{fieldname: "note", fieldtype: "Data", label: this.t("Комментарий", "Эзоҳ")},
			{fieldname: "result", fieldtype: "HTML"},
		];
		if (pending) for (const field of fields) {
			if (Object.hasOwn(pending.args, field.fieldname)) {
				field.default = pending.args[field.fieldname];
				field.read_only = 1;
			}
		}
		const dlg = new frappe.ui.Dialog({
			title: this.t("Перевод между счетами", "Интиқол байни суратҳисобҳо"), fields,
			primary_action_label: pending ? this.t("Проверить / повторить", "Санҷидан / такрор") : this.t("Перевести", "Интиқол кардан"),
			primary_action: async (values) => {
				if (dlg.transfer_busy) return;
				dlg.transfer_busy = true;
				dlg.get_primary_btn().prop("disabled", true);
				try {
					const args = pending?.args || {company: comp, kind: values.kind, from_wallet: values.from_wallet,
						to_wallet: values.to_wallet, amount: values.amount, note: values.note || "",
						received_amount: values.received_amount || null, source_exchange_rate: values.source_exchange_rate || null,
						target_exchange_rate: values.target_exchange_rate || null};
					for (const field of fields.filter(field => field.fieldtype !== "HTML")) dlg.set_df_property(field.fieldname, "read_only", 1);
					const result = await this.run_transfer(args, pending?.id);
					const link = frappe.utils.get_form_link("Payment Entry", result.name);
					const label = result.docstatus === 2 ? this.t("Перевод отменён", "Интиқол бекор шудааст") : this.t("Перевод проведён", "Интиқол сабт шуд");
					frappe.msgprint(`${frappe.utils.escape_html(label)}: <a href="${frappe.utils.escape_html(link)}">${frappe.utils.escape_html(result.name)}</a>`);
					dlg.hide();
					this.load();
				} catch (error) {
					const message = this.t("Перевод не подтверждён. Закройте и откройте форму, чтобы проверить или повторить тот же запрос.", "Интиқол тасдиқ нашуд. Шаклро пӯшида аз нав кушоед, то ҳамон дархостро санҷед ё такрор кунед.");
					dlg.fields_dict.result.$wrapper.text(`${message} ${error.message || ""}`);
					// Keep original values on an ambiguous outcome, even if the dialog remains open.
					pending = this.pending_transfer();
					for (const field of fields.filter(field => !["HTML"].includes(field.fieldtype))) dlg.set_df_property(field.fieldname, "read_only", !!pending);
				} finally {
					dlg.transfer_busy = false;
					dlg.get_primary_btn().prop("disabled", false);
				}
			},
		});
		const currencies = () => {
			const src = wallets.find(wallet => wallet.name === dlg.get_value("from_wallet"));
			const dst = wallets.find(wallet => wallet.name === dlg.get_value("to_wallet"));
			const source_currency = src?.account_currency || this.data.currency;
			const target_currency = dst?.account_currency || this.data.currency;
			for (const [field, currency] of [["amount", source_currency], ["received_amount", target_currency]]) {
				dlg.set_df_property(field, "label", `${field === "amount" ? this.t("Списать", "Баровардан") : this.t("Зачислить", "Ворид кардан")} (${currency})`);
				dlg.set_df_property(field, "options", currency);
			}
			for (const [field, foreign, currency] of [["source_exchange_rate", source_currency !== this.data.currency, source_currency], ["target_exchange_rate", target_currency !== this.data.currency && target_currency !== source_currency, target_currency]]) {
				dlg.set_df_property(field, "hidden", !foreign);
				dlg.set_df_property(field, "reqd", foreign);
				dlg.set_df_property(field, "description", `1 ${currency} = … ${this.data.currency}`);
				if (!foreign && !pending) dlg.set_value(field, null);
			}
			dlg.set_df_property("received_amount", "hidden", source_currency === target_currency);
			dlg.set_df_property("received_amount", "reqd", source_currency !== target_currency);
			if (source_currency === target_currency && !pending) dlg.set_value("received_amount", null);
		};
		for (const field of ["from_wallet", "to_wallet"]) dlg.fields_dict[field].df.onchange = currencies;
		dlg.show();
		currencies();
		if (pending) dlg.fields_dict.result.$wrapper.text(this.t("Есть неподтверждённый запрос. Повторная проверка не создаст второй перевод.", "Дархости тасдиқнашуда ҳаст. Санҷиши такрорӣ интиқоли дуюм намесозад."));
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
