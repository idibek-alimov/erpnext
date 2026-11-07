/* Stable operation IDs survive lost responses/reloads and remain visible to closing in other tabs. */
frappe.provide("frappe.expense_requests");

Object.assign(frappe.expense_requests, {
	key(action) {
		return `quick-expense:${frappe.session.user}:${action}`;
	},
	pending(action) {
		const key = this.key(action);
		const saved = localStorage.getItem(key) || sessionStorage.getItem(key);
		if (saved) {
			const pending = JSON.parse(saved);
			localStorage.setItem(key, saved);
			sessionStorage.removeItem(key);
			return pending;
		}
		return null;
	},
	clear(action, id) {
        for (const storage of [localStorage, sessionStorage]) {
            const raw = storage.getItem(this.key(action));
            if (!raw || !id || JSON.parse(raw).id === id) storage.removeItem(this.key(action));
        }
	},
	async check(action) {
		const pending = this.pending(action);
		if (!pending) return null;
		const response = await frappe.call({
			method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_request_outcome",
			args: { client_request_id: pending.id },
		});
		const result = response.message;
		if (!result || !["submitted", "cancelled", "draft", "not_found"].includes(result.status))
			throw new Error(__("The expense result was not confirmed. Retry to check its status."));
		// A read with no result never discards original intent: a delayed send could
		// still arrive. A cancellation is complete only when its reversal is confirmed.
		const terminal = action === "record_quick_expense"
			? ["submitted", "cancelled"].includes(result.status)
			: result.status === "cancelled";
		if (terminal && result.name && result.docstatus === (result.status === "submitted" ? 1 : 2))
			this.clear(action, pending.id);
		return result;
	},
	async run(action, args) {
		const key = this.key(action);
		const intent = JSON.stringify(args);
		let pending = this.pending(action);
		if (pending && JSON.stringify(pending.args) !== intent) {
			let completed;
			try {
				const outcome = await frappe.call({
					method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_request_outcome",
					args: { client_request_id: pending.id },
				});
				completed = ["submitted", "cancelled"].includes(outcome.message?.status)
					? outcome.message
					: null;
			} catch {
				/* Unknown outcome retains the pending operation. */
			}
			if (completed) {
				this.clear(action, pending.id);
				throw new Error(
					__(
						"The previous request was completed. Refresh and review the recorded expense before continuing.",
					) +
						" " +
						completed.name,
				);
			}
			throw new Error(
				__(
					"The previous expense request needs confirmation. Restore its values and retry before recording another expense.",
				),
			);
		}
		if (!pending) {
			pending = { args, id: crypto.randomUUID() };
			localStorage.setItem(key, JSON.stringify(pending));
		}
		try {
			const response = await frappe.call({
				method: `erpnext.accounts.page.expense_desk.expense_desk.${action}`,
				args: { ...pending.args, client_request_id: pending.id },
			});
			if (!response.message?.expense)
				throw new Error(__("The expense result was not confirmed. Retry to check its status."));
			if (action === "record_quick_expense" && response.message.expense.docstatus === 2) {
				this.clear(action, pending.id);
				throw new Error(
					__(
						"The original expense was cancelled. Refresh and ask a manager to review it before recording another expense.",
					),
				);
			}
			const expectedStatus = action === "cancel_quick_expense" ? 2 : 1;
			if (response.message.expense.docstatus !== expectedStatus) {
				throw new Error(__("The expense result was not confirmed. Retry to check its status."));
			}
			this.clear(action, pending.id);
			return response.message;
		} catch (error) {
			// Validation failures roll back on the server. Check the operation before
			// allowing edited input; an unknown network result keeps its original ID.
			if (error?.responseJSON?.exc_type || error?.exc_type) {
				try {
					const outcome = await frappe.call({
						method: "erpnext.accounts.page.expense_desk.expense_desk.get_expense_request_outcome",
						args: { client_request_id: pending.id },
					});
					if (outcome.message?.status === "not_found") this.clear(action, pending.id);
				} catch {
					/* Keep the request for a safe retry. */
				}
			}
			throw error;
		}
	},
});
