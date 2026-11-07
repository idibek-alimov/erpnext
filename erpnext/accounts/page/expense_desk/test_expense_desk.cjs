// Isolated UI orchestration checks; no Frappe site or financial documents are written.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "expense_desk.js"), "utf8");
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
function harness() {
  const contents = new Map();
  function element(selector = "") {
    return {
      html(value) {
        if (value !== undefined) contents.set(selector, value);
        return this;
      },
      text(value) {
        if (value === undefined) return "";
        contents.set(selector, value);
        return this;
      },
      prop(key, value) {
        contents.set(`${selector}:${key}`, value);
        return this;
      },
      empty() {
        contents.set(selector, "");
        return this;
      },
      find: (key) => element(key),
      val() {
        return this;
      },
      toggle() {
        return this;
      },
      closest() {
        return this;
      },
      removeClass() {
        return this;
      },
      append() {
        return this;
      },
      appendTo() {
        return this;
      },
    };
  }
  const messages = [],
    calls = [],
    requests = [];
  const frappe = {
    provide() {},
    expense_entry: {},
    pages: { "expense-desk": {} },
    boot: { user: { can_read: [] } },
    ui: {},
    require: async () => {},
    call: async (args) => {
      calls.push(args);
      return { message: {} };
    },
    utils: {
      escape_html: (s) =>
        s
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;"),
      get_form_link: (dt, name) =>
        `/app/${dt.toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(name)}`,
    },
    expense_requests: {
      pending: () => null,
      run: async (action, args) => {
        requests.push({ action, args });
        return { expense: { name: "EXP1", docstatus: 1, status: "submitted" } };
      },
      check: async () => ({ status: "not_found" }),
    },
    msgprint: (value) => messages.push(value),
  };
  const context = vm.createContext({
    frappe,
    $: element,
    navigator: { onLine: true },
    window: {},
    __: (key, args = []) =>
      args.reduce((s, x, i) => s.replace(`{${i}}`, x), key),
    format_currency: (v, c) => `${v} ${c}`,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, "../../../public/js/expense_entry.js"),
      "utf8",
    ),
    context,
  );
  vm.runInContext(source + "\nglobalThis.App = ExpenseDeskApp;", context);
  const app = Object.create(context.App.prototype);
  Object.assign(app, {
    wrapper: element(),
    filters: app.defaults(),
    company: "Test",
    data: {
      company: "Test",
      currency: "TJS",
      can_record: true,
      categories: [{ name: "cat-id", category_name: "Tea" }],
      payment_sources: [{ account: "Office", label: "Safe" }],
    },
    rows: [],
    sequence: 0,
    page: { btn_primary: element("primary") },
    render_recovery() {},
    update_scope_controls() {},
    update_options() {},
  });
  const response = (rows = [], total = 100) => ({
    message: {
      recent_expenses: rows,
      summary: {
        period_total: total,
        cash_total: 40,
        bank_total: 60,
        matching_count: 123,
        category_breakdown: [],
      },
      has_more: true,
      next_start: 50,
      period_from: "2026-11-01",
      period_to: "2026-11-30",
    },
  });
  return {
    app,
    frappe,
    contents,
    messages,
    calls,
    requests,
    response,
    element,
  };
}
function dialog(h, values = {}) {
  const fields = new Map();
  return {
    values,
    get_value: (k) => values[k],
    get_field: (k) => {
      if (!fields.has(k)) fields.set(k, { $wrapper: h.element(k) });
      return fields.get(k);
    },
    set_value(k, v) {
      values[k] = v;
    },
    set_df_property() {},
    refresh_section_collapse() {},
    get_primary_btn: () => h.element("dialog-primary"),
    hide() {
      this.hidden = true;
    },
  };
}
test("ordinary expense period starts this month", () => {
  const { app } = harness();
  assert.equal(app.filters.period, "month");
  assert.equal(app.filters.status, "submitted");
});
test("obsolete company/filter response cannot replace a newer scope", async () => {
  const h = harness(),
    old = deferred(),
    next = deferred();
  let n = 0;
  h.frappe.call = () => (++n === 1 ? old.promise : next.promise);
  const first = h.app.load();
  await new Promise(setImmediate);
  h.app.filters.search = "new";
  const second = h.app.load();
  await new Promise(setImmediate);
  next.resolve(
    h.response(
      [
        {
          source_id: "Quick Expense:New",
          source_doctype: "Quick Expense",
          name: "New",
          docstatus: 1,
        },
      ],
      200,
    ),
  );
  await second;
  old.resolve(h.response([{ source_id: "Quick Expense:Old" }], 999));
  await first;
  assert.equal(h.app.summary.period_total, 200);
  assert.equal(h.app.rows[0].name, "New");
});
test("paging keeps typed identities and authoritative all-matching totals", async () => {
  const h = harness();
  h.app.rows = [
    {
      source_id: "Quick Expense:Same",
      name: "Same",
      source_doctype: "Quick Expense",
      docstatus: 1,
    },
  ];
  h.app.next_start = 50;
  h.frappe.call = async (args) => {
    h.calls.push(args);
    return h.response(
      [
        {
          source_id: "POS Cash Movement:Same",
          name: "Same",
          source_doctype: "POS Cash Movement",
          docstatus: 1,
        },
      ],
      900,
    );
  };
  await h.app.load(false, true);
  assert.equal(h.app.rows.length, 2);
  assert.equal(h.app.summary.period_total, 900);
  assert.equal(h.calls[0].args.limit_start, 50);
  assert.match(h.contents.get(".ed-summary"), /900 TJS/);
});
test("invalid custom dates invalidate figures and make no history call", async () => {
  const h = harness();
  h.app.ready = true;
  h.app.filters.period = "custom";
  h.app.filters.from_date = "2026-11-10";
  h.app.filters.to_date = "2026-11-01";
  await h.app.load();
  assert.equal(h.calls.length, 0);
  assert.equal(h.app.ready, false);
  assert.match(h.contents.get(".ed-summary"), /—/);
  assert.equal(h.contents.get("primary:disabled"), true);
});
test("failed refresh does not present stale paid totals as current", async () => {
  const h = harness();
  h.app.ready = true;
  h.frappe.call = async () => {
    throw Error("Restricted");
  };
  await h.app.load();
  assert.equal(h.app.ready, false);
  assert.match(h.contents.get(".ed-results"), /Restricted/);
  assert.doesNotMatch(h.contents.get(".ed-summary"), /100 TJS/);
});
test("ordinary entry sources are requested in Desk scope even from POS-filtered history", async () => {
  const h = harness(),
    d = dialog(h);
  h.app.entry = d;
  h.app.filters.pos_profile = "Register";
  h.app.filters.pos_opening_shift = "Shift";
  h.frappe.call = async (args) => {
    h.calls.push(args);
    return { message: { categories: [], payment_sources: [] } };
  };
  await h.app.entry_options(d, "Test", false);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0].args)), {
    company: "Test",
    entry_context: "Desk",
  });
});
test("changing correction shift ignores late source choices", async () => {
  const h = harness(),
    d = dialog(h, { pos_opening_shift: "Old" }),
    old = deferred();
  h.app.entry = d;
  let n = 0;
  h.frappe.call = async () =>
    ++n === 1
      ? old.promise
      : {
          message: {
            pos_opening_shift: "New",
            categories: [],
            payment_sources: [],
          },
        };
  const first = h.app.entry_options(d, "Test");
  d.values.pos_opening_shift = "New";
  await h.app.entry_options(d, "Test");
  old.resolve({
    message: { pos_opening_shift: "Old", categories: [], payment_sources: [] },
  });
  await first;
  assert.equal(d.expense_options.pos_opening_shift, "New");
});
test("native option labels escape configured category and wallet text", () => {
  const h = harness(),
    d = dialog(h),
    options = {};
  d.set_df_property = (field, key, value) => {
    options[field] = value;
  };
  h.app.set_entry_options(d, {
    categories: [{ name: "cat-id", category_name: "<img onerror=x>" }],
    payment_sources: [{ account: "Office", label: "<svg onload=x>" }],
  });
  assert.match(options.category[1].label, /&lt;img/);
  assert.match(options.paid_from[1].label, /&lt;svg/);
});
test("record posts canonical category/account once with captured company and no inferred POS scope", async () => {
  const h = harness(),
    d = dialog(h),
    pending = deferred();
  d.expense_options = h.app.data;
  h.app.entry = d;
  h.app.load = () => {};
  h.app.show_result = () => {};
  h.frappe.expense_requests.run = async (action, args) => {
    h.requests.push({ action, args });
    return pending.promise;
  };
  const values = {
    category: "cat-id",
    paid_from: "Office",
    amount: 50,
    posting_date: "2026-11-06",
    beneficiary_name: "Staff",
  };
  const first = h.app.submit_entry(d, values, "Test", false);
  await h.app.submit_entry(d, values, "Test", false);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].args.category, "cat-id");
  assert.equal(h.requests[0].args.company, "Test");
  assert.equal(h.requests[0].args.entry_context, "Desk");
  assert.equal(h.requests[0].args.pos_opening_shift, undefined);
  assert.equal(h.requests[0].args.party, undefined);
  pending.resolve({ expense: { name: "EXP1", docstatus: 1 } });
  await first;
  assert.equal(d.hidden, true);
});
test("lost record response keeps dialog input and exposes recovery", async () => {
  const h = harness(),
    d = dialog(h, { category: "cat-id", paid_from: "Office", amount: 50 });
  d.expense_options = h.app.data;
  h.frappe.expense_requests.run = async () => {
    throw Error("Lost response");
  };
  let recovered = 0;
  h.app.render_recovery = () => recovered++;
  await h.app.submit_entry(
    d,
    { ...d.values, posting_date: "2026-11-06" },
    "Test",
    false,
  );
  assert.equal(d.values.amount, 50);
  assert.equal(d.hidden, undefined);
  assert.equal(h.contents.get("result"), "Lost response");
  assert.equal(recovered, 1);
});
test("POS correction cannot submit with stale choices or missing reason", async () => {
  const h = harness(),
    d = dialog(h);
  d.expense_options = { ...h.app.data, pos_opening_shift: "Old" };
  await h.app.submit_entry(
    d,
    {
      category: "cat-id",
      paid_from: "Office",
      amount: 50,
      pos_opening_shift: "New",
      correction_reason: "Taxi",
    },
    "Test",
    true,
  );
  assert.equal(h.requests.length, 0);
});
test("independent recovery works without current options, and missing result remains pending", async () => {
  const h = harness();
  h.app.data = null;
  h.frappe.expense_requests.pending = () => ({ id: "original", args: {} });
  let checks = 0;
  h.frappe.expense_requests.check = async () => {
    checks++;
    return { status: "not_found" };
  };
  await h.app.recover("record_quick_expense");
  assert.equal(checks, 1);
  assert.equal(h.requests.length, 0);
  assert.match(h.messages[0], /retained/);
});
test("unconfirmed cancellation is never reported as completed or newly recorded", async () => {
  const h = harness();
  h.frappe.expense_requests.pending = () => ({ id: "original", args: {} });
  h.frappe.expense_requests.check = async () => ({
    status: "submitted",
    docstatus: 1,
    name: "EXP1",
  });
  h.app.show_result = () =>
    assert.fail("must not report completed cancellation");
  await h.app.recover("cancel_quick_expense");
  assert.match(h.messages[0], /Cancellation is not confirmed/);
});
test("receipt links allow only native file paths", () => {
  const { app } = harness();
  for (const value of [
    "https://evil/x",
    "javascript:alert(1)",
    "//evil/x",
    "/files/x\\evil",
    "/private/files/x\nfoo",
  ])
    assert.equal(app.receipt_url(value), null);
  assert.equal(
    app.receipt_url("/private/files/a%20b.pdf"),
    "/private/files/a%20b.pdf",
  );
  assert.equal(app.receipt_url("/files/old.jpg"), "/files/old.jpg");
});

