import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(file,mocks) {
  const full=path.resolve(file),exports={};
  const code=ts.transpileModule(readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const resolve=name=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',mocks);
    if(name.startsWith('.'))return load(path.resolve(path.dirname(full),name)+'.ts',mocks);
    return require(name);
  };
  runInNewContext(code,{exports,require:resolve,TextEncoder,console,process:{env:{}},Date,URL});
  return exports;
}
const strong='Cedar!Harbor2026';
function form(password=strong,confirmation=password,current='old-pass') {
  const data=new FormData();data.set('password',password);data.set('confirmPassword',confirmation);data.set('currentPassword',current);return data;
}
function fixture() {
  const calls=[];
  const state={user:{id:'member',email:'member@example.test',email_confirmed_at:'2026-10-30T00:00:00Z'},profile:{id:'member',role:'foreman',status:'active',invitation_pending:true},signInError:null,updateError:null,sessionActive:true};
  const client={auth:{
    getUser:async()=>({data:{user:state.user}}),
    signInWithPassword:async args=>{calls.push(['verify-current',args.password]);return{error:state.signInError};},
    updateUser:async args=>{calls.push(['password',args.password]);return{error:state.updateError};},
    signOut:async()=>calls.push(['signout']),
  },from:()=>({select:()=>({eq:()=>({single:async()=>({data:state.profile})})})})};
  const admin={from:()=>({update:patch=>{calls.push(['activate',patch.invitation_pending]);return{eq:()=>({eq:()=>({select:()=>({single:async()=>({data:{id:'member'}})})})})};}})};
  const mocks={
    'server-only':{},
    '@/lib/supabase/server':{createClient:async()=>{calls.push(['client']);return client;}},
    '@/lib/supabase/admin':{createAdminClient:()=>admin},
    'next/navigation':{redirect:url=>{throw Error('redirect:'+url);}},
    './session-state':{readSessionState:async()=>({active:state.sessionActive})},
  };
  return{calls,state,mocks,auth:load('lib/auth/actions.ts',mocks),invite:load('lib/auth/invitation-actions.ts',mocks),setup:load('lib/auth/save-setup-password.ts',mocks)};
}

test('invitation, reset, settings and the shared write reject weak passwords before any auth mutation',async()=>{
  for(const password of['short','Password123456789!','cedar!harbor2026','Cedar Harbor2026']) {
    for(const action of['invite','reset','change','setup']) {
      const f=fixture();
      const result=action==='invite'?await f.invite.acceptInvitation({},form(password)):
        action==='reset'?await f.auth.updatePassword({},form(password)):
        action==='change'?await f.auth.changePassword({},form(password)):
        await f.setup.saveSetupPassword(password);
      assert.ok(result.error,action);
      assert.equal(f.calls.length,0,action);
    }
  }
});

test('all password forms reject mismatched confirmation before changing credentials',async()=>{
  const f=fixture();
  for(const action of[f.invite.acceptInvitation,f.auth.updatePassword,f.auth.changePassword])
    assert.match((await action({},form(strong,'different'))).error,/match/);
  assert.equal(f.calls.length,0);
});

test('invitation and reset save an accepted password and complete only the authenticated account setup',async()=>{
  for(const kind of['invite','reset']) {
    const f=fixture();
    const action=kind==='invite'?f.invite.acceptInvitation:f.auth.updatePassword;
    await assert.rejects(action({},form()),/redirect:\/foreman/);
    const writes=f.calls.filter(call=>['password','activate'].includes(call[0]));
    assert.deepEqual(writes,[['password',strong],['activate',false]]);
  }
});

test('missing, unverified and inactive users cannot complete setup; a failed write cannot activate an invitation',async()=>{
  for(const variant of['missing','unverified','inactive','write-failed']) {
    const f=fixture();
    if(variant==='missing')f.state.user=null;
    if(variant==='unverified')f.state.user.email_confirmed_at=null;
    if(variant==='inactive')f.state.profile.status='inactive';
    if(variant==='write-failed')f.state.updateError={message:'Write failed'};
    assert.ok((await f.setup.saveSetupPassword(strong)).error);
    assert.equal(f.calls.some(call=>call[0]==='activate'),false);
    assert.equal(f.calls.filter(call=>call[0]==='password').length,variant==='write-failed'?1:0);
  }
});

test('settings still verifies the existing password and session, rejects reuse, and accepts legacy current passwords',async()=>{
  const valid=fixture();valid.state.profile.invitation_pending=false;
  assert.ok((await valid.auth.changePassword({},form())).success);
  assert.deepEqual(valid.calls.filter(call=>call[0]!=='client'),[['verify-current','old-pass'],['password',strong]]);
  const wrong=fixture();wrong.state.signInError={message:'Wrong password'};
  assert.match((await wrong.auth.changePassword({},form())).error,/current password/);
  assert.equal(wrong.calls.some(call=>call[0]==='password'),false);
  const expired=fixture();expired.state.sessionActive=false;
  assert.match((await expired.auth.changePassword({},form())).error,/session/);
  assert.equal(expired.calls.some(call=>call[0]==='password'),false);
  const reused=fixture();
  assert.match((await reused.auth.changePassword({},form(strong,strong,strong))).error,/different/);
  assert.equal(reused.calls.length,0);
});

function managerFixture() {
  const calls=[];
  const manager={id:'manager',role:'admin',status:'active',invitation_pending:false,first_name:'Admin',last_name:'User',email:'admin@example.test'};
  const target={id:'target',role:'foreman',status:'active',invitation_pending:false,first_name:'Site',last_name:'User',email:'site@example.test'};
  const state={manager,target,signedIn:true};
  const client={auth:{getUser:async()=>({data:{user:state.signedIn?{id:'manager'}:null}})},from:table=>{
    if(table==='account_events')return{insert:async()=>({error:null})};
    return{select:()=>({eq:(_column,id)=>({single:async()=>({data:id==='manager'?manager:target})})})};
  }};
  const mocks={
    'next/cache':{revalidatePath:()=>{}},
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/supabase/admin':{createAdminClient:()=>({auth:{admin:{updateUserById:async(id,args)=>{calls.push([id,args.password]);return{error:null};}}}})},
  };
  return{calls,state,actions:load('lib/accounts/actions.ts',mocks)};
}

test('administrator-set temporary passwords obey the same rules and preserve management permissions',async()=>{
  const f=managerFixture();
  for(const password of['short','Password123456789!','Cedar Harbor2026'])
    assert.ok((await f.actions.setTemporaryPassword('target',password)).error);
  assert.equal(f.calls.length,0);
  assert.ok((await f.actions.setTemporaryPassword('target',strong)).success);
  assert.deepEqual(f.calls,[['target',strong]]);
  for(const variant of['signed-out','wrong-role','pending-invitation','self']) {
    const denied=managerFixture();
    if(variant==='signed-out')denied.state.signedIn=false;
    if(variant==='wrong-role')denied.state.manager.role='foreman';
    if(variant==='pending-invitation')denied.state.target.invitation_pending=true;
    assert.ok((await denied.actions.setTemporaryPassword(variant==='self'?'manager':'target',strong)).error,variant);
    assert.equal(denied.calls.length,0,variant);
  }
});
