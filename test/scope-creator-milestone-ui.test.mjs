// scope-creator.html Payment Schedule editor — per-milestone "Pay vendor at this milestone" checkbox
// and "Customer: % of total | flat $" toggle (Sep 28 2026, FEATURE_LOG rule 199). Extracts the REAL
// shipped editor functions out of scope-creator.html and runs them against a stub DOM, so this tests
// the actual code, not a copy. Server-side rules for the same fields live in
// test/vendor-pay-rollover.test.mjs.
import fs from 'fs';
import assert from 'node:assert';
const html = fs.readFileSync(new URL('../scope-creator.html', import.meta.url), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = html.indexOf('{', html.indexOf(')', i));
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1);
}
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const dom = { 'schedule-rows': { innerHTML: '' } };
const status = {};
const scheduleState = { milestones: [], maxUpfrontPct: 33.34 };
const factory = new Function('document', 'scheduleState', 'setStatus', 'esc',
  grab('addScheduleRow') + '\n' + grab('rebalanceSchedule') + '\n' + grab('updateScheduleField') + '\n' + grab('renderSchedule') + '\n' + grab('renderScheduleTotal') +
  '\nreturn { addScheduleRow, updateScheduleField, renderSchedule };');
const api = factory({ getElementById: id => dom[id] }, scheduleState, (id, msg, cls) => { status[id] = { msg, cls }; }, s => String(s));

// new rows default to today's exact behavior
api.addScheduleRow();
let m = scheduleState.milestones[0];
ok(m.vendor_paid === true && m.calc_mode === 'percent' && m.flat_customer_amount === null, 'a new row is vendor-paid, percent mode, no flat amount');
ok(/checked/.test(dom['schedule-rows'].innerHTML), 'the Pay-vendor checkbox renders checked by default');
ok(!/Customer: flat \$<\/option>.*selected/.test(dom['schedule-rows'].innerHTML) && !/placeholder="Amount"/.test(dom['schedule-rows'].innerHTML), 'no flat $ box in percent mode');

// unchecking vendor pay
api.updateScheduleField(0, 'vendor_paid', false);
ok(m.vendor_paid === false, 'unchecking sets vendor_paid:false on that milestone only');
api.addScheduleRow();
ok(scheduleState.milestones[1].vendor_paid === true, 'a second row is unaffected');
api.renderSchedule();
ok(/rolls to the next vendor-paid milestone/.test(dom['schedule-rows'].innerHTML), 'an unpaid-vendor row shows the roll-forward hint');

// flat mode
api.updateScheduleField(1, 'calc_mode', 'flat');
ok(scheduleState.milestones[1].calc_mode === 'flat' && scheduleState.milestones[1].flat_customer_amount === 0, 'switching to flat seeds a 0 amount');
ok(/placeholder="Amount"/.test(dom['schedule-rows'].innerHTML), 'flat mode renders the $ input');
api.updateScheduleField(1, 'flat_customer_amount', '1250.5');
ok(scheduleState.milestones[1].flat_customer_amount === 1250.5, 'typed flat amount is stored as a number');
api.updateScheduleField(1, 'flat_customer_amount', '');
ok(scheduleState.milestones[1].flat_customer_amount === null, 'a cleared amount becomes null (server will reject it clearly rather than bill $0)');
api.updateScheduleField(1, 'calc_mode', 'percent');
ok(scheduleState.milestones[1].calc_mode === 'percent' && scheduleState.milestones[1].flat_customer_amount === null, 'back to percent clears the flat amount');

// existing fields still behave
api.updateScheduleField(0, 'percent', '40');
api.updateScheduleField(0, 'label', 'Deposit');
ok(scheduleState.milestones[0].percent === 40 && scheduleState.milestones[0].label === 'Deposit', 'percent and label edits are unchanged');

