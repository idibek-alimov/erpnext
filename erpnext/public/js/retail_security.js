// Retail OS security: cashier route guard + printable manager auth badge (58x40 mm thermal).
(function () {
	const MGMT = ["Retail Manager", "Retail Owner", "System Manager", "Administrator"];
	const CASHIER_ALLOWED = ["posapp", "posawesome", "login", "logout", "update-password"];

	function is_cashier_only() {
		const roles = frappe.user_roles || [];
		return roles.includes("Retail Cashier") && !roles.some((r) => MGMT.includes(r)) && frappe.session.user !== "Administrator";
	}

	function guard() {
		if (!is_cashier_only()) return;
		const first = (frappe.get_route()[0] || "").toLowerCase();
		if (!CASHIER_ALLOWED.includes(first)) {
			frappe.set_route("posapp");
		}
	}

	$(document).on("startup", () => {
		guard();
		frappe.router.on("change", guard);
	});

	window.retail_print_manager_badge = function (code, name) {
		const w = window.open("", "_blank", "width=420,height=360");
		if (!w) return frappe.msgprint(__("Allow pop-ups to print the badge"));
		w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${frappe.utils.escape_html(code)}</title>
<style>
@page { size: 58mm 40mm; margin: 0; }
html,body { margin:0; padding:0; }
.badge { width:58mm; height:40mm; box-sizing:border-box; padding:2mm; text-align:center; font-family:Arial,sans-serif; display:flex; flex-direction:column; justify-content:center; align-items:center; }
.t { font-size:9pt; font-weight:700; letter-spacing:.5px; }
.n { font-size:11pt; font-weight:700; margin:1mm 0; }
svg { width:52mm; height:18mm; }
</style></head><body>
<div class="badge"><div class="t">АДМИНИСТРАТОР / MANAGER</div><div class="n">${frappe.utils.escape_html(name)}</div><svg id="bc"></svg></div>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
<script>
window.onload = function () {
  JsBarcode("#bc", ${JSON.stringify(code)}, { format: "CODE128", displayValue: true, fontSize: 14, height: 50, margin: 0 });
  setTimeout(function () { window.print(); }, 300);
};
<\/script></body></html>`);
		w.document.close();
	};

	frappe.ui.form.on("User", {
		refresh(frm) {
			if (frm.is_new()) return;
			if (!["System Manager", "Retail Owner"].some((r) => (frappe.user_roles || []).includes(r))) return;
			frm.add_custom_button(
				__("🖨️ Print Manager Badge"),
				() => {
					frappe.call({
						method: "erpnext.setup.retail_security.get_or_create_manager_badge",
						args: { user: frm.doc.name },
						callback: (r) => {
							if (!r.message) return;
							frm.reload_doc();
							window.retail_print_manager_badge(r.message.code, r.message.name);
						},
					});
				},
				__("Retail")
			);
			frm.add_custom_button(
				__("Regenerate Badge (lost)"),
				() => {
					frappe.confirm(__("The old badge will stop working. Continue?"), () => {
						frappe.call({
							method: "erpnext.setup.retail_security.regenerate_manager_badge",
							args: { user: frm.doc.name },
							callback: (r) => {
								if (!r.message) return;
								frm.reload_doc();
								window.retail_print_manager_badge(r.message.code, r.message.name);
							},
						});
					});
				},
				__("Retail")
			);
		},
	});
})();
