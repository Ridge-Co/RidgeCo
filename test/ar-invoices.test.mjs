// The Send & Track board classifies every QuickBooks invoice so Brett can (1) see the pile he
// CREATED but never SENT — the thing QuickBooks' own UI can't filter — and (2) time reminders by
// days overdue. These pin classifyArInvoice:
//   (1) paid (balance ≈ 0) always wins, even if never emailed;
//   (2) EmailStatus 'NeedToSend' AND 'NotSet' both classify as not_sent (created, never sent);
//   (3) an emailed, unpaid, past-due invoice is 'overdue' with correct days_overdue;
//   (4) an emailed, unpaid, not-yet-due invoice is 'sent' (awaiting payment);
//   (5) has_email reflects whether a send-to address is on file.
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
const classify = new Function(grab('classifyArInvoice') + '\nreturn classifyArInvoice;')();

// Fixed "now" so the test is deterministic: 2026-08-12.
const now = Date.parse('2026-08-12T12:00:00Z');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// (1) paid wins even if never emailed
let r = classify({ Id:'1', Balance:0, TotalAmt:150, EmailStatus:'NotSet', DueDate:'2026-07-01', BillEmail:{Address:'a@b.com'} }, now);
ok(r.status === 'paid', 'zero balance ⇒ paid regardless of EmailStatus');

// (2a) NeedToSend, unpaid ⇒ not_sent
r = classify({ Id:'2', Balance:150, TotalAmt:150, EmailStatus:'NeedToSend', DueDate:'2026-09-01', BillEmail:{Address:'a@b.com'} }, now);
ok(r.status === 'not_sent', 'NeedToSend + unpaid ⇒ not_sent');

// (2b) NotSet, unpaid ⇒ not_sent (this is the pile QB cannot filter)
r = classify({ Id:'3', Balance:150, TotalAmt:150, EmailStatus:'NotSet', DueDate:'2026-01-01', BillEmail:{} }, now);
ok(r.status === 'not_sent', 'NotSet + unpaid ⇒ not_sent even when past due (must send before chasing)');
ok(r.has_email === false, 'no BillEmail ⇒ has_email false');

// (3) emailed, unpaid, past due ⇒ overdue with days_overdue
r = classify({ Id:'4', Balance:200, TotalAmt:200, EmailStatus:'EmailSent', DueDate:'2026-07-13', BillEmail:{Address:'x@y.com'} }, now);
ok(r.status === 'overdue', 'EmailSent + unpaid + past due ⇒ overdue');
ok(r.days_overdue === 30, 'days_overdue computed from due date (Jul 13 → Aug 12 = 30)');

// (4) emailed, unpaid, future due ⇒ sent (awaiting)
r = classify({ Id:'5', Balance:200, TotalAmt:200, EmailStatus:'EmailSent', DueDate:'2026-09-30', BillEmail:{Address:'x@y.com'} }, now);
ok(r.status === 'sent', 'EmailSent + unpaid + not due ⇒ sent (awaiting payment)');
ok(r.days_overdue === 0, 'not past due ⇒ days_overdue 0');

// (5) sent flag mirrors EmailStatus
ok(classify({ Id:'6', Balance:10, TotalAmt:10, EmailStatus:'EmailSent' }, now).sent === true, 'EmailSent ⇒ sent true');
ok(classify({ Id:'7', Balance:10, TotalAmt:10, EmailStatus:'NeedToSend' }, now).sent === false, 'NeedToSend ⇒ sent false');

console.log('ar-invoices: ' + n + ' assertions passed');
