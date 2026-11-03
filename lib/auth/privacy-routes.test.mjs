import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

test('privacy and terms can be read before sign-in without exempting actions or protected pages',async()=>{
  const exports={};let authCalls=0;
  const mocks={
    '@supabase/ssr':{createServerClient(){authCalls++;throw Error('Auth boundary reached');}},
    'next/server':{NextResponse:{next(){return {publicNotice:true};}}},
    '@/lib/auth/roles':{},'@/lib/auth/session-state':{},'@/lib/auth/session-policy':{},
  };
  runInNewContext(ts.transpileModule(readFileSync('lib/supabase/proxy.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:name=>mocks[name],process:{env:{}}});
  const request=(pathname,method='GET',action=false)=>({nextUrl:{pathname},method,headers:{has:()=>action}});
  for(const path of ['/privacy','/terms']) for(const method of ['GET','HEAD']) assert.equal((await exports.updateSession(request(path,method))).publicNotice,true);
  assert.equal(authCalls,0);
  for(const input of [request('/privacy','POST',true),request('/terms','POST'),request('/admin/projects'),request('/privacy/other')]) {
    await assert.rejects(exports.updateSession(input),/Auth boundary reached/);
  }
  assert.equal(authCalls,4);
});
