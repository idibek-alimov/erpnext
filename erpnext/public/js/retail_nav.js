// Retail OS navigation: curated left sidebar (7 hubs) + default landing on Retail Home.
// System Managers can switch to the full vanilla menu and back (stored in localStorage).
// Awesomebar (Ctrl+K) is untouched, so power users can still reach any DocType.

(function () {
	const FULL_MENU_KEY = "retail_full_menu";

	const HUBS = [
		{ icon: "🏠", ru: "Главная", tg: "Асосӣ", route: "retail-home" },
		{ icon: "🛒", ru: "Касса (POS)", tg: "Касса (POS)", route: "posapp" },
		{ icon: "📦", ru: "Товары и цены", tg: "Мол ва нархҳо", route: "product-catalog" },
		{ icon: "🤝", ru: "Поставщики", tg: "Таъминкунандагон", route: "supplier-hub" },
		{ icon: "👥", ru: "Персонал", tg: "Кормандон", route: "staff-hub" },
		{ icon: "💰", ru: "Кассы и счета", tg: "Хазинаҳо", route: "money-hub" },
		{ icon: "🏷️", ru: "Расход кассы", tg: "Хароҷоти касса", route: "expense-desk" },
	];

	function is_full_menu() {
		return localStorage.getItem(FULL_MENU_KEY) === "1";
	}

	function can_toggle() {
		return frappe.user_roles && frappe.user_roles.includes("System Manager");
	}

	function build_retail_sidebar(ws) {
		const is_tg = frappe.boot.user.language === "tg";
		const current = frappe.get_route()[0];
		ws.sidebar.find(".standard-sidebar-section").remove();

		const items = HUBS.map((h) => {
			const selected = current === h.route ? "selected" : "";
			return `
				<div class="sidebar-item-container" item-name="${h.route}">
					<div class="desk-sidebar-item standard-sidebar-item ${selected}">
						<a href="/app/${h.route}" class="item-anchor">
							<span class="sidebar-item-icon" style="font-size:16px">${h.icon}</span>
							<span class="sidebar-item-label">${is_tg ? h.tg : h.ru}</span>
						</a>
					</div>
				</div>`;
		}).join("");

		const toggle = can_toggle()
			? `<div class="sidebar-item-container">
				<div class="desk-sidebar-item standard-sidebar-item">
					<a href="#" class="item-anchor retail-toggle-menu">
						<span class="sidebar-item-icon" style="font-size:16px">⚙️</span>
						<span class="sidebar-item-label">${is_tg ? "Ҳамаи модулҳо" : "Все модули"}</span>
					</a>
				</div>
			</div>`
			: "";

		const section = $(`<div class="standard-sidebar-section nested-container">${items}${toggle}</div>`);
		section.find(".retail-toggle-menu").on("click", (e) => {
			e.preventDefault();
			localStorage.setItem(FULL_MENU_KEY, "1");
			ws.make_sidebar();
		});
		ws.sidebar.append(section);
		ws.remove_sidebar_skeleton && ws.remove_sidebar_skeleton();
	}

	function add_back_link(ws) {
		if (!can_toggle()) return;
		const is_tg = frappe.boot.user.language === "tg";
		const link = $(`<div class="standard-sidebar-section retail-back-section">
			<a href="#" class="item-anchor" style="display:block;padding:8px 12px;font-weight:600">
				🏪 ${is_tg ? "Менюи чакана" : "Меню магазина"}</a></div>`);
		link.find("a").on("click", (e) => {
			e.preventDefault();
			localStorage.removeItem(FULL_MENU_KEY);
			ws.make_sidebar();
		});
		ws.sidebar.find(".retail-back-section").remove();
		ws.sidebar.prepend(link);
	}

	function patch_workspace() {
		if (!frappe.views || !frappe.views.Workspace || frappe.views.Workspace.__retail_patched) {
			return !!(frappe.views && frappe.views.Workspace);
		}
		const orig = frappe.views.Workspace.prototype.make_sidebar;
		frappe.views.Workspace.prototype.make_sidebar = function () {
			if (is_full_menu()) {
				orig.call(this);
				add_back_link(this);
			} else {
				build_retail_sidebar(this);
			}
		};
		frappe.views.Workspace.__retail_patched = true;
		return true;
	}

	function redirect_home() {
		const route = frappe.get_route();
		const is_default = !route[0] || route[0] === "home" || route[0] === "Workspaces";
		if (is_default && !is_full_menu() && frappe.router.current_route && frappe.router.current_route.length <= 1) {
			frappe.set_route("retail-home");
		}
	}

	if (!patch_workspace()) {
		$(document).on("startup", patch_workspace);
	}
	$(document).on("startup", () => {
		patch_workspace();
		frappe.router.on("change", redirect_home);
	});
})();
