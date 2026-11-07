// Query/UI orchestration fixtures; no database or financial writes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise, resolve}; }
function harness(tg = false) {
 const calls = [];
 const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
 const frappe = {pages:{"money-hub":{}}, utils:{escape_html:escape, get_form_link:(type,name)=>"/app/"+type.replaceAll(" ","-")+"/"+encodeURIComponent(name)}, call:async args=>{calls.push(args);return {message:result()};}};
 const context = vm.createContext({frappe, __:s=>s, console, clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"money_hub.js"),"utf8")+"\nglobalThis.App=MoneyHubApp;",context);
 const app = Object.create(context.App.prototype);
 Object.assign(app,{data:{company:"Test",currency:"TJS"},is_tg:tg,feed:[],search_query:"old",feed_wallet:null,feed_period:"all",render(){this.renders=(this.renders||0)+1;}});
 return {app,frappe,calls};
}
function result(values={}) {return {company:"Test",currency:"TJS",total_count:601,start:0,page_length:50,has_more:true,
 summary:{debit:6000,credit:100,net:5900,transfer_amount:500},
 rows:[{gl_name:"GL1",date:"07.11.2026",label:"Платёж",label_tg:"Пардохт",voucher_type:"Payment Entry",voucher_no:"PE1",wallet:"USD Bank",account_currency:"USD",account_amount:100,debit:1100,credit:0}], ...values};}

test("requests explicit company/page and uses whole-filter totals rather than visible rows",async()=>{
 const {app,calls}=harness();await app.load_feed(50);
 assert.match(calls[0].method,/get_money_movements$/);
 assert.equal(calls[0].args.company,"Test");assert.equal(calls[0].args.start,50);assert.equal(calls[0].args.page_length,50);assert.equal(calls[0].silent,true);
 const html=app.render_feed_table("TJS",app.feed_result.summary.debit,100,5900);
 assert.match(html,/601/);assert.match(html,/6\s*000,00/);assert.match(html,/100,00 USD/);assert.match(html,/href="\/app\/Payment-Entry\/PE1"/);
 assert.equal(app.feed_loading,false);
});
test("late success and late failure cannot replace newer filter results",async()=>{
 const {app,frappe}=harness(),pending=deferred();let count=0;
 frappe.call=()=>++count===1?pending.promise:Promise.resolve({message:result({total_count:2})});
 const old=app.load_feed();await app.load_feed(50);pending.resolve({message:result({total_count:999})});await old;
 assert.equal(app.feed_result.total_count,2);
 const pending2=deferred();frappe.call=()=>pending2.promise;const stale=app.load_feed();app.feed_sequence++;pending2.resolve({message:null});await stale;
 assert.equal(app.feed_error,false);assert.equal(app.feed_result.total_count,2);
});
test("loading/error state retains filters and has an inline retry",async()=>{
 const {app,frappe}=harness(),pending=deferred();frappe.call=()=>pending.promise;const req=app.load_feed();
 assert.match(app.render_feed_table("TJS",0,0,0),/role="status"/);
 pending.resolve({message:null});await req;
 assert.equal(app.search_query,"old");assert.equal(app.feed_result,null);
 assert.match(app.render_feed_table("TJS",0,0,0),/mh-feed-retry/);
 frappe.call=async()=>({message:result()});await app.load_feed();assert.equal(app.feed_error,false);
});
test("unrelated-company response is rejected",async()=>{
 const {app,frappe}=harness();frappe.call=async()=>({message:result({company:"Other"})});await app.load_feed();assert.equal(app.feed_error,true);assert.equal(app.feed.length,0);
});
test("all variable history fields are escaped and native links are real anchors",async()=>{
 const {app,frappe}=harness();frappe.call=async()=>({message:result({company:"Test",rows:[{...result().rows[0],date:"<img>",wallet:"<svg>",label:"<script>",party:"<iframe>",notes:"<img onerror=1>",voucher_no:'PE"><img>'}]})});
 await app.load_feed();const html=app.render_feed_table("TJS",6000,100,5900);
 assert.doesNotMatch(html,/<img|<script|<svg|<iframe/);assert.match(html,/&lt;script&gt;/);assert.match(html,/<button[^>]+mh-detail-button/);
});
test("empty and Tajik scopes remain clear and totals are independent of page",async()=>{
 const {app,frappe}=harness(true);frappe.call=async()=>({message:result({rows:[],total_count:0,has_more:false,summary:{debit:0,credit:0,net:0,transfer_amount:0}})});
 await app.load_feed();const html=app.render_feed_table("TJS",0,0,0);
 assert.match(html,/Ҳаракатҳо ёфт нашуданд/);assert.match(html,/Ҳаракати пул фоида нест/);assert.match(html,/Ҷамъбасти ҳамаи натиҷаҳо/);assert.match(html,/mh-feed-next" disabled/);
});
