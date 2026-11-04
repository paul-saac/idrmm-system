import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const jsx=(type,props)=>({type,props});
const nodes=value=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=value=>value==null?'':typeof value!=='object'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
function page(user){
 let clients=0;const exports={};
 const mocks={
  'react/jsx-runtime':{jsx,jsxs:jsx},'next/link':{default:'link'},
  '@/components/auth/reset-password-form':{ResetPasswordForm:'reset-form'},
  '@/components/auth/session-guard':{SessionGuard:'session-guard'},
  '@/lib/supabase/server':{createClient:async()=>{clients++;return{auth:{getUser:async()=>({data:{user}})}};}},
 };
 const code=ts.transpileModule(readFileSync('app/reset-password/page.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},
 }).outputText;
 runInNewContext(code,{exports,require:name=>mocks[name]??{}});
 return{render:params=>exports.default({searchParams:Promise.resolve(params)}),clients:()=>clients};
}

test('a verified session can see the password form after a successful recovery callback',async()=>{
 const f=page({id:'member',email_confirmed_at:'2026-11-05T00:00:00Z'});
 const tree=await f.render({});assert.match(text(tree),/Set a new password/);
 assert.ok(nodes(tree).some(node=>node.type==='reset-form'));
 assert.ok(nodes(tree).some(node=>node.type==='session-guard'));
});

test('expired links show a new-link action instead of a login screen or a password form, even when already signed in',async()=>{
 const f=page({id:'member',email_confirmed_at:'2026-11-05T00:00:00Z'});
 const tree=await f.render({error:'invalid_link'});
 assert.match(text(tree),/Reset link unavailable/);assert.equal(f.clients(),0);
 assert.ok(nodes(tree).some(node=>node.props?.href==='/forgot-password'));
 assert.ok(!nodes(tree).some(node=>['reset-form','session-guard'].includes(node.type)));
});

test('opening the reset page without a verified session cannot display the password form',async()=>{
 for(const user of [null,{id:'unverified'}]) {
  const tree=await page(user).render({});
  assert.ok(!nodes(tree).some(node=>node.type==='reset-form'));
  assert.ok(nodes(tree).some(node=>node.props?.href==='/forgot-password'));
 }
});

test('the recovery email template sends a token hash and recovery type directly to the app callback',()=>{
 const template=readFileSync('supabase/templates/reset-password.html','utf8');
 assert.ok(template.includes('href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=recovery&amp;next=/reset-password"'));
 assert.ok(!template.includes('.ConfirmationURL'));
});
