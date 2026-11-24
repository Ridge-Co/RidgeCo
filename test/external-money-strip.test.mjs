// Nov 24 2026 (Brett: "Vendor page shows payment info! This is never supposed to be possible."): WO-1253's vendor
// portal showed the Hub's own billing line in Notes ("Scope Proposal billed — Final — $830.00 invoiced (1774); vendor
// paid $460.00 this round (less the $200.00 deposit already paid) (send $250.00 after the $10.00 instant-pay fee).").
// enrichWO spreads every Work_Orders column, and it builds every external view (vendor, tenant, owner, shared link).
// These run the REAL stripExternalMoney / externalSafeNotes extracted from worker.js so the test can't drift.
import fs from 'fs';
import assert from 'assert';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grabLine(sig) {
  const s = wsrc.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  return wsrc.slice(s, wsrc.indexOf('\n', s));
}
function grabFn(sig) {
  const s = wsrc.indexOf(sig); if (s < 0) throw new Error('not found: ' + sig);
  const open = wsrc.indexOf('{', wsrc.indexOf(')', s));
  let d = 0, i = open;
  for (; i < wsrc.length; i++) { if (wsrc[i] === '{') d++; else if (wsrc[i] === '}') { d--; if (!d) break; } }
  return wsrc.slice(s, i + 1);
}
const code = [
  grabLine('const EXTERNAL_HIDDEN_WO_FIELDS'),
  grabLine('const EXTERNAL_HIDDEN_WO_PREFIXES'),
  grabLine('const EXTERNAL_NOTE_MONEY_RE'),
  grabFn('function externalSafeNotes('),
  grabFn('function stripExternalMoney('),
].join('\n') + '\nreturn { externalSafeNotes, stripExternalMoney };';
const { externalSafeNotes, stripExternalMoney } = new Function(code)();

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('ok -', name); }

// 1. The exact WO-1253 line is gone.
const realLine = '[Nov 2, 7:01 PM] Scope Proposal billed — Final — $830.00 invoiced (1774); vendor paid $460.00 this round (less the $200.00 deposit already paid) (send $250.00 after the $10.00 instant-pay fee).';
t('WO-1253 billing line is removed', () => assert.strictEqual(externalSafeNotes(realLine), ''));

// 2. The Review Bills final-billing line is gone.
t('Review Bills final billing line is removed', () => assert.strictEqual(
  externalSafeNotes('[Nov 3, 9:00 AM] Final billing via Review Bills — invoice 1780 for $400.00 after $200.00 already invoiced (Deposit); Scope #12 closed.'), ''));

// 3. Brett's ordinary notes to the vendor survive, in order, around a removed line.
t('normal notes survive', () => assert.strictEqual(
  externalSafeNotes('Tenant works nights, knock loud\n' + realLine + '\nBring 16x25x1 filters'),
  'Tenant works nights, knock loud\nBring 16x25x1 filters'));

// 4. Money columns are dropped; vendor's own Max_Price and paid date and the job fields stay.
t('money columns stripped, job fields kept', () => {
  const out = stripExternalMoney({
    ID: 'WO-1253', Description: 'Replace air filter', Notes: 'Gate code on lockbox\n' + realLine,
    Customer_Charge: '830', Invoice_ID: '1774', Invoice_Number: '1774',
    Deposit_Amount: '200', Deposit_Fee: '10', Deposit_QB_Bill_ID: '99', QB_Bill_ID: '55',
    Max_Price: '500', Vendor_Paid_Date: '2026-11-02', Status: 'Complete',
  });
  for (const k of ['Customer_Charge', 'Invoice_ID', 'Invoice_Number', 'Deposit_Amount', 'Deposit_Fee', 'Deposit_QB_Bill_ID', 'QB_Bill_ID'])
    assert.ok(!(k in out), k + ' should be stripped');
  assert.strictEqual(out.Notes, 'Gate code on lockbox');
  assert.strictEqual(out.Max_Price, '500');
  assert.strictEqual(out.Vendor_Paid_Date, '2026-11-02');
  assert.strictEqual(out.Description, 'Replace air filter');
  assert.strictEqual(out.Status, 'Complete');
});

// 5. Every external view path goes through it: enrichWO returns stripExternalMoney(base).
t('enrichWO returns through stripExternalMoney', () => {
  const enrich = grabFn('function enrichWO(');
  assert.ok(/return stripExternalMoney\(base\);\s*\}$/.test(enrich), 'enrichWO must end with return stripExternalMoney(base)');
  assert.ok(!/\n\s*return base;/.test(enrich), 'enrichWO must not return base unstripped anywhere');
});

// 6. Empty / missing notes stay harmless.
t('empty notes', () => { assert.strictEqual(externalSafeNotes(''), ''); assert.strictEqual(externalSafeNotes(undefined), ''); });

console.log(pass + ' passed');
