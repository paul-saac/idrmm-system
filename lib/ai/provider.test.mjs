import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const require=createRequire(import.meta.url);
function load(relative,{env={},fetch=async()=>{throw Error('Unexpected network call');},authorized=true}={}) {
  const cache=new Map();
  function module(file) {
    file=path.resolve(file);
    if(cache.has(file))return cache.get(file);
    const exports={};cache.set(file,exports);
    const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    const resolve=name=>{
      if(name==='server-only')return {};
      if(name==='@/lib/auth/project-access')return {requireAdminOrForeman:async()=>authorized?{id:'fixture'}:null};
      if(name.startsWith('@/'))return module(name.slice(2)+'.ts');
      if(name.startsWith('.'))return module(path.resolve(path.dirname(file),name)+'.ts');
      return require(name);
    };
    runInNewContext(code,{exports,require:resolve,process:{env},fetch,URL,Error,AbortSignal,DOMException,File,FormData,Buffer,setTimeout,console:{error(){},warn(){}}});
    return exports;
  }
  return module(relative);
}
const api=load('lib/ai/provider.ts');
const env={AI_PROVIDER:'azure-foundry',AZURE_AI_ENDPOINT:'https://fixture.services.ai.azure.com',AZURE_AI_API_KEY:'private-fixture-key',AZURE_AI_MODEL:'fixture-phi-deployment'};
const config=extra=>api.getAIProvider({...env,...extra});
const plain=value=>JSON.parse(JSON.stringify(value));
const completion=(value,finish='stop')=>new Response(JSON.stringify({choices:[{finish_reason:finish,message:{content:JSON.stringify(value)}}]}));
const draft={categories:[{name:'Concrete works',amount:'',tasks:[{name:'Footings',quantity:'5',unit:'cu.m',materials:[{name:'Cement',quantity:'20',unit:'bags',unitCost:'250'}]}]}]};
function csv(){const data=new FormData();data.set('file',new File(['Task,Quantity\nFootings,5'],'estimate.csv',{type:'text/csv'}));return data;}

test('existing Groq configuration remains the default; Azure does not silently use Groq',()=>{
  const groq=api.getAIProvider({GROQ_API_KEY:'groq-key'});
  assert.equal(groq.id,'groq');assert.equal(groq.textModel,'openai/gpt-oss-20b');
  assert.throws(()=>api.getAIProvider({AI_PROVIDER:'azure-foundry',GROQ_API_KEY:'groq-key'}),/Azure AI is not configured/);
  assert.throws(()=>api.getAIProvider({AI_PROVIDER:'unexpected'}),/AI_PROVIDER/);
});

