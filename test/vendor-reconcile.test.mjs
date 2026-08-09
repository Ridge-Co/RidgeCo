// The vendor-reconciliation status classifier decides, from the LIVE QuickBooks balances, what
// state each vendor bill is in. The one that must never be missed is action=true: the customer
// invoice is paid but the vendor bill is not — money Brett collected and still owes the vendor.
// Runs the real function out of worker.js so the test can't drift from what ships.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };

const { qbReconcileStatus } = new Function(
  grab(wsrc, 'function qbReconcileStatus(') + '\nreturn { qbReconcileStatus };')();

// hasBillId, billFound, billBal, hasInv, invBal
let r;
r = qbReconcileStatus(false, false, null, true, 100);
t('no QB bill id at all is flagged as such', r.status === 'No vendor bill in QuickBooks' && r.action === false);

r = qbReconcileStatus(true, false, null, true, 0);
t('linked bill id that QB does NOT return is a broken link, never "pay vendor"', r.status === 'Linked bill not found in QuickBooks' && r.action === false);

r = qbReconcileStatus(true, true, 0, true, 0);
t('vendor paid + owner paid = Vendor paid, no action', r.status === 'Vendor paid' && r.action === false);

r = qbReconcileStatus(true, true, 150, true, 0);
t('THE key case: owner paid us but vendor still owed → action', r.status === 'COLLECTED — pay vendor' && r.action === true);

r = qbReconcileStatus(true, true, 150, true, 150);
t('vendor owed AND owner has not paid → Waiting on owner, no action', r.status === 'Waiting on owner' && r.action === false);

r = qbReconcileStatus(true, true, 150, false, null);
t('vendor owed but no invoice on file → unpaid/unknown, no action', /unpaid/i.test(r.status) && r.action === false);

r = qbReconcileStatus(true, true, 0.004, true, 200);
t('a sub-penny bill balance counts as paid (rounding guard)', r.status === 'Vendor paid');

r = qbReconcileStatus(true, true, 150, true, 0.004);
t('a sub-penny invoice balance counts as owner-paid → action', r.action === true);

// ── qbMatchBillsToHub: link QB bills to Hub rows by WO number (Allen George's real shape) ──
const { qbMatchBillsToHub } = new Function(
  grab(wsrc, 'function qbMatchBillsToHub(') + '\nreturn { qbMatchBillsToHub };')();
{
  const hub = [
    { row_id:'h1', wo_id:'1052', qb_bill_id:'', total:100 },
    { row_id:'h2', wo_id:'1064', qb_bill_id:'', total:185 },  // Kevin — Hub 185 vs QB 100
    { row_id:'h3', wo_id:'1099', qb_bill_id:'', total:50 },   // no QB bill
    { row_id:'h4', wo_id:'1075', qb_bill_id:'B-already', total:200 }, // already linked
  ];
  const qb = [
    { id:'201', doc:'WO-1052', total:100, balance:0, paid:true },
    { id:'202', doc:'WO-1064', total:100, balance:100, paid:false }, // Kevin, open
    { id:'203', doc:'WO-1053', total:225, balance:0, paid:true },    // QB-only, no hub row
    { id:'B-already', doc:'WO-1075', total:200, balance:0, paid:true },
  ];
  const r = qbMatchBillsToHub(hub, qb);
  t('clean matches are proposed (1052 + 1064)', r.links.length === 2);
  t('WO-1052 links to its paid QB bill', r.links.find(l=>l.wo_id==='1052').qb_bill_id==='201');
  t('the Kevin row links to the OPEN bill and flags the amount mismatch',
     (()=>{const l=r.links.find(x=>x.wo_id==='1064'); return l && l.qb_bill_id==='202' && l.qb_paid===false && l.amount_mismatch===true;})());
  t('a Hub row already linked is left alone (not re-proposed)', !r.links.find(l=>l.row_id==='h4'));
  t('a Hub row with no QB bill is reported, not linked', r.hubNoMatch.length===1 && r.hubNoMatch[0].wo_id==='1099');
  t('a QB bill with no Hub row is reported (WO-1053), excluding already-linked', r.qbNoHub.length===1 && r.qbNoHub[0].qb_doc==='WO-1053');
}
{
  // ambiguity: two QB bills for one WO must NOT auto-link
  const hub = [{ row_id:'h1', wo_id:'1052', qb_bill_id:'', total:100 }];
  const qb = [{ id:'a', doc:'WO-1052', total:100, balance:0, paid:true }, { id:'b', doc:'WO-1052', total:100, balance:100, paid:false }];
  const r = qbMatchBillsToHub(hub, qb);
  t('a WO matching >1 QB bill is ambiguous, never auto-linked', r.links.length===0 && r.ambiguous.length===1 && r.ambiguous[0].candidates.length===2);
}
{
  // two Hub rows share one WO but there's only ONE QB bill — must not double-link both to it
  const hub = [{ row_id:'h1', wo_id:'1052', qb_bill_id:'', total:100 }, { row_id:'h2', wo_id:'1052', qb_bill_id:'', total:100 }];
  const qb = [{ id:'x', doc:'WO-1052', total:100, balance:0, paid:true }];
  const r = qbMatchBillsToHub(hub, qb);
  t('one QB bill is claimed by only one Hub row, the other is left unmatched',
     r.links.length===1 && r.hubNoMatch.length===1 && r.links[0].qb_bill_id==='x');
}

console.log(`\nvendor-reconcile: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
