// Brett's stated rules, pinned to the live invPricing in index.html:
//   · his hour is added on top and is NEVER marked up (it's a wage, not a job)
//   · it DOES carry the 5% processing fee, because the card takes its cut of the whole ticket
//   · an in-house job is worth its full ticket — his own labour is not netted out of profit
//   · what the business made is reported apart from what he earned
import fs from 'fs';
const html = fs.readFileSync('index.html','utf8');
function grab(name){
  const i = html.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=html.indexOf(')',i); j=html.indexOf('{',j);
  for(;j<html.length;j++){ if(html[j]==='{')d++; else if(html[j]==='}'){d--; if(!d)break;} }
  return html.slice(i, j+1);
}
const ctx = { state: { vendors: [] }, _invBill: {}, document: null };
const { calcTieredEstimate, invPricing, setup } = new Function(
  'state','_invBill','fields',
  'function safeArray(v){return Array.isArray(v)?v:[];}\n' +
  'function invTimeTotal(k){return fields.loggedTime||0;}\n' +
  'var document={getElementById:function(id){\n' +
  '  if(id.indexOf("inv-onsite-")===0) return {checked:!!fields.onsite};\n' +
  '  if(id.indexOf("inv-brett-hrs-")===0) return {value:String(fields.brettHrs||0)};\n' +
  '  if(id.indexOf("inv-travel-")===0) return {value:String(fields.travel||0)};\n' +
  '  return null;}};\n' +
  grab('calcTieredEstimate') + '\n' + grab('invPricing') +
  '\nreturn { calcTieredEstimate, invPricing };')(ctx.state, ctx._invBill, {});

function price(bill, fields, vendors){
  const state={vendors:vendors||[]}, _invBill={k:bill};
  const f=Object.assign({onsite:false,brettHrs:0,travel:0,loggedTime:0},fields);
  const mod = new Function('state','_invBill','fields',
    'function safeArray(v){return Array.isArray(v)?v:[];}\n' +
    'function invTimeTotal(k){return fields.loggedTime||0;}\n' +
    'var document={getElementById:function(id){\n' +
    '  if(id.indexOf("inv-onsite-")===0) return {checked:!!fields.onsite};\n' +
    '  if(id.indexOf("inv-brett-hrs-")===0) return {value:String(fields.brettHrs||0)};\n' +
    '  if(id.indexOf("inv-travel-")===0) return {value:String(fields.travel||0)};\n' +
    '  return null;}};\n' +
    grab('calcTieredEstimate') + '\n' + grab('invPricing') +
    '\nreturn invPricing("k");')(state,_invBill,f);
  return mod;
}

let pass=0,fail=0;
const t=(n,c,got)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n, got!==undefined?('got '+JSON.stringify(got)):'');} };

// ── Brett's oversight example: vendor $200, his oversight hour $75 ──
const ext = { Bill_Type:'hourly', Hours:'2', Labor_Total:'200', Truck_Stock:'0', Receipts_Total:'0', Vendor_ID:'9' };
const p1 = price(ext, { loggedTime: 75 }, [{ID:'9', In_House:'FALSE'}]);

t('his hour is not part of the marked-up base', p1.tieredBase === calcTieredEstimate(200).finalPrice, p1.tieredBase);
t('his hour lands on top of the marked-up price', p1.tieredPrice > p1.tieredBase, p1.tieredPrice);
// added on top with the 5% fee, then rounded to $5
t('his hour carries the 5% fee, not the markup',
  p1.tieredPrice === Math.ceil((p1.tieredBase + 75*1.05)/5)*5, p1.tieredPrice);
t('an external vendor is cash out', p1.cashOut === 200, p1.cashOut);
t('his oversight hour is his wage', p1.ownWage === 75, p1.ownWage);

// profit = charge - cashOut - ownWage
const charge1 = p1.tieredPrice;
t('profit excludes both the vendor cost and his wage',
  Math.abs((charge1 - p1.cashOut - p1.ownWage) - (charge1 - 275)) < 0.01);

// ── the in-house $450 case: he did the work himself ──
const own = { Bill_Type:'hourly', Hours:'4', Labor_Total:'200', Truck_Stock:'0', Receipts_Total:'0', Vendor_ID:'1' };
const p2 = price(own, {}, [{ID:'1', In_House:'TRUE'}]);
t('in-house labour is not cash out', p2.cashOut === 0, p2.cashOut);
t('in-house labour counts as his wage', p2.ownWage === 200, p2.ownWage);
t('a $450 in-house job is worth $450', (450 - p2.cashOut) === 450);
t('and splits into $200 wage + $250 profit', (450 - p2.cashOut - p2.ownWage) === 250);
t('pricing still works off the full cost', p2.totalCost === 200, p2.totalCost);

// ── an unflagged vendor must not be treated as in-house ──
const p3 = price(own, {}, [{ID:'1'}]);
t('no In_House flag means a normal vendor', p3.cashOut === 200 && p3.ownWage === 0);
const p4 = price(own, {}, []);
t('an unknown vendor is not in-house', p4.cashOut === 200);
t('lowercase true still counts as in-house', price(own, {}, [{ID:'1', In_House:'true'}]).cashOut === 0);

// ── no time logged at all: nothing changes from before ──
const p5 = price(ext, {}, [{ID:'9'}]);
t('no wage means profit is the whole margin', p5.ownWage === 0 && p5.cashOut === 200);
t('and the tiered price is the plain tiered price', p5.tieredPrice === Math.ceil(calcTieredEstimate(200).finalPrice/5)*5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
