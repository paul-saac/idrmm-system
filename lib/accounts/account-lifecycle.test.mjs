import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

function load(file,mocks={}) {
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 runInNewContext(code,{exports,require:name=>mocks[name]??{},console:{error(){}},Date});return exports;
}
const roles=load('../auth/roles.ts');
function fixture({managerRole='admin',targetRole='foreman',pending=true,history=false,historyError=false,self=false,authenticated=true}={}) {
 const calls=[];
 const manager={role:managerRole,status:'active',invitation_pending:false,first_name:'Admin',last_name:'User',email:'admin@example.test'};
 const target={id:'target',role:targetRole,status:'active',invitation_pending:pending,first_name:'Invited',last_name:'User',email:'invite@example.test'};
 const client={auth:{getUser:async()=>({data:{user:authenticated?{id:'actor'}:null}})},from(){let id;
  const q={select(){return q;},eq(_key,value){id=value;return q;},or(){return q;},order(){return q;},limit(){return q;},
   single:async()=>({data:id==='actor'?manager:target}),
   insert:async row=>{calls.push(['audit',row]);return{error:null};},
   then:resolve=>Promise.resolve({data:[],error:null}).then(resolve),
  };return q;
 },rpc:async()=>{calls.push(['history']);return{data:history,error:historyError?{message:'Unavailable'}:null};}};
 const actions=load('./actions.ts',{
  '@/lib/auth/roles':roles,'next/cache':{revalidatePath(){}},
  '@/lib/supabase/server':{createClient:async()=>client},
  '@/lib/supabase/admin':{createAdminClient:()=>({auth:{admin:{deleteUser:async id=>{calls.push(['delete',id]);return{error:null};}}}})},
 });
 return{calls,remove:()=>actions.deleteAccount(self?'actor':'target'),detail:()=>actions.getAccountDetail('target')};
}

test('administrators can delete unused invitations only for roles they manage',async()=>{
 for(const targetRole of ['foreman','project_manager']) {
  const f=fixture({targetRole});assert.ok((await f.remove()).success);
  assert.equal(f.calls.filter(row=>row[0]==='delete').length,1);
  assert.equal(f.calls.find(row=>row[0]==='audit')[1].action,'deleted');
 }
 for(const options of [{pending:false},{targetRole:'admin'},{targetRole:'super_admin'},
  {managerRole:'foreman'},{managerRole:'project_manager'},{authenticated:false},{self:true}]){
  const f=fixture(options);assert.ok((await f.remove()).error);assert.ok(!f.calls.some(row=>row[0]==='delete'));
 }
});

test('business history and failed history checks block deletion for both administrators and super administrators',async()=>{
 for(const managerRole of ['admin','super_admin'])for(const options of [{history:true},{historyError:true}]){
  const f=fixture({managerRole,...options});assert.ok((await f.remove()).error);assert.ok(!f.calls.some(row=>row[0]==='delete'));
 }
 const superAdmin=fixture({managerRole:'super_admin',targetRole:'admin',pending:false});assert.ok((await superAdmin.remove()).success);
});

test('an administrator can load the history check for a pending invitation without receiving account audit events',async()=>{
 const f=fixture();const result=await f.detail();assert.equal(result.detail.hasHistory,false);
 assert.equal(result.detail.log.length,0);assert.ok(f.calls.some(row=>row[0]==='history'));
 const blocked=fixture({historyError:true});assert.equal((await blocked.detail()).detail.hasHistory,true);
});

const jsx=(type,props)=>({type,props});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?'':typeof value!=='object'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
async function mount({active=true,pending=true,superAdmin=false,targetRole='foreman'}={}) {
 const state=[],effects=[],calls=[];let cursor=0;
 const account={id:'target',firstName:'Invited',lastName:'User',email:'invite@example.test',role:targetRole,status:active?'active':'inactive',invitationPending:pending,
  createdAt:'2026-11-04',lastSignInAt:null,detailPreview:{projects:[],activity:[]},assignedProjects:[]};
 const react={useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;
  return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];},useId:()=> 'test',useEffect:fn=>effects.push(fn)};
 const Component=load('../../components/accounts/account-detail.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({refresh(){}})},
  '@/lib/initials':{initials:()=> 'IU'},'@/components/ui/list-table':{avatarColor:()=> ''},'@/lib/auth/roles':roles,
  '@/lib/auth/password-policy':{getPasswordError:()=> 'Enter a password'},
  '@/lib/accounts/actions':{getAccountDetail:async()=>({detail:{projects:[],activity:[],log:[],hasHistory:false}}),
   setAccountsStatus:async(...args)=>{calls.push(['activate',...args]);return{success:'Activated'};},
   deleteAccount:async id=>{calls.push(['delete',id]);return{success:'Deleted'};}},
  '@/components/ui/confirm-dialog':{ConfirmDialog:'confirmation'},
 }).AccountDetail;
 const render=()=>{cursor=0;return Component({account,accounts:[account],roleOptions:['project_manager','foreman'],isSuperAdmin:superAdmin,onClose(){}});};
 render();effects[0]();await Promise.resolve();
 return{render,calls};
}

test('Activate is in the profile header immediately before the name block, and still calls the existing status action',async()=>{
 const form=await mount({active:false});const tree=form.render();const all=nodes(tree);
 const buttons=all.filter(n=>n.type==='button'&&text(n)==='Activate');assert.equal(buttons.length,1);
 const header=tree.props.children[0];assert.equal(header.props.children[1],buttons[0]);
 assert.equal(text(header.props.children[2]).startsWith('Invited User'),true);
 await buttons[0].props.onClick();assert.equal(form.calls[0][0],'activate');assert.equal(form.calls[0][2],'active');
});

test('pending invitations show a working confirmation dialog to administrators, while completed accounts remain super-admin-only',async()=>{
 for(const options of [{pending:true},{pending:false},{pending:false,superAdmin:true}]){
  const form=await mount(options);
  const remove=nodes(form.render()).find(n=>n.type==='button'&&text(n)==='Delete permanently');
  if(!options.pending&&!options.superAdmin){assert.equal(remove,undefined);continue;}
  assert.equal(remove.props.disabled,false);remove.props.onClick();
  const confirmation=nodes(form.render()).find(n=>n.type==='confirmation');assert.equal(confirmation.props.open,true);
  await confirmation.props.onConfirm();assert.equal(form.calls[0][0],'delete');
 }
});
