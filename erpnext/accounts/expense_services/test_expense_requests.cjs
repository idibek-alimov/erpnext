const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const script = fs.readFileSync(
  path.resolve(__dirname, "../../public/js/expense_requests.js"),
  "utf8",
);

function client(call, storage = new Map(), oldTabStorage = new Map()) {
  const frappe = {
    session: { user: "cashier" },
    expense_requests: {},
    provide() {},
    call,
  };
  vm.runInNewContext(script, {
    frappe,
    crypto: { randomUUID: () => "operation-001" },
    __: (text) => text,
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    sessionStorage: {
      getItem: (key) => oldTabStorage.get(key),
      removeItem: (key) => oldTabStorage.delete(key),
    },
  });
  return { api: frappe.expense_requests, storage };
}

test("successful response clears the pending operation", async () => {
  const { api, storage } = client(async () => ({
    message: { expense: { name: "EXP-1", docstatus: 1 } },
  }));
  await api.run("record_quick_expense", { amount: 50 });
  assert.equal(storage.size, 0);
});

test("lost response retains ID across reload and posts the same intent on retry", async () => {
  const storage = new Map();
  const first = client(async () => {
    throw new Error("network");
  }, storage);
  await assert.rejects(
    first.api.run("record_quick_expense", { amount: 50 }),
    /network/,
  );
  const old = first.api.pending("record_quick_expense");
  let request;
  const reloaded = client(async (args) => {
    request = args;
    return { message: { expense: { name: "EXP-1", docstatus: 1 } } };
  }, storage);
  await reloaded.api.run("record_quick_expense", { amount: 50 });
  assert.equal(request.args.client_request_id, old.id);
  assert.equal(storage.size, 0);
});

test("edited intent cannot silently create another expense while outcome is unknown", async () => {
  let calls = 0;
  const { api } = client(async () => {
    calls++;
    throw new Error("network");
  });
  await assert.rejects(api.run("record_quick_expense", { amount: 50 }));
  await assert.rejects(
    api.run("record_quick_expense", { amount: 60 }),
    /needs confirmation/,
  );
  assert.equal(calls, 2); // Original command and a read-only outcome check.
});

test("an unconfirmed success response retains the request", async () => {
  const { api, storage } = client(async () => ({ message: {} }));
  await assert.rejects(
    api.run("record_quick_expense", { amount: 50 }),
    /not confirmed/,
  );
  assert.equal(storage.size, 1);
});

test("confirmed validation rollback allows input correction", async () => {
  const { api, storage } = client(async ({ method }) => {
    if (method.endsWith("get_expense_request_outcome"))
      return { message: { status: "not_found" } };
    throw { responseJSON: { exc_type: "ValidationError" } };
  });
  await assert.rejects(api.run("record_quick_expense", { amount: 50 }));
  assert.equal(storage.size, 0);
});

test("validation error does not discard a submitted operation", async () => {
  const { api, storage } = client(async ({ method }) => {
    if (method.endsWith("get_expense_request_outcome"))
      return { message: { status: "submitted", name: "EXP-1" } };
    throw { responseJSON: { exc_type: "ValidationError" } };
  });
  await assert.rejects(api.run("record_quick_expense", { amount: 50 }));
  assert.equal(storage.size, 1);
});

test("a completed older request is surfaced before accepting changed input", async () => {
  const storage = new Map();
  const first = client(async () => {
    throw new Error("network");
  }, storage);
  await assert.rejects(first.api.run("record_quick_expense", { amount: 50 }));
  const next = client(async ({ method }) => {
    assert.ok(method.endsWith("get_expense_request_outcome"));
    return { message: { status: "submitted", name: "EXP-1" } };
  }, storage);
  await assert.rejects(
    next.api.run("record_quick_expense", { amount: 60 }),
    /previous request was completed/,
  );
  assert.equal(storage.size, 0);
});

