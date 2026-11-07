const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path");
function box(){return {html(value){this.content=value;return this;},text(value){this.content=value;return this;},find(selector){const self=this;return {on(event,fn){self.handlers??={};self.handlers[selector]=fn;}};}};}
function harness(){
 const shared=new Map(),calls=[],dialogs=[],alerts=[];
 const localStorage={getItem:key=>shared.get(key)||null,setItem:(key,value)=>shared.set(key,value),removeItem:key=>shared.delete(key)};
 let context={company:"Test",currency:"TJS",configured:true,can_record:true,can_configure:true,loans_enabled:true,loan_balance:100,
 wallets:[{name:"Cash",currency:"TJS"},{name:"USD",currency:"USD"}]};
 class Dialog{
  constructor(options){this.options=options;this.fields_dict={};for(const df of options.fields)this.fields_dict[df.fieldname]={df:{...df},$wrapper:box(),value:df.default};this.button={prop:(name,value)=>{this.disabled=value;}};dialogs.push(this);}
  get_primary_btn(){return this.button;} show(){} hide(){this.onhide?.();} get_value(name){return this.fields_dict[name].value;}
  set_df_property(name,property,value){this.fields_dict[name].df[property]=value;}
  async set_value(name,value){this.fields_dict[name].value=value;this.fields_dict[name].df.onchange?.();}
 }
 const frappe={pages:{"money-hub":{}},session:{user:"owner"},ui:{Dialog},utils:{escape_html:v=>String(v).replaceAll("<","&lt;").replaceAll('"',"&quot;"),get_form_link:()=>"/app/journal-entry/JE-1"},msgprint:value=>alerts.push(value),
 call:async request=>{calls.push(request);return {message:request.method.endsWith("get_owner_money_context")?context:{name:"JE-1",company:"Test",docstatus:1,doctype:"Journal Entry"}};}};
 const scope=vm.createContext({frappe,localStorage,crypto:{randomUUID:()=>"owner-request-1"},__:v=>v});
 vm.runInContext(fs.readFileSync(path.join(__dirname,"money_hub.js"),"utf8")+"\nglobalThis.App=MoneyHubApp",scope);
 const app=Object.create(scope.App.prototype);Object.assign(app,{is_tg:false,data:{company:"Test",currency:"TJS"},load(){app.loads=(app.loads||0)+1;}});
 return {app,frappe,calls,dialogs,shared,alerts,set_context:value=>{context=value;},context};
}
test("owner dialog defaults to normal funds and keeps loans optional",async()=>{
 const h=harness();await h.app.open_owner_money();const dlg=h.dialogs[0];
 assert.equal(dlg.get_value("operation"),"contribution");assert.equal(dlg.fields_dict.operation.df.options.length,2);
 await dlg.set_value("show_loans",1);assert.equal(dlg.fields_dict.operation.df.options.length,4);
 assert.equal(dlg.disabled,false);assert.match(dlg.fields_dict.status.$wrapper.content,/100,00 TJS/);
 await dlg.set_value("wallet","USD");assert.equal(dlg.fields_dict.exchange_rate.df.hidden,false);assert.equal(dlg.fields_dict.exchange_rate.df.reqd,true);assert.match(dlg.fields_dict.amount.df.label,/USD/);
});
test("manager context is read-only and cannot invoke a posting call",async()=>{
 const h=harness();h.set_context({...h.context,can_record:false,can_configure:false});await h.app.open_owner_money();
 const dlg=h.dialogs[0];assert.equal(dlg.disabled,true);await dlg.options.primary_action({operation:"contribution",amount:50});
 assert.equal(h.calls.length,1);assert.match(dlg.fields_dict.status.$wrapper.content,/уполномоченному бухгалтеру/);
});
test("missing schema and missing setup cannot create money when opening the dialog",async()=>{
 const h=harness();h.set_context({...h.context,configured:false,upgrade_required:true});await h.app.open_owner_money();
 assert.equal(h.dialogs[0].disabled,true);assert.match(h.dialogs[0].fields_dict.status.$wrapper.content,/обновление системы/);assert.equal(h.calls.length,1);
 const second=harness();second.set_context({...second.context,configured:false});await second.app.open_owner_money();
 assert.equal(second.dialogs[0].disabled,true);assert.match(second.dialogs[0].fields_dict.status.$wrapper.content,/data-owner-setup/);assert.equal(second.calls.length,1);
});
test("unknown response persists original owner request independently from transfers",async()=>{
 const h=harness();const args={company:"Test",operation:"contribution",wallet:"Cash",amount:50};
 h.frappe.call=async()=>{throw new Error("Lost response");};
 await assert.rejects(h.app.run_transfer(args,null,"owner"));
 assert.equal(h.app.pending_transfer("owner").id,"owner-request-1");assert.equal(h.app.pending_transfer(),null);
 h.frappe.call=async request=>{h.calls.push(request);return {message:{name:"JE-1",company:"Test",docstatus:1}};};
 await h.app.run_transfer(args,"owner-request-1","owner");
 assert.match(h.calls[0].method,/record_owner_money_movement$/);assert.equal(h.calls[0].args.client_request_id,"owner-request-1");assert.equal(h.shared.size,0);
});
test("reopened loan request retains the operation, original fields and journal result",async()=>{
 const h=harness();h.shared.set(h.app.transfer_key("owner"),JSON.stringify({id:"original-owner-id",args:{company:"Test",operation:"loan_received",wallet:"Cash",amount:50,note:"<img>",exchange_rate:null}}));
 await h.app.open_owner_money();const dlg=h.dialogs[0];assert.equal(dlg.get_value("show_loans"),1);assert.equal(dlg.fields_dict.operation.df.read_only,1);
 await dlg.options.primary_action({});const request=h.calls.find(call=>call.method.endsWith("record_owner_money_movement"));
 assert.equal(request.args.client_request_id,"original-owner-id");assert.equal(request.args.operation,"loan_received");assert.match(h.alerts[0],/journal-entry/);assert.equal(h.app.loads,1);
});
test("cancelled owner request is never described as a new successful posting",async()=>{
 const h=harness();await h.app.open_owner_money();h.frappe.call=async()=>({message:{name:"JE-1",company:"Test",docstatus:2}});
 await h.dialogs[0].options.primary_action({operation:"contribution",wallet:"Cash",amount:50});assert.match(h.alerts[0],/отменена/);
});
test("late context response cannot update a closed or changed-company dialog",async()=>{
 for(const changed of [false,true]){
  const h=harness();let resolve;h.frappe.call=()=>new Promise(done=>{resolve=done;});
  const loading=h.app.open_owner_money();const dlg=h.dialogs[0];if(changed)h.app.data.company="Other";else dlg.hide();
  resolve({message:h.context});await loading;assert.equal(dlg.fields_dict.status.$wrapper.content,"Загрузка…");
 }
});
test("context errors offer retry and never expose stale loan amounts",async()=>{
 const h=harness();h.frappe.call=async()=>{throw new Error("Denied");};await h.app.open_owner_money();
 const dlg=h.dialogs[0];assert.equal(dlg.disabled,true);assert.match(dlg.fields_dict.status.$wrapper.content,/data-owner-retry/);assert.doesNotMatch(dlg.fields_dict.status.$wrapper.content,/100,00/);
 h.frappe.call=async()=>({message:h.context});await dlg.fields_dict.status.$wrapper.handlers["[data-owner-retry]"]();assert.equal(dlg.disabled,false);
});
test("an existing pending request can still recover when current setup cannot load",async()=>{
 const h=harness();h.shared.set(h.app.transfer_key("owner"),JSON.stringify({id:"original-owner-id",args:{company:"Test",operation:"contribution",wallet:"Cash",amount:50}}));
 h.frappe.call=async()=>{throw new Error("Settings unavailable");};await h.app.open_owner_money();assert.equal(h.dialogs[0].disabled,false);
});
test("pending foreign owner amount retains its currency after its wallet is hidden or renamed",async()=>{
 const h=harness();h.shared.set(h.app.transfer_key("owner"),JSON.stringify({id:"original-id",args:{company:"Test",operation:"contribution",wallet:"Old USD wallet",amount:10,exchange_rate:11},display:{currency:"USD"}}));
 await h.app.open_owner_money();const dlg=h.dialogs[0];assert.match(dlg.fields_dict.amount.df.label,/USD/);assert.equal(dlg.fields_dict.exchange_rate.df.hidden,false);assert.equal(dlg.get_value("exchange_rate"),11);
});
