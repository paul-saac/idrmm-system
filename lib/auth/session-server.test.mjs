import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(file,mocks={},env={}) {
  const full=path.resolve(file);const exports={};
  const code=ts.transpileModule(readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const resolve=name=>{
    if(name in mocks)return mocks[name];
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',mocks,env);
    if(name.startsWith('.'))return load(path.resolve(path.dirname(full),name)+'.ts',mocks,env);
    return require(name);
  };
  runInNewContext(code,{exports,require:resolve,console,Date,URL,Response,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public',...env}}});return exports;
}
const alive={active:true,reason:null,serverNow:'2026-10-30T00:00:00Z',sessionId:'session',expiresAt:'2026-10-30T00:30:00Z',idleExpiresAt:'2026-10-30T00:30:00Z',absoluteExpiresAt:'2026-10-30T12:00:00Z'};
function routeFixture(env={}) {
  const calls=[];let state=alive;let user={id:'user'},error=null;
  const client={auth:{getUser:async()=>({data:{user},error}),signOut:async options=>calls.push(['signout',options])}};
  const route=load('app/api/auth/session/route.ts',{
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/auth/session-state':{readSessionState:async(_client,activity=false,end=false)=>{calls.push(['state',activity,end]);return state;}},
  },env);
  return{route,calls,setState:s=>state=s,setUser:(u,e=null)=>{user=u;error=e;}};
}
const request=(action,origin='https://app.test')=>({headers:new Headers({'origin':origin,'content-type':'application/json'}),nextUrl:new URL('https://app.test/api/auth/session'),json:async()=>({action})});
const azureHostname='idrmm-system.example.azurewebsites.net';
const azureEnv={NODE_ENV:'production',WEBSITE_HOSTNAME:azureHostname,NEXT_PUBLIC_SITE_URL:'https://idrmm.online'};
function azureRequest(action,origin='https://idrmm.online') {
  const req=request(action,origin);
  req.nextUrl=new URL('http://localhost:8080/api/auth/session');
  req.headers.set('host','idrmm.online');
  req.headers.set('x-forwarded-proto','https');
  return req;
}

test('session GET is read-only activity; POST only counts explicit same-origin activity',async()=>{
  const f=routeFixture();const read=await f.route.GET();assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(f.calls,[['state',false,false]]);
  await f.route.POST(request('activity'));assert.deepEqual(f.calls.at(-1),['state',true,false]);
  assert.equal((await f.route.POST(request('activity','https://untrusted.test'))).status,403);
  assert.equal((await f.route.POST(request('heartbeat'))).status,400);
  assert.equal(f.calls.length,2);
});
test('Azure HTTPS activity and sign-out work for the configured custom and default domain behind an internal HTTP URL',async()=>{
  const f=routeFixture(azureEnv);
  assert.equal((await f.route.POST(azureRequest('activity'))).status,200);
  assert.deepEqual(f.calls.at(-1),['state',true,false]);
  const defaultHost=azureRequest('activity',`https://${azureHostname}`);
  defaultHost.headers.set('host',azureHostname);
  assert.equal((await f.route.POST(defaultHost)).status,200);
  assert.deepEqual(f.calls.at(-1),['state',true,false]);
  f.setState({...alive,active:false,reason:'signed_out'});
  assert.equal((await f.route.POST(azureRequest('signout'))).status,401);
  assert.deepEqual(f.calls.at(-2),['state',false,true]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),['signout',{scope:'local'}]);
});
test('Azure session requests reject foreign, missing, opaque, internal and wrong-port origins before accessing session state',async()=>{
  const f=routeFixture(azureEnv);
  for(const origin of['https://untrusted.test','null','http://localhost:8080','http://idrmm.online','https://idrmm.online:444','https://idrmm.online.untrusted.test','https://idrmm.online@untrusted.test']) {
    assert.equal((await f.route.POST(azureRequest('activity',origin))).status,403,origin);
  }
  const missing=azureRequest('activity');missing.headers.delete('origin');
  assert.equal((await f.route.POST(missing)).status,403);
  const spoofed=azureRequest('activity','https://untrusted.test');
  spoofed.headers.set('x-forwarded-host','untrusted.test');
  assert.equal((await f.route.POST(spoofed)).status,403);
  assert.equal(f.calls.length,0);
});
test('production uses configured HTTPS origins even if proxy headers are absent or rewritten, and ignores spoofed headers',async()=>{
  const f=routeFixture(azureEnv);
  const missing=azureRequest('activity');missing.headers.delete('host');missing.headers.delete('x-forwarded-proto');
  assert.equal((await f.route.POST(missing)).status,200);
  const rewritten=azureRequest('activity');rewritten.headers.set('host','localhost:8080');rewritten.headers.set('x-forwarded-proto','http');
  assert.equal((await f.route.POST(rewritten)).status,200);
  const spoofed=azureRequest('activity','https://untrusted.test');
  spoofed.headers.set('host','untrusted.test');spoofed.headers.set('x-forwarded-host','untrusted.test');
  assert.equal((await f.route.POST(spoofed)).status,403);
  assert.equal(f.calls.length,2);
  const withoutAzure=routeFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://idrmm.online'});
  assert.equal((await withoutAzure.route.POST(azureRequest('activity'))).status,200);
});
test('production without valid HTTPS site configuration fails closed; local HTTP retains exact origin and port checks',async()=>{
  for(const site of[undefined,'invalid','http://idrmm.online']) {
    const f=routeFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:site});
    assert.equal((await f.route.POST(azureRequest('activity'))).status,403);
    assert.equal((await f.route.POST(request('activity'))).status,403);
    assert.equal(f.calls.length,0);
  }
  const local=routeFixture();const req=request('activity','http://localhost:3000');
  req.nextUrl=new URL('http://localhost:3000/api/auth/session');
  assert.equal((await local.route.POST(req)).status,200);
  req.headers.set('origin','http://localhost:3001');
  assert.equal((await local.route.POST(req)).status,403);
  assert.equal((await local.route.POST(azureRequest('activity'))).status,403);
});
test('accepted Azure origins still require authentication, JSON and a supported action',async()=>{
  const f=routeFixture(azureEnv);
  const text=azureRequest('activity');text.headers.set('content-type','text/plain');
  assert.equal((await f.route.POST(text)).status,403);
  const invalid=azureRequest('activity');invalid.json=async()=>{throw new SyntaxError('Invalid JSON');};
  assert.equal((await f.route.POST(invalid)).status,400);
  assert.equal((await f.route.POST(azureRequest('heartbeat'))).status,400);
  f.setUser(null);
  assert.equal((await f.route.POST(azureRequest('activity'))).status,401);
  assert.equal(f.calls.length,0);
});
test('expired sessions end only the current login and return 401, while outages fail closed without signing out other devices',async()=>{
  const f=routeFixture();f.setState({...alive,active:false,reason:'idle'});
  assert.equal((await f.route.GET()).status,401);assert.deepEqual(JSON.parse(JSON.stringify(f.calls.at(-1))),['signout',{scope:'local'}]);
  f.setState(null);const count=f.calls.filter(c=>c[0]==='signout').length;
  assert.equal((await f.route.GET()).status,503);assert.equal(f.calls.filter(c=>c[0]==='signout').length,count);
  f.setUser(null,{status:0});assert.equal((await f.route.GET()).status,503);
  f.setUser(null);assert.equal((await f.route.GET()).status,401);
});
function jar(initial=[]) {
  const values=new Map(initial.map(c=>[c.name,c]));
  return{getAll:()=>[...values.values()],set:(name,value,options={})=>{
    if(typeof name==='object')values.set(name.name,name);else values.set(name,{name,value,...options});
  },delete:name=>values.delete(name)};
}
function proxyFixture() {
  let state=alive;let cookieMethods;let role='project_manager';const calls=[];
  const next=()=>({kind:'next',cookies:jar(),headers:new Headers()});
  const NextResponse={next,json:(data,opts)=>({...next(),kind:'json',data,status:opts?.status}),redirect:url=>({...next(),kind:'redirect',url:url.toString()})};
  const client={auth:{getUser:async()=>({data:{user:{id:'user'}}}),signOut:async()=>{calls.push('signout');cookieMethods.setAll([{name:'sb-auth-token',value:'',options:{maxAge:0}}]);}},
    from:()=>({select:()=>({eq:()=>({single:async()=>({data:{role,status:'active',invitation_pending:false}})})})})};
  const proxy=load('lib/supabase/proxy.ts',{
    '@supabase/ssr':{createServerClient:(_url,_key,options)=>{cookieMethods=options.cookies;return client;}},'next/server':{NextResponse},
    '@/lib/auth/session-state':{readSessionState:async()=>{calls.push('state');return state;}},
  }).updateSession;
  const req=(pathname,action=false)=>({nextUrl:{pathname,clone:()=>new URL('https://app.test'+pathname)},headers:new Headers(action?{'next-action':'action-id'}:{}),cookies:jar([{name:'sb-auth-token',value:'old'}])});
  return{proxy,req,calls,setState:s=>state=s,setRole:r=>role=r};
}
test('proxy redirects expired pages, rejects protected APIs, and strips expired action cookies without breaking action responses',async()=>{
  const f=proxyFixture();f.setState({...alive,active:false,reason:'maximum'});
  const page=await f.proxy(f.req('/project-manager/projects'));assert.equal(page.kind,'redirect');assert.match(page.url,/session_maximum/);assert.ok(page.cookies.getAll().some(c=>c.name==='sb-auth-token'&&c.maxAge===0));
  assert.equal((await f.proxy(f.req('/api/backups'))).status,401);
  const action=f.req('/project-manager/projects',true);assert.equal((await f.proxy(action)).kind,'next');assert.equal(action.cookies.getAll()[0].value,'');
});
test('proxy keeps role restrictions and login/reset/session routes; configuration failures never grant access',async()=>{
  const f=proxyFixture();f.setState(null);
  assert.equal((await f.proxy(f.req('/admin'))).status,503);
  const checks=f.calls.length;
  for(const req of[f.req('/',true),f.req('/forgot-password',true),f.req('/auth/confirm'),f.req('/api/auth/session')])assert.equal((await f.proxy(req)).kind,'next');
  assert.equal(f.calls.length,checks);
  f.setState(alive);const wrongRole=await f.proxy(f.req('/admin/projects'));assert.equal(wrongRole.kind,'redirect');assert.match(wrongRole.url,/project-manager/);
});
test('password login and invitation/reset exchange register a fresh session before querying protected profiles',async()=>{
  const calls=[];let sessionActive=true;
  const client={auth:{signInWithPassword:async()=>{calls.push('password');return{data:{user:{id:'user'}},error:null};},signOut:async()=>calls.push('signout'),verifyOtp:async()=>{calls.push('otp');return{error:null};}},from:()=>({select:()=>({eq:()=>({single:async()=>{calls.push('profile');return{data:{role:'project_manager',status:'active',invitation_pending:false}};}})})})};
  const mocks={'@/lib/supabase/server':{createClient:async()=>client},'next/navigation':{redirect:url=>{throw Error('redirect:'+url);}},'./save-setup-password':{},'./session-state':{readSessionState:async()=>{calls.push('session');return{active:sessionActive};}}};
  const {login}=load('lib/auth/actions.ts',mocks);const form=new FormData();form.set('email','pm@example.test');form.set('password','test-password');
  await assert.rejects(login({},form),/redirect:/);assert.deepEqual(calls.slice(0,3),['password','session','profile']);
  calls.length=0;sessionActive=false;assert.match((await login({},form)).error,/secure session/);assert.deepEqual(calls,['password','session','signout']);
  calls.length=0;sessionActive=true;
  const confirm=load('app/auth/confirm/route.ts',{'@/lib/supabase/server':mocks['@/lib/supabase/server'],'@/lib/auth/session-state':mocks['./session-state'],'next/server':{NextResponse:{redirect:url=>({url:url.toString()})}}});
  for(const type of['invite','recovery']){const result=await confirm.GET({nextUrl:new URL(`https://app.test/auth/confirm?token_hash=sample&type=${type}&next=/reset-password`),url:'https://app.test/auth/confirm'});assert.match(result.url,new RegExp(type==='invite'?'accept-invite':'reset-password'));}
  assert.deepEqual(calls,['otp','session','otp','session']);
});

