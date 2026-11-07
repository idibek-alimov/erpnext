const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot(roles = ["Retail Cashier"]) {
	let route = null;
	const events = {};
	const redirects = [];
	const context = {
		document: {},
		window: {},
		$: () => ({ on: (event, callback) => (events[event] = callback) }),
		frappe: {
			user_roles: roles,
			session: { user: "cashier@example.test" },
			get_route: () => route,
			set_route: (target) => redirects.push(target),
			router: { on: (event, callback) => (events[event] = callback) },
			ui: { form: { on() {} } },
		},
	};
	vm.runInNewContext(
		fs.readFileSync(path.join(__dirname, "../public/js/retail_security.js"), "utf8"),
		context,
	);
	return { events, redirects, route: (value) => (route = value) };
}

test("cashier startup waits for a route then enforces the first restricted navigation", () => {
	const app = boot();
	assert.doesNotThrow(() => app.events.startup());
	assert.deepEqual(app.redirects, []);
	app.route(["money-hub"]);
	app.events.change();
	assert.deepEqual(app.redirects, ["posapp"]);
});

test("an unresolved empty route does not redirect or crash", () => {
	const app = boot();
	app.route([]);
	app.events.startup();
	assert.deepEqual(app.redirects, []);
});

test("cashiers retain POS and account recovery navigation", () => {
	const app = boot();
	app.events.startup();
	for (const page of ["posapp", "posawesome", "login", "logout", "update-password"]) {
		app.route([page]);
		app.events.change();
	}
	assert.deepEqual(app.redirects, []);
});

test("a manager who also has the cashier role retains management navigation", () => {
	const app = boot(["Retail Cashier", "Retail Manager"]);
	app.events.startup();
	app.route(["shift-review"]);
	app.events.change();
	assert.deepEqual(app.redirects, []);
});
