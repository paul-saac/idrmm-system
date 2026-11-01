import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture({confirmed=true,pending=true,status='active',recent=false}={}) {
  const calls=[];
  const manager={role:'admin',status:'active',invitation_pending:false,email:'admin@example.test',first_name:'Admin',last_name:''};
  const target={id:'target',role:'foreman',status,invitation_pending:pending,email:'target@example.test',first_name:'Target',last_name:''};
  const client={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:()=>({
    select:()=>({eq:(_column,id)=>({single:async()=>({data:id==='actor'?manager:target})})}),
    insert:async()=>({error:null}),
  })};
  const admin={auth:{admin:{getUserById:async()=>({data:{user:{email:target.email,email_confirmed_at:confirmed?'2026-01-01':null,confirmation_sent_at:recent?new Date().toISOString():null}}}),inviteUserByEmail:async(...args)=>{calls.push(['invite',...args]);return{error:null};}},
    signInWithOtp:async args=>{calls.push(['setup',args]);return{error:null};},resetPasswordForEmail:()=>assert.fail('Invitation must not send a reset email')},};
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL('./actions.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mocks={'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/auth/roles':{MANAGED_ROLES:{admin:['foreman']}}};
  runInNewContext(source,{exports,require:name=>mocks[name]??{},Date,console,process:{env:{NEXT_PUBLIC_SITE_URL:'https://idrmm.online'}}});
  return {calls,resend:()=>exports.resendInvitation('target')};
}

test('confirmed pending accounts receive existing-user setup links, never password resets',async()=>{
  const f=fixture();assert.ok((await f.resend()).success);
  assert.equal(f.calls[0][0],'setup');
  assert.equal(f.calls[0][1].options.shouldCreateUser,false);
  assert.equal(f.calls[0][1].options.emailRedirectTo,'https://idrmm.online/accept-invite');
});
test('unconfirmed pending accounts receive another admin invitation',async()=>{
  const f=fixture({confirmed:false});assert.ok((await f.resend()).success);assert.equal(f.calls[0][0],'invite');
});
test('completed, inactive and recently emailed accounts cannot be resent',async()=>{
  for(const options of [{pending:false},{status:'inactive'},{recent:true}]) {
    const f=fixture(options);assert.ok((await f.resend()).error);assert.equal(f.calls.length,0);
  }
});
test('pending account display does not use the authentication link-exchange timestamp',()=>{
  assert.match(readFileSync(new URL('./data.ts',import.meta.url),'utf8'),/lastSignInAt: row\.invitation_pending \? null : signIns\.get\(row\.id\)/);
  const template=readFileSync(new URL('../../supabase/templates/invitation-resend.html',import.meta.url),'utf8');
  assert.match(template,/type=magiclink&amp;next=\/accept-invite/);
  assert.match(template,/Accept invitation/);
});
