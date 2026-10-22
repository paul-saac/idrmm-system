import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePurchaseLines,stockBalance} from './purchases-model.ts';
test('invoice lines validate separately from received stock',()=>{
  const rows=validatePurchaseLines([{material_name:' Cement ',unit:'bag',quantity:100,unit_price:250,received_quantity:40}]);
  assert.equal(rows[0].material_name,'Cement');
  assert.equal(rows[0].quantity*rows[0].unit_price,25000);
  assert.equal(stockBalance(0,rows[0].received_quantity,20),20);
});
test('invalid quantities, prices and over-receipts are rejected',()=>{
  const valid={material_name:'Cement',unit:'bag',quantity:100,unit_price:250,received_quantity:0};
  for(const patch of [{quantity:0},{quantity:-1},{unit_price:-1},{received_quantity:101},{received_quantity:NaN},{unit:''},{material_name:''},{unit_price:0.001},{quantity:0.0001}]) assert.throws(()=>validatePurchaseLines([{...valid,...patch}]));
  assert.throws(()=>validatePurchaseLines([]));
});
test('replacing a usage entry recalculates stock without repeat deductions',()=>{
  assert.equal(stockBalance(0,100,20),80);
  assert.equal(stockBalance(0,100,15),85);
  assert.equal(stockBalance(0,100,15),85);
  assert.equal(stockBalance(0,0,20),-20);
  assert.equal(stockBalance(0.1,0.2,0.1),0.2);
});
