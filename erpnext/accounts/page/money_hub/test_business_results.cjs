// Results orchestration and presentation; no financial writes or browser dependencies.
const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function data(company = "Test") {
	return {company, currency: "TJS", currency_precision: 2, from_date: "2026-11-01", to_date: "2026-11-07",
		ledger: {income: 1000, cogs: 400, other_expenses: 100, result: 500, accounts: [
			{account: "USD Rent", root_type: "Expense", account_type: "", base_amount: 100, account_amount: 10, account_currency: "USD"}]},
		invoice_sales: {net_sales: 900, returns: 100, unmerged_pos_net_sales: 200, unmerged_pos_count: 2,
			by_currency: [{currency: "USD", net_total: 80, base_net_total: 900}]},
		invoice_costs: {cogs: 350, gross_profit: 550, known_cogs: 350, unknown_rows: 0, as_of: "2026-11-07"},
		reconciliation: {income_less_invoice_sales: 100}, completeness: {final_profit: false},
		navigation: {account: true, sales_invoice: true, general_ledger: true, profit_and_loss: true}};
}
function deferred() {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};}
function harness(tg = false) {
	const calls = [];
	const frappe = {pages: {"money-hub": {}}, datetime: {
		get_today: () => "2026-11-07", add_days: (day, n) => new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10),
		get_diff: (end, start) => (Date.parse(end) - Date.parse(start)) / 86400000},
		utils: {escape_html: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
			get_form_link: (kind, name) => "/app/account/" + encodeURIComponent(name)},
		call: async request => {calls.push(request); return {message: data(request.args.company || "Test")};}};
	const context = vm.createContext({frappe, __: value => value, clearTimeout});
	vm.runInContext(fs.readFileSync(path.join(__dirname, "money_hub.js"), "utf8") + "\nglobalThis.App=MoneyHubApp;", context);
	const app = Object.create(context.App.prototype);
	Object.assign(app, {active_tab: "results", results_company: "Test", results_period: "month", is_tg: tg,
		render_results_body() {this.html = this.results_html();}, render_results_page() {this.shells = (this.shells || 0) + 1;}});
	return {app, frappe, calls};
}
test("results load independently of wallet/history data with this-month scope", async () => {
	const {app, calls} = harness(); await app.load();
	assert.equal(app.shells, 1); assert.equal(calls.length, 1);
	assert.match(calls[0].method, /get_business_results$/);
	assert.deepEqual({...calls[0].args}, {company: "Test", from_date: "2026-11-01", to_date: "2026-11-07"});
	assert.match(app.html, /Результат по проводкам/);
});
test("server company default is resolved once without requiring a wallet", async () => {
	const {app, calls} = harness(); app.results_company = ""; await app.load_results();
	assert.equal(calls[0].args.company, null); assert.equal(app.results_company, "Test");
	app.results_company = ""; await app.load_results(); assert.equal(calls.length, 1);
	assert.match(app.html, /Выберите компанию/);
});
test("presets and custom dates remain independent of movement filters", () => {
	const {app} = harness(); app.from_date = "2020-01-01"; app.results_period = "today";
	assert.deepEqual([...app.results_dates()], ["2026-11-07", "2026-11-07"]);
	app.results_period = "week"; assert.deepEqual([...app.results_dates()], ["2026-11-01", "2026-11-07"]);
	app.results_period = "custom"; app.results_from = "2026-10-20"; app.results_to = "2026-11-02";
	assert.deepEqual([...app.results_dates()], ["2026-10-20", "2026-11-02"]);
});
test("incomplete, reversed, future and oversized custom ranges clear old totals before querying", async () => {
	for (const [from, to] of [["", "2026-11-07"], ["2026-11-07", "2026-11-01"], ["2026-11-01", "2026-11-08"], ["2020-01-01", "2026-11-07"]]) {
		const {app, calls} = harness(); Object.assign(app, {results: data(), results_period: "custom", results_from: from, results_to: to});
		await app.load_results(); assert.equal(calls.length, 0); assert.equal(app.results, null);
		assert.match(app.html, /366/); assert.doesNotMatch(app.html, /500,00/);
	}
});
test("loading immediately removes prior company amounts and announces status", async () => {
	const {app, frappe} = harness(), pending = deferred(); app.results = data(); frappe.call = () => pending.promise;
	const load = app.load_results(); assert.equal(app.results, null); assert.match(app.html, /role="status"/);
	pending.resolve({message: data()}); await load; assert.equal(app.results_loading, false);
});
test("late company responses cannot replace newer totals", async () => {
	const {app, frappe} = harness(), pending = deferred(); let count = 0;
	frappe.call = () => ++count === 1 ? pending.promise : Promise.resolve({message: data("Other")});
	const old = app.load_results(); app.results_company = "Other"; await app.load_results();
	pending.resolve({message: data()}); await old; assert.equal(app.results.company, "Other");
});
test("switching away prevents a late result or failure from rendering", async () => {
	const {app, frappe} = harness(), pending = deferred(); frappe.call = () => pending.promise;
	const load = app.load_results(); app.active_tab = "ledger"; pending.resolve({message: data()}); await load;
	assert.equal(app.results, null); assert.match(app.html, /Загрузка/);
});
test("wrong company/date and malformed responses are errors, followed by a fresh retry", async () => {
	for (const bad of [{...data(), company: "Other"}, {...data(), from_date: "2026-10-01"}, {...data(), ledger: null}]) {
		const {app, frappe} = harness(); frappe.call = async () => ({message: bad}); await app.load_results();
		assert.equal(app.results, null); assert.match(app.html, /mh-results-retry/);
		frappe.call = async () => ({message: data()}); await app.load_results(); assert.equal(app.results.company, "Test");
	}
});
test("denied and failed reads retain filters and show bilingual recovery", async () => {
	for (const tg of [false, true]) {
		const {app, frappe} = harness(tg); frappe.call = async () => {throw {exc_type: "PermissionError", message: "<script>"};};
		await app.load_results(); assert.match(app.html, tg ? /дастрасӣ нест/ : /Нет доступа/);
		assert.match(app.html, /role="alert"/); assert.doesNotMatch(app.html, /<script>/); assert.equal(app.results_company, "Test");
		frappe.call = async () => {throw {status: 500};}; await app.load_results(); assert.match(app.html, /mh-results-retry/);
	}
});
test("posted and analytical figures stay distinct without adding POS or costs twice", () => {
	const {app} = harness(); app.results = data(); const html = app.results_html();
	for (const amount of ["1\\s*000,00", "400,00", "100,00", "500,00", "900,00", "350,00", "550,00", "200,00"]) assert.match(html, new RegExp(amount));
	assert.match(html, /не добавлены повторно/); assert.match(html, /не окончательная чистая прибыль/);
	assert.match(html, /2026-11-07/); assert.match(html, /Поздние отгрузки/);
});
test("unavailable costs/profit and original currencies remain unavailable, with recorded zero preserved", () => {
	const {app} = harness(); app.results = data(); Object.assign(app.results.invoice_costs, {cogs: null, gross_profit: null, known_cogs: 70, unknown_rows: 3});
	app.results.ledger.accounts[0].account_amount = null;
	let html = app.results_html(); assert.match(html, /часть себестоимости: 70,00/); assert.match(html, /стоимости: 3/); assert.match(html, /— USD/);
	assert.equal((html.match(/<strong class="">—<\/strong>/g) || []).length, 2);
	Object.assign(app.results.invoice_costs, {cogs: 0, gross_profit: 900}); html = app.results_html(); assert.doesNotMatch(html, /mh-results-missing/); assert.match(html, /0,00/);
});
test("all account rows render without truncation and native links retain scope and separate currencies", () => {
	const {app} = harness(); app.results = data(); const row = app.results.ledger.accounts[0];
	app.results.ledger.accounts = Array.from({length: 601}, (_, i) => ({...row, account: `Rent ${i}`}));
	const html = app.results_html(); assert.equal((html.match(/<tr>/g) || []).length, 602);
	assert.match(html, /Rent 600/); assert.match(html, /10,00 USD/); assert.match(html, /General%20Ledger\?company=Test&amp;from_date=2026-11-01/);
	assert.match(html, /account=%5B%22Rent%20600%22%5D/); assert.match(html, /posting_date=%5B%22between%22/);
});
test("native navigation is gated and all variable labels, accounts and URLs are escaped", () => {
	const {app} = harness(); app.results = data(); app.results.company = '<img onerror="1">';
	app.results.ledger.accounts[0].account = '<svg onload="1">'; app.results.invoice_sales.by_currency[0].currency = "<script>";
	const html = app.results_html(); assert.doesNotMatch(html, /<img|<svg|<script/); assert.match(html, /&lt;svg/);
	app.results.navigation = {}; const gated = app.results_html(); assert.doesNotMatch(gated, /href=/);
});
test("empty scope and Tajik completeness remain visible and negative results use text and color", () => {
	const {app} = harness(true); app.results = data(); app.results.ledger.accounts = []; app.results.ledger.result = -100;
	const html = app.results_html(); assert.match(html, /сабтҳои ғайрисифрии/); assert.match(html, /Пуррагии маълумот/);
	assert.match(html, /Тақсимот аз рӯи мағозаҳо/); assert.match(html, /text-danger/); assert.match(html, /-100/);
});
test("results precision comes from the results company even after viewing another wallet company", () => {
	const {app} = harness(); app.results = data(); app.results.currency_precision = 3;
	app.data = {currency_precisions: {TJS: 0}}; assert.match(app.results_html(), /500,000/);
});
test("toolbar actions resolve native wallet context for the selected results company", async () => {
	const {app, frappe, calls} = harness(); app.results = data(); app.data = {company: "Previous"};
	let opened; app.open_transfer = () => {opened = app.data.company;};
	frappe.call = async request => {calls.push(request); return {message: {company: request.args.company, wallets: []}};};
	await app.open_money_action("open_transfer"); assert.equal(opened, "Test");
	assert.equal(calls[0].args.company, "Test"); assert.match(calls[0].method, /get_money_hub_data$/);
});
test("toolbar context cannot open a dialog after the results scope changes", async () => {
	const {app, frappe} = harness(), pending = deferred(); app.results = data(); frappe.call = () => pending.promise;
	let opened = false; app.open_owner_money = () => {opened = true;};
	const load = app.open_money_action("open_owner_money"); app.results_sequence = 2; app.results_company = "Other";
	pending.resolve({message: {company: "Test"}}); await load; assert.equal(opened, false);
});
test("denied wallet context retains readable results and opens no financial dialog", async () => {
	const {app, frappe} = harness(); app.results = data(); frappe.call = async () => {throw {status: 403};};
	let message, opened = false; frappe.msgprint = value => {message = value;}; app.open_transfer = () => {opened = true;};
	await app.open_money_action("open_transfer"); assert.equal(opened, false); assert.equal(app.results.company, "Test");
	assert.match(message, /права на счета/);
});
test("unvalidated company text cannot fetch totals under the previous company", async () => {
	const {app, calls} = harness(); app.results = data(); app.results_company_control = {get_value: () => "Unvalidated"};
	await app.load_results(); assert.equal(calls.length, 0); assert.equal(app.results, null);
	assert.match(app.html, /Выберите компанию из списка/);
});
