// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.pages["expense-desk"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Expenses"), single_column: true });
	wrapper.expense_desk_app = new ExpenseDeskApp(page);
};
frappe.pages["expense-desk"].on_page_show = function (wrapper) {
	if (wrapper.expense_desk_app?.loaded) wrapper.expense_desk_app.load(true);
};

class ExpenseDeskApp {
	constructor(page) {
		this.page = page;
		this.wrapper = $(page.body).addClass("expense-desk-page");
		this.filters = this.defaults();
		this.sequence = 0;
		this.rows = [];
		this.setup();
		this.wrapper.on("click", "a[href]", () => {
			this.return_refresh = true;
		});
		window.addEventListener("focus", () => {
			if (this.return_refresh && frappe.get_route()[0] === "expense-desk" && !this.entry) {
				this.return_refresh = false;
				this.load(true);
			}
		});
		this.load(true);
	}
	defaults() {
		return {
			period: "month",
			source_id: "all",
			category: "all",
			employee: "all",
			status: "submitted",
			search: "",
			from_date: "",
			to_date: "",
			pos_profile: "",
			pos_opening_shift: "",
		};
	}
	esc(value) {
		return frappe.utils.escape_html(String(value ?? ""));
	}
	money(value, currency = this.data?.currency) {
		return currency ? format_currency(value, currency) : "—";
	}
	link(doctype, name, label = name) {
		return name
			? `<a href="${this.esc(frappe.utils.get_form_link(doctype, name))}">${this.esc(label)}</a>`
			: "—";
	}
	can_read(doctype) {
		return (frappe.boot.user.can_read || []).includes(doctype);
	}
	select(key, label, options) {
		return `<label class="ed-filter">${this.esc(__(label))}<select class="form-control" data-filter="${key}">${this.options(options)}</select></label>`;
	}
	options(options) {
		return options
			.map(([value, label]) => `<option value="${this.esc(value)}">${this.esc(label)}</option>`)
			.join("");
	}
	setup() {
		this.page.set_primary_action(__("Record expense"), () => this.open_entry(), "add");
		this.page.btn_primary.prop("disabled", true);
		for (const [label, action] of [
			["Refresh", () => this.load(true)],
			["Quick Expense list", () => frappe.set_route("List", "Quick Expense")],
			["Correct a POS expense", () => this.open_entry(true)],
			["Money Hub", () => frappe.set_route("money-hub")],
			["Product Catalog", () => frappe.set_route("product-catalog")],
		])
			this.page.add_menu_item(__(label), action);
		frappe
			.call({
				method: "erpnext.accounts.page.expense_desk.expense_desk.get_shift_review_navigation",
			})
			.then((response) => {
				if (response.message?.available)
					this.page.add_menu_item(__("Shift Review"), () => frappe.set_route("shift-review"));
			})
			.catch(() => {
				/* Optional navigation does not block expense history. */
			});
		this.wrapper.html(`<div class="ed-workspace">
			<p class="ed-scope text-muted"></p><div class="ed-recovery" aria-live="polite"></div>
			<div class="ed-summary" aria-live="polite"></div>
			<p class="ed-basis text-muted">${__("Paid expenses for all matching records. These are period totals, not account balances. Cancelled and draft records are excluded from paid totals.")}</p>
			<div class="ed-filters">
			${this.select("period", "Period", [
				["month", __("This month")],
				["today", __("Today")],
				["yesterday", __("Yesterday")],
				["week", __("Last 7 days")],
				["custom", __("Custom dates")],
				["all", __("All history")],
			])}
			${this.select("source_id", "Paid from", [["all", __("All sources")]])}
			${this.select("category", "Category", [["all", __("All categories")]])}
			<label class="ed-filter ed-search">${__("Search expenses")}<input type="search" class="form-control" data-filter="search" autocomplete="off"></label>
			</div><div class="ed-dates" hidden>
			<label class="ed-filter">${__("From date")}<input type="date" class="form-control" data-filter="from_date"></label>
			<label class="ed-filter">${__("To date")}<input type="date" class="form-control" data-filter="to_date"></label></div>
			<details class="ed-more"><summary>${__("More filters")}</summary><div class="ed-extra">
			<div class="ed-company"></div><div class="ed-profile"></div><div class="ed-shift"></div>
			${this.select("employee", "Recipient", [["all", __("All recipients")]])}
			${this.select("status", "Status", [
				["submitted", __("Submitted")],
				["all", __("All statuses")],
				["cancelled", __("Cancelled")],
				["draft", __("Draft")],
			])}
			</div></details><div class="ed-filter-footer"><span class="ed-active text-muted"></span><button class="btn btn-default btn-sm ed-reset">${__("Reset filters")}</button></div>
			<div class="ed-feedback" role="status"></div><div class="ed-results" aria-live="polite"></div>
			<div class="ed-footer"><span class="ed-count text-muted"></span><button class="btn btn-default btn-sm ed-more-rows" hidden>${__("Load more")}</button></div>
			<details class="ed-breakdown" hidden><summary>${__("By category")}</summary><div></div></details>
		</div>`);
		this.make_scope_control("company", "Company", "Company", () => {
			if (this.updating_controls) return;
			this.company = this.controls.company.get_value();
			this.filters.pos_profile = this.filters.pos_opening_shift = "";
			this.filters.source_id = this.filters.category = this.filters.employee = "all";
			this.update_scope_controls();
			this.load(true);
		});
		this.make_scope_control("profile", "Register", "POS Profile", () => {
			if (this.updating_controls) return;
			this.filters.pos_profile = this.controls.profile.get_value();
			this.filters.pos_opening_shift = "";
			this.update_scope_controls();
			this.load(true);
		});
		this.make_scope_control("shift", "Opening shift", "POS Opening Shift", () => {
			if (this.updating_controls) return;
			this.filters.pos_opening_shift = this.controls.shift.get_value();
			this.load(true);
		});
		this.controls.company.get_query = () => ({ filters: { is_group: 0 } });
		this.controls.profile.get_query = () => ({ filters: { company: this.company } });
		this.controls.shift.get_query = () => ({
			filters: {
				company: this.company,
				docstatus: 1,
				...(this.filters.pos_profile ? { pos_profile: this.filters.pos_profile } : {}),
			},
		});
		this.wrapper.on("change", "[data-filter]:not([data-filter=search])", (event) => {
			const key = event.currentTarget.dataset.filter;
			this.filters[key] = event.currentTarget.value;
			this.wrapper.find(".ed-dates").prop("hidden", this.filters.period !== "custom");
			this.load();
		});
		this.wrapper.on("input", "[data-filter=from_date], [data-filter=to_date]", (event) => {
			this.filters[event.currentTarget.dataset.filter] = event.currentTarget.value;
			this.invalidate();
			this.render_active_filters();
		});
		this.wrapper.on("input", "[data-filter=search]", (event) => {
			this.filters.search = event.currentTarget.value;
			this.invalidate(); // Ignore earlier responses immediately, including during debounce.
			clearTimeout(this.search_timer);
			this.search_timer = setTimeout(() => this.load(), 250);
		});
		this.wrapper.on("click", ".ed-reset", () => {
			this.filters = this.defaults();
			this.update_scope_controls();
			this.wrapper.find("[data-filter]").each((_, el) => $(el).val(this.filters[el.dataset.filter]));
			this.wrapper.find(".ed-dates").prop("hidden", true);
			this.load(true);
		});
		this.wrapper.on("click", ".ed-more-rows", () => this.load(false, true));
		this.wrapper.on("click", ".ed-retry", () => this.load(true));
		this.wrapper.on("click", "[data-expense]", (event) => {
			event.preventDefault();
			const row = this.rows.find((item) => item.source_id === event.currentTarget.dataset.expense);
			if (row) this.open_detail(row);
		});
		this.wrapper.on("click", "[data-check]", (event) => this.recover(event.currentTarget.dataset.check));
		this.wrapper.on("click", "[data-retry-original]", (event) =>
			this.recover(event.currentTarget.dataset.retryOriginal, true),
		);
		this.online_listener = () => this.load(true);
		this.offline_listener = () => {
			this.invalidate();
			this.wrapper.find(".ed-results").text(__("Offline. Reconnect to load expenses."));
		};
		window.addEventListener("online", this.online_listener);
		window.addEventListener("offline", this.offline_listener);
	}
	make_scope_control(key, label, doctype, onchange) {
		this.controls ||= {};
		this.controls[key] = frappe.ui.form.make_control({
			parent: this.wrapper.find(`.ed-${key}`),
			df: { fieldtype: "Link", fieldname: key, label: __(label), options: doctype, onchange },
			render_input: true,
		});
		this.controls[key].$input?.attr("aria-label", __(label));
	}
	update_scope_controls() {
		this.updating_controls = true;
		this.controls.company.set_input(this.company || "");
		this.controls.profile.set_input(this.filters.pos_profile);
		this.controls.shift.set_input(this.filters.pos_opening_shift);
		this.updating_controls = false;
	}
	args() {
		return {
			...this.filters,
			company: this.company,
			entry_context:
				this.filters.pos_profile || this.filters.pos_opening_shift ? "POS Correction" : "Desk",
		};
	}
	invalidate() {
		this.sequence++;
		this.ready = false;
		this.wrapper.find(".ed-scope").text(this.company || __("Loading…"));
		this.page.btn_primary.prop("disabled", true);
		this.wrapper
			.find(".ed-summary")
			.html(
				["Paid expenses", "Paid in cash", "Paid through bank/wallets"]
					.map((label) => `<div><span>${__(label)}</span><strong>—</strong></div>`)
					.join(""),
			);
		this.wrapper.find(".ed-results").text(__("Loading…"));
		this.wrapper.find(".ed-count, .ed-feedback, .ed-active").empty();
		this.wrapper.find(".ed-more-rows, .ed-breakdown").prop("hidden", true);
	}
	async load(init = false, more = false) {
		clearTimeout(this.search_timer);
		const old_rows = more ? [...this.rows] : [];
		const offset = more ? this.next_start : 0;
		this.invalidate();
		const sequence = this.sequence;
		this.render_active_filters();
		try {
			await frappe.require("/assets/erpnext/js/expense_requests.js");
			if (sequence !== this.sequence) return;
			this.render_recovery();
			if (navigator.onLine === false) throw new Error(__("Offline. Reconnect to load expenses."));
			if (
				this.filters.period === "custom" &&
				(!this.filters.from_date ||
					!this.filters.to_date ||
					this.filters.from_date > this.filters.to_date)
			)
				throw new Error(__("Select a valid date range."));
			const initialize = init || !this.data || this.data.company !== this.company;
			const response = await frappe.call({
				method: `erpnext.accounts.page.expense_desk.expense_desk.${initialize ? "get_expense_desk_init_data" : "get_filtered_expenses"}`,
				args: { ...this.args(), ...(initialize ? {} : { limit_start: offset }) },
			});
			if (sequence !== this.sequence) return;
			const data = response.message;
			if (!data?.summary || !Array.isArray(data.recent_expenses))
				throw new Error(__("Could not load expenses. Retry."));
			if (initialize) {
				this.data = data;
				this.company = data.company;
				this.update_scope_controls();
				this.update_options();
			}
			this.loaded = this.ready = true;
			this.rows = [...old_rows, ...data.recent_expenses];
			this.summary = data.summary;
			this.period_range = [data.period_from, data.period_to].filter(Boolean).join(" – ");
			this.next_start = data.next_start;
			this.has_more = data.has_more;
			this.render();
		} catch (error) {
			if (sequence !== this.sequence) return;
			this.wrapper
				.find(".ed-results")
				.html(
					`<p class="ed-error">${this.esc(error.message || __("Could not load expenses. Check access and setup, then retry."))}</p><button class="btn btn-default btn-sm ed-retry">${__("Retry")}</button>`,
				);
		}
	}
	update_options() {
		const history = this.data.history_filters || { accounts: [], categories: [] };
		const accounts = new Set([
			...history.accounts,
			...(this.data.payment_sources || []).map((source) => source.account),
		]);
		const category_ids = new Set([
			...history.categories,
			...(this.data.categories || []).map((category) => category.name),
		]);
		for (const [key, options] of [
			[
				"source_id",
				[
					["all", __("All sources")],
					["cash", __("Cash")],
					["bank", __("Bank/wallets")],
					...[...accounts].sort().map((account) => [`account:${account}`, account]),
				],
			],
			[
				"category",
				[
					["all", __("All categories")],
					...[...category_ids].sort().map((id) => [id, this.category_label(id)]),
				],
			],
			[
				"employee",
				[
					["all", __("All recipients")],
					...(this.data.employees || []).map((employee) => [employee.name, employee.employee_name]),
				],
			],
		]) {
			if (!options.some(([value]) => value === this.filters[key]))
				options.push([this.filters[key], this.filters[key]]);
			this.wrapper.find(`[data-filter=${key}]`).html(this.options(options)).val(this.filters[key]);
		}
		this.controls.profile.$wrapper.toggle(Boolean(this.data.can_correct));
		this.controls.shift.$wrapper.toggle(Boolean(this.data.can_correct));
		this.wrapper
			.find("[data-filter=employee]")
			.closest("label")
			.toggle(Boolean(this.data.employees?.length));
	}
	category_label(id) {
		if (!id) return __("Uncategorized");
		if (id.startsWith("legacy:")) return `${id.slice(7)} · ${__("Cash movement")}`;
		return __(
			(this.data?.categories || []).find((category) => category.name === id)?.category_name || id,
		);
	}
	render_active_filters() {
		const period = {
			month: "This month",
			today: "Today",
			yesterday: "Yesterday",
			week: "Last 7 days",
			custom: "Custom dates",
			all: "All history",
		}[this.filters.period];
		const parts = [__(period)];
		if (this.ready && this.period_range && this.filters.period !== "custom")
			parts.push(this.period_range);
		if (this.filters.period === "custom")
			parts.push(`${this.filters.from_date || "…"} – ${this.filters.to_date || "…"}`);
		for (const key of ["source_id", "category", "employee", "status"]) {
			if (this.filters[key] !== ({ status: "submitted" }[key] || "all"))
				parts.push(this.wrapper.find(`[data-filter=${key}] option:selected`).text());
		}
		if (this.filters.search) parts.push(this.filters.search);
		if (this.filters.pos_profile) parts.push(this.filters.pos_profile);
		if (this.filters.pos_opening_shift) parts.push(this.filters.pos_opening_shift);
		this.wrapper.find(".ed-active").text(parts.join(" · "));
	}
	render() {
		const summary = this.summary;
		this.page.btn_primary.prop("disabled", !this.data.can_record);
		this.wrapper.find(".ed-scope").text(`${this.company} · ${this.data.currency}`);
		this.render_active_filters();
		this.wrapper.find(".ed-summary").html(
			[
				["Paid expenses", summary.period_total],
				["Paid in cash", summary.cash_total],
				["Paid through bank/wallets", summary.bank_total],
			]
				.map(
					([label, value]) =>
						`<div><span>${__(label)}</span><strong>${this.money(value)}</strong></div>`,
				)
				.join(""),
		);
		this.wrapper
			.find(".ed-feedback")
			.text(
				!this.data.can_record
					? __("You can view expenses. Recording requires create and submit permission.")
					: !this.data.categories?.length || !this.data.payment_sources?.length
						? __(
								"Expense setup is incomplete. Ask a manager to configure categories and permitted funding sources.",
							)
						: "",
			);
		if (summary.other_total)
			this.wrapper
				.find(".ed-feedback")
				.append(
					$('<p class="text-muted">').text(
						`${__("Other sources")}: ${this.money(summary.other_total)}`,
					),
				);
		if (summary.unassigned_count)
			this.wrapper
				.find(".ed-feedback")
				.append(
					$('<p class="text-muted">').text(
						__(
							"Some historical POS expenses have no shift attribution. A manager should review their native records.",
						),
					),
				);
		this.wrapper.find(".ed-results").html(
			this.rows.length
				? `<div class="ed-table-scroll" tabindex="0" role="region" aria-label="${__("Expense history")}"><table class="ed-table"><thead><tr>${["Date", "Expense", "Paid from", "Amount", "Recorded by"].map((label) => `<th${label === "Amount" ? ' class="ed-amount"' : ""}>${__(label)}</th>`).join("")}</tr></thead><tbody>${this.rows
						.map(
							(row) => `<tr>
			<td>${this.esc(row.formatted_date || row.posting_date)}<small>${this.esc(row.formatted_time)}</small></td>
			<td><a href="${this.esc(frappe.utils.get_form_link(row.source_doctype, row.name))}" data-expense="${this.esc(row.source_id)}">${this.esc(this.category_label(row.category_id || row.expense_category))}</a><small>${this.esc(row.description)}</small>${row.docstatus !== 1 ? `<small class="ed-status">${__(row.docstatus === 2 ? "Cancelled" : "Draft")}</small>` : ""}</td>
			<td>${this.esc(row.paid_from || __("Missing source"))}${row.attribution_status === "Unassigned" ? `<small>${__("Shift not assigned")}</small>` : ""}</td><td class="ed-amount">${this.money(row.amount)}</td><td>${this.esc(row.owner)}</td></tr>`,
						)
						.join("")}</tbody></table></div>`
				: `<div class="ed-empty">${__("No expenses found. Change the period or filters, or record an expense.")}</div>`,
		);
		this.wrapper
			.find(".ed-count")
			.text(__("Showing {0} of {1} matching records", [this.rows.length, summary.matching_count]));
		this.wrapper.find(".ed-more-rows").prop("hidden", !this.has_more);
		this.wrapper
			.find(".ed-breakdown")
			.prop("hidden", !summary.category_breakdown?.length)
			.find("div")
			.html(
				(summary.category_breakdown || [])
					.map(
						(category) =>
							`<p><span>${this.esc(this.category_label(category.category_id))}</span><span>${this.money(category.total)}</span></p>`,
					)
					.join(""),
			);
	}
	async open_entry(correction = false) {
		await frappe.require("/assets/erpnext/js/expense_entry.js");
		return frappe.expense_entry.open_entry.call(this, correction);
	}
	handoffs(...args) {
		return frappe.expense_entry.handoffs.apply(this, args);
	}
	entry_options(...args) {
		return frappe.expense_entry.entry_options.apply(this, args);
	}
	set_entry_options(...args) {
		return frappe.expense_entry.set_entry_options.apply(this, args);
	}
	upload_receipt(...args) {
		return frappe.expense_entry.upload_receipt.apply(this, args);
	}
	submit_entry(...args) {
		return frappe.expense_entry.submit_entry.apply(this, args);
	}
	async open_detail(row) {
		await frappe.require("/assets/erpnext/js/expense_entry.js");
		return frappe.expense_entry.open_detail.call(this, row);
	}
	receipt_url(...args) {
		return frappe.expense_entry.receipt_url.apply(this, args);
	}
	shift_links(...args) {
		return frappe.expense_entry.shift_links.apply(this, args);
	}
	cancel_expense(doc, detail) {
		const dialog = new frappe.ui.Dialog({
			title: __("Cancel expense"),
			fields: [
				{
					fieldtype: "HTML",
					options: `<p>${__("Cancellation reverses the accounting entry. It does not physically return money. Record a replacement only after cancellation is confirmed.")}</p>`,
				},
				{
					fieldtype: "Small Text",
					fieldname: "reason",
					label: __("Reason for cancellation"),
					reqd: 1,
				},
				{ fieldtype: "HTML", fieldname: "result" },
			],
			primary_action_label: __("Cancel expense"),
			primary_action: async ({ reason }) => {
				if (dialog.busy) return;
				dialog.busy = true;
				dialog.get_primary_btn().prop("disabled", true);
				try {
					const result = await frappe.expense_requests.run("cancel_quick_expense", {
						expense_name: doc.name,
						company: doc.company,
						pos_profile: doc.pos_profile || null,
						pos_opening_shift: doc.pos_opening_shift || null,
						reason,
						expected_modified: doc.modified,
					});
					this.show_result(result.expense);
					dialog.hide();
					detail.hide();
					this.load(true);
				} catch (error) {
					dialog
						.get_field("result")
						.$wrapper.text(
							error.message ||
								__(
									"The expense result was not confirmed. Check result before recording again.",
								),
						);
				} finally {
					dialog.busy = false;
					dialog.get_primary_btn().prop("disabled", false);
					this.render_recovery();
				}
			},
		});
		dialog.$wrapper.addClass("expense-desk-dialog");
		dialog.show();
	}
	render_recovery() {
		const target = this.wrapper.find(".ed-recovery").empty();
		for (const action of ["record_quick_expense", "cancel_quick_expense"]) {
			try {
				const saved = frappe.expense_requests.pending(action);
				if (!saved) continue;
				const args = saved.args || {};
				const block = $('<div class="ed-pending">').appendTo(target);
				$("<p>")
					.text(`${__("Unconfirmed expense request")} · ${saved.id || __("Missing request ID")}`)
					.appendTo(block);
				$('<p class="text-muted">')
					.text(
						[args.company, args.pos_opening_shift, args.paid_from, args.amount, args.expense_name]
							.filter(Boolean)
							.join(" · "),
					)
					.appendTo(block);
				if (saved.id)
					$(
						`<button class="btn btn-default btn-sm" data-check="${action}">${__("Check result")}</button>`,
					).appendTo(block);
				if (saved.id && saved.args)
					$(
						`<button class="btn btn-default btn-sm" data-retry-original="${action}">${__("Retry original request")}</button>`,
					).appendTo(block);
			} catch {
				$('<p class="ed-error">')
					.text(
						__(
							"Saved expense evidence cannot be read. Ask a manager to investigate; do not record it again.",
						),
					)
					.appendTo(target);
			}
		}
	}
	async recover(action, retry = false) {
		if (this.recovering) return;
		this.recovering = true;
		try {
			const saved = frappe.expense_requests.pending(action);
			if (!saved?.id) throw new Error(__("Missing request ID"));
			const result = retry
				? (await frappe.expense_requests.run(action, saved.args)).expense
				: await frappe.expense_requests.check(action);
			if (
				!result?.name ||
				!["submitted", "cancelled"].includes(result.status) ||
				result.docstatus !== (result.status === "submitted" ? 1 : 2)
			) {
				frappe.msgprint(
					__(
						"No completed result is confirmed. The original request is retained. Check again or retry the original request.",
					),
				);
			} else if (action === "cancel_quick_expense" && result.status === "submitted") {
				frappe.msgprint(
					__(
						"The expense is still submitted. Cancellation is not confirmed. The original request is retained.",
					),
				);
			} else {
				this.show_result(result);
				this.load(true);
			}
		} catch (error) {
			frappe.msgprint(
				this.esc(
					error.message ||
						__("Could not check the expense result. The original request is retained."),
				),
			);
		} finally {
			this.recovering = false;
			this.render_recovery();
		}
	}
	show_result(doc) {
		frappe.msgprint({
			title: __(doc.docstatus === 2 ? "Expense cancelled" : "Expense recorded"),
			message: `<p>${this.link("Quick Expense", doc.name)}</p><p>${this.money(doc.amount, doc.currency)} · ${this.esc(doc.paid_from)} · ${this.esc(doc.company)}</p>${doc.pos_opening_shift ? `<p>${this.link("POS Opening Shift", doc.pos_opening_shift)}</p>` : ""}`,
		});
	}
}