test("source loading explicitly enables the native primary button once options are ready", () => {
  const h = harness(),
    d = dialog(h);
  h.app.set_entry_options(d, { categories: [], payment_sources: [] });
  assert.equal(h.contents.get("dialog-primary:disabled"), true);
  h.app.set_entry_options(d, h.app.data);
  assert.equal(h.contents.get("dialog-primary:disabled"), false);
});

test("receipt upload uses private native uploader and blocks an unconfirmed attachment", () => {
  const h = harness(),
    d = dialog(h);
  d.expense_options = h.app.data;
  h.app.entry = d;
  let uploader;
  h.element("secondary").hide = () => {};
  h.frappe.ui.FileUploader = class {
    constructor(options) {
      uploader = this;
      this.options = options;
      this.uploader = { files: [{}] };
      this.dialog = { get_secondary_btn: () => ({ hide() {} }) };
    }
  };
  h.app.upload_receipt(d);
  assert.equal(uploader.options.make_attachments_public, false);
  assert.equal(uploader.options.allow_web_link, false);
  assert.equal(uploader.options.allow_toggle_private, false);
  assert.equal(d.uploading, true);
  assert.equal(h.contents.get("dialog-primary:disabled"), true);
  uploader.options.on_success({ file_url: "/files/public.pdf" });
  uploader.dialog.onhide();
  assert.equal(d.receipt_pending, true);
  assert.equal(h.contents.get("dialog-primary:disabled"), true);
  // A response arriving after its uploader closed cannot attach a different file.
  uploader.options.on_success({ file_url: "/private/files/late.pdf" });
  assert.equal(d.receipt_url, undefined);
});
test("confirmed private receipt unlocks recording when uploader closes", () => {
  const h = harness(),
    d = dialog(h);
  d.expense_options = h.app.data;
  h.app.entry = d;
  let uploader;
  h.frappe.ui.FileUploader = class {
    constructor(options) {
      uploader = this;
      this.options = options;
      this.uploader = { files: [{}] };
      this.dialog = { get_secondary_btn: () => ({ hide() {} }) };
    }
  };
  h.app.upload_receipt(d);
  uploader.options.on_success({
    file_url: "/private/files/receipt.pdf",
    file_name: "receipt.pdf",
  });
  uploader.dialog.onhide();
  assert.equal(d.receipt_url, "/private/files/receipt.pdf");
  assert.equal(d.receipt_pending, false);
  assert.equal(h.contents.get("dialog-primary:disabled"), false);
});
