const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function harness(values = {}) {
  const handlers = {},
    requests = [];
  const wrapper = {
    html(content) {
      if (content !== undefined) this.content = content;
      return this;
    },
    find() {
      return this;
    },
    on() {
      return this;
    },
    off() {
      return this;
    },
  };
  const context = {
    __: (text) => text,
    flt: (value, digits) =>
      digits == null
        ? Number(value || 0)
        : Number(Number(value || 0).toFixed(digits)),
    cint: (value) => Number.parseInt(value || 0),
    format_currency: (value) => String(value),
    setTimeout,
    clearTimeout,
    frappe: {
      ui: {
        form: {
          on(doctype, events) {
            handlers[doctype] = events;
          },
        },
      },
      utils: { escape_html: (text) => String(text) },
      meta: { get_field_precision: () => 2 },
      format: (value) => String(value),
      datetime: { str_to_user: (value) => value },
      call: (args) =>
        new Promise((resolve) => requests.push({ args, resolve })),
      throw: (message) => {
        throw new Error(message);
      },
      prompt: (fields, callback) => {
        context.prompt = callback;
      },
      msgprint: () => {},
    },
  };
  const frm = {
    doc: {
      name: "QPR-1",
      docstatus: 0,
      company: "A",
      target_warehouse: "Stores-A",
      item: "T",
      item_name: "Shirt",
      short_code: "1000",
      supplier: "S1",
      items: [],
      ...values,
    },
    fields_dict: {
      restock_matrix: { $wrapper: wrapper },
      restock_summary: { $wrapper: wrapper },
      purchase_total: { df: {} },
    },
    clear_table: (field) => {
      frm.doc[field] = [];
    },
    add_child: (field) => {
      const row = {};
      frm.doc[field].push(row);
      return row;
    },
    set_value: async (field, value) => {
      if (typeof field === "object") Object.assign(frm.doc, field);
      else frm.doc[field] = value;
    },
    refresh_field: () => {},
    dirty: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(__dirname + "/quick_product_restock.js", "utf8"),
    context
  );
  return {
    context,
    frm,
    requests,
    handlers: handlers["Quick Product Restock"],
  };
}

const stockRow = (values = {}) => ({
  item_code: "T-Red-M",
  color: "Red",
  size: "M",
  stock_uom: "Nos",
  qty: 0,
  current_stock: 4,
  buying_price: 50,
  orig_buying: 50,
  selling_price: 100,
  orig_selling: 100,
  ...values,
});

test("negative quantities survive synchronization and cannot disappear before validation", () => {
  const { context, frm } = harness();
  frm._state = { info: {}, selected: ["Red"], rows: [stockRow({ qty: -2 })] };
  context.sync_items(frm);
  assert.equal(frm.doc.items.length, 1);
  assert.equal(frm.doc.items[0].qty, -2);
});

test("new sizes with missing quantity survive synchronization for explicit server validation", () => {
  const { context, frm } = harness();
  frm._state = {
    info: {},
    selected: ["Red"],
    rows: [stockRow({ item_code: "", qty: 0 })],
  };
  context.sync_items(frm);
  assert.equal(frm.doc.items.length, 1);
  assert.equal(frm.doc.items[0].is_new_variant, 1);
});

test("warehouse reload keeps unsaved quantities and individual price overrides", () => {
  const { context, frm } = harness();
  frm._state = {
    info: {},
    selected: ["Red"],
    rows: [stockRow({ qty: 7, buying_price: 65, selling_price: 125 })],
  };
  context.sync_items(frm);
  context.build_state(frm, {
    stock_uom: "Nos",
    color_attr: "Color",
    rows: [stockRow({ current_stock: 20 })],
  });
  const row = frm._state.rows[0];
  assert.deepEqual(
    [row.qty, row.buying_price, row.selling_price, row.current_stock],
    [7, 65, 125, 20]
  );
});

test("bulk delivery cost preserves overrides by default and allows explicit replacement", () => {
  const { context, frm } = harness();
  frm._state = {
    info: {},
    selected: ["Red"],
    rows: [
      stockRow({ qty: 2 }),
      stockRow({ qty: 2, buying_price: 75 }),
      stockRow(),
    ],
  };
  context.render_matrix = () => {};
  context.qpr_bulk_prices(frm, "buying_price");
  context.prompt({ rate: 60, overwrite: 0 });
  assert.deepEqual(
    frm._state.rows.map((r) => r.buying_price),
    [60, 75, 50]
  );
  context.qpr_bulk_prices(frm, "buying_price");
  context.prompt({ rate: 70, overwrite: 1 });
  assert.deepEqual(
    frm._state.rows.map((r) => r.buying_price),
    [70, 70, 50]
  );
});

