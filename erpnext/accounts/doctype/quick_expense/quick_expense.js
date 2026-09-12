// Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.ui.form.on("Quick Expense", {
	setup(frm) {
		frm.set_query("paid_from", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
					account_type: ["in", ["Cash", "Bank"]],
				},
			};
		});

		frm.set_query("expense_account", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
					root_type: "Expense",
				},
			};
		});

		frm.set_query("cost_center", function () {
			return {
				filters: {
					company: frm.doc.company,
					is_group: 0,
				},
			};
		});
	},

	refresh(frm) {
		if (frm.doc.docstatus === 1) {
			if (frm.doc.purchase_invoice) {
				frm.add_custom_button(__("Purchase Invoice"), () => {
					frappe.set_route("Form", "Purchase Invoice", frm.doc.purchase_invoice);
				}, __("View"));
			}
			if (frm.doc.payment_entry) {
				frm.add_custom_button(__("Payment Entry"), () => {
					frappe.set_route("Form", "Payment Entry", frm.doc.payment_entry);
				}, __("View"));
			}
			if (frm.doc.journal_entry) {
				frm.add_custom_button(__("Journal Entry"), () => {
					frappe.set_route("Form", "Journal Entry", frm.doc.journal_entry);
				}, __("View"));
			}
		}
	},

	expense_category(frm) {
		if (!frm.doc.expense_category) return;

		// Suggest party type based on category
		if (frm.doc.expense_category === "Staff Bonus") {
			if (!frm.doc.party_type) frm.set_value("party_type", "Employee");
		} else if (["Rent", "Electricity"].includes(frm.doc.expense_category)) {
			if (!frm.doc.party_type) frm.set_value("party_type", "Supplier");
		}

		// Auto-populate expense account
		if (frm.doc.company) {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "Account",
					filters: {
						company: frm.doc.company,
						is_group: 0,
						root_type: "Expense",
					},
					fields: ["name", "account_name"],
					limit_page_length: 100,
				},
				callback: function (r) {
					if (!r.message) return;
					const map = {
						"Rent": ["Office Rent", "Rent"],
						"Electricity": ["Electricity Expenses", "Utility Expenses"],
						"Internet & Phone": ["Internet and Communications", "Telephone Expenses", "Utility Expenses"],
						"Staff Bonus": ["Staff Bonuses and Incentives", "Salary"],
						"Store & Office Supplies": ["Store Supplies and Consumables", "Print and Stationery", "Office Maintenance Expenses"],
						"Transportation & Taxi": ["Travel Expenses"],
						"Repairs & Maintenance": ["Office Maintenance Expenses"],
						"Food & Refreshments": ["Entertainment Expenses", "Miscellaneous Expenses"],
						"Other Expense": ["Miscellaneous Expenses"],
					};
					const targets = map[frm.doc.expense_category] || ["Miscellaneous Expenses"];
					for (const target of targets) {
						const found = r.message.find(acc => acc.account_name === target);
						if (found) {
							frm.set_value("expense_account", found.name);
							break;
						}
					}
				},
			});
		}
	},

	mode_of_payment(frm) {
		if (frm.doc.mode_of_payment && frm.doc.company) {
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Mode of Payment Account",
					filters: {
						parent: frm.doc.mode_of_payment,
						company: frm.doc.company,
					},
					fieldname: "default_account",
				},
				callback: function (r) {
					if (r.message && r.message.default_account) {
						frm.set_value("paid_from", r.message.default_account);
					}
				},
			});
		}
	},

	company(frm) {
		if (frm.doc.company) {
			// Fetch company default cash account
			frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Company",
					filters: { name: frm.doc.company },
					fieldname: ["default_cash_account", "cost_center"],
				},
				callback: function (r) {
					if (r.message) {
						if (r.message.default_cash_account && !frm.doc.paid_from) {
							frm.set_value("paid_from", r.message.default_cash_account);
						}
						if (r.message.cost_center && !frm.doc.cost_center) {
							frm.set_value("cost_center", r.message.cost_center);
						}
					}
				},
			});
		}
	},
});
