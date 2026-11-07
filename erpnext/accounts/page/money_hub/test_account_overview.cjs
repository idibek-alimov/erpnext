// Native page orchestration/render fixtures; no financial actions are invoked.
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function data(){return {company:"Test",currency:"TJS",as_of:"2026-11-07",totals:{total:1100,cash:0,non_cash:1100,net_today:100},
 accounts:[{account:"USD Bank",wallet_names:["Original","Alias"],primary_wallet:"Original",enabled:true,balance:1100,opening_balance:1000,today_in:100,today_out:0,account_balance:100,account_currency:"USD"}],wallets:[{name:"Original"}]};}
function harness(tg=false){
 const calls=[];
 const esc=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
 const frappe={pages:{"money-hub":{}},utils:{escape_html:esc,get_form_link:(type,name)=>"/app/"+type.toLowerCase().replaceAll(" ","-")+"/"+encodeURIComponent(name)},call:async request=>{calls.push(request);return {message:data()};}};
 const context=vm.createContext({frappe,__:value=>value,clearTimeout});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"money_hub.js"),"utf8")+"\nglobalThis.App=MoneyHubApp;",context);
 const app=Object.create(context.App.prototype);
 Object.assign(app,{data:data(),include_hidden:false,is_tg:tg,feed:[],wrapper:{text(){},html(value){app.error_html=value;},find(){return {on(){}};}},render(){app.renders=(app.renders||0)+1;},load_feed(){app.feed_requests=(app.feed_requests||0)+1;}});
 return {app,frappe,calls};
}
test("overview rows show opening/activity/closing once per account and native links",()=>{
 const {app}=harness();const html=app.render_accounts("TJS",app.data.totals);
 assert.equal((html.match(/<tr>/g)||[]).length,2);
 assert.match(html,/Original \/ Alias/);assert.match(html,/1\s*100,00/);assert.match(html,/100,00 USD/);
 assert.match(html,/href="\/app\/account\/USD%20Bank"/);assert.match(html,/data-wallet="Original"/);assert.match(html,/не является прибылью/);
});
test("restricted amounts stay missing and variable account/alias fields are escaped",()=>{
 const {app}=harness();Object.assign(app.data.accounts[0],{account:'<img onerror=1>',wallet_names:['<script>'],primary_wallet:'x"><svg>',balance:null,account_balance:null});
 const html=app.render_accounts("TJS",{total:null,cash:null,non_cash:null,net_today:null});
 assert.doesNotMatch(html,/<img|<script|<svg/);assert.match(html,/&lt;script&gt;/);assert.match(html,/Ограничено правами/);assert.match(html,/— USD/);
});
test("empty and Tajik state explains inactive accounts and source scope",()=>{
 const {app}=harness(true);app.data.accounts=[];
 const html=app.render_accounts("TJS",{total:0,cash:0,non_cash:0,net_today:0});
 assert.match(html,/Суратҳисобҳои дастрас нестанд/);assert.match(html,/Тағйири пул фоида нест/);assert.match(html,/намудҳои манбаъҳои дастгиришаванда/);
});
test("overview request retains the chosen hidden scope and clears an unavailable account filter",async()=>{
 const {app,calls}=harness();app.include_hidden=true;app.feed_wallet="Disabled";
 await app.load();assert.equal(calls[0].args.include_hidden,1);assert.equal(calls[0].silent,true);assert.equal(app.feed_wallet,null);assert.equal(app.feed_requests,1);
});
test("late overview responses cannot replace newer inactive scope",async()=>{
 const {app,frappe}=harness(),pending=deferred();let count=0;
 frappe.call=()=>++count===1?pending.promise:Promise.resolve({message:{...data(),company:"New"}});
 const old=app.load();app.include_hidden=true;await app.load();pending.resolve({message:data()});await old;
 assert.equal(app.data.company,"New");assert.equal(app.feed_requests,1);
});
test("overview failures expose retry and cannot retain old balances",async()=>{
 const {app,frappe}=harness();frappe.call=async()=>{throw new Error("Read denied");};await app.load();
 assert.equal(app.data,null);assert.match(app.error_html,/role="alert"/);assert.match(app.error_html,/mh-retry/);
});
test("write-result refresh re-reads current scope rather than accepting a default-scope payload",()=>{
 const {app}=harness();let loads=0;app.load=()=>{loads++;};app.apply({message:{company:"Wrong scope"}});assert.equal(loads,1);assert.equal(app.data.company,"Test");
});
test("background movement responses update only the badge while Accounts is focused",async()=>{
 const {app,frappe}=harness();app.active_tab="accounts";const badges=[];
 app.wrapper.find=()=>({text:value=>badges.push(value)});
 frappe.call=async()=>({message:{company:"Test",rows:[],start:0,total_count:12,summary:{}}});
 await Object.getPrototypeOf(app).load_feed.call(app);
 assert.equal(app.renders,undefined);assert.deepEqual(badges,["…",12]);
});
