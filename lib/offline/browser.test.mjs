import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,existsSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';

const chrome=process.env.IDRMM_TEST_CHROME??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('real browser: offline reopen, persistent drafts, queued sync, expired sessions and conflict review',{
 skip:!existsSync(chrome),timeout:120000,
},async()=>{
 const temporary=mkdtempSync(join(tmpdir(),'idrmm-offline-browser-'));
 const owner='00000000-0000-4000-8000-000000000001';
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
 const blank=()=>({quantityCompletedToday:0,costs:{labor:0,material:0,equipment:0,other:0},attendance:[],materialsUsed:[],unplannedMaterials:[],equipmentCostsUsed:[],unplannedEquipmentCosts:[],otherCostsUsed:[],unplannedOtherCosts:[]});
 const snapshot={id:1,name:'Offline Test Project',ownerId:owner,ownerName:'Test Foreman',preparedAt:new Date().toISOString(),workDate:today,
  workers:[{id:5,name:'Test Worker',rate:100,subcontractor:false},{id:6,name:'Test Subcontractor',rate:0,subcontractor:true},
   {id:7,name:'Extra Skilled Worker',title:'Carpenter',rate:95,subcontractor:false},
   {id:8,name:'Extra Subcontractor',title:'Roofer',company:'Roofing Company',rate:0,subcontractor:true}],
  items:[{key:'task-1',id:1,kind:'task',name:'Site Clearing',phase:'Site Works',quantity:100,unit:'sq.m.',startDate:today,endDate:today,workerIds:['5',6],materials:[{name:'Sand',unit:'bags'}],equipment:[{name:'Mixer',amount:100}],other:[{name:'Permit',amount:50}]}],
  materialStocks:[{name:'Sand',unit:'bags',purchased:20,used:0,balance:20,status:'Available',unitCost:100},
   {name:'Portland Cement',unit:'bag',purchased:12,used:2,balance:10,status:'Available',unitCost:210},
   {name:'Empty Stock',unit:'pcs',purchased:2,used:2,balance:0,status:'Out of stock',unitCost:20}],
  states:{'task-1':{version:null,totalQuantity:0,input:blank()}}};
 let session=200,syncStatus=200,syncCount=0,requests=0,dropReceipt=false;
 const receipts=new Map();let incidentCount=0;
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(path==='/api/offline/incidents'){for await(const chunk of req){}incidentCount++;return json(200,{id:99});}
  if(path==='/api/offline/session')return json(session,session===200?{id:owner}:{error:'Sign in again.'});
  if(path==='/api/offline/projects/1')return json(200,snapshot);
  if(path==='/api/offline/sync'){
   let body='';for await(const chunk of req)body+=chunk;
   const row=JSON.parse(body);requests++;
   if(syncStatus!==200)return json(syncStatus,{error:syncStatus===409?'This daily log changed. Review the latest record.':'Temporarily unavailable.'});
   let receipt=receipts.get(row.id);
   if(!receipt){syncCount++;receipt={id:row.id,workDate:row.workDate,state:{version:String(syncCount).padStart(32,'0'),totalQuantity:row.input.quantityCompletedToday,input:row.input}};receipts.set(row.id,receipt);snapshot.states['task-1']=receipt.state;}
   if(dropReceipt){dropReceipt=false;res.destroy();return;}
   return json(200,receipt);
  }
  if(path==='/'||path==='/offline/index.html'||path.startsWith('/offline/')||path==='/offline-sw.js'){
   const file=path==='/'?'public/offline/index.html':'public'+path;
   try{const bytes=readFileSync(file);res.writeHead(200,{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.svg')?'image/svg+xml':'text/html','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}return;
  }
  res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port,origin=`http://127.0.0.1:${port}`;
 const process=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',`--user-data-dir=${temporary}`,'--remote-debugging-port=0','about:blank'],{windowsHide:true,stdio:'ignore'});
 let ws,id=0;const pending=new Map();
 try{
  let debuggerPort;
  for(let n=0;n<150;n++){try{debuggerPort=Number(readFileSync(join(temporary,'DevToolsActivePort'),'utf8').split('\n')[0]);break;}catch{await delay(100);}}
  assert.ok(debuggerPort,'Chrome debugging port did not open');
  const targets=await(await fetch(`http://127.0.0.1:${debuggerPort}/json/list`)).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=event=>{const result=JSON.parse(event.data),p=pending.get(result.id);if(p){pending.delete(result.id);if(result.error)p.reject(new Error(result.error.message));else p.resolve(result.result);}};
  const command=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async(expression)=>{const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,replMode:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;};
  const wait=async(expression)=>{for(let n=0;n<150;n++){try{if(await evaluate(expression))return;}catch{}await delay(100);}throw new Error('Timed out: '+expression);};
  await command('Page.enable');await command('Network.enable');
  await command('Page.navigate',{url:origin+'/offline/index.html'});
  await wait("document.querySelector('.empty')");
  await evaluate("window.store=await import('/offline/storage.js'); await store.prepareOfflineProject(1)");
  await command('Page.reload');await wait("document.querySelector('#report-incident')?.textContent==='Report incident' && document.querySelector('#save')?.disabled");
  assert.equal(await evaluate("document.querySelectorAll('.block h3 .section-add').length"),4);
  assert.equal(await evaluate("document.querySelector('.block:first-child .section-add')"),null);
  assert.equal(await evaluate("document.querySelector('header a[href=\"/\"]')"),null);
  assert.equal(await evaluate("document.querySelector('#connection small').textContent"),'Synchronization available');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.connection-online')).color"),'rgb(110, 231, 183)');
  assert.equal(await evaluate("document.querySelector('[name=quantityCompletedToday]').value"),'');
  assert.equal(await evaluate("document.querySelector('[name=quantityCompletedToday]').placeholder"),'0');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[name=quantityCompletedToday]'),'::placeholder').color"),'rgb(161, 161, 170)');
  assert.equal(await evaluate("document.querySelectorAll('.prefilled-value').length"),4,'both assigned workers have prefilled name and rate fields');
  assert.equal(await evaluate("[...document.querySelectorAll('.resource input[readonly]')].every(input=>getComputedStyle(input).backgroundColor==='rgb(244, 244, 245)')"),true);
  assert.equal(await evaluate("document.querySelector('select[aria-label=\"Add worker or subcontractor\"]')"),null);
  assert.equal(await evaluate("[...document.querySelectorAll('.resource')].every(row=>Math.abs([...row.querySelectorAll('input')].at(-1).getBoundingClientRect().right-row.getBoundingClientRect().right)<1)"),true,'planned rows extend to the right edge without an empty remove column');
  await evaluate("document.querySelector('[aria-label=\"Add material\"]').click()");
  assert.equal(await evaluate("document.querySelector('#material-picker').open"),true);
  assert.equal(await evaluate("document.querySelectorAll('#material-stock-list tbody tr').length"),2,'planned material excluded from unplanned stock picker');
  assert.equal(await evaluate("[...document.querySelectorAll('#material-stock-list button')].find(button=>button.textContent==='Empty Stock').disabled"),true);
  await evaluate("[...document.querySelectorAll('#material-stock-list button')].find(button=>button.textContent==='Portland Cement').click()");
  assert.equal(await evaluate("document.querySelectorAll('.material-row').length"),1);
  assert.equal(await evaluate("document.querySelector('.material-row [name=name]').value"),'Portland Cement');
  assert.equal(await evaluate("document.querySelector('.material-row [name=name]').readOnly"),true);
  assert.equal(await evaluate("document.querySelector('.material-row [name=unitCost]').value"),'210');
  assert.equal(await evaluate("document.querySelector('.material-row').getBoundingClientRect().right-document.querySelector('.material-row [name=unitCost]').getBoundingClientRect().right>=39"),true,'added rows retain their remove-button space');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.remove')).borderTopWidth"),'0px');
  assert.equal(await evaluate("!!document.querySelector('.remove svg path')"),true);
  await evaluate("document.querySelector('.material-row .remove').click()");
  assert.equal(await evaluate("document.querySelectorAll('.material-row').length"),0);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('header')).backgroundColor"),'rgb(59, 57, 57)');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('[type=number]')).appearance"),'textfield');
  assert.equal(await evaluate("document.querySelectorAll('.resource .remove').length"),0,'assigned workers and planned rows cannot be removed');
  assert.equal(await evaluate("[...document.querySelectorAll('h3')].some(h=>h.textContent.includes('Additional amounts'))"),false);
  assert.equal(await evaluate("document.querySelector('[name=labor]')"),null);
  assert.equal(await evaluate("[...document.querySelectorAll('.computed-cost')].every(input=>input.readOnly)"),true);
  assert.equal(await evaluate("document.querySelectorAll('.computed-cost').length"),3);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.computed-cost')).backgroundColor"),'rgb(244, 244, 245)');
  assert.deepEqual(await evaluate("[...document.querySelectorAll('.block')].map(block=>getComputedStyle(block).backgroundColor)"),['rgb(250, 250, 250)','rgba(0, 0, 0, 0)','rgb(250, 250, 250)','rgba(0, 0, 0, 0)','rgb(250, 250, 250)']);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.resource')).borderBottomWidth"),'0px');
  await command('Runtime.evaluate',{expression:"document.querySelector('#task').showPicker()",userGesture:true});
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#task'),'::picker(select)').marginBlockStart"),'4px');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#task'),'::picker(select)').scrollbarWidth"),'none');
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  snapshot.preparedAt=new Date(Date.now()+1000).toISOString();
  snapshot.workers[0].name='Updated Assigned Worker';
  await evaluate("await (await import('/offline/storage.js')).prepareOfflineProject(1)");
  await wait("document.querySelector('.prefilled-value')?.value==='Updated Assigned Worker'");
  assert.equal(await evaluate("document.querySelectorAll('.resource .remove').length"),0,'updating the offline copy keeps assigned rows protected');
  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'mobile page must not overflow horizontally');
  // Scenarios use the real shared storage/service worker and actual form UI;
  // this local fictional API never touches or bypasses production authentication.
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate("document.querySelector('[aria-label=\"Add material\"]').click()");
  await evaluate("{const input=document.querySelector('[aria-label=\"Search stock\"]');input.value='cement';input.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelectorAll('#material-stock-list tbody tr').length"),1,'offline search uses cached stocks');
  await evaluate("document.querySelector('#material-stock-list button').click()");
  await evaluate("document.querySelector('[aria-label=\"Add material\"]').click()");
  assert.equal(await evaluate("[...document.querySelectorAll('#material-stock-list button')].some(button=>button.textContent==='Portland Cement')"),false,'already added stock cannot be duplicated');
  await evaluate("document.querySelector('[aria-label=\"Close material stock\"]').click();document.querySelector('.material-row .remove').click()");
  await evaluate("document.querySelector('[aria-label=\"Add worker or subcontractor\"]').click()");
  assert.equal(await evaluate("document.querySelector('#workforce-picker').open"),true);
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'Search workforce');
  assert.equal(await evaluate("document.querySelectorAll('#workforce-list tbody tr').length"),1,'only additional skilled workers appear');
  assert.match(await evaluate("document.querySelector('#workforce-list').textContent"),/Carpenter/);
  assert.equal(await evaluate('document.documentElement.scrollWidth<=window.innerWidth'),true,'mobile modal must not widen the page');
  const pickerHeight=await evaluate("document.querySelector('#workforce-picker').getBoundingClientRect().height");
  await evaluate("{const input=document.querySelector('[aria-label=\"Search workforce\"]');input.value='missing';input.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelectorAll('#workforce-list tbody tr').length"),0);
  assert.equal(await evaluate("document.querySelector('#workforce-picker').getBoundingClientRect().height"),pickerHeight,'empty search keeps modal height fixed');
  await evaluate("{const input=document.querySelector('[aria-label=\"Search workforce\"]');input.value='carpenter';input.dispatchEvent(new Event('input',{bubbles:true}));}");
  await evaluate("document.querySelector('.workforce-member').click()");
  assert.equal(await evaluate("document.querySelector('#workforce-picker')"),null);
  assert.equal(await evaluate("document.querySelectorAll('[name=hours]').length"),2);
  await evaluate("document.querySelector('[aria-label=\"Add worker or subcontractor\"]').click()");
  assert.equal(await evaluate("document.querySelectorAll('#workforce-list tbody tr').length"),0,'already added member is excluded');
  await evaluate("document.querySelectorAll('.workforce-tabs button')[1].click()");
  await evaluate("{const input=document.querySelector('[aria-label=\"Search workforce\"]');input.value='Roofing Company';input.dispatchEvent(new Event('input',{bubbles:true}));}");
  assert.equal(await evaluate("document.querySelectorAll('#workforce-list tbody tr').length"),1,'search includes subcontractor company');
  await evaluate("document.querySelector('.workforce-member').click()");
  assert.equal(await evaluate("document.querySelectorAll('.resource .remove').length"),2,'added workers remain removable');
  await evaluate("document.querySelector('[aria-label=\"Add worker or subcontractor\"]').click()");
  await command('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
  await command('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
  await wait("!document.querySelector('#workforce-picker')");
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"),'Add worker or subcontractor');
  await evaluate("{while(document.querySelector('.resource .remove'))document.querySelector('.resource .remove').click();}");
  const setQuantity=async(value)=>evaluate(`{const input=document.querySelector('[name=quantityCompletedToday]');input.value='${value}';input.dispatchEvent(new Event('input',{bubbles:true}));}`);
  await setQuantity(20);
  await evaluate("{for(const [selector,value] of [['[name=hours]',8],['[name=amount]',1200],['[name=quantity]',2]]){const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}}");
  assert.match(await evaluate("document.querySelector('[name=\"summary-labor\"]').value"),/2,000/,'hourly labor and subcontractor amount update the total immediately');
  await evaluate("{for(const [name,value] of [['Mixer',350],['Permit',75]]){const row=[...document.querySelectorAll('.cost-row')].find(row=>row.querySelector('[name=name]').value===name);const input=row.querySelector('[name=amount]');input.value=value;input.dispatchEvent(new Event('input',{bubbles:true}));}}");
  assert.match(await evaluate("document.querySelector('[name=\"summary-equipment\"]').value"),/350/);
  assert.match(await evaluate("document.querySelector('[name=\"summary-other\"]').value"),/75/);
  await wait("document.querySelector('#draft-status').textContent==='Draft saved on this device'");
  await command('Page.reload');await wait("document.querySelector('[name=quantityCompletedToday]')?.value==='20'");
  assert.equal(await evaluate("document.querySelectorAll('[name=hours]').length"),1,'assigned hourly worker survives restoring a draft');
  assert.equal(await evaluate("document.querySelectorAll('.resource .remove').length"),0);
  assert.match(await evaluate("document.querySelector('[name=\"summary-labor\"]').value"),/2,000/,'computed totals survive offline draft reload');
  assert.equal(await evaluate("document.querySelector('#connection').textContent.includes('Offline')"),true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.connection-offline')).color"),'rgb(252, 165, 165)');
  await evaluate("document.querySelector('#save').click()");
  await wait("document.querySelector('#outbox')?.textContent.includes('Pending sync')");
  assert.equal(syncCount,0,'offline data is not official before synchronization');
  await command('Page.reload');await wait("document.querySelector('#outbox')?.textContent.includes('Pending sync')");
  assert.equal(await evaluate("document.querySelector('[name=quantityCompletedToday]').value"),'20');
  assert.equal(await evaluate("document.querySelector('#save').disabled"),true,'cannot queue the same task/day twice');
  const image=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  if(globalThis.process.env.IDRMM_OFFLINE_SCREENSHOT)writeFileSync(globalThis.process.env.IDRMM_OFFLINE_SCREENSHOT,Buffer.from(image.data,'base64'));
  session=401;
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("await (await import('/offline/storage.js')).synchronizeOfflineLogs(true)");
  await wait("document.querySelector('#outbox').textContent.includes('Sign in to sync')");assert.equal(syncCount,0);
  // Lost response after a commit must retry the same immutable identifier.
  session=200;dropReceipt=true;
  await evaluate("await (await import('/offline/storage.js')).synchronizeOfflineLogs(true)");assert.equal(syncCount,1);
  await evaluate("await (await import('/offline/storage.js')).synchronizeOfflineLogs(true)");
  await wait("document.querySelector('#outbox').textContent.includes('Synced')");assert.equal(syncCount,1);assert.ok(requests>=2);
  const saved=[...receipts.values()][0].state.input;assert.equal(saved.attendance[0].hours,8);assert.equal(saved.attendance[1].amount,1200);assert.equal(saved.attendance[1].hours,0);assert.equal(saved.materialsUsed[0].quantity,2);
  await command('Page.reload');await wait("document.querySelector('[name=quantityCompletedToday]')?.value==='20'");
  assert.equal(await evaluate("document.querySelector('#save').disabled"),true,'unchanged synchronized values cannot create another edit');
  syncStatus=409;await setQuantity(25);await evaluate("document.querySelector('#save').click()");
  await wait("document.querySelector('#outbox').textContent.includes('Needs review')");assert.equal(syncCount,1);
  await evaluate("[...document.querySelectorAll('#outbox button')].find(b=>b.textContent==='Review').click()");
  await wait("document.querySelector('.review') && document.querySelector('[name=quantityCompletedToday]').value==='25' && !document.querySelector('#save').disabled");
  syncStatus=200;await evaluate("document.querySelector('#save').click()");await wait("[...document.querySelectorAll('#outbox .status')].every(e=>e.textContent==='Synced')");assert.equal(syncCount,2);
  // Offline incident reports survive reload and synchronize separately from accomplishments.
  await command('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate("document.querySelector('#report-incident').click()");
  await wait("document.querySelector('.offline-incident[open]')");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.offline-incident .incident-choice')).flexDirection"),'row');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.offline-incident .incident-choice input')).padding"),'0px');
  assert.equal(await evaluate("!!document.querySelector('.offline-incident [aria-label=Close] svg')"),true);

  await evaluate(`const f=document.querySelector('.offline-incident form');f.querySelector('[name=occurredTime]').value='10:30';f.querySelector('[name=incidentKind][value=near_miss]').checked=true;f.querySelector('[name=description]').value='Offline near miss report';for(const n of ['injured','firstAid','hospitalTransport'])f.querySelector('[name='+n+'][value=no]').checked=true;f.requestSubmit();`);
  await wait("document.querySelector('#offline-incidents')?.textContent.includes('Pending sync')");
  assert.equal(incidentCount,0);
  await command('Page.reload');await wait("document.querySelector('#offline-incidents')?.textContent.includes('Offline near miss report')");
  await command('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await evaluate("await (await import('/offline/storage.js')).synchronizeOfflineLogs(true)");
  await wait("document.querySelector('#offline-incidents')?.textContent.includes('Synced')");assert.equal(incidentCount,1);
  await evaluate("await (await import('/offline/storage.js')).synchronizeOfflineLogs(true)");assert.equal(incidentCount,1);
  // Signing out locks local access without deleting saved entries.
  await evaluate("await (await import('/offline/storage.js')).lockOfflineWorkspace()");await wait("document.querySelector('#editor').hidden");
  await command('Page.reload');await wait("document.querySelector('.empty')?.textContent.includes('locked')");
  assert.equal(await evaluate("document.querySelector('#editor').hidden"),true);
 }finally{
  try{ws?.send(JSON.stringify({id:++id,method:'Browser.close'}));}catch{}
  await Promise.race([new Promise(r=>process.once('exit',r)),delay(3000)]);
  try{ws?.close();}catch{}if(process.exitCode===null)process.kill();server.closeAllConnections();await new Promise(r=>server.close(r));
  await delay(300);
  if(resolve(temporary).startsWith(resolve(tmpdir())+'\\'))try{rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:300});}catch{console.warn('Temporary Chrome profile cleanup deferred:',temporary);}
 }
});
