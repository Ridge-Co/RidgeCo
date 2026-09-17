// B-20260916-1930-k7: vendor invoice confirmation email — pure date/holiday helpers.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
function grab(name){
  let i = src.indexOf('function '+name+'(');
  if(i<0) throw new Error('missing '+name);
  let d=0,j=src.indexOf(')',i); j=src.indexOf('{',j);
  for(;j<src.length;j++){ if(src[j]==='{')d++; else if(src[j]==='}'){d--; if(!d)break;} }
  return src.slice(i, j+1);
}
const { parseHolidayMap, nextBusinessDay, vendorPaymentWindow } = new Function(
  grab('parseHolidayMap') + '\n' + grab('nextBusinessDay') + '\n' + grab('vendorPaymentWindow') +
  '\nreturn { parseHolidayMap, nextBusinessDay, vendorPaymentWindow };')();

let pass=0,fail=0;
const t=(n,c,got)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n, got!==undefined?('got '+JSON.stringify(got)):'');} };

// ── parseHolidayMap ──────────────────────────────────────────
const H2026 = '2026-01-01:New Year\'s Day,2026-01-19:Martin Luther King Jr. Day,2026-02-16:Washington\'s Birthday,2026-05-25:Memorial Day,2026-06-19:Juneteenth,2026-07-04:Independence Day,2026-09-07:Labor Day,2026-10-12:Columbus Day,2026-11-11:Veterans Day,2026-11-26:Thanksgiving Day,2026-12-25:Christmas Day';
const hmap = parseHolidayMap(H2026);
t('parses every well-formed entry', hmap.size === 11, hmap.size);
t('looks up a specific date correctly', hmap.get('2026-09-07') === 'Labor Day');
t('ignores a malformed entry (no colon)', parseHolidayMap('2026-01-01').size === 0);
t('ignores a bad date shape', parseHolidayMap('01-01-2026:New Year').size === 0);
t('empty/undefined input yields an empty map', parseHolidayMap('').size === 0 && parseHolidayMap(undefined).size === 0);

// ── nextBusinessDay ───────────────────────────────────────────
t('a plain Tuesday submission clocks in Wednesday',
  nextBusinessDay('2026-09-15', hmap).date === '2026-09-16', nextBusinessDay('2026-09-15', hmap));
// (Sep 4 2026 is a Friday; Sep 5/6 are Sat/Sun; Sep 7 2026 IS Labor Day per the map above —
// so the real next business day is Tuesday Sep 8, and Labor Day should show up as skipped.)
const fri = nextBusinessDay('2026-09-04', hmap);
t('Friday-before-Labor-Day lands on the Tuesday after', fri.date === '2026-09-08', fri);
t('and reports the holiday it skipped (not the weekend)',
  fri.skippedHolidays.length === 1 && fri.skippedHolidays[0].name === 'Labor Day', fri.skippedHolidays);

t('a plain weekend-only skip reports no named holiday',
  nextBusinessDay('2026-09-11', hmap).skippedHolidays.length === 0, nextBusinessDay('2026-09-11', hmap));
// Sep 11 2026 is a Friday with no holiday nearby -> next business day is Sep 14 (Monday).
t('and still lands on the correct following Monday',
  nextBusinessDay('2026-09-11', hmap).date === '2026-09-14');

t('a holiday landing on an ordinary weekday still gets skipped',
  nextBusinessDay('2026-06-18', hmap).date === '2026-06-22', nextBusinessDay('2026-06-18', hmap));
// Jun 18 2026 (Thu) -> Jun 19 is Juneteenth (Fri) -> skip to Sat/Sun -> Mon Jun 22.
t('and names the right holiday',
  nextBusinessDay('2026-06-18', hmap).skippedHolidays.some(h => h.name === 'Juneteenth'));

t('a malformed date input fails safe rather than throwing',
  nextBusinessDay('not-a-date', hmap).date === '');
t('a missing holiday map still works (weekends only)',
  nextBusinessDay('2026-09-04', undefined).date === '2026-09-07');

// ── vendorPaymentWindow ───────────────────────────────────────
const winPlain = vendorPaymentWindow('2026-09-15', hmap); // Tuesday, no holiday involved
t('plain case: clock starts the next day', winPlain.clock_start === '2026-09-16', winPlain);
t('plain case: due 14 calendar days after clock start', winPlain.due_date === '2026-09-30', winPlain);
t('plain case: nothing to explain', winPlain.skipped_holidays.length === 0);

const winHoliday = vendorPaymentWindow('2026-09-04', hmap); // Friday before Labor Day
t('holiday case: clock starts the Tuesday after Labor Day', winHoliday.clock_start === '2026-09-08', winHoliday);
t('holiday case: due date is 14 days from THAT start, not the submission date',
  winHoliday.due_date === '2026-09-22', winHoliday);
t('holiday case: the holiday is reported so the email can explain the shift',
  winHoliday.skipped_holidays.length === 1 && winHoliday.skipped_holidays[0].name === 'Labor Day');

t('a bad submission date yields no window at all (fail safe, no bad guess)',
  vendorPaymentWindow('garbage', hmap) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
