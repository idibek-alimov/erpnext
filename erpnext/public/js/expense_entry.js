// One ordinary paid-expense form shared by Expense Desk and POS Shift Review.
frappe.provide("frappe.expense_entry");
Object.assign(frappe.expense_entry, {
	async open_entry(correction = false) {
		if (!this.ready || !this.data?.can_record || this.entry) return;
		if (correction && !this.data.can_correct)
			return frappe.msgprint(__("A manager is required for a POS expense correction."));
		const company = this.company;
		const review = this.review_entry;
		const dialog = new frappe.ui.Dialog({
			title: __(correction ? "Correct a POS expense" : "Record expense"),
			// Native collapsible sections read required values from the layout document.
			doc: {},
			fields: [
				{
					fieldtype: "HTML",
					fieldname: "scope",
					options: `<p class="text-muted">${this.esc(company)} · ${this.esc(this.data.currency)}</p>${review ? `<p>${__("The submitted expense will explain this shortage once. The original closing count is retained.")}</p>` : correction ? `<p>${__("Record real spending from a register source. Select the exact shift and explain the correction. This does not resolve a closing discrepancy.")}</p>` : ""}`,
				},
				...(correction
					? [
							{
								fieldtype: "Link",
								fieldname: "pos_opening_shift",
								label: __("Opening shift"),
								options: "POS Opening Shift",
								read_only: Boolean(review),
								reqd: 1,
								get_query: () => ({ filters: { company, docstatus: 1 } }),
								onchange: () => this.entry_options(dialog, company),
							},
							{
								fieldtype: "Small Text",
								fieldname: "correction_reason",
								label: __("Reason for correction"),
								reqd: 1,
							},
						]
					: []),
				{ fieldtype: "Select", fieldname: "category", label: __("Category"), reqd: 1, options: [] },
				{
					fieldtype: "Currency",
					fieldname: "amount",
					label: __("Amount"),
					options: this.data.currency,
					default: review ? Math.abs(Number(review.row.remaining_amount)) : null,
					reqd: 1,
				},
				{ fieldtype: "Select", fieldname: "paid_from", label: __("Paid from"), reqd: 1, options: [] },
				{ fieldtype: "HTML", fieldname: "configuration" },
				{ fieldtype: "Section Break", label: __("Additional details"), collapsible: 1 },
				{
					fieldtype: "Date",
					fieldname: "posting_date",
					label: __("Date"),
					default: frappe.datetime.get_today(),
					reqd: 1,
				},
				{ fieldtype: "Small Text", fieldname: "description", label: __("Note") },
				{
					fieldtype: "Data",
					fieldname: "beneficiary_name",
					label: __("Recipient"),
					description: __("Optional. This does not create employee debt or a salary deduction."),
				},
				{
					fieldtype: "HTML",
					fieldname: "receipt",
					options: `<button class="btn btn-default btn-sm ed-upload">${__("Attach private receipt")}</button> <span class="ed-receipt-name text-muted"></span> <button class="btn btn-default btn-sm ed-remove-receipt" hidden>${__("Remove receipt")}</button>`,
				},
				{ fieldtype: "HTML", fieldname: "handoffs", options: this.handoffs() },
				{ fieldtype: "Section Break" },
				{ fieldtype: "HTML", fieldname: "result" },
			],
			primary_action_label: __("Record expense"),
			primary_action: (values) => this.submit_entry(dialog, values, company, correction),
		});
		this.entry = dialog;
		dialog.$wrapper.addClass("expense-desk-dialog");
		dialog.onhide = () => {
			if (this.entry === dialog) this.entry = null;
		};
		dialog.get_field("receipt").$wrapper.on("click", ".ed-upload", () => this.upload_receipt(dialog));
		dialog.get_field("receipt").$wrapper.on("click", ".ed-remove-receipt", () => {
			if (dialog.busy || dialog.uploading) return;
			dialog.receipt_url = null;
			dialog.receipt_pending = false;
			dialog.get_field("receipt").$wrapper.find(".ed-receipt-name").empty();
			dialog.get_field("receipt").$wrapper.find(".ed-remove-receipt").prop("hidden", true);
			dialog.get_field("result").$wrapper.empty();
			this.set_entry_options(dialog, dialog.expense_options);
		});
		dialog.show();
		if (!correction) await this.entry_options(dialog, company, false);
		else {
			this.set_entry_options(dialog, { categories: [], payment_sources: [] });
			if (review || this.filters.pos_opening_shift)
				await dialog.set_value(
					"pos_opening_shift",
					review?.detail.pos_opening_shift || this.filters.pos_opening_shift,
				);
		}
	},
	async open_detail(row) {
		const sequence = (this.detail_sequence = (this.detail_sequence || 0) + 1);
		const dialog = new frappe.ui.Dialog({
			title: __("Expense details"),
			fields: [{ fieldtype: "HTML", fieldname: "body", options: __("Loading…") }],
		});
		dialog.$wrapper.addClass("expense-desk-dialog");
		dialog.onhide = () => {
			if (this.detail_sequence === sequence) this.detail_sequence++;
		};
		dialog.show();
		try {
			const response = await frappe.call({
				method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_detail",
				args: { expense_name: row.name, source_doctype: row.source_doctype },
			});
			if (sequence !== this.detail_sequence) return;
			if (!response.message?.name)
				throw new Error(__("Could not open expense. It may be unavailable or outside your access."));
			const doc = { ...row, ...response.message };
			const field = (label, value) =>
				`<div><dt>${__(label)}</dt><dd>${this.esc(value || "—")}</dd></div>`;
			const receipt = this.receipt_url(doc.receipt_attachment);
			dialog.get_field("body").$wrapper
				.html(`<div class="ed-detail"><p>${this.link(doc.source_doctype, doc.name)} · ${__(doc.docstatus === 1 ? "Submitted" : doc.docstatus === 2 ? "Cancelled" : "Draft")}</p><p class="ed-detail-amount">${this.money(doc.amount, doc.currency || this.data.currency)}</p><dl>
			${field("Company", doc.company)}${field("Date", doc.posting_date)}${field("Category", this.category_label(doc.category_id || doc.expense_category))}${field("Paid from", doc.paid_from)}${field("Recorded by", doc.owner)}${field("Recipient", doc.beneficiary_name)}${field("Note", doc.description)}${field("Reason for correction", doc.correction_reason)}${field("Reason for cancellation", doc.cancellation_reason)}</dl>
			${this.shift_links(doc.shift_links)}
			${receipt ? `<p><a href="${this.esc(receipt)}" target="_blank" rel="noopener">${__("Open receipt")}</a></p>` : ""}
			<p>${[
				["Journal Entry", doc.journal_entry],
				["Payment Entry", doc.payment_entry],
				["Purchase Invoice", doc.purchase_invoice],
				[doc.source_doctype, doc.amended_from],
			]
				.filter(([, name]) => name)
				.map(([doctype, name]) => this.link(doctype, name))
				.join(" · ")}</p>
			${doc.source_doctype === "POS Cash Movement" ? `<p class="text-muted">${__("Historical cash movement. Corrections use its native document workflow.")}</p>` : ""}</div>`);
			dialog.get_field("body").$wrapper.on("click", "a", () => {
				this.return_refresh = true;
				this.mark_native_navigation?.();
				dialog.hide();
			});
			if (this.cancel_expense && doc.can_cancel && doc.source_doctype === "Quick Expense")
				dialog.set_primary_action(__("Cancel expense"), () => this.cancel_expense(doc, dialog));
		} catch (error) {
			if (sequence !== this.detail_sequence) return;
			dialog
				.get_field("body")
				.$wrapper.text(
					error.message ||
						__("Could not open expense. It may be unavailable or outside your access."),
				);
		}
	},
	receipt_url(value) {
		return typeof value === "string" && /^\/(?:private\/)?files\/[^\\\r\n]+$/.test(value) ? value : null;
	},
	shift_links(links = {}) {
		return `<p>${__("Opening shift")}: ${this.link("POS Opening Shift", links.opening_shift)}</p>${(links.reviews || []).map((review) => `<p>${review.url ? `<a href="${this.esc(review.url)}">${__("Shift Review")}</a>` : __("Shift Review")}: ${this.esc(__(review.status))} · ${this.link("POS Closing Shift", review.closing_shift)}</p>`).join("")}`;
	},
	handoffs() {
		return `<p class="text-muted">${__("Paid personally? Use an Expense Claim. Unpaid supplier bill? Use a Purchase Invoice.")}</p><p class="text-muted">${__("If the cost is already recorded on a claim or supplier bill, pay that native document. Do not record the expense again here.")}</p>${[
			["Expense Claim", "Expense Claim"],
			["Purchase Invoice", "Purchase Invoice"],
		]
			.filter(([doctype]) => this.can_read(doctype))
			.map(([doctype, label]) => `<a href="/app/${frappe.router.slug(doctype)}">${__(label)}</a>`)
			.join(" · ")}`;
	},
	async entry_options(dialog, company, correction = true) {
		const sequence = (dialog.option_sequence = (dialog.option_sequence || 0) + 1);
		this.set_entry_options(dialog, { categories: [], payment_sources: [] });
		const shift = correction ? dialog.get_value("pos_opening_shift") : null;
		if (correction && !shift) return;
		try {
			const response = await frappe.call({
				method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_options",
				args: {
					company,
					...(correction
						? { pos_opening_shift: shift, entry_context: "POS Correction" }
						: { entry_context: "Desk" }),
				},
			});
			if (this.entry !== dialog || sequence !== dialog.option_sequence) return;
			if (this.review_entry)
				response.message.payment_sources = response.message.payment_sources.filter(
					(source) => source.account === this.review_entry.row.account,
				);
			this.set_entry_options(dialog, response.message);
			if (this.review_entry) {
				await dialog.set_value("paid_from", this.review_entry.row.account);
				dialog.set_df_property("paid_from", "read_only", true);
			}
		} catch (error) {
			if (sequence === dialog.option_sequence)
				dialog
					.get_field("configuration")
					.$wrapper.text(error.message || __("Could not load sources. Check access and setup."));
		}
	},
	set_entry_options(dialog, data) {
		dialog.expense_options = data;
		dialog.set_df_property("description", "reqd", Boolean(data.note_required));
		dialog.refresh_section_collapse();
		for (const [field, options] of [
			[
				"category",
				(data.categories || []).map((category) => ({
					value: category.name,
					label: this.esc(__(category.category_name)),
				})),
			],
			[
				"paid_from",
				(data.payment_sources || []).map((source) => ({
					value: source.account,
					label: this.esc(`${source.label} · ${source.account}`),
				})),
			],
		]) {
			const previous = dialog.get_value(field);
			dialog.set_df_property(field, "options", [{ value: "", label: "" }, ...options]);
			dialog.set_value(field, options.some((option) => option.value === previous) ? previous : "");
		}
		const ready = data.categories?.length && data.payment_sources?.length;
		dialog
			.get_field("configuration")
			.$wrapper.text(
				ready
					? ""
					: __(
							"Select a shift if correcting POS spending. Categories and funding sources must be configured before recording.",
						),
			);
		dialog
			.get_primary_btn()
			.prop("disabled", Boolean(!ready || dialog.busy || dialog.uploading || dialog.receipt_pending));
	},
	upload_receipt(dialog) {
		if (dialog.busy || dialog.uploading) return;
		dialog.uploading = true;
		dialog.receipt_pending = true;
		let accepting_upload = true;
		dialog.get_field("receipt").$wrapper.find(".ed-remove-receipt").prop("hidden", false);
		dialog.get_primary_btn().prop("disabled", true);
		const uploader = new frappe.ui.FileUploader({
			allow_multiple: false,
			make_attachments_public: false,
			allow_toggle_private: false,
			allow_web_link: false,
			disable_file_browser: true,
			restrictions: { allowed_file_types: ["image/*", ".pdf"] },
			on_success: (file) => {
				if (this.entry !== dialog || !accepting_upload) return;
				if (!file.file_url?.startsWith("/private/files/") || !this.receipt_url(file.file_url)) {
					dialog
						.get_field("result")
						.$wrapper.text(__("Use a private receipt uploaded to this site."));
					return;
				}
				dialog.receipt_url = file.file_url;
				dialog.receipt_pending = false;
				dialog.get_field("receipt").$wrapper.find(".ed-receipt-name").text(file.file_name);
			},
		});
		uploader.dialog.get_secondary_btn().hide();
		uploader.dialog.onhide = () => {
			accepting_upload = false;
			dialog.uploading = false;
			if (!uploader.uploader.files.length) dialog.receipt_pending = false;
			if (dialog.receipt_pending)
				dialog
					.get_field("result")
					.$wrapper.text(
						__(
							"Receipt upload was not confirmed. Upload again or remove the receipt before recording.",
						),
					);
			this.set_entry_options(dialog, dialog.expense_options);
		};
	},
	async submit_entry(dialog, values, company, correction) {
		if (dialog.busy || dialog.uploading || dialog.receipt_pending) return;
		if (!Number.isFinite(Number(values.amount)) || Number(values.amount) <= 0)
			return frappe.msgprint(
				__("Enter a finite positive amount using the company currency precision."),
			);
		const options = dialog.expense_options;
		if (
			!options?.categories?.some((category) => category.name === values.category) ||
			!options.payment_sources?.some((source) => source.account === values.paid_from)
		)
			return frappe.msgprint(__("Select a permitted category and funding source."));
		if (
			correction &&
			(!values.pos_opening_shift ||
				!values.correction_reason?.trim() ||
				options.pos_opening_shift !== values.pos_opening_shift)
		)
			return frappe.msgprint(__("Select the exact opening shift and enter a correction reason."));
		const args = {
			company,
			category: values.category,
			amount: values.amount,
			paid_from: values.paid_from,
			description: values.description || null,
			beneficiary_name: values.beneficiary_name || null,
			posting_date: values.posting_date,
			receipt_attachment: dialog.receipt_url || null,
			entry_context: correction ? "POS Correction" : "Desk",
			...(correction
				? {
						pos_opening_shift: values.pos_opening_shift,
						pos_profile: options.pos_profile,
						correction_reason: values.correction_reason,
					}
				: {}),
		};
		dialog.busy = true;
		dialog.get_primary_btn().prop("disabled", true);
		try {
			const result = this.perform_expense
				? await this.perform_expense(args)
				: await frappe.expense_requests.run("record_quick_expense", args);
			if (!result) return;
			if (!this.perform_expense) this.show_result(result.expense);
			dialog.hide();
			this.load(true);
		} catch (error) {
			if (this.perform_expense) await this.load(true);
			dialog
				.get_field("result")
				.$wrapper.text(
					error.message ||
						__("The expense result was not confirmed. Check result before recording again."),
				);
		} finally {
			dialog.busy = false;
			this.set_entry_options(dialog, options);
			this.render_recovery();
		}
	},
});