function confirmFixture(env={}) {
  let otpError=null,state=alive;const calls=[];
  const client={auth:{verifyOtp:async args=>{calls.push(['otp',args.type]);return{error:otpError};},signOut:async options=>calls.push(['signout',options.scope])}};
  const route=load('app/auth/confirm/route.ts',{
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/auth/session-state':{readSessionState:async()=>{calls.push(['state']);return state;}},
    'next/server':{NextResponse:{redirect:url=>({status:307,url:url.toString()}),json:Response.json}},
  },env);
  const request=(query='')=>{const url='https://localhost:8080/auth/confirm'+query;return{nextUrl:new URL(url),url,headers:new Headers({'host':'localhost:8080','x-forwarded-host':'untrusted.test'})};};
  return{route,request,calls,setError:error=>otpError=error,setState:value=>state=value};
}

test('production invitation and recovery callbacks redirect to the public site after verification and session registration',async()=>{
  const f=confirmFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://idrmm.online'});
  for(const [type,next] of[['invite','/accept-invite'],['recovery','/reset-password'],['recovery','/accept-invite']]) {
    const result=await f.route.GET(f.request(`?token_hash=sample&type=${type}&next=${next}`));
    assert.equal(result.url,'https://idrmm.online'+next);
    assert.deepEqual(f.calls.slice(-2),[['otp',type],['state']]);
  }
});