test("retrying a cancelled original expense never reports a new posting success", async () => {
  const { api, storage } = client(async () => ({
    message: { expense: { name: "EXP-1", docstatus: 2 } },
  }));
  await assert.rejects(
    api.run("record_quick_expense", { amount: 50 }),
    /original expense was cancelled/,
  );
  assert.equal(storage.size, 0);
});


test("migrates old same-tab evidence without changing its request ID or intent", async () => {
  const tab = new Map([["quick-expense:cashier:record_quick_expense", JSON.stringify({ id: "original-operation", args: { amount: 50 } })]]);
  const persistent = new Map();
  const { api } = client(async () => { throw new Error("network"); }, persistent, tab);
  assert.equal(api.pending("record_quick_expense").id, "original-operation");
  assert.equal(tab.size, 0);
  assert.equal(persistent.size, 1);
  await assert.rejects(api.run("record_quick_expense", { amount: 50 }));
  assert.equal(api.pending("record_quick_expense").id, "original-operation");
});

test("a late completed response cannot erase another pending operation", async () => {
  const { api, storage } = client(async () => ({ message: { expense: { name: "QE", docstatus: 1 } } }));
  const key = api.key("record_quick_expense");
  storage.set(key, JSON.stringify({ id: "new-operation", args: { amount: 60 } }));
  api.clear("record_quick_expense", "old-operation");
  assert.equal(api.pending("record_quick_expense").id, "new-operation");
});

test("independent check recovers submitted result without current source/category or a create call", async () => {
  const storage = new Map([["quick-expense:cashier:record_quick_expense", JSON.stringify({id:"original-id",args:{amount:50,category:"Disabled category",paid_from:"Disabled wallet"}})]]);
  const { api } = client(async ({method,args}) => {
    assert.ok(method.endsWith("get_expense_request_outcome"));
    assert.equal(args.client_request_id, "original-id");
    return {message:{name:"QE-50",status:"submitted",docstatus:1}};
  },storage);
  assert.equal((await api.check("record_quick_expense")).name,"QE-50");
  assert.equal(storage.size,0);
});

test("no recorded result retains original intent and ID for a safe retry", async () => {
  const storage = new Map([["quick-expense:cashier:record_quick_expense", JSON.stringify({id:"original-id",args:{amount:50}})]]);
  const { api } = client(async()=>({message:{status:"not_found"}}), storage);
  await api.check("record_quick_expense");
  assert.equal(api.pending("record_quick_expense").id,"original-id");
});

test("cancellation status check clears only a confirmed cancellation", async () => {
  const storage=new Map([["quick-expense:cashier:cancel_quick_expense",JSON.stringify({id:"cancel-id",args:{expense_name:"QE"}})]]);
  let status="submitted";
  const {api}=client(async()=>({message:{name:"QE",status,docstatus:status==="submitted"?1:2}}),storage);
  await api.check("cancel_quick_expense");
  assert.equal(storage.size,1);
  status="cancelled";
  await api.check("cancel_quick_expense");
  assert.equal(storage.size,0);
});

test("cancelled original is confirmed as cancelled rather than a fresh successful expense",async()=>{
  const storage=new Map([["quick-expense:cashier:record_quick_expense",JSON.stringify({id:"record-id",args:{amount:50}})]]);
  const {api}=client(async()=>({message:{name:"QE",status:"cancelled",docstatus:2}}),storage);
  assert.equal((await api.check("record_quick_expense")).status,"cancelled");
  assert.equal(storage.size,0);
});

test("failed, malformed and unauthorized outcome checks preserve pending evidence",async()=>{
  for(const response of [new Error("permission denied"),{}, {message:{status:"unknown"}}, {message:{name:"QE",status:"submitted",docstatus:0}}]){
    const storage=new Map([["quick-expense:cashier:record_quick_expense",JSON.stringify({id:"record-id",args:{amount:50}})]]);
    const {api}=client(async()=>{if(response instanceof Error)throw response;return response;},storage);
    try{await api.check("record_quick_expense");}catch{}
    assert.equal(storage.size,1);
  }
});
