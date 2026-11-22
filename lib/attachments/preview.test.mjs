import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const preview=require('./preview.ts');
const nodes=v=>!v||typeof v!=='object'?[]:Array.isArray(v)?v.flatMap(nodes):[v,...nodes(v.props?.children)];
const text=v=>v==null?'':typeof v==='string'||typeof v==='number'?String(v):Array.isArray(v)?v.map(text).join(''):text(v.props?.children);
const jsx=(type,props)=>({type,props});
function module(file,dependencies={},globals={}){
 const exports={};const code=ts.transpileModule(readFileSync(file,'utf8').replaceAll('import.meta.url','"https://idrmm.online/viewer.js"'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 runInNewContext(code,{exports,console,URL,Date,...globals,require(name){if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name in dependencies)return dependencies[name];if(name==='@/lib/attachments/preview')return preview;if(name==='next/dynamic')return{default:()=>function DocumentViewer(){}};return{};}});return exports;
}
function renderer(){
 let active;const react={createContext:value=>{const context={value};context.Provider=Object.assign(function Provider(){},{context});return context;},useContext:c=>c.value,useCallback:fn=>fn,useState(initial){const i=active.cursor++;if(!(i in active.values))active.values[i]=typeof initial==='function'?initial():initial;return[active.values[i],v=>{active.values[i]=typeof v==='function'?v(active.values[i]):v;}];},useEffect(fn,deps){const i=active.cursor++;const before=active.effects[i];if(!before||deps.some((v,i)=>v!==before.deps[i])){before?.cleanup?.();active.effects[i]={deps,fn};active.pending.push(i);}},useRef(value){return react.useState(()=>({current:value}))[0];}};
 // State setters must retain their own component instance between renders.
 react.useState=initial=>{const state=active,i=state.cursor++;if(!(i in state.values))state.values[i]=typeof initial==='function'?initial():initial;return[state.values[i],v=>{state.values[i]=typeof v==='function'?v(state.values[i]):v;}];};
 return{react,mount(component,props){const state={values:[],effects:[],pending:[],cursor:0};return{render(){active=state;state.cursor=0;const tree=component(props);for(const i of state.pending.splice(0))state.effects[i].cleanup=state.effects[i].fn();return tree;},unmount(){state.effects.forEach(e=>e?.cleanup?.());}};}};
}
test('recognizes supported attachments, opaque API URLs and unsupported formats without rendering HTML',()=>{
 for(const args of [['application/pdf','Document','/opaque'],['','Drawing.pdf','/opaque'],['','Drawing','/file.pdf?token=private']])assert.equal(preview.attachmentKind(...args),'pdf');
 for(const type of ['image/jpeg','image/png','image/webp','image/gif'])assert.equal(preview.attachmentKind(type),'image');
 assert.equal(preview.attachmentKind('text/html','fake.pdf'),'unsupported');assert.equal(preview.attachmentKind('','Workbook.xlsx'),'unsupported');
 for(const url of ['javascript:alert(1)','data:text/html,evil','file:///secret','https://user:password@example.test/file'])assert.equal(preview.safeAttachmentUrl(url,'https://idrmm.online'),null);
 assert.equal(preview.safeAttachmentUrl('/api/progress-photos?projectId=12','https://idrmm.online'),'https://idrmm.online/api/progress-photos?projectId=12');
 assert.equal(preview.attachmentDownloadName('Purchase attachment','https://storage.test/file.jpg?token=x','image/jpeg'),'Purchase attachment.jpg');
 assert.equal(preview.attachmentDownloadName('Report.pdf','/opaque','application/pdf'),'Report.pdf');
});
test('attachment clicks open a centered viewer, never navigate, and revoke local file URLs on close',()=>{
 const r=renderer();let created=0;const revoked=[];
 const {AttachmentViewerProvider,AttachmentLink}=module('components/ui/attachment-viewer.tsx',{react:r.react},{window:{location:{href:'https://idrmm.online'}},URL:class extends URL{static createObjectURL(){return `blob:local-${++created}`;}static revokeObjectURL(url){revoked.push(url);}}});
 const provider=r.mount(AttachmentViewerProvider,{children:'Existing form draft'});let tree=provider.render();tree.type.context.value=tree.props.value;
 let stopped=false;const link=r.mount(AttachmentLink,{url:'/private/file.pdf',name:'Report.pdf',children:'Attachment'}).render();
 assert.equal(link.type,'button');assert.equal(link.props.href,undefined);assert.equal(link.props.target,undefined);link.props.onClick({stopPropagation(){stopped=true;}});assert.ok(stopped);
 tree=provider.render();let modal=nodes(tree).find(n=>n.props?.title==='Report.pdf');assert.equal(modal.props.open,true);assert.equal(modal.props.variant,'centered');assert.ok(text(tree).includes('Existing form draft'));
 modal.props.onClose();tree=provider.render();tree.type.context.value=tree.props.value;
 const local=r.mount(AttachmentLink,{url:'',name:'Camera.jpg',file:{type:'image/jpeg'},children:'Image'}).render();local.props.onClick({stopPropagation(){}});
 tree=provider.render();modal=nodes(tree).find(n=>n.props?.title==='Camera.jpg');assert.ok(modal.props.open);assert.equal(created,1);modal.props.onClose();provider.render();assert.deepEqual(revoked,['blob:local-1']);
});
test('unsupported files show a fallback and only download on an explicit click; errors are recoverable',async()=>{
 const r=renderer();let calls=0,fail=true;
 const loaded=module('components/ui/attachment-viewer.tsx',{react:r.react,'@/lib/attachments/preview':{...preview,downloadAttachment:async()=>{calls++;if(fail)throw new Error('Denied');}}},{window:{location:{href:'https://idrmm.online'}}});
 const provider=r.mount(loaded.AttachmentViewerProvider,{children:'Form'});let tree=provider.render();tree.props.value({url:'/stock.xlsx',name:'Stock.xlsx'});tree=provider.render();
 const content=nodes(tree).find(n=>n.type?.name==='AttachmentContent');const mounted=r.mount(content.type,content.props);let view=mounted.render();assert.match(text(view),/preview is not available/);assert.equal(calls,0);
 await nodes(view).find(n=>n.type==='button'&&text(n)==='Download').props.onClick();view=mounted.render();assert.equal(calls,1);assert.match(text(view),/Could not download/);
 fail=false;await nodes(view).find(n=>n.type==='button'&&text(n)==='Download').props.onClick();view=mounted.render();assert.equal(calls,2);assert.ok(!text(view).includes('Could not download'));
});
test('image controls adjust zoom and rotation without navigating away',()=>{
 const r=renderer();const component=module('components/projects/sheets/document-preview.tsx',{react:r.react},{ResizeObserver:class{observe(){}disconnect(){}}}).DocumentViewer;
 const mounted=r.mount(component,{url:'/photo.jpg',pdf:false,title:'Photo',showDownload:false});let tree=mounted.render();const button=name=>nodes(tree).find(n=>n.props?.['aria-label']===name);
 assert.equal(button('Previous page'),undefined);assert.equal(nodes(tree).find(n=>n.type==='a'),undefined);assert.ok(!text(tree).includes('Download original'));
 nodes(tree).find(n=>n.type==='img').props.onLoad({currentTarget:{naturalWidth:640,naturalHeight:480}});button('Zoom in').props.onClick();tree=mounted.render();assert.match(text(tree),/125%/);
 button('Rotate clockwise').props.onClick();tree=mounted.render();assert.match(nodes(tree).find(n=>n.type==='img').props.style.transform,/rotate\(90deg\)/);
 button('Fit to screen').props.onClick();tree=mounted.render();assert.match(text(tree),/Fit/);
});
test('explicit downloads fetch with current credentials and save a blob instead of opening a tab',async()=>{
 let clicked=0,removed=0,fetched;const link={click(){clicked++;},remove(){removed++;}};let cleanup;
 const {downloadAttachment}=module('lib/attachments/preview.ts',{}, {window:{location:{href:'https://idrmm.online'},setTimeout(fn){cleanup=fn;}},document:{createElement:()=>link,body:{appendChild(){}}},fetch:async(url,options)=>{fetched={url,options};return{ok:true,blob:async()=>({type:'application/pdf'})};},URL:class extends URL{static createObjectURL(){return'blob:download';}static revokeObjectURL(){removed++;}}});
 assert.equal(clicked,0);await downloadAttachment('/api/private-file','Report');assert.equal(fetched.options.credentials,'same-origin');assert.equal(link.href,'blob:download');assert.equal(link.download,'Report.pdf');assert.equal(link.target,undefined);assert.equal(clicked,1);assert.equal(removed,1);cleanup();assert.equal(removed,2);
});

test('PDF preview loads pages in-app, bounds page navigation, rotates and destroys its worker on close',async()=>{
 const r=renderer();let destroyed=0;const rendered=[];
 const document={numPages:2,getPage:async page=>({rotate:0,getViewport:({scale,rotation=0})=>({width:(rotation%180?600:400)*scale,height:(rotation%180?400:600)*scale}),render:options=>{rendered.push({page,...options});return{promise:Promise.resolve(),cancel(){}};}})};
 const component=module('components/projects/sheets/document-preview.tsx',{react:r.react,'pdfjs-dist':{GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(document),destroy(){destroyed++;}})}},{ResizeObserver:class{observe(){}disconnect(){}},window:{devicePixelRatio:1,document:{createElement:()=>({})}}}).DocumentViewer;
 const mounted=r.mount(component,{url:'/secure.pdf',pdf:true,title:'Report',showDownload:false});let tree=mounted.render();
 const canvas=nodes(tree).find(n=>n.type==='canvas');canvas.props.ref.current={style:{},getContext:()=>({drawImage(){}})};
 const tick=()=>new Promise(resolve=>setImmediate(resolve));await tick();tree=mounted.render();await tick();tree=mounted.render();
 assert.match(text(tree),/Page 1 \/ 2/);assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Previous page').props.disabled,true);
 nodes(tree).find(n=>n.props?.['aria-label']==='Next page').props.onClick();tree=mounted.render();await tick();tree=mounted.render();
 assert.match(text(tree),/Page 2 \/ 2/);assert.equal(nodes(tree).find(n=>n.props?.['aria-label']==='Next page').props.disabled,true);
 nodes(tree).find(n=>n.props?.['aria-label']==='Rotate clockwise').props.onClick();tree=mounted.render();await tick();
 assert.ok(rendered.length>=3);assert.ok(!nodes(tree).some(n=>n.type==='iframe'||n.type==='a'));mounted.unmount();assert.equal(destroyed,1);
});
