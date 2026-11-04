import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const jsx=(type,props)=>({type,props});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?'':typeof value!=='object'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
function load(file,mocks={}){
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 runInNewContext(code,{exports,require:name=>mocks[name]??{},Map,Set,console});return exports;
}
function hooks(){
 const state=[];let cursor=0;
 return{
  reset(){cursor=0;},
  react:{useEffect(){},useMemo:fn=>fn(),useRef:value=>({current:value}),useState(initial){
   const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;
   return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];
  }},
 };
}
const presets=load('./presets.ts');
const member={id:1,fullName:'Sample Foreman',title:'Foreman',category:'management',employmentType:'employee',
 profileId:'account',contactNumber:null,workHours:[8,8,8,8,8,8,0]};
const skilled={...member,id:2,fullName:'Sample Carpenter',title:'Carpenter',category:'skilled',profileId:null};
const group={id:1,name:'Site crew',memberIds:[1,2]};
const base={members:[member,skilled],assignments:[],accounts:[],memberGroups:[group],hoursWorked:[]};
const mocks={
 'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},
 'next/navigation':{useRouter:()=>({refresh(){},push(){},prefetch(){}}),usePathname:()=>'/foreman/team'},
 '@/components/portal/portal-context':{usePortal:()=>({basePath:'/foreman'})},
 '@/lib/workers/presets':presets,
 '@/components/team/availability':load('../../components/team/availability.tsx'),
 '@/components/ui/list-table':{SelectCell:'select-cell',SelectAllCell:'select-all',InitialsAvatar:'avatar'},
 '@/components/ui/modal':{Modal:'modal',ModalFooter:'footer'},
 '@/components/team/member-groups':{GroupsPanel:'groups'},
 '@/components/team/member-profile':{MemberProfile:'profile'},
 '@/components/team/member-form':{MemberForm:'member-form'},
};

test('Foreman sidebar includes Team while Accounts remains administrator-only',()=>{
 const h=hooks();
 const Sidebar=load('../../components/admin/sidebar.tsx',{...mocks,react:h.react}).PortalSidebar;
 const nav=nodes(Sidebar({basePath:'/foreman'}));
 assert.ok(nav.some(node=>node.props?.href==='/foreman/team'));
 assert.ok(!nav.some(node=>node.props?.href==='/foreman/accounts'));
 assert.ok(!nav.some(node=>node.props?.href==='/admin/accounts'));
});

test('Foreman Team page supplies member data with both management capabilities disabled',async()=>{
 const called=[];
 const readers={listWorkers:base.members,listAssignments:[],listMemberGroups:[group],listHoursWorked:[]};
 const data=Object.fromEntries(Object.entries(readers).map(([name,result])=>[name,async()=>{called.push(name);return result;}]));
 const Page=load('../../app/foreman/team/page.tsx',{...mocks,
  '@/lib/workers/data':data,'@/components/team/team-browser':{TeamBrowser:'team'},
 }).default;
 const tree=nodes(await Page());const team=tree.find(node=>node.type==='team');
 assert.equal(team.props.canManageMembers,false);assert.equal(team.props.canManageGroups,false);
 assert.equal(team.props.members,base.members);assert.equal(team.props.memberGroups[0],group);
 assert.equal(team.props.accounts.length,0);assert.equal(called.length,4);
});

test('Foremen can filter categories, search and open profiles without member or group mutations',()=>{
 const h=hooks();
 const Team=load('../../components/team/team-browser.tsx',{...mocks,react:h.react}).TeamBrowser;
 const render=()=>{h.reset();return Team({...base,canManageMembers:false,canManageGroups:false});};
 let tree=render();
 assert.equal(nodes(tree).find(node=>node.type==='groups').props.canManage,false);
 assert.ok(!nodes(tree).some(node=>['select-all','select-cell','member-form'].includes(node.type)));
 assert.ok(!nodes(tree).some(node=>node.type==='button'&&['Add Member','Delete'].includes(text(node).trim())));
 assert.equal(nodes(tree).filter(node=>node.props?.role==='tab').length,4);
 nodes(tree).find(node=>node.props?.role==='tab'&&text(node).includes('Skilled Workers')).props.onClick();
 tree=render();assert.match(text(tree),/Sample Carpenter/);
 nodes(tree).find(node=>node.props?.['aria-label']==='Search members').props.onChange({target:{value:'missing'}});
 assert.match(text(render()),/No members match/);
 nodes(render()).find(node=>node.props?.['aria-label']==='Search members').props.onChange({target:{value:''}});
 const row=nodes(render()).find(node=>node.type==='tr'&&typeof node.props.onClick==='function');row.props.onClick();
 const profile=nodes(render()).find(node=>node.type==='profile');
 assert.equal(profile.props.member.id,2);assert.equal(profile.props.onEdit,undefined);
 assert.equal(nodes(render()).find(node=>node.type==='modal').props.menuItems,undefined);
});

test('Foremen can open group details with only Close; existing group managers retain editing controls',()=>{
 for(const canManage of [false,true]){
  const h=hooks();
  const Groups=load('../../components/team/member-groups.tsx',{...mocks,react:h.react}).GroupsPanel;
  const render=()=>{h.reset();return Groups({groups:[group],members:base.members,canManage});};
  let tree=render();assert.equal(nodes(tree).some(node=>node.props?.['aria-label']==='Add group'),canManage);
  nodes(tree).find(node=>node.props?.['aria-label']==='View Site crew').props.onClick();
  tree=render();assert.equal(nodes(tree).find(node=>node.type==='modal').props.open,true);
  const buttons=nodes(tree).filter(node=>node.type==='button').map(text);
  assert.equal(buttons.includes('Edit'),canManage);assert.equal(buttons.includes('Delete'),canManage);
  assert.equal(buttons.includes('Close'),!canManage);
 }
});

test('Project Managers retain group selection and Administrators retain member editing',()=>{
 for(const canManageMembers of [false,true]){
  const h=hooks();
  const Team=load('../../components/team/team-browser.tsx',{...mocks,react:h.react}).TeamBrowser;
  const render=()=>{h.reset();return Team({...base,canManageMembers});};
  let tree=render();assert.equal(nodes(tree).find(node=>node.type==='groups').props.canManage,true);
  nodes(tree).find(node=>node.props?.role==='tab'&&text(node).includes('Skilled Workers')).props.onClick();
  tree=render();assert.ok(nodes(tree).some(node=>node.type==='select-cell'));
  assert.equal(nodes(tree).some(node=>node.type==='button'&&text(node).trim()==='Add Member'),canManageMembers);
  nodes(tree).find(node=>node.type==='tr'&&typeof node.props.onClick==='function').props.onClick();
  tree=render();assert.equal(nodes(tree).some(node=>node.type==='member-form'),canManageMembers);
  assert.equal(nodes(tree).some(node=>node.type==='profile'),!canManageMembers);
 }
});
