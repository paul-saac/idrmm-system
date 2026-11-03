import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const exports={};runInNewContext(ts.transpileModule(readFileSync('lib/progress-logs/draft.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const key=exports.progressLogDraftKey;
const original={quantityCompletedToday:20,costs:{labor:100,material:0,equipment:0,other:0},materialsUsed:[{name:'Sand',unit:'cu.m',quantity:2}],unplannedMaterials:[{name:'Gravel',unit:'bag',quantity:1,unitCost:20}],attendance:[{workerId:1,hours:1},{workerId:2,hours:2}],equipmentCostsUsed:[{name:'Mixer',amount:10}],unplannedEquipmentCosts:[{name:'Rental',amount:12}],otherCostsUsed:[{name:'Delivery',amount:15}],unplannedOtherCosts:[{name:'Permit',amount:25}]};
test('quantity, every resource value and labor attendance changes are detected',()=>{
 const changes=[draft=>draft.quantityCompletedToday++,draft=>draft.costs.labor++,draft=>draft.materialsUsed[0].quantity++,draft=>draft.materialsUsed[0].unit='bag',draft=>draft.unplannedMaterials[0].unitCost++,draft=>draft.attendance[0].hours++,draft=>draft.attendance[0].workerId=3,
  ...['equipmentCostsUsed','unplannedEquipmentCosts','otherCostsUsed','unplannedOtherCosts'].map(field=>draft=>draft[field][0].amount++)];
 for(const change of changes){const draft=structuredClone(original);change(draft);assert.notEqual(key(draft),key(original));}
});
test('row order, surrounding whitespace and empty unused rows are not edits; reverting restores equality',()=>{
 const draft=structuredClone(original);draft.attendance.reverse();draft.materialsUsed[0].name=' Sand ';draft.materialsUsed.push({name:'',unit:null,quantity:0});draft.unplannedOtherCosts.push({name:'',amount:0});
 assert.equal(key(draft),key(original));draft.quantityCompletedToday=21;assert.notEqual(key(draft),key(original));draft.quantityCompletedToday=20;assert.equal(key(draft),key(original));
});
