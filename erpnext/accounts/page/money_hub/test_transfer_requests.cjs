const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
function harness(shared = new Map()) {
 const calls = [];
 const localStorage = {getItem:key=>shared.get(key)||null, setItem:(key,value)=>shared.set(key,value), removeItem:key=>shared.delete(key)};
 const frappe = {pages:{"money-hub":{}},session:{user:"manager"},call:async request=>{calls.push(request);return {message:{name:"PE-1",company:"Test",docstatus:1,status:"submitted"}};}};
 const context = vm.createContext({frappe,localStorage,crypto:{randomUUID:()=>"stable-request-1"},__:text=>text});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"money_hub.js"),"utf8")+"\nglobalThis.App=MoneyHubApp",context);
 const app = Object.create(context.App.prototype);app.data={company:"Test"};app.is_tg=false;
 const args = {company:"Test",from_wallet:"Cash",to_wallet:"Bank",amount:100};
 return {app,frappe,calls,args,shared,localStorage};
}
test("stable ID is persisted before sending and removed only for a confirmed native outcome",async()=>{
 const {app,frappe,args,shared}=harness();
 frappe.call=async request=>{assert.equal(shared.size,1);assert.match(request.method,/\.record_money_transfer$/);assert.equal(request.args.client_request_id,"stable-request-1");return {message:{name:"PE-1",company:"Test",docstatus:1}};};
 assert.equal((await app.run_transfer(args)).name,"PE-1");assert.equal(shared.size,0);
});
test("lost response survives reload and retries exactly the same ID and values",async()=>{
 const first=harness();let original;
 first.frappe.call=async request=>{original=request.args;throw new Error("Response lost");};
 await assert.rejects(first.app.run_transfer(first.args));assert.equal(first.shared.size,1);
 const next=harness(first.shared);await next.app.run_transfer(next.args);
 assert.equal(JSON.stringify(next.calls[0].args),JSON.stringify(original));assert.equal(first.shared.size,0);
});
test("unknown outcome rejects changed values without sending another posting request",async()=>{
 const {app,frappe,args,calls,shared}=harness();frappe.call=async()=>{throw new Error("Network");};
 await assert.rejects(app.run_transfer(args));
 await assert.rejects(app.run_transfer({...args,amount:200}),/предыдущий перевод/);
 assert.equal(calls.length,0);assert.equal(shared.size,1);
});
test("empty, draft or wrong-company responses retain the pending operation",async()=>{
 for (const result of [null,{}, {name:"PE-1",company:"Test",docstatus:0},{name:"PE-1",company:"Other",docstatus:1}]) {
  const {app,frappe,args,shared}=harness();frappe.call=async()=>({message:result});
  await assert.rejects(app.run_transfer(args));assert.equal(shared.size,1);
 }
});
test("cancelled source is returned as cancelled rather than reported as a new success",async()=>{
 const {app,frappe,args,shared}=harness();frappe.call=async()=>({message:{name:"PE-1",company:"Test",docstatus:2,status:"cancelled"}});
 assert.equal((await app.run_transfer(args)).docstatus,2);assert.equal(shared.size,0);
});
test("explicit validation rejection needs a serialized missing receipt before unlocking input",async()=>{
 const {app,frappe,args,calls,shared}=harness();
 frappe.call=async request=>{calls.push(request);if(calls.length===1)throw {exc_type:"ValidationError"};return {message:{status:"not_found"}};};
 await assert.rejects(app.run_transfer(args));assert.equal(calls.length,2);assert.equal(calls[1].args.client_request_id,"stable-request-1");assert.equal(shared.size,0);
});
test("failed outcome check after a rejection preserves the original operation",async()=>{
 const {app,frappe,args,shared}=harness();frappe.call=async()=>{throw {exc_type:"PermissionError"};};
 await assert.rejects(app.run_transfer(args));assert.equal(shared.size,1);
});
test("storage errors prevent any financial request",async()=>{
 const {app,args,calls,localStorage}=harness();localStorage.setItem=()=>{throw new Error("Storage denied");};
 await assert.rejects(app.run_transfer(args),/Storage denied/);assert.equal(calls.length,0);
});
test("pending storage is separated by company and signed-in user",()=>{
 const {app,frappe}=harness();const first=app.transfer_key();app.data.company="Other";assert.notEqual(app.transfer_key(),first);
 app.data.company="Test";frappe.session.user="other";assert.notEqual(app.transfer_key(),first);
});
test("a stale recovery dialog reuses its original ID after another tab clears storage",async()=>{
 const {app,args,calls}=harness();
 await app.run_transfer(args,"old-request-from-dialog");
 assert.equal(calls[0].args.client_request_id,"old-request-from-dialog");
});
test("a stale recovery dialog cannot overwrite a newer pending command",async()=>{
 const {app,frappe,args,calls}=harness();frappe.call=async()=>{throw new Error("Network");};
 await assert.rejects(app.run_transfer(args,"new-request"));
 await assert.rejects(app.run_transfer(args,"old-request"),/другом окне/);assert.equal(calls.length,0);
 assert.equal(app.pending_transfer().id,"new-request");
});
test("a changed page company prevents posting an old dialog's intent",async()=>{
 const {app,args,calls,shared}=harness();app.data.company="Other";
 await assert.rejects(app.run_transfer(args),/Компания изменилась/);assert.equal(calls.length,0);assert.equal(shared.size,0);
});
