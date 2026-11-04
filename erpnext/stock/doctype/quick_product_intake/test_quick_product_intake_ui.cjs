const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

function harness(doc = {}) {
  const handlers = {};
  const requests = [];
  const context = {
    flt: (value, precision) =>
      precision == null
        ? Number(value || 0)
        : Number(Number(value || 0).toFixed(precision)),
    __: (text) => text,
    setTimeout,
    frappe: {
      ui: {
        form: {
          on: (doctype, events) => {
            handlers[doctype] = events;
          },
        },
      },
      model: {
        set_value: async (doctype, name, field, value) => {
          frm.doc.items.find((row) => row.name === name)[field] = value;
        },
        clear_doc: (doctype, name) => {
          frm.doc.items = frm.doc.items.filter((row) => row.name !== name);
        },
      },
      call: (args) =>
        new Promise((resolve) => requests.push({ args, resolve })),
      show_alert: () => {},
      msgprint: () => {},
    },
  };
  const frm = {
    doc: {
      docstatus: 0,
      company: "A",
      item_name: "Shirt",
      buying_price: 50,
      selling_price: 100,
      items: [],
      ...doc,
    },
    fields_dict: {},
    refresh_field: () => {},
    add_child: (field) => {
      const row = {
        name: `ROW-${frm.doc.items.length}`,
        doctype: "Quick Product Intake Item",
      };
      frm.doc[field].push(row);
      return row;
    },
    set_value: async (field, value) => {
      frm.doc[field] = value;
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(__dirname + "/quick_product_intake.js", "utf8"),
    context
  );
  return { context, frm, handlers: handlers["Quick Product Intake"], requests };
}

test("adding variants preserves quantities, individual prices and barcodes", () => {
  const { context, frm } = harness({
    colors: "Blue, Red",
    sizes: "M, L",
    items: [
      {
        color: "Blue",
        size: "M",
        qty: 7,
        buying_price: 65,
        selling_price: 120,
        barcode: "123",
      },
    ],
  });
  context.generate_matrix_rows(frm);
  assert.equal(frm.doc.items.length, 4);
  assert.equal(frm.doc.items[0].qty, 7);
  assert.equal(frm.doc.items[0].buying_price, 65);
  assert.equal(frm.doc.items[0].barcode, "123");
  context.generate_matrix_rows(frm);
  assert.equal(frm.doc.items.length, 4);
});

test("generation removes the untouched placeholder row inserted by Desk", () => {
  const { context, frm } = harness({
    colors: "Blue",
    sizes: "M",
    items: [{ name: "EMPTY", qty: 0, buying_price: 50, selling_price: 100 }],
  });
  context.generate_matrix_rows(frm);
  assert.equal(frm.doc.items.length, 1);
  assert.equal(frm.doc.items[0].color, "Blue");
  assert.equal(frm.doc.items[0].size, "M");
});

test("header prices preserve row overrides", () => {
  const { context, frm } = harness({
    buying_price: 60,
    items: [
      { name: "A", buying_price: 50 },
      { name: "B", buying_price: 75 },
      { name: "C", buying_price: 0 },
    ],
  });
  frm.__header_prices = { buying_price: 50 };
  context.propagate_price(frm, "buying_price");
  assert.deepEqual(
    frm.doc.items.map((row) => row.buying_price),
    [60, 75, 60]
  );
});

test("an older supplier-default response cannot overwrite the newer agreement", async () => {
  const { context, frm, requests } = harness({ supplier: "S1" });
  const old = context.intake_defaults(frm, true);
  frm.doc.supplier = "S2";
  const current = context.intake_defaults(frm, true);
  requests[1].resolve({ message: { currency: "TJS", due_date: "2026-12-01" } });
  await current;
  requests[0].resolve({ message: { currency: "USD", due_date: "2026-11-01" } });
  await old;
  assert.equal(frm.doc.currency, "TJS");
  assert.equal(frm.doc.due_date, "2026-12-01");
});

test("clearing a suggested deadline stays optional when receipt dates change", async () => {
  const { context, frm, requests } = harness({ supplier: "S", due_date: "" });
  frm.__suggested_deadline = "2026-12-01";
  const pending = context.intake_defaults(frm, false);
  requests[0].resolve({ message: { currency: "TJS", due_date: "2026-12-02" } });
  await pending;
  assert.equal(frm.doc.due_date, "");
});
