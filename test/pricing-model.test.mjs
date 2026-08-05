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
  const f=Object.assign({onsite:false,brettHrs:0,travel:0,loggedTime:0,ownMaterials:0},fields);
  const mod = new Function('state','_invBill','fields',
    'function safeArray(v){return Array.isArray(v)?v:[];}\n' +
    'var _invPass5=fields&&fields._invPass5?{k:true}:{};\n' +
    'function invTimeTotal(k){return fields.loggedTime||0;}\n' +
    'function invMatTotal(k){return fields.ownMaterials||0;}\n' +
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


// ── Materials Brett buys himself: they were invisible to this panel entirely, so they
// reached no invoice, carried no markup and no 5%. Both of those are the same fix.
const noMat  = price(ext, {}, [{ID:'9'}]);
const withMat = price(ext, { ownMaterials: 100 }, [{ID:'9'}]);

t('materials you bought join the pricing basis',
  withMat.totalCost === noMat.totalCost + 100, [noMat.totalCost, withMat.totalCost]);
// The two pricing paths treat materials differently, and that is worth pinning rather
// than discovering later:
//   TIERED   — markup is a percentage of total cost, so materials get the markup AND the 5%
//   ITEMIZED — markup is labour-hours based ($35/hr, min $75), so materials pass through
//              at cost and pick up only the 5%
t('tiered marks materials up as well as adding the 5%',
  (withMat.tieredPrice - noMat.tieredPrice) > 100 * 1.05,
  { added: withMat.tieredPrice - noMat.tieredPrice });
t('itemized passes materials at cost plus the 5%',
  Math.abs((withMat.itemizedPrice - noMat.itemizedPrice) - 105) < 0.01,
  { added: withMat.itemizedPrice - noMat.itemizedPrice });
t('either way the 5% definitely reaches them',
  (withMat.itemizedPrice - noMat.itemizedPrice) >= 105 &&
  (withMat.tieredPrice - noMat.tieredPrice) >= 105);
t('they are exposed for the invoice lines', withMat.ownMaterials === 100);

// they are real cash out, so they reduce profit even on an in-house job
const ownJob = price(own, { ownMaterials: 80 }, [{ID:'1', In_House:'TRUE'}]);
t('materials you bought are cash out even when the labour is yours',
  ownJob.cashOut === 80, ownJob.cashOut);
t('and your own labour still is not', ownJob.ownWage === 200);

// ── Pass-through: labor + materials at cost, no markup, no $75 (the new default) ──
// vendor labor 200 + own materials 100, no on-site time, no travel
const ptBill = { Bill_Type:'hourly', Hours:'2', Labor_Total:'200', Truck_Stock:'0', Receipts_Total:'0', Vendor_ID:'9' };
const pt = price(ptBill, { ownMaterials: 100 }, [{ID:'9'}]);
t('pass-through (5% off) = total cost exactly, no markup',
  pt.passthroughPrice === 300 && pt.passFeeOn === false, pt.passthroughPrice);
t('pass-through sits below the tiered price (no markup, no $75)',
  pt.passthroughPrice < pt.tieredPrice && pt.passthroughPrice < pt.itemizedPrice,
  [pt.passthroughPrice, pt.tieredPrice, pt.itemizedPrice]);

// with logged time + travel, they ride on top at cost (never marked up)
const pt2 = price(ptBill, { ownMaterials: 100, loggedTime: 75, travel: 20 }, [{ID:'9'}]);
t('pass-through adds your time and travel at cost',
  pt2.passthroughPrice === 300 + 75 + 20, pt2.passthroughPrice);

// 5% toggle ON multiplies the whole ticket by 1.05
const pt3 = price(ptBill, { ownMaterials: 100, _invPass5: true }, [{ID:'9'}]);
t('pass-through (5% on) = base * 1.05',
  pt3.passthroughPrice === +(300*1.05).toFixed(2) && pt3.passFeeOn === true, pt3.passthroughPrice);

// the approve-time split must not invent a card fee on a no-surcharge pass-through
function approveSplit(charge, totalCost, brettTime, travel, mode, pass5){
  const carries5 = (mode==='tiered'||mode==='itemized') || (mode==='passthrough' && !!pass5);
  const fee = carries5 ? +(charge - charge/1.05).toFixed(2) : 0;
  const markup = +(charge - fee - totalCost - brettTime - travel).toFixed(2);
  return { fee, markup };
}
const sOff = approveSplit(pt.passthroughPrice, pt.totalCost, 0, 0, 'passthrough', false);
t('pass-through off reports NO processing fee', sOff.fee === 0 && sOff.markup === 0, sOff);
const sOn = approveSplit(pt3.passthroughPrice, pt.totalCost, 0, 0, 'passthrough', true);
t('pass-through on reports the real 5% share', Math.abs(sOn.fee - 300*0.05) < 0.02 && Math.abs(sOn.markup) < 0.02, sOn);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