// ---- cascade (Oct 27 2026): what you type is held; the NEXT untouched row absorbs; total forced to 100 ----
{
  const live = (arr) => { scheduleState.milestones = arr.map((p, i) => ({ label: 'm' + i, percent: p, trigger: i === arr.length - 1 ? 'completion' : 'manual', vendor_paid: true, calc_mode: 'percent', flat_customer_amount: null })); scheduleState.note = ''; };
  const pcts = () => scheduleState.milestones.map(x => x.percent);
  const sum = () => +pcts().reduce((a, b) => a + b, 0).toFixed(2);
  const typeIn = (i, v) => api.updateScheduleField(i, 'percent', String(v));

  live([33.34, 66.66]); typeIn(0, 40);
  ok(pcts()[0] === 40 && pcts()[1] === 60, "40% upfront makes the final 60%");
  live([33.34, 66.66]); typeIn(1, 70);
  ok(pcts()[1] === 70 && pcts()[0] === 30, 'editing the LAST row pushes the difference up to the row above');

  // Brett's case: add a milestone, deposit and final must not move
  live([33.34, 66.66]);
  scheduleState.milestones[0].trigger = 'upfront';
  api.addScheduleRow();
  ok(scheduleState.milestones.length === 3 && scheduleState.milestones[2].trigger === 'completion', 'a new milestone goes in BEFORE the Final row');
  ok(pcts()[0] === 33.34 && pcts()[1] === 0 && pcts()[2] === 66.66 && sum() === 100, 'adding a milestone changes nothing already set and the total is still 100');
  typeIn(1, 30);
  ok(pcts()[0] === 33.34 && pcts()[1] === 30 && pcts()[2] === 36.66 && sum() === 100, 'typing the new milestone takes from the NEXT row (Final), deposit untouched');
  typeIn(2, 50);
  ok(pcts()[2] === 50 && pcts()[0] === 33.34 && pcts()[1] === 16.66 && sum() === 100, 'typing Final: the row above gives/takes; the deposit you set is held');

  // everything is held -> neighbour below is forced to 100
  live([30, 30, 40]); scheduleState.milestones.forEach(m => { m.locked = true; });
  typeIn(0, 20);
  ok(sum() === 100 && pcts()[0] === 20 && pcts()[1] === 40 && pcts()[2] === 40, 'all rows set: editing row 1 forces the next row to keep 100 (and says so)');
  ok(/adjusted to keep 100%/.test(scheduleState.note), 'the screen says which row was adjusted');
  typeIn(2, 30);
  ok(sum() === 100 && pcts()[2] === 30 && pcts()[0] === 20 && pcts()[1] === 50, 'editing the LAST row when all are set adjusts the one above it');

  // deposit edit with a middle row: next row down takes it, final held
  live([33.34, 0, 66.66]); typeIn(0, 25);
  ok(pcts()[0] === 25 && pcts()[1] === 8.34 && pcts()[2] === 66.66, 'deposit change goes to the NEXT part (milestone), Final held');

  // typing path independence: 5 -> 50 -> 500 -> 50
  live([33.34, 0, 66.66]); typeIn(1, 5); typeIn(1, 50); typeIn(1, 500); typeIn(1, 50);
  ok(sum() === 100 && pcts()[1] === 50 && pcts()[0] === 33.34 && pcts()[2] === 16.66, 'typing through an absurd number and back lands on the same answer as typing 50 directly');

  // over 100 is surfaced, not hidden
  live([50, 50]); typeIn(0, 120);
  ok(pcts()[0] === 120 && pcts()[1] === 0, 'over 100: the other row drops to 0 and the 120 stays visible so the total warning fires');
  live([50, 50]); typeIn(0, '');
  ok(pcts()[0] === 0 && pcts()[1] === 100, 'clearing the box (mid-typing) is safe');
  live([100]); typeIn(0, 60);
  ok(pcts()[0] === 60, 'a single milestone has nothing to balance against and is left as typed');
  live([33.33, 33.33, 33.34]); typeIn(1, 33.33);
  ok(sum() === 100, 'rounding never leaves the total off 100');

  // removing a row keeps 100 by handing its share to the next row
  live([30, 20, 50]);
  const rf = new Function('scheduleState', 'renderSchedule', grab('removeScheduleRow') + '\nreturn removeScheduleRow;')(scheduleState, () => {});
  rf(1);
  ok(pcts().length === 2 && pcts()[0] === 30 && pcts()[1] === 70, 'removing a milestone gives its % to the next one, nothing else moves');
  rf(1);
  ok(pcts().length === 1 && pcts()[0] === 100, 'removing the last of two gives it to the remaining row');
}

console.log(n + ' passed, 0 failed');
