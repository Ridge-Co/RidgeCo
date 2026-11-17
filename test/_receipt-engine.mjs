// Test helper (Nov 17 2026, receipt accuracy build): loads the PURE receipt-matching functions out of the real
// worker.js into one sandbox and returns them, so every receipt test runs the code the Worker runs.
import fs from 'fs';
import './_wo-status-global.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
export function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const NAMES = ['_rcNorm', '_rcPropActive', 'matchReceiptCandidates', 'matchReceiptProperty', '_rcUnitKey', 'receiptUnitHint',
  '_rcWoNum', '_rcWoOpenOn', 'receiptWORef', 'receiptPropertyHint', 'rankReceiptWOs', 'receiptCardStatus', 'receiptCardLast4Strict',
  'receiptIsVendorInvoice', '_rcStoreKey', '_rcInvKey', 'receiptDupSignals', 'receiptRuleDecision', 'receiptIsDuplicate', 'receiptSuggestCore'];
const defaults = (src.match(/const RECEIPT_VENDOR_INVOICE_NAMES_DEFAULT = \[[^\]]*\];/) || [''])[0];
const body = [
  'const RECEIPT_OPEN_STATUSES = WOStatus.sets.ACTIVE;',
  "const RECEIPT_STOP=new Set(['the','and','for','with','apt','ste','unit','street','saint','st','ave','rd','ln','pl','n','s','e','w','2x','x']);",
  'const RECEIPT_CLOSED_WINDOW_DAYS = 30;',
  defaults,
  ...NAMES.map(grab),
  'return { ' + NAMES.concat(['RECEIPT_VENDOR_INVOICE_NAMES_DEFAULT']).join(', ') + ' };',
].join('\n');
export const E = new Function(body)();
