import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(file,mocks={}) {
  const exports={};const source=readFileSync(new URL(file,import.meta.url),'utf8');
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports,require:name=>mocks[name]??{},console});return exports;
}
const roles=load('../auth/roles.ts');
const jsx={jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'};
function nodes(tree){return !tree||typeof tree!=='object'?[]:Array.isArray(tree)?tree.flatMap(nodes):[tree,...nodes(tree.props?.children)];}

test('only Admin/Super Admin can load, list or save project-access settings, before database access',async()=>{
  for(const role of ['project_manager','foreman',null,'admin','super_admin']){
    let clients=0,rpcs=0;
    const actions=load('./project-access.ts',{
      '@/lib/auth/session':{getSessionProfile:async()=>role?{id:'actor',role}:null},
      '@/lib/auth/roles':roles,'next/cache':{revalidatePath(){}},
      '@/lib/supabase/server':{createClient:async()=>{clients++;return{rpc:async()=>{rpcs++;return{data:{eligible:true,projects:[]}};}};}},
    });
    const result=await actions.loadProjectAccess('target');
    const saved=await actions.saveProjectAccess('target',[{id:1,level:'view',previous:'edit'}]);
    if(role==='admin'||role==='super_admin'){
      assert.ok(result.settings);assert.ok(saved.success);assert.equal(rpcs,2);
    }else{
      assert.match(result.error,/cannot manage/);assert.match(saved.error,/cannot manage/);
      assert.equal((await actions.listProjectAccessAccounts()).length,0);assert.equal(clients,0);assert.equal(rpcs,0);
    }
  }
});

test('PM and Foreman cannot invoke material/equipment approval actions directly',async()=>{
  for(const role of ['project_manager','foreman'])for(const [file,name]of [
    ['../material-requests/actions.ts','approveMaterialRequest'],['../equipment-requests/actions.ts','approveEquipmentRequest'],
  ]){
    const actions=load(file,{
      '@/lib/auth/project-access':{requireProjectAccess:async()=>({id:'actor',role})},
      '@/lib/auth/roles':roles,
      '@/lib/supabase/server':{createClient(){assert.fail('Unauthorized approval reached the database');}},
    });
    assert.match((await actions[name](1,1,{},{})).error,/not authorized to approve/);
  }
});

test('every dashboard shows approvals only in the administrator portal; request counts stay available',async()=>{
  const Dashboard=load('../../components/admin/dashboard/dashboard-view.tsx',{
    'react/jsx-runtime':jsx,
    '@/components/admin/dashboard/pending-approvals-card':{PendingApprovalsCard:'approvals'},
    '@/components/admin/dashboard/stat-card':{StatCard:'stat'},
    '@/components/admin/dashboard/calendar-model':{manilaToday:()=> '2026-10-31'},
    '@/lib/dashboard/data':{getDashboardData:async()=>({stats:{pendingMaterialRequests:2,pendingEquipmentRequests:1},pendingRequests:[],activeProjects:[],recentActivity:[],team:{},equipment:{}})},
  }).DashboardView;
  for(const basePath of ['/admin','/project-manager','/foreman']){
    const tree=nodes(await Dashboard({basePath}));
    assert.equal(tree.some(node=>node.type==='approvals'),basePath==='/admin');
    assert.equal(tree.filter(node=>node.type==='stat').length,4);
  }
});

test('Accounts navigation is administrator-only and old PM account links redirect without reading accounts',()=>{
  const source=readFileSync(new URL('../../components/admin/sidebar.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('sidebar.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression;
  function visit(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='NAV_ITEMS')expression=node.initializer.getText(ast);ts.forEachChild(node,visit);}visit(ast);
  const context={LayoutGrid:1,Folder:1,HardHat:1,UserRound:1,FileText:1,Wrench:1};
  const items=runInNewContext(expression,context);
  assert.deepEqual(Array.from(items.find(row=>row.path==='/accounts').portals),['/admin']);
  let destination;
  const Page=load('../../app/project-manager/accounts/page.tsx',{'next/navigation':{redirect:path=>destination=path}}).default;
  Page();assert.equal(destination,'/project-manager');
  assert.equal(roles.MANAGED_ROLES.project_manager.length,0);assert.equal(roles.MANAGED_ROLES.foreman.length,0);
});
