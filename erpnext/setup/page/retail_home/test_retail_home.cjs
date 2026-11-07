const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function boot(language = "ru") {
	const calls = [];
	const wrapper = { content: "", html(value) { this.content = value; return this; },
		find() { return this; }, on() { return this; } };
	const context = { $: () => wrapper, frappe: { pages: { "retail-home": {} },
		boot: { user: { language } }, call: (args) => calls.push(args),
		utils: { escape_html: (value) => String(value).replaceAll("<", "&lt;").replaceAll(">", "&gt;") } } };
	vm.runInNewContext(fs.readFileSync(path.join(__dirname, "retail_home.js"), "utf8") + "\nglobalThis.App = RetailHomeApp;", context);
	const app = new context.App({ body: {} });
	let renders = 0;
	app.render = () => renders++;
	return { app, calls, wrapper, renders: () => renders };
}

test("missing financial data stays unavailable while real zero remains zero", () => {
	const { app } = boot();
	assert.equal(app.fmt(null), "—");
	assert.equal(app.fmt(undefined), "—");
	assert.match(app.fmt(0), /0,00/);
});

test("posted result labels and completeness are explicit in Russian and Tajik", () => {
	for (const language of ["ru", "tg"]) {
		const { app } = boot(language);
		app.pnl = { revenue: 100, cogs: 40, expenses: 20, net: 40, company: "A&B", from_date: "2026-11-01", to_date: "2026-11-07",
			invoice_sales: { net_sales: 100, returns: 0, unmerged_pos_net_sales: null } };
		const html = app.pnl_html("TJS");
		assert.match(html, language === "ru" ? /не окончательная чистая прибыль/ : /фоидаи софи ниҳоӣ нест/);
		assert.match(html, language === "ru" ? /полнота ещё не проверена/ : /пуррагӣ ҳанӯз санҷида нашудааст/);
		assert.match(html, /company=A%26B/);
		assert.match(html, /period_start_date=2026-11-01/);
		assert.match(html, /— TJS/);
	}
});

test("an obsolete pulse cannot replace newer data or show an obsolete error", () => {
	const { app, calls, wrapper, renders } = boot();
	app.load(); app.load();
	calls[1].callback({ message: { pnl: { net: 50 } } });
	calls[0].callback({ message: { pnl: { net: 1 } } });
	calls[0].error();
	assert.equal(app.pnl.net, 50);
	assert.equal(renders(), 1);
	assert.doesNotMatch(wrapper.content, /rh-retry/);
});

test("period requests reject stale responses and errors", () => {
	const { app, calls, wrapper, renders } = boot();
	app.load_pnl(); app.load_pnl();
	calls[1].callback({ message: { net: 50 } });
	calls[0].callback({ message: { net: 1 } }); calls[0].error();
	assert.equal(app.pnl.net, 50);
	assert.equal(renders(), 1);
	assert.doesNotMatch(wrapper.content, /rh-retry/);
});

test("refresh invalidates an in-flight period response", () => {
	const { app, calls, renders } = boot();
	app.load_pnl(); app.load();
	calls[0].callback({ message: { net: 1 } });
	assert.equal(renders(), 0);
	assert.equal(app.pnl, null);
});

test("current errors and empty responses offer a retry instead of stale figures", () => {
	const { app, calls, wrapper } = boot();
	app.load(); calls[0].error();
	assert.match(wrapper.content, /role="alert"/);
	assert.match(wrapper.content, /rh-retry/);
	app.load_pnl(); calls[1].callback({});
	assert.match(wrapper.content, /rh-retry/);
});
