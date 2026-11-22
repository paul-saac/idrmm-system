import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
function load(file,mocks,globals={}) {const exports={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:name=>mocks[name],Request,Response,URL,Uint8Array,Error,crypto,Number,...globals});return exports;}
test('private log photos require project view permission and reject a different project path',async()=>{
 let allow=false,reads=0;
 const {GET}=load('app/api/progress-photos/route.ts',{
  '@/lib/auth/project-access':{requireProjectAccess:async()=>allow?{}:null},
  '@/lib/supabase/server':{createClient:async()=>({storage:{from:()=>({download:async()=>{reads++;return{data:new Blob(['photo'],{type:'image/png'})};}})}})},
 });
 let response=await GET(new Request('https://example.test/api/progress-photos?projectId=1&path=2/user/photo'));assert.equal(response.status,404);assert.equal(reads,0);
 response=await GET(new Request('https://example.test/api/progress-photos?projectId=1&path=1/user/photo'));assert.equal(response.status,403);assert.equal(reads,0);
 allow=true;response=await GET(new Request('https://example.test/api/progress-photos?projectId=1&path=1/user/photo'));assert.equal(response.status,200);assert.equal(reads,1);
 assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
});

test('upload checks image signatures and cleans earlier unattached uploads if a later file fails',async()=>{
 const uploads=[],removed=[];
 const bucket={upload:async(path)=>{uploads.push(path);return{error:null};},remove:async(paths)=>{removed.push(...paths);return{error:null};}};
 const {uploadProgressPhotos}=load('lib/progress-logs/photo-upload.ts',{
  '@/lib/supabase/client':{createClient:()=>({auth:{getUser:async()=>({data:{user:{id:'user'}}})},storage:{from:()=>bucket}})},
  './evidence':{LOG_PHOTO_TYPES:['image/jpeg','image/png','image/webp'],MAX_LOG_PHOTO_BYTES:5242880},
 });
 const file=(name,bytes)=>({name,type:'image/png',size:100,slice:()=>({arrayBuffer:async()=>new Uint8Array(bytes).buffer})});
 await assert.rejects(uploadProgressPhotos(1,[file('First.png',[137,80,78,71,13,10,26,10]),file('Fake.png',[0,0,0])]),/not a valid/);
 assert.equal(uploads.length,1);assert.deepEqual(removed,uploads);
});
