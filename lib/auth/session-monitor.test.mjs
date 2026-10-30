import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(file) {
  const exports={};const code=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,require:()=>load('./session-policy.ts'),Date,console});return exports;
}
const {createSessionMonitor}=load('./session-monitor.ts');
const {parseSessionState}=load('./session-policy.ts');
const epoch=Date.parse('2026-10-30T00:00:00Z');
function fixture() {
  let now=0,visible=true,deadline=30*60*1000,expired=null,activitySaved=0;
  let reply=null;const calls=[];const views=[];
  const monitor=createSessionMonitor({now:()=>now,visible:()=>visible,onChange:v=>views.push(v),onExpired:r=>expired=r,onActivitySaved:()=>activitySaved++,request:async action=>{
    calls.push(action??'read');if(reply)return reply(action);
    if(now>=deadline||now>=12*3600000||action==='signout')return{active:false,reason:now>=12*3600000?'maximum':'idle',serverNow:new Date(epoch+now).toISOString()};
    if(action==='activity')deadline=now+30*60*1000;
    return{active:true,reason:null,sessionId:'session',serverNow:new Date(epoch+now).toISOString(),idleExpiresAt:new Date(epoch+deadline).toISOString(),absoluteExpiresAt:new Date(epoch+12*3600000).toISOString(),expiresAt:new Date(epoch+Math.min(deadline,12*3600000)).toISOString()};
  }});
  return{monitor,calls,views,setNow:v=>now=v,setVisible:v=>visible=v,setDeadline:v=>deadline=v,setReply:v=>reply=v,get expired(){return expired;},get activitySaved(){return activitySaved;}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('background polls and tab focus checks never report user activity',async()=>{
  const f=fixture();await f.monitor.start();for(let i=1;i<=4;i++){f.setNow(i*15000);f.monitor.tick();await flush();}
  await f.monitor.check();assert.ok(f.calls.every(v=>v==='read'));assert.equal(f.views.at(-1).remaining,29*60);
});
test('real activity is throttled and trailing activity flushes without a background heartbeat',async()=>{
  const f=fixture();await f.monitor.start();f.monitor.activity();await flush();
  f.setNow(1000);f.monitor.activity();f.monitor.activity();await flush();assert.equal(f.calls.filter(v=>v==='activity').length,1);
  f.setNow(15000);f.monitor.tick();await flush();assert.equal(f.calls.filter(v=>v==='activity').length,2);
  f.setNow(30000);f.monitor.tick();await flush();assert.equal(f.calls.filter(v=>v==='activity').length,2);assert.equal(f.activitySaved,2);
});
test('warning needs explicit Stay signed in; movement cannot dismiss it',async()=>{
  const f=fixture();await f.monitor.start();f.setNow(29*60000);f.monitor.tick();await flush();
  f.monitor.activity();await flush();assert.equal(f.calls.includes('activity'),false);
  await f.monitor.stay();assert.equal(f.views.at(-1).remaining,1800);assert.equal(f.calls.at(-1),'activity');
});
test('an expired tab cannot extend its login; server maximum remains authoritative',async()=>{
  const f=fixture();await f.monitor.start();f.setNow(30*60000);await f.monitor.stay();assert.equal(f.expired,'idle');
  const maximum=fixture();await maximum.monitor.start();maximum.setNow(12*3600000);await maximum.monitor.stay();assert.equal(maximum.expired,'maximum');
});
test('a stale tab checks server state before ending a login extended in another tab',async()=>{
  const f=fixture();await f.monitor.start();f.setNow(30*60000);f.setDeadline(45*60000);f.monitor.tick();await flush();
  assert.equal(f.expired,null);assert.equal(f.calls.at(-1),'read');assert.equal(f.views.at(-1).remaining,15*60000/1000);
});
test('sleep/wake and offline failures cannot manufacture an extension; disposal ignores late responses',async()=>{
  const f=fixture();await f.monitor.start();f.setVisible(false);f.setNow(31*60000);f.monitor.tick();await flush();assert.equal(f.expired,null);
  f.setVisible(true);await f.monitor.check();assert.equal(f.expired,'idle');
  const offline=fixture();await offline.monitor.start();offline.setReply(async()=>{throw Error('offline');});offline.setNow(30*60000);await offline.monitor.check();assert.ok(offline.views.at(-1).error);assert.equal(offline.views.at(-1).remaining,0);
  let resolve;const stopped=fixture();stopped.setReply(()=>new Promise(r=>resolve=r));const request=stopped.monitor.start();stopped.monitor.stop();resolve({active:false,reason:'idle',serverNow:new Date(epoch).toISOString()});await request;assert.equal(stopped.expired,null);
});
test('malformed state fails closed; no client timestamp or selected account is sent to the server',async()=>{
  assert.equal(parseSessionState({active:true,reason:null,serverNow:'invalid'}),null);
  assert.equal(parseSessionState({active:true,reason:null,serverNow:new Date(epoch).toISOString()}),null);
  const f=fixture();f.setReply(()=>[]);await f.monitor.start();assert.equal(f.views.at(-1).state,null);assert.ok(f.views.at(-1).error);
  const route=readFileSync(new URL('../../app/api/auth/session/route.ts',import.meta.url),'utf8');
  assert.doesNotMatch(route,/body\.(userId|sessionId|timestamp|lastActivity)/);
});
