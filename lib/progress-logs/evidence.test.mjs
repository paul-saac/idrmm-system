import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync('lib/progress-logs/evidence.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Set,Number,encodeURIComponent});
const {validateLogEvidence:validate}=exports;
const photo={path:'1/user/photo',name:'Photo.jpg',type:'image/jpeg',size:100};
test('evidence accepts optional empty fields, trims remarks and retains photo references',()=>{
 assert.equal(validate(undefined,undefined,1).remarks,'');assert.equal(validate(' Note ',[photo],1).remarks,'Note');
 assert.equal(validate(' Note ',[photo],1).photos[0].path,photo.path);
});
test('evidence rejects cross-project paths, duplicates, oversize files and invalid descriptions',()=>{
 for(const photos of [[{...photo,path:'2/user/photo'}],[photo,photo],[{...photo,type:'text/html'}],[{...photo,size:6*1024*1024}],[{...photo,path:'1/../other'}],Array(7).fill(photo)]) assert.ok(validate('',photos,1).error);
 assert.ok(validate('x'.repeat(2001),[],1).error);assert.ok(validate({},[],1).error);
});
