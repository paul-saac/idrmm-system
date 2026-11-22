import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validatePurchaseLines,stockBalance,computeMaterialStocks,getMaterialStockStatus,getMaterialLowStockThreshold} from './purchases-model.ts';
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

const receipt=(id,date,received,patch={})=>({id,project_id:1,batch_id:String(id),line_number:1,purchase_date:date,supplier:'Supplier',invoice_number:String(id),material_name:'Hollow blocks',unit:'pcs',quantity:received,received_quantity:received,unit_price:10,amount:received*10,recorded_by:'test',created_at:date+'T08:00:00Z',...patch});
const used=(date,quantity,patch={})=>({materialName:'Hollow blocks',unit:'pcs',quantity,entryDate:date,...patch});

test('initial stock uses 5 percent and has no universal five-unit shortcut',()=>{
 assert.equal(getMaterialStockStatus(1000,949).status,'available');
 assert.equal(getMaterialStockStatus(1000,950).status,'low_stock');
 assert.equal(getMaterialStockStatus(12,7).status,'available');
 assert.equal(getMaterialStockStatus(1000,1000).status,'out_of_stock');
 assert.equal(getMaterialStockStatus(1000,1001).status,'over_issued');
});

test('1000 received, 500 used, 1000 replenished resets the reference to 1500',()=>{
 const receipts=[receipt(2,'2026-11-03',1000),receipt(1,'2026-11-01',1000)];
 const usage=[used('2026-11-02',500),used('2026-11-04',1410)];
 const [stock]=computeMaterialStocks(receipts,usage);
 assert.equal(stock.received,2000);assert.equal(stock.referenceQuantity,1500);
 assert.equal(stock.lowStockThreshold,75);assert.equal(stock.balance,90);
 assert.equal(stock.status,'available','90 is above 5% of 1500, despite being below 5% of cumulative receipts');
 const [low]=computeMaterialStocks(receipts,[usage[0],used('2026-11-04',1425)]);
 assert.equal(low.balance,75);assert.equal(low.status,'low_stock');
});

test('usage does not move the reference; another receipt does',()=>{
 const receipts=[receipt(1,'2026-11-01',1000),receipt(2,'2026-11-03',1000)];
 const usage=[used('2026-11-02',500),used('2026-11-04',1400)];
 const [before]=computeMaterialStocks(receipts,usage);
 const [after]=computeMaterialStocks([...receipts,receipt(3,'2026-11-05',900)],usage);
 assert.equal(before.referenceQuantity,1500);assert.equal(before.balance,100);
 assert.equal(after.referenceQuantity,1000);assert.equal(after.balance,1000);assert.equal(after.lowStockThreshold,50);
});

test('unreceived purchases do not replenish stock or reset the reference',()=>{
 const [stock]=computeMaterialStocks([receipt(1,'2026-11-01',1000),receipt(2,'2026-11-05',0,{quantity:2000})],[used('2026-11-02',960)]);
 assert.equal(stock.purchased,3000);assert.equal(stock.referenceQuantity,1000);
 assert.equal(stock.lastReceived,'2026-11-01');assert.equal(stock.status,'low_stock');
});

test('same-day receipts are grouped before daily usage, independent of array order',()=>{
 const receipts=[receipt(1,'2026-11-01',1000),receipt(2,'2026-11-03',600),receipt(3,'2026-11-03',400)];
 const usage=[used('2026-11-02',500),used('2026-11-03',1425)];
 const [stock]=computeMaterialStocks(receipts,usage);
 assert.equal(stock.referenceQuantity,1500);assert.equal(stock.status,'low_stock');
 assert.deepEqual(computeMaterialStocks([...receipts].reverse(),[...usage].reverse()),[stock]);
});

test('corrected or deleted usage and receipt records rebuild the reference without double counting',()=>{
 const receipts=[receipt(1,'2026-11-01',1000),receipt(2,'2026-11-03',1000)];
 assert.equal(computeMaterialStocks(receipts,[used('2026-11-02',400)])[0].referenceQuantity,1600);
 assert.equal(computeMaterialStocks(receipts,[])[0].referenceQuantity,2000);
 assert.equal(computeMaterialStocks(receipts.slice(0,1),[used('2026-11-02',400)])[0].referenceQuantity,1000);
});

test('materials are separated by name and unit, and decimal thresholds are not rounded to whole units',()=>{
 const rows=computeMaterialStocks([receipt(1,'2026-11-01',10,{material_name:'Sand',unit:'cu.m.'}),receipt(2,'2026-11-01',100,{material_name:'Sand',unit:'bag'})],[used('2026-11-02',9.5,{materialName:'Sand',unit:'cu.m.'})]);
 assert.equal(rows.length,2);
 assert.equal(rows.find(row=>row.unit==='cu.m.').status,'low_stock');
 assert.equal(rows.find(row=>row.unit==='bag').status,'available');
 assert.equal(computeMaterialStocks([], [used('2026-11-02',1)])[0].status,'over_issued');
});

test('one whole item skips low stock; replenishing to two activates a one-item threshold',()=>{
 const initial=[receipt(1,'2026-11-01',1)];
 const [full]=computeMaterialStocks(initial,[]);
 assert.equal(full.lowStockThreshold,0);assert.equal(full.status,'available');
 assert.equal(computeMaterialStocks(initial,[used('2026-11-02',1)])[0].status,'out_of_stock');
 const replenished=[...initial,receipt(2,'2026-11-03',1)];
 const [two]=computeMaterialStocks(replenished,[]);
 assert.equal(two.referenceQuantity,2);assert.equal(two.lowStockThreshold,1);assert.equal(two.status,'available');
 assert.equal(computeMaterialStocks(replenished,[used('2026-11-04',1)])[0].status,'low_stock');
 assert.equal(computeMaterialStocks(replenished,[used('2026-11-04',2)])[0].status,'out_of_stock');
});

test('whole-item thresholds round up and recognize supported unit spelling variants',()=>{
 for(const unit of ['pcs','piece','Pieces',' NOS. ','bag','bags.','box','roll','sheet','set','lot','pair','unit','pack']){
  assert.equal(getMaterialLowStockThreshold(1,unit),0,unit);
  assert.equal(getMaterialLowStockThreshold(12,unit),1,unit);
  assert.equal(getMaterialLowStockThreshold(25,unit),2,unit);
  assert.equal(getMaterialLowStockThreshold(1500,unit),75,unit);
 }
 assert.equal(getMaterialStockStatus(12,11,12,'pcs').status,'low_stock');
 assert.equal(getMaterialStockStatus(12,10,12,'pcs').status,'available');
 assert.equal(getMaterialStockStatus(25,23,25,'bag').status,'low_stock');
 assert.equal(getMaterialStockStatus(25,26,25,'bag').status,'over_issued');
});

test('measured and unclassified units retain fractional five-percent thresholds',()=>{
 for(const unit of ['kg','L','cu.m.','m³','m','custom-unit']){
  assert.equal(getMaterialLowStockThreshold(1,unit),0.05,unit);
  assert.equal(getMaterialStockStatus(1,0.95,1,unit).status,'low_stock');
  assert.equal(getMaterialStockStatus(1,0.9,1,unit).status,'available');
 }
});