test('Azure inference endpoints use api-key, deployed model, native token field and bounded output',()=>{
  const c=config();const request=api.aiChatRequest(c,{model:c.textModel,max_completion_tokens:8192,reasoning_effort:'low',messages:[]});
  assert.equal(request.url,'https://fixture.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
  assert.equal(request.options.headers['api-key'],'private-fixture-key');
  assert.equal(request.options.headers.Authorization,undefined);
  const body=JSON.parse(request.options.body);
  assert.equal(body.model,'fixture-phi-deployment');assert.equal(body.max_tokens,4096);
  assert.equal(body.max_completion_tokens,undefined);assert.equal(body.reasoning_effort,undefined);
  assert.equal(request.options.redirect,'error');
  assert.ok(!request.url.includes('private-fixture-key')&&!request.options.body.includes('private-fixture-key'));
});

test('Azure v1 and direct serverless endpoints resolve without duplicate path segments',()=>{
  for(const endpoint of ['https://fixture.openai.azure.com','https://fixture.services.ai.azure.com/openai/v1/','https://fixture.services.ai.azure.com/openai/v1/chat/completions']) {
    const c=config({AZURE_AI_ENDPOINT:endpoint});
    assert.ok(c.endpoint.endsWith('/openai/v1/chat/completions'));assert.equal(c.apiStyle,'openai');
    const body=JSON.parse(api.aiChatRequest(c,{max_completion_tokens:2000}).options.body);
    assert.equal(body.max_completion_tokens,2000);assert.equal(body.max_tokens,undefined);
  }
  assert.match(config({AZURE_AI_ENDPOINT:'https://fixture.eastus.models.ai.azure.com'}).endpoint,/\.models\.ai\.azure\.com\/chat\/completions\?/);
});

test('invalid URLs, injected query parameters, unsupported modes and limits fail before requests',()=>{
  for(const endpoint of ['http://fixture.services.ai.azure.com','https://evil.test','https://fixture.services.ai.azure.com.evil.test','https://private:credential@fixture.services.ai.azure.com','https://fixture.services.ai.azure.com/?api-key=secret','https://fixture.services.ai.azure.com/api/projects/project','https://fixture.services.ai.azure.com:1234']) {
    assert.throws(()=>config({AZURE_AI_ENDPOINT:endpoint}));
  }
  for(const value of ['0','9000','invalid'])assert.throws(()=>config({AZURE_AI_MAX_OUTPUT_TOKENS:value}));
  assert.throws(()=>config({AZURE_AI_RESPONSE_FORMAT:'unknown'}));
  assert.throws(()=>config({AZURE_AI_API_STYLE:'unknown'}));
});

test('JSON fallbacks are bounded and image import requires an explicit vision deployment',()=>{
  assert.equal(config().responseMode,'json_object');
  assert.equal(api.nextAIResponseMode('json_object'),'text');assert.equal(api.nextAIResponseMode('text'),null);
  assert.equal(api.aiResponseFormat('text','fixture',{}),undefined);
  assert.equal(api.aiResponseFormat('strict','fixture',{}).json_schema.strict,true);
  assert.equal(api.isAIJsonFormatError({error:{param:'response_format'}}),true);
  assert.throws(()=>api.aiModel(config(),true),/image-capable Azure deployment/);
  assert.equal(api.aiModel(config({AZURE_AI_VISION_MODEL:'fixture-vision'}),true),'fixture-vision');
});

test('Azure CSV extraction returns the same review draft, with no project writes',async()=>{
  const requests=[];
  const {extractBomFromFile}=load('lib/bom-import/actions.ts',{env,fetch:async(url,options)=>{
    requests.push({url,body:JSON.parse(options.body),headers:options.headers});return completion(draft);
  }});
  const result=await extractBomFromFile(csv());
  assert.deepEqual(plain(result.categories),draft.categories);assert.equal(requests.length,1);
  assert.equal(requests[0].body.response_format.type,'json_object');assert.equal(requests[0].body.max_tokens,4096);
  assert.equal(requests[0].headers['api-key'],'private-fixture-key');
});

test('Groq document import retains its strict JSON mode and review-draft output',async()=>{
  let calls=0;
  const importer=load('lib/bom-import/actions.ts',{env:{GROQ_API_KEY:'fixture-groq-key'},fetch:async(url,options)=>{
    calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(options.headers.Authorization,'Bearer fixture-groq-key');
    assert.equal(JSON.parse(options.body).response_format.type,'json_schema');
    return completion(draft);
  }});
  assert.deepEqual(plain((await importer.extractBomFromFile(csv())).categories),draft.categories);
  assert.equal(calls,1);
});

test('Azure insights use the deployed model and preserve fact validation through JSON fallback',async()=>{
  const requests=[];
  const context={facts:[{id:'cost-overrun',title:'Recorded cost exceeds plan',evidence:'Saved expense is higher than Planned cost.',destination:{tab:'expenses'}}]};
  const payload={summary:'Review the recorded cost.',insights:[{factId:'cost-overrun',recommendation:'Review the saved equipment charges.'}]};
  const provider=load('lib/project-insights/provider.ts',{env,fetch:async(url,options)=>{
    requests.push(JSON.parse(options.body));
    assert.equal(url,config().endpoint);assert.equal(options.headers['api-key'],'private-fixture-key');
    return requests.length===1?new Response(JSON.stringify({error:{param:'response_format'}}),{status:400}):completion(payload);
  }});
  const result=await provider.requestInsightAnalysis(context,config());
  assert.equal(result.findings[0].id,'cost-overrun');
  assert.deepEqual(plain(result.findings[0].destination),{tab:'expenses'});
  assert.equal(requests.length,2);assert.equal(requests[0].response_format.type,'json_object');
  assert.equal(requests[1].response_format,undefined);assert.equal(requests[0].reasoning_effort,undefined);
  assert.equal(requests[0].model,'fixture-phi-deployment');
});

test('Azure JSON-mode rejection retries as plain JSON and validates the resulting draft',async()=>{
  const bodies=[];
  const {extractBomFromFile}=load('lib/bom-import/actions.ts',{env,fetch:async(url,options)=>{
    bodies.push(JSON.parse(options.body));
    return bodies.length===1?new Response(JSON.stringify({error:{param:'response_format',message:'response_format unsupported'}}),{status:400}):completion(draft);
  }});
  assert.deepEqual(plain((await extractBomFromFile(csv())).categories),draft.categories);
  assert.equal(bodies.length,2);assert.equal(bodies[1].response_format,undefined);
});

test('unauthorized imports and missing vision capability never send files to a provider',async()=>{
  const unauthorized=load('lib/bom-import/actions.ts',{env,authorized:false});
  assert.match((await unauthorized.extractBomFromFile(csv())).error,/not authorized/);
  const importer=load('lib/bom-import/actions.ts',{env});
  const form=new FormData();form.set('file',new File(['fixture'],'photo.png',{type:'image/png'}));
  assert.match((await importer.extractBomFromFile(form)).error,/image-capable/);
});

test('provider errors do not disclose diagnostic text or trust truncated JSON',async()=>{
  for(const [status,pattern] of [[401,/administrator/],[403,/administrator/],[404,/deployment was not found/],[429,/usage limit/],[400,/couldn't process/]]) {
    const importer=load('lib/bom-import/actions.ts',{env,fetch:async()=>new Response(JSON.stringify({error:{message:'private-fixture-key confidential uploaded text'}}),{status})});
    const result=await importer.extractBomFromFile(csv());assert.match(result.error,pattern);
    assert.ok(!result.error.includes('private-fixture-key')&&!result.error.includes('confidential'));
  }
  const truncated=load('lib/bom-import/actions.ts',{env,fetch:async()=>completion(draft,'length')});
  assert.match((await truncated.extractBomFromFile(csv())).error,/response limit/);
});
