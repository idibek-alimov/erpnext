frappe.ui.form.on("Owner Money Settings", {
	setup(frm) {
		for (const field of ["contribution_account", "withdrawal_account", "loan_account"]) {
			frm.set_query(field, () => ({filters: {
				company: frm.doc.company, is_group: 0, disabled: 0,
				root_type: field === "loan_account" ? "Liability" : "Equity",
			}}));
		}
	},
});
