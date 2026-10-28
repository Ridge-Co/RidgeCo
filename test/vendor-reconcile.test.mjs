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

{
  // Signed-proposal jobs (Cesar's WO-1246 roof + WO-1227): the Hub created the QB bills itself with a BLANK
  // DocNumber, so doc-number matching finds nothing — the milestone record (scopeBillsByWo) is what links them.
  const hub = [
    { row_id:'126', wo_id:'WO-1246', qb_bill_id:'', total:2900 },
    { row_id:'124', wo_id:'WO-1227', qb_bill_id:'', total:800 },
  ];
  const qb = [
    { id:'7948', doc:'', total:1148.4, balance:0, paid:true },
    { id:'7972', doc:'', total:1740, balance:1740, paid:false },
    { id:'7902', doc:'', total:283.39, balance:0, paid:true },
    { id:'7999', doc:'', total:556.61, balance:556.61, paid:false },
  ];
  const sb = {
    '1246': [{ qb_bill_id:'7948', qb_invoice_id:'7947' }, { qb_bill_id:'7972', qb_invoice_id:'7971' }],
    '1227': [{ qb_bill_id:'7902', qb_invoice_id:'7901' }, { qb_bill_id:'7999', qb_invoice_id:'7998' }],
  };
  const r = qbMatchBillsToHub(hub, qb, sb);
  const l126 = r.links.find(l => l.row_id === '126'), l124 = r.links.find(l => l.row_id === '124');
  t('scope job links the OPEN final bill, not the paid deposit bill', l126 && l126.qb_bill_id === '7972' && l126.qb_paid === false);
  t('scope job also carries the matching customer invoice for the same milestone', l126 && l126.qb_invoice_id === '7971' && l126.via === 'scope_milestone');
  t('the second scope job links its open bill too (WO-1227 -> 7999 / invoice 7998)', l124 && l124.qb_bill_id === '7999' && l124.qb_invoice_id === '7998');
  t('Hub total 2900 vs the open bill 1740 is flagged, never changed', l126 && l126.amount_mismatch === true && l126.hub_total === 2900 && l126.qb_total === 1740);
  t('every candidate bill is shown so the split is visible', l126 && l126.scope_bills.length === 2);
  t('nothing left ambiguous or unmatched', r.ambiguous.length === 0 && r.hubNoMatch.length === 0);
}
{
  // doc-number match still wins over the milestone fallback
  const hub = [{ row_id:'h1', wo_id:'WO-1052', qb_bill_id:'', total:100 }];
  const qb = [{ id:'a', doc:'WO-1052', total:100, balance:0, paid:true }, { id:'b', doc:'', total:50, balance:50, paid:false }];
  const r = qbMatchBillsToHub(hub, qb, { '1052': [{ qb_bill_id:'b', qb_invoice_id:'9' }] });
  t('a bill-number match is used first; the milestone fallback is not consulted', r.links.length === 1 && r.links[0].qb_bill_id === 'a' && !r.links[0].via);
}
{
  // two OPEN bills, or two PAID bills, on one scope WO -> never guess
  const hub = [{ row_id:'h1', wo_id:'WO-1', qb_bill_id:'', total:100 }, { row_id:'h2', wo_id:'WO-2', qb_bill_id:'', total:100 }];
  const qb = [
    { id:'a', doc:'', total:50, balance:50, paid:false }, { id:'b', doc:'', total:50, balance:50, paid:false },
    { id:'c', doc:'', total:50, balance:0, paid:true }, { id:'d', doc:'', total:50, balance:0, paid:true },
  ];
  const r = qbMatchBillsToHub(hub, qb, { '1': [{ qb_bill_id:'a' }, { qb_bill_id:'b' }], '2': [{ qb_bill_id:'c' }, { qb_bill_id:'d' }] });
  t('two open scope bills on one WO are ambiguous', r.links.length === 0 && r.ambiguous.length === 2);
}
{
  // single scope bill, already-linked and other-vendor bills
  const hub = [{ row_id:'h1', wo_id:'WO-1', qb_bill_id:'', total:100 }, { row_id:'h2', wo_id:'WO-2', qb_bill_id:'', total:100 }, { row_id:'h3', wo_id:'WO-3', qb_bill_id:'z', total:100 }];
  const qb = [{ id:'a', doc:'', total:100, balance:0, paid:true }, { id:'z', doc:'', total:100, balance:0, paid:true }];
  const r = qbMatchBillsToHub(hub, qb, { '1': [{ qb_bill_id:'a', qb_invoice_id:'' }], '2': [{ qb_bill_id:'NOT-THIS-VENDORS' }], '3': [{ qb_bill_id:'z' }] });
  t('one scope bill links (even when paid), with no invoice stamped when none is known', r.links.length === 1 && r.links[0].qb_bill_id === 'a' && r.links[0].qb_invoice_id === '');
  t('a scope bill that is not in this vendor\'s QuickBooks list is ignored', r.hubNoMatch.length === 1 && r.hubNoMatch[0].row_id === 'h2');
  t('an already-linked Hub row is left alone', !r.links.find(l => l.row_id === 'h3'));
  const same = qbMatchBillsToHub([{ row_id:'x', wo_id:'WO-1', qb_bill_id:'', total:1 }, { row_id:'y', wo_id:'WO-1', qb_bill_id:'', total:1 }], [{ id:'a', doc:'', total:1, balance:0, paid:true }], { '1': [{ qb_bill_id:'a' }] });
  t('one scope bill is claimed by only one Hub row', same.links.length === 1 && same.hubNoMatch.length === 1);
}

console.log(`\nvendor-reconcile: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
