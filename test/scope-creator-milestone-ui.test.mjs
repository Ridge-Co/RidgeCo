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
  grab('addScheduleRow') + '\n' + grab('updateScheduleField') + '\n' + grab('renderSchedule') + '\n' + grab('renderScheduleTotal') +
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

console.log(n + ' passed, 0 failed');