test('missing, rejected and unregistered invitation tokens stay on the public site without granting access',async()=>{
  const f=confirmFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://idrmm.online/'});
  assert.equal((await f.route.GET(f.request('?type=invite'))).url,'https://idrmm.online/accept-invite?error=invalid_link');
  assert.equal(f.calls.length,0);
  f.setError({message:'Invalid token'});
  assert.equal((await f.route.GET(f.request('?token_hash=sample&type=invite'))).url,'https://idrmm.online/accept-invite?error=invalid_link');
  assert.deepEqual(f.calls,[['otp','invite']]);
  f.setError(null);f.setState(null);
  assert.equal((await f.route.GET(f.request('?token_hash=sample&type=invite'))).url,'https://idrmm.online/accept-invite?error=invalid_link');
  assert.deepEqual(f.calls.slice(-3),[['otp','invite'],['state'],['signout','local']]);
});

test('production email callbacks reject off-site destinations and invalid public URL configuration',async()=>{
  const f=confirmFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:'https://idrmm.online'});
  for(const next of['https://untrusted.test','//untrusted.test','/\\untrusted.test']) {
    const result=await f.route.GET(f.request('?token_hash=sample&type=recovery&next='+encodeURIComponent(next)));
    assert.equal(result.url,'https://idrmm.online/');
  }
  for(const site of[undefined,'invalid','http://localhost:3000']) {
    const broken=confirmFixture({NODE_ENV:'production',NEXT_PUBLIC_SITE_URL:site});
    assert.equal((await broken.route.GET(broken.request('?type=invite'))).status,503);
    assert.equal(broken.calls.length,0);
  }
});
