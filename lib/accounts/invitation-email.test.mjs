import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {domainToASCII} from 'node:url';
import ts from 'typescript';

function load(file, mocks={}) {
  const exports={};
  const source=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  runInNewContext(source,{exports,require:name=>mocks[name]??{},setTimeout,clearTimeout,Date,
    console:{error(){}},process:{env:{NEXT_PUBLIC_SITE_URL:'https://idrmm.online'}}});
  return exports;
}
const fail=code=>{throw Object.assign(new Error(code),{code});};
function emailHelpers({mx=[{exchange:'mail.example.test',priority:0}],mxError,a=[],aaaa=[],aError,aaaaError}={}) {
  const calls=[];
  class Resolver {
    constructor(options){calls.push(['options',options]);}
    async resolveMx(domain){calls.push(['mx',domain]);return mxError?fail(mxError):mx;}
    async resolve4(domain){calls.push(['a',domain]);return aError?fail(aError):a;}
    async resolve6(domain){calls.push(['aaaa',domain]);return aaaaError?fail(aaaaError):aaaa;}
    cancel(){}
  }
  return {...load('./invitation-email.ts',{'node:dns/promises':{Resolver},'node:url':{domainToASCII}}),calls};
}

test('valid mail domains pass without pretending to verify a specific mailbox',async()=>{
  const f=emailHelpers();assert.equal(await f.getInvitationEmailDomainError('not-a-real-mailbox@example.test'),null);
  assert.equal(f.calls.filter(call=>call[0]==='mx').length,1);
  assert.equal(f.calls.find(call=>call[0]==='options')[1].tries,1);
});
test('invalid, nonexistent, and null-MX domains show useful errors',async()=>{
  const invalid=emailHelpers();assert.match(await invalid.getInvitationEmailDomainError('person@bad_domain.test'),/valid email/);
  assert.equal(invalid.calls.length,0);
  for(const options of [{mxError:'ENOTFOUND'},{mx:[{exchange:'',priority:0}]},{mx:[{exchange:'.',priority:0}]},
    {mxError:'ENODATA',aError:'ENODATA',aaaaError:'ENODATA'}]) {
    assert.match(await emailHelpers(options).getInvitationEmailDomainError('person@example.test'),/does not exist or cannot receive/);
  }
});
test('no-MX domains can use IPv4 or IPv6 mail delivery; transient errors are not reported as nonexistent',async()=>{
  for(const options of [{a:['192.0.2.1'],aaaaError:'ENODATA'},{aaaa:['2001:db8::1'],aError:'ENODATA'}]) {
    assert.equal(await emailHelpers({mxError:'ENODATA',...options}).getInvitationEmailDomainError('person@example.test'),null);
  }
  for(const options of [{mxError:'ETIMEOUT'},{mxError:'ESERVFAIL'},{mxError:'ENODATA',aError:'ETIMEOUT',aaaaError:'ENODATA'}]) {
    assert.match(await emailHelpers(options).getInvitationEmailDomainError('person@example.test'),/right now.*try again/i);
  }
});
test('provider errors distinguish duplicate accounts, invalid recipients, configuration restrictions and rate limits',()=>{
  const {invitationSendError}=emailHelpers();
  for(const code of ['email_exists','user_already_exists'])assert.equal(invitationSendError({code,message:''}),'An account already uses this email.');
  assert.equal(invitationSendError({message:'User already registered'}),'An account already uses this email.');
  assert.match(invitationSendError({code:'email_address_invalid',message:''}),/invalid or cannot receive/);
  assert.match(invitationSendError({code:'email_address_not_authorized',message:''}),/not configured/);
  assert.match(invitationSendError({message:'550 5.1.1 No such user'}),/mailbox does not exist/);
  assert.match(invitationSendError({code:'over_email_send_rate_limit',message:''}),/wait a few minutes/);
  assert.match(invitationSendError({message:'SMTP unavailable'}),/Could not send/);
});

function actionFixture({existing=false,domainError=null,sendError=null,role='admin'}={}) {
  const calls=[];
  const manager={role,status:'active',invitation_pending:false,email:'admin@example.test',first_name:'Admin',last_name:'User'};
  const client={auth:{getUser:async()=>({data:{user:{id:'actor'}}})},from:()=>({
    select:()=>({eq:()=>({single:async()=>({data:manager})})}),insert:async()=>({error:null}),
  })};
  const admin={from(table){const q={select(){return q;},ilike(){return q;},eq(){return q;},lt(){return q;},
    maybeSingle:async()=>({data:existing?{id:'existing'}:null,error:null}),
    insert(row){calls.push(['insert',table,row]);return q;},single:async()=>({data:{id:'invitation'},error:null}),
    delete(){calls.push(['cleanup',table]);return q;},then:resolve=>Promise.resolve({error:null}).then(resolve),
  };return q;},auth:{admin:{inviteUserByEmail:async()=>{calls.push(['send']);return{data:{user:null},error:sendError};}}}};
  const helpers=emailHelpers();
  const actions=load('./actions.ts',{
    'next/cache':{revalidatePath(){}},'@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/supabase/admin':{createAdminClient:()=>admin},'@/lib/auth/roles':{MANAGED_ROLES:{admin:['foreman'],foreman:[]}},
    '@/lib/accounts/invitation-email':{...helpers,getInvitationEmailDomainError:async()=>{calls.push(['domain']);return domainError;}},
  });
  return {calls,create:async(email='invite@example.test')=>{
    const form=new FormData();for(const [key,value] of Object.entries({firstName:'Invite',lastName:'User',email,role:'foreman'}))form.set(key,value);
    return actions.createAccount({},form);
  }};
}
test('duplicate emails use the exact short message without DNS checks or invitation writes',async()=>{
  const f=actionFixture({existing:true});assert.equal((await f.create()).error,'An account already uses this email.');
  assert.equal(f.calls.length,0);
});
test('invalid domains and malformed addresses stop before invitation writes',async()=>{
  const f=actionFixture({domainError:'This email domain does not exist or cannot receive email. Check the email address.'});
  assert.match((await f.create()).error,/cannot receive/);assert.deepEqual(f.calls.map(call=>call[0]),['domain']);
  const malformed=actionFixture();assert.match((await malformed.create('not-an-email')).error,/valid email/);assert.equal(malformed.calls.length,0);
});
test('provider rejection is shown and its pending invitation is cleaned up; valid invitations succeed',async()=>{
  const f=actionFixture({sendError:{code:'email_address_invalid',message:'Invalid address'}});
  assert.match((await f.create()).error,/invalid or cannot receive/);
  assert.equal(f.calls.at(-1)[0],'cleanup');assert.equal(f.calls.filter(call=>call[0]==='send').length,1);
  assert.ok((await actionFixture().create()).success);
});
test('unauthorized roles cannot perform DNS checks or send invitations',async()=>{
  const f=actionFixture({role:'foreman'});assert.ok((await f.create()).error);assert.equal(f.calls.length,0);
});