test("obsolete supplier defaults cannot change currency or the current deadline", async () => {
  const { context, frm, requests } = harness();
  const old = context.qpr_defaults(frm, true);
  frm.doc.supplier = "S2";
  const current = context.qpr_defaults(frm, true);
  requests[1].resolve({ message: { currency: "TJS", due_date: "2026-12-01" } });
  await current;
  requests[0].resolve({ message: { currency: "USD", due_date: "2026-11-01" } });
  await old;
  assert.equal(frm.doc.currency, "TJS");
  assert.equal(frm.doc.due_date, "2026-12-01");
});

test("clearing a deadline remains an open-ended agreement after a date change", async () => {
  const { context, frm, requests } = harness({ due_date: "" });
  frm._suggested_deadline = "2026-12-01";
  const pending = context.qpr_defaults(frm, false);
  requests[0].resolve({ message: { currency: "TJS", due_date: "2026-12-02" } });
  await pending;
  assert.equal(frm.doc.due_date, "");
});

test("warehouse defaults preserve an explicitly selected warehouse and reject old company responses", () => {
  const { context, frm, requests } = harness();
  context.set_default_warehouse(frm);
  assert.equal(requests.length, 0);
  frm.doc.target_warehouse = "";
  context.set_default_warehouse(frm);
  frm.doc.company = "B";
  requests[0].args.callback({ message: "Stores-A" });
  assert.equal(frm.doc.target_warehouse, "");
});

test("old barcode responses cannot replace a newer scanned product", () => {
  const { context, frm, requests, handlers } = harness({ short_code: "1000" });
  let selected = null;
  context.apply_product_selection = (...args) => {
    selected = args[1];
  };
  handlers.short_code(frm);
  frm.doc.short_code = "2000";
  handlers.short_code(frm);
  requests[1].args.callback({
    message: { item_code: "NEW", short_code: "2000" },
  });
  requests[0].args.callback({
    message: { item_code: "OLD", short_code: "1000" },
  });
  assert.equal(selected, "NEW");
});

test("save waits for resolved product and completed stock request", () => {
  const { frm, handlers } = harness();
  assert.throws(() => handlers.before_save(frm), /Choose a product/);
  frm._selected_name = frm.doc.item_name;
  frm._selected_code = frm.doc.short_code;
  frm._loading = true;
  assert.throws(() => handlers.before_save(frm), /finish loading/);
});

test("a changed product clears the automatically suggested supplier", async () => {
  const { context, frm } = harness();
  frm._suggested_supplier = "S1";
  context.init_matrix = () => {};
  await context.apply_product_selection(frm, "T2", "Jacket", "2000");
  assert.equal(frm.doc.supplier, "");
  assert.equal(frm.doc.item, "T2");
  assert.equal(frm._selected_name, "Jacket");
});

test("historical submitted restocks show quantities and costs without stored summary fields", () => {
  const { context, frm } = harness({
    docstatus: 1,
    total_qty: 0,
    purchase_total: 0,
    items: [stockRow({ qty: 5 })],
  });
  context.qpr_summary(frm);
  assert.match(
    frm.fields_dict.restock_summary.$wrapper.content,
    /Purchase Total[\s\S]*250/
  );
});

test("an older warehouse response cannot replace stock for the currently selected warehouse", () => {
  const { context, frm, requests } = harness();
  context.render_matrix = () => {};
  context.init_matrix(frm);
  frm.doc.target_warehouse = "Other-A";
  context.init_matrix(frm);
  const info = (current_stock) => ({
    item_code: "T",
    item_name: "Shirt",
    short_code: "1000",
    color_attr: "Color",
    rows: [stockRow({ current_stock })],
  });
  requests[1].args.callback({ message: info(20) });
  requests[0].args.callback({ message: info(4) });
  assert.equal(frm._state.rows[0].current_stock, 20);
  assert.ok(frm._loaded_key.endsWith("|Other-A"));
});
