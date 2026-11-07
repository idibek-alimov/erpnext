// Isolated native-dialog orchestration checks; no site or financial records are written.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(language = "ru") {
  const dialogs = [], calls = [];
  const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  const frappe = {
    pages: { "money-hub": {} },
    utils: {
      escape_html: escape,
      get_form_link: (type, name) => "/app/" + type.toLowerCase().replaceAll(" ", "-") + "/" + encodeURIComponent(name),
    },
    call: async (request) => { calls.push(request); return { message: detail() }; },
    ui: { Dialog: class {
      constructor(options) {
        Object.assign(this, options);
        this.html = "";
        this.events = new Map();
        this.fields_dict = { detail_area: { $wrapper: {
          html: (value) => { this.html = value; },
          find: (selector) => ({ on: (event, handler) => this.events.set(selector, handler) }),
        } } };
        dialogs.push(this);
      }
      show() { this.visible = true; }
    } },
  };
  const context = vm.createContext({ frappe, __: (s) => s, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "money_hub.js"), "utf8") + "\nglobalThis.App = MoneyHubApp;", context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, { data: { company: "Test", currency: "TJS", currency_precisions: { TJS: 2, USD: 2 } }, is_tg: language === "tg" });
  const row = { gl_name: "GL1", voucher_type: "Sales Invoice", voucher_no: "INV1", amount: 999999, debit: 999999, wallet: "untrusted stale wallet" };
  return { app, row, frappe, dialogs, calls };
}

function detail(values = {}) {
  return {
    company: "Test", company_currency: "TJS", currency: "USD", voucher_type: "Sales Invoice", voucher_no: "INV1",
    docstatus: 1, status: "Submitted", owner: "Recorder", posting_date: "07.11.2026", posting_time: "09:20",
    movements: [{ gl_name: "GL1", wallet: "USD wallet", account: "Bank", currency: "TJS", account_currency: "USD",
      debit: 1100, credit: 0, account_debit: 100, account_credit: 0 }],
    items: [{ item_name: "Product", item_code: "ITEM", qty: 2, uom: "Nos", rate: 50, amount: 100, currency: "USD" }],
    grand_total: 100, payments: [], references: [], accounts: [], ...values,
  };
}

test("passes selected company and uses authorized amounts rather than stale feed data", async () => {
  const h = harness();
  await h.app.show_transaction_modal(h.row);
  assert.equal(h.calls[0].args.company, "Test");
  assert.equal(h.calls[0].silent, true);
  assert.match(h.dialogs[0].html, /USD wallet/);
  assert.match(h.dialogs[0].html, /TJS/);
  assert.match(h.dialogs[0].html, /USD/);
  assert.doesNotMatch(h.dialogs[0].html, /999999|untrusted stale wallet/);
  assert.match(h.dialogs[0].html, /href="\/app\/sales-invoice\/INV1"/);
});

test("escapes all variable labels, remarks, account names and document links", async () => {
  const h = harness();
  h.frappe.call = async () => ({ message: detail({
    remarks: '<img src=x onerror="boom()">', party_name: "<script>boom()</script>",
    voucher_no: 'INV1"><img src=x>', items: [{ item_name: "<img>", qty: 1, uom: "<svg>", rate: 1, amount: 1, currency: "USD" }],
    accounts: [{ account: "<iframe>", debit: 1, credit: 0, currency: "USD" }],
  }) });
  await h.app.show_transaction_modal(h.row);
  const html = h.dialogs[0].html;
  assert.doesNotMatch(html, /<img|<script|<svg|<iframe/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;iframe/);
});

test("failed request displays a retry that loads fresh data", async () => {
  const h = harness();
  let attempts = 0;
  h.frappe.call = async () => { if (++attempts === 1) throw new Error("Denied"); return { message: detail() }; };
  await h.app.show_transaction_modal(h.row);
  const dialog = h.dialogs[0];
  assert.match(dialog.html, /role="alert"/);
  assert.doesNotMatch(dialog.html, /href=/);
  await dialog.events.get('[data-action="retry-transaction"]')();
  assert.equal(attempts, 2);
  assert.match(dialog.html, /USD wallet/);
});

test("closed dialog ignores a late response", async () => {
  const h = harness(), pending = deferred();
  h.frappe.call = () => pending.promise;
  const loading = h.app.show_transaction_modal(h.row), dialog = h.dialogs[0];
  const initial = dialog.html;
  dialog.onhide();
  pending.resolve({ message: detail() });
  await loading;
  assert.equal(dialog.html, initial);
});

test("rejects cancelled, unrelated-company, missing and stale movement responses", async () => {
  for (const value of [null, detail({ docstatus: 2 }), detail({ company: "Other" }), detail({ movements: [] }),
    detail({ movements: [{ gl_name: "Other", wallet: "Other bank" }] })]) {
    const h = harness();
    h.frappe.call = async () => ({ message: value });
    await h.app.show_transaction_modal(h.row);
    assert.match(h.dialogs[0].html, /role="alert"/);
    assert.doesNotMatch(h.dialogs[0].html, /href=/);
  }
});

test("a company switch while loading cannot display the previous company transaction", async () => {
  const h = harness(), pending = deferred();
  h.frappe.call = () => pending.promise;
  const loading = h.app.show_transaction_modal(h.row);
  h.app.data.company = "Other";
  pending.resolve({ message: detail() });
  await loading;
  assert.match(h.dialogs[0].html, /role="alert"/);
});

test("payment sides and references retain their own currencies; missing amounts are not zero", async () => {
  const h = harness();
  h.frappe.call = async () => ({ message: detail({
    paid_from: "USD bank", paid_to: "TJS payable", paid_amount: 100, received_amount: 1100,
    paid_from_account_currency: "USD", paid_to_account_currency: "TJS",
    references: [{ reference_doctype: "Purchase Invoice", reference_name: "PI1", allocated_amount: 1100, currency: "TJS" }],
    items: [{ item_name: "Missing", qty: 1, rate: null, amount: null, currency: "USD" }],
    references_restricted: true,
  }) });
  await h.app.show_transaction_modal(h.row);
  const html = h.dialogs[0].html;
  assert.match(html, /100,00 USD/);
  assert.match(html, /1[^\d]100,00 TJS/);
  assert.match(html, /href="\/app\/purchase-invoice\/PI1"/);
  assert.match(html, /<td>—<\/td>/);
  assert.match(html, /ограничены правами/);
});

test("Tajik loading, successful detail and failed request labels are present", async () => {
  const h = harness("tg");
  await h.app.show_transaction_modal(h.row);
  assert.equal(h.dialogs[0].title, "Тафсилоти амалиёт");
  assert.match(h.dialogs[0].html, /Ҳуҷҷат/);
  h.frappe.call = async () => { throw new Error("Offline"); };
  await h.app.show_transaction_modal(h.row);
  assert.match(h.dialogs[1].html, /Такрор/);
});
