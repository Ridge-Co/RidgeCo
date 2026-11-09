// Nov 3 2026 (Brett): Premier is switched to "create in QuickBooks only" for INSPECTIONS. Their booking page must not insist on a work order number
// (the WO email may arrive after the booking), but a typed number must still be valid, other billed customers still require it, and the customer
// screen carries the on/off switch. Runs the real inspBookingWoInput from worker.js.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../inspect.html', import.meta.url), 'utf8');
const book = fs.readFileSync(new URL('../inspect-book.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const inspErr = (code, msg, status) => Object.assign(new Error(msg), { code, status });
const f = new Function('inspErr', grab('insbNormWO') + '\n' + grab('inspBookingWoInput') + '\nreturn inspBookingWoInput;')(inspErr);
const tries = (c, b) => { try { return { v: f(c, b) }; } catch (e) { return { err: e.code }; } };

ok(tries({ Billing_Mode: '' }, {}).v === '', 'a customer with no billing mode never needs a WO');
ok(tries({ Billing_Mode: 'wo' }, {}).err === 'bad_wo', 'billed-by-WO customer (emailed invoice) still must give a WO');
ok(tries({ Billing_Mode: 'wo', Invoice_Delivery: '' }, { wo_number: '  ' }).err === 'bad_wo', 'blank/spaces still refused for them');
ok(tries({ Billing_Mode: 'wo' }, { wo_number: '43945-1' }).v === '43945-1', 'a valid WO is accepted');
ok(tries({ Billing_Mode: 'wo' }, { wo_number: '4 3945-1' }).v === '43945-1', 'spaces are removed');
ok(tries({ Billing_Mode: 'wo', Invoice_Delivery: 'qb_only' }, {}).v === '', 'QuickBooks-only customer may book without a WO');
ok(tries({ Billing_Mode: 'wo', Invoice_Delivery: 'qb_only' }, { wo_number: '' }).v === '', '... including an empty field');
ok(tries({ Billing_Mode: 'wo', Invoice_Delivery: 'qb_only' }, { wo_number: '44248-1' }).v === '44248-1', '... and a WO they do give is kept');
ok(tries({ Billing_Mode: 'wo', Invoice_Delivery: 'qb_only' }, { wo_number: '!!' }).err === 'bad_wo', '... but a typed WO that is invalid is refused, never silently dropped');
// info endpoint + pages
ok(/require_wo: String\(c\.Billing_Mode \|\| ''\) === 'wo' && String\(c\.Invoice_Delivery \|\| ''\) !== 'qb_only', ask_wo:/.test(src), 'booking info says "required" only when it really is, and always offers the field');
ok(/r\.require_wo\|\|r\.ask_wo/.test(book) && /add it if you have it/.test(book) && /woReq\|\|wo/.test(book), 'booking page shows an optional field and only validates a required or typed one');
ok(/id="ce-qo"/.test(html) && /Invoice_Delivery:document\.getElementById\('ce-qo'\)\.checked\?'qb_only':''/.test(html) && /getElementById\('ce-qo'\)\.checked=\(c\.Invoice_Delivery==='qb_only'\)/.test(html), 'customer screen has the switch, loads it and saves it');
ok(/Inspections only/.test(html), 'the switch says it is for inspections only');
console.log('insp-book-wo-optional: ' + n + ' checks passed');
