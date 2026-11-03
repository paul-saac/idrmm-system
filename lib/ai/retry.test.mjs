import test from 'node:test';import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import ts from'typescript';
const model={};runInNewContext(ts.transpileModule(readFileSync(new URL('./retry.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:model});
const delay=(status,headers={},attempt=1,remaining=180000,code='')=>model.aiRetryDelay(new Response('',{status,headers}),attempt,remaining,code,Date.parse('2026-11-03T00:00:00Z'),0);
test('honors Azure millisecond hints, Retry-After seconds and HTTP dates',()=>{
 assert.equal(delay(429,{'retry-after-ms':'4200'}),4200);
 assert.equal(delay(503,{'retry-after':'12'}),12000);
 assert.equal(delay(503,{'retry-after':'Tue, 03 Nov 2026 00:00:09 GMT'}),9000);
});
test('backs off for transient failures and never retries permanent errors or an excessive cooldown',()=>{
 assert.equal(delay(502,{},1),1000);assert.equal(delay(504,{},2),2000);
 for(const status of [400,401,403,404,200])assert.equal(delay(status),null);
 assert.equal(delay(429,{},1,180000,'insufficient_quota'),null);
 assert.equal(delay(429,{'retry-after':'3600'}),null);
 assert.equal(delay(503,{},1,5500),null);
 assert.equal(delay(503,{'retry-after-ms':'invalid'}),1000);
});
