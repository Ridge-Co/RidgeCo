// receiptSuggestCore (CAP-002 phase 2) is the single PURE decision function behind BOTH the
// interactive POST /receipt/suggest endpoint and the bulk receiptReconScan() cron sweep — one
// source of truth for: refund/company/customer-card exclusions, property resolution, open-WO
// ranking, and duplicate/already-invoiced flagging. No I/O, so it's fully testable here.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const norm = grab('_rcNorm');
const consts = "const RECEIPT_OPEN_STATUSES=['New','Assigned','Accepted','In Progress','On Hold','Pending Invoice','Complete'];" +
  "const RECEIPT_STOP=new Set(['the','and','for','with','apt','ste','unit','street','saint','st','ave','rd','ln','pl','n','s','e','w','2x','x']);";
const body = [
  norm,
  consts,
  grab('matchReceiptProperty'),
  grab('rankReceiptWOs'),
  grab('receiptIsDuplicate'),
  grab('receiptSuggestCore'),
  'return receiptSuggestCore;',
].join('\n');
const receiptSuggestCore = new Function(body)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const PROPS = [ { ID: 8, Address: '3014 N Calvert St' } ];
const WOS = [
  { ID: 'WO-1099', Status: 'In Progress', Trade: 'Electrical', Description: 'Tenant reported smoke alarm going off', Property_ID: 8 },
  { ID: 'WO-1035', Status: 'Invoiced',    Trade: 'Electrical', Description: 'smoke alarm follow-up',                Property_ID: 8 },
];
const RCPTS = [ { WO_ID: 'WO-1099', Amount: '217.07', Date: '2026-08-04', Store: 'Home Depot', Active: 'TRUE' } ];

// Exclusions — never propose a WO for spend that isn't customer-billable.
ok(receiptSuggestCore({ po: '3014 N Calvert', total: -12.5 }, PROPS, WOS, RCPTS, []).category === 'refund', 'negative total ⇒ refund, skipped');
ok(receiptSuggestCore({ po: 'bmore', total: 40 }, PROPS, WOS, RCPTS, []).category === 'company', 'PO "bmore" ⇒ company expense, excluded');
ok(receiptSuggestCore({ po: '3014 N Calvert', total: 40, card: '7442' }, PROPS, WOS, RCPTS, ['7442']).category === 'customer_paid', 'card on the customer-card list ⇒ excluded');
ok(receiptSuggestCore({ po: '3014 N Calvert', total: 40, card: '1111' }, PROPS, WOS, RCPTS, ['7442']).category === 'billable', 'a DIFFERENT card is not excluded');

// No property resolvable ⇒ flagged for manual assignment, never guessed.
ok(receiptSuggestCore({ po: 'no address here', total: 40 }, PROPS, WOS, RCPTS, []).action === 'need_property', 'unresolvable PO ⇒ need_property');

// Normal path — suggests the best-ranked OPEN work order at that property.
const suggest = receiptSuggestCore({ po: '3014 N Calvert', total: 25, date: '2026-08-05', store: 'Home Depot', items: ['smoke detector'] }, PROPS, WOS, RCPTS, []);
ok(suggest.action === 'suggest', 'a resolvable property + open WO ⇒ suggest');
ok(suggest.suggested_wo.id === 'WO-1099', 'suggests the open WO, not the Invoiced one');
ok(suggest.property.id === '8', 'resolves the correct property');

// Duplicate guard — same WO/amount/date/store already on file ⇒ auto-skip, never double-posted.
const dupe = receiptSuggestCore({ po: '3014 N Calvert', total: 217.07, date: '2026-08-04', store: 'Home Depot', items: ['smoke detector'] }, PROPS, WOS, RCPTS, []);
ok(dupe.flags.includes('duplicate_on_wo'), 'exact prior receipt on that WO ⇒ flagged duplicate');
ok(dupe.action === 'skip_duplicate', 'duplicate ⇒ action is skip_duplicate, not suggest');

// No open WOs at all at that property ⇒ need_wo, never silently dropped.
const noOpen = receiptSuggestCore({ po: '3014 N Calvert', total: 25 }, PROPS, [{ ...WOS[1] }], RCPTS, []);
ok(noOpen.flags.includes('no_open_wo') && noOpen.action === 'need_wo', 'property with only closed WOs ⇒ need_wo');

console.log('receipt-suggest-core: ' + n + ' assertions passed');
