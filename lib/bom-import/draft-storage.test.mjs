import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../../components/projects/cost-estimate/import-bom-modal-content.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('draft.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=['nextId','draftResources','toDraftCategories','isResourceDraft','isDraftCategories'];
const functions=ast.statements.filter(node=>ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node=>node.getText(ast)).join('\n');
const exports={};
runInNewContext(ts.transpileModule(`${functions}\nexport {toDraftCategories,isDraftCategories};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Math});

test('extracted resources survive conversion and JSON round trips through Recently imported',()=>{
  const resources={amount:'',laborEstimate:'900',equipment:[{name:'Mixer',amount:'200'}],otherCosts:[{name:'Permit',amount:'100'}]};
  const draft=exports.toDraftCategories([{name:'Concrete',...resources,tasks:[{name:'Footings',quantity:'',unit:'',materials:[],...resources}]}]);
  const restored=JSON.parse(JSON.stringify(draft));
  assert.equal(exports.isDraftCategories(restored),true);
  for(const owner of [restored[0],restored[0].tasks[0]]) {
    assert.equal(owner.laborEstimate,'900');assert.equal(owner.equipment[0].name,'Mixer');assert.ok(owner.equipment[0].id);
    assert.equal(owner.otherCosts[0].amount,'100');assert.ok(owner.otherCosts[0].id);
  }
});

test('old material-only drafts remain restorable and malformed resource fields are rejected',()=>{
  const legacy=[{id:'category',name:'Earthworks',amount:'',tasks:[{id:'task',name:'Excavation',quantity:'',unit:'',materials:[]}]}];
  assert.equal(exports.isDraftCategories(legacy),true);
  legacy[0].tasks[0].equipment=[{id:'line',name:'Truck',amount:100}];
  assert.equal(exports.isDraftCategories(legacy),false);
});

test('recent drafts preserve alphabetic, Roman and decimal item numbers plus printed material totals',()=>{
  const data=[{name:'Work',itemNo:'IV.',amount:'',tasks:[{name:'Excavation',itemNo:'IV-2',quantity:'',unit:'',
    materials:[{name:'Gravel',itemNo:'A.01',quantity:'',unit:'',unitCost:'',amount:'9600'}],
    equipment:[{name:'Truck',itemNo:'02',amount:'100'}],otherCosts:[{name:'Permit',itemNo:'(ii)',amount:'300'}],
  }]}];
  const restored=JSON.parse(JSON.stringify(exports.toDraftCategories(data)));
  assert.equal(exports.isDraftCategories(restored),true);
  assert.equal(restored[0].itemNo,'IV.');assert.equal(restored[0].tasks[0].itemNo,'IV-2');
  assert.equal(restored[0].tasks[0].materials[0].itemNo,'A.01');
  assert.equal(restored[0].tasks[0].materials[0].amount,'9600');
  assert.equal(restored[0].tasks[0].equipment[0].itemNo,'02');
  assert.equal(restored[0].tasks[0].otherCosts[0].itemNo,'(ii)');
});
