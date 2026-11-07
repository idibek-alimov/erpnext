// All suggestions come from the same server policy used by posting.
frappe.ui.form.on("Quick Expense", {
	setup(frm) {
		frm.set_query("paid_from", () => ({
			filters: { name: ["in", (frm.expense_options?.payment_sources || []).map((s) => s.account)] },
		}));
		frm.set_query("expense_category", () => ({
			filters: { name: ["in", (frm.expense_options?.categories || []).map((c) => c.name)] },
		}));
	},
	async refresh(frm) {
		if (frm.doc.docstatus === 0 && frm.doc.company) await frm.trigger("load_expense_options");
		for (const [field, label] of [
			["journal_entry", "Journal Entry"],
			["payment_entry", "Payment Entry"],
			["purchase_invoice", "Purchase Invoice"],
		]) {
			if (frm.doc[field])
				frm.add_custom_button(
					__(label),
					() => frappe.set_route("Form", label, frm.doc[field]),
					__("View"),
				);
		}
	},
	async load_expense_options(frm) {
		const sequence = (frm.expense_options_sequence || 0) + 1;
		frm.expense_options_sequence = sequence;
		frm.expense_options = { payment_sources: [], categories: [] };
		if (!frm.doc.company || frm.doc.docstatus !== 0) return;
		if (frm.doc.entry_context && frm.doc.entry_context !== "Desk" && !frm.doc.pos_opening_shift) return;
		const response = await frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_options",
			args: {
				company: frm.doc.company,
				pos_profile: frm.doc.pos_profile,
				pos_opening_shift: frm.doc.pos_opening_shift,
				entry_context: frm.doc.entry_context,
			},
		});
		if (sequence !== frm.expense_options_sequence) return;
		frm.expense_options = response.message;
		if (response.message.pos_profile) await frm.set_value("pos_profile", response.message.pos_profile);
		if (frm.doc.expense_category) await frm.trigger("expense_category");
	},
	async company(frm) {
		await frm.trigger("load_expense_options");
	},
	async pos_opening_shift(frm) {
		await frm.trigger("load_expense_options");
	},
	async entry_context(frm) {
		await frm.trigger("load_expense_options");
	},
	expense_category(frm) {
		const category = frm.expense_options?.categories.find((c) => c.name === frm.doc.expense_category);
		frm.set_value({
			expense_account: category?.default_account || "",
			cost_center: category?.cost_center || "",
		});
	},
	paid_from(frm) {
		const source = frm.expense_options?.payment_sources.find((s) => s.account === frm.doc.paid_from);
		frm.set_value("mode_of_payment", source?.mode_of_payment || "");
	},
	async before_cancel(frm) {
		await new Promise((resolve, reject) => {
			const dialog = frappe.prompt(
				[
					{
						fieldname: "reason",
						fieldtype: "Small Text",
						label: __("Reason for cancellation"),
						reqd: 1,
					},
				],
				({ reason }) => {
					frm.doc.cancellation_reason = reason;
					resolve();
				},
				__("Cancel expense"),
				__("Continue"),
			);
			dialog.onhide = () => {
				if (!frm.doc.cancellation_reason) reject(new Error(__("Cancellation reason is required")));
			};
		});
	},
});
