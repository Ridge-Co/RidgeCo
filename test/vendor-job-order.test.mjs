// Order of a job in the vendor portal and the Hub (Nov 17 2026): Complete before billing, what a bill needs, On Hold with a reason and a return date.
// Behaviour of the pure helpers is tested directly; the page wiring is pinned by source checks so a refactor cannot quietly drop a rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => fs.readFileSync(new URL(p, root), 'utf8');
const JobOrder = new Function(read('vendor-job-order.js') + '\nreturn JobOrder;')();
const vendor = read('vendor.html'), hub = read('index.html');

test('On Hold needs a reason and a real return date that is not in the past', () => {
  const today = '2026-11-17';
  assert.deepEqual(JobOrder.checkHold({ code: '', back: '2026-11-20' }, today).errors, ['reason']);
  assert.deepEqual(JobOrder.checkHold({ code: 'part', back: '' }, today).errors, ['date']);
  assert.deepEqual(JobOrder.checkHold({ code: 'part', back: '2026-02-30' }, today).errors, ['date']);
  assert.deepEqual(JobOrder.checkHold({ code: 'part', back: '2026-11-16' }, today).errors, ['past']);
  assert.deepEqual(JobOrder.checkHold({ code: 'other', detail: ' ', back: '2026-11-20' }, today).errors, ['other']);
  assert.equal(JobOrder.checkHold({ code: 'other', detail: 'Owner is away', back: '2026-11-17' }, today).ok, true, 'today is allowed');
  assert.equal(JobOrder.checkHold({ code: 'part', back: '2026-11-24' }, today).ok, true);
});

test('the saved hold text is plain English and carries the return date the Hub parses', () => {
  const s = JobOrder.holdText({ code: 'part', detail: '  3/4 inch   valve ', back: '2026-11-24' });
  assert.equal(s, 'Waiting on a part or material — 3/4 inch valve — expected back 2026-11-24');
  assert.equal(/expected back (\d{4}-\d{2}-\d{2})/.exec(s)[1], '2026-11-24');
  assert.equal(JobOrder.holdText({ code: 'approval', back: '2026-12-01' }), 'Waiting for approval from Ridge Co or the owner — expected back 2026-12-01');
});

test('date helper crosses month and year ends', () => {
  assert.equal(JobOrder.addDays('2026-11-29', 3), '2026-12-02');
  assert.equal(JobOrder.addDays('2026-12-30', 7), '2027-01-06');
  assert.equal(JobOrder.addDays('nonsense', 1), '');
});

test('what a bill still needs: complete job, an after photo, a real description, an image for every reimbursed receipt', () => {
  const keys = (s) => JobOrder.missingForBill(s).map((m) => m.key + (m.n ? ':' + m.n : ''));
  const ok = { jobDone: true, afterPhotos: 2, description: 'Replaced the kitchen faucet cartridge and tested for leaks', receipts: [] };
  assert.deepEqual(keys(ok), []);
  assert.deepEqual(keys({ ...ok, jobDone: false }), ['complete']);
  assert.deepEqual(keys({ ...ok, afterPhotos: 0 }), ['after']);
  assert.deepEqual(keys({ ...ok, afterPhotos: null }), [], 'a photo count we could not read never blocks pay');
  assert.deepEqual(keys({ ...ok, description: '  ok ' }), ['desc']);
  assert.deepEqual(keys({ ...ok, description: '' }), ['desc']);
  assert.deepEqual(keys({ ...ok, receipts: [{ n: 1, amount: 20, pay: 'reimburse', hasImage: false }, { n: 2, amount: 9, pay: 'reimburse', hasImage: true }, { n: 3, amount: 30, pay: 'account', hasImage: false }, { n: 4, amount: 0, pay: 'reimburse', hasImage: false }] }), ['receipt:1'], 'only reimbursed lines with an amount need the image');
  assert.deepEqual(keys({ jobDone: false, afterPhotos: 0, description: '', receipts: [{ n: 1, amount: 5, pay: 'reimburse', hasImage: false }] }), ['complete', 'after', 'desc', 'receipt:1']);
});

test('vendor portal wiring: complete-first gate, red panel, submit gate, hold picker, nudge', () => {
  assert.match(vendor, /<script src="wo-status\.js"><\/script>/, 'loads the status list (isDone fails open if it is missing)');
  assert.match(vendor, /<script src="vendor-job-order\.js"><\/script>/);
  assert.match(vendor, /id="bill-needs-panel"/, 'bold red panel sits at the top of the bill window');
  assert.match(vendor, /JobOrder\.billNeedsComplete\(woId\)[\s\S]{0,120}JobOrder\.askComplete\(woId, vendorName\)/, 'billing opened early asks "Is the job finished?"');
  assert.match(vendor, /JobOrder\.billMissing\(\)/, 'submit is stopped while the red list is not empty');
  assert.match(vendor, /JobOrder\.openHold\(woId, idx\)/, 'On Hold goes through the reason + return-date picker');
  assert.match(vendor, /JobOrder\.nudgeInvoice\(woId\)/, 'after Complete the vendor is asked to send the invoice now');
  assert.match(vendor, /JobOrder\.cardNeeds\(woId, idx\)/, 'a Complete job with no invoice says so on the card');
  assert.match(vendor, /JobOrder\.setAfter\(woId,/, 'the photo list keeps the after-photo count current');
  assert.match(vendor, /oninput="JobOrder\.refreshBillPanel\(\)"/, 'typing the description updates the red list');
});

test('Hub wiring: hold picker with reason + return date replaces the typed prompt, overdue holds show in red, bills follow the same order', () => {
  assert.doesNotMatch(hub, /prompt\('Reason for putting this work order on hold:'\)/, 'single hold no longer a bare prompt');
  assert.doesNotMatch(hub, /prompt\('Reason for putting these '/, 'bulk hold no longer a bare prompt');
  assert.match(hub, /function hubHoldDialog\(/);
  assert.match(hub, /expected back \(\\d\{4\}-\\d\{2\}-\\d\{2\}\)/, 'the Hub reads the return date out of Hold_Reason');
  assert.match(hub, /function hubBillNeeds\(/, 'bill entry lists what is missing');
});
