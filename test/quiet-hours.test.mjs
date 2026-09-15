// Quiet hours (Sep 14 2026): hold any automatic SMS that would fire after 7pm ET until 9am ET
// the next day. No timezone library available, so nyOffsetMinutes/etHour/nextQuietHoursEnd
// derive the real America/New_York offset from Intl.DateTimeFormat directly — this test
// exists specifically to prove that's actually DST-correct (not just correct on the one date
// someone happened to test it), using real UTC timestamps that fall in both EDT and EST.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const { isQuietHoursNow, nextQuietHoursEnd, etHour } = new Function(
  'const QUIET_HOURS_START_ET = 19, QUIET_HOURS_END_ET = 9;\n' +
  grab('nyOffsetMinutes') + '\n' + grab('etHour') + '\n' +
  grab('isQuietHoursNow') + '\n' + grab('nextQuietHoursEnd') +
  '\nreturn { isQuietHoursNow, nextQuietHoursEnd, etHour };'
)();

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// July 14 2026 is EDT (UTC-4). 17:00 UTC = 1:00pm ET, well inside business hours.
{
  const d = new Date('2026-07-14T17:00:00Z');
  ok(etHour(d) === 13, 'EDT: 17:00 UTC reads as 1pm (13:00) Eastern');
  ok(!isQuietHoursNow(d), 'EDT: 1pm Eastern is not quiet hours');
}
// 23:30 UTC in July = 7:30pm EDT -> quiet hours (past the 7pm start).
{
  const d = new Date('2026-07-14T23:30:00Z');
  ok(etHour(d) === 19, 'EDT: 23:30 UTC reads as 7pm (19:00) Eastern');
  ok(isQuietHoursNow(d), 'EDT: 7:30pm Eastern is quiet hours');
}
// Exactly 7:00pm ET (23:00 UTC in EDT) — boundary is inclusive on the start side.
{
  const d = new Date('2026-07-14T23:00:00Z');
  ok(isQuietHoursNow(d), 'EDT: exactly 7:00pm Eastern counts as quiet hours (inclusive boundary)');
}
// Exactly 9:00am ET (13:00 UTC in EDT) — boundary is NOT quiet (quiet hours have ended).
{
  const d = new Date('2026-07-14T13:00:00Z');
  ok(!isQuietHoursNow(d), 'EDT: exactly 9:00am Eastern is NOT quiet hours — the hold has ended');
}
// January 14 2026 is EST (UTC-5). 14:00 UTC = 9:00am ET exactly.
{
  const d = new Date('2026-01-14T14:00:00Z');
  ok(etHour(d) === 9, 'EST: 14:00 UTC reads as 9am Eastern');
  ok(!isQuietHoursNow(d), 'EST: exactly 9:00am Eastern is not quiet hours');
}
// EST, 2:00am ET (07:00 UTC) — early-morning tail of quiet hours.
{
  const d = new Date('2026-01-14T07:00:00Z');
  ok(isQuietHoursNow(d), 'EST: 2am Eastern is quiet hours (before the 9am end)');
}

// ---- nextQuietHoursEnd: evening case rolls to TOMORROW 9am ----
{
  // 2026-07-14 10:00pm EDT (July 15 02:00 UTC) -> next 9am should be July 15, 9am EDT (13:00 UTC).
  const d = new Date('2026-07-15T02:00:00Z');
  const next = nextQuietHoursEnd(d);
  ok(next.toISOString() === '2026-07-15T13:00:00.000Z', 'EDT evening: next 9am ET rolls to the FOLLOWING calendar day, at 13:00 UTC (9am EDT)');
}
// ---- nextQuietHoursEnd: early-morning case stays TODAY ----
{
  // 2026-01-14 3:00am EST (08:00 UTC) -> next 9am should be the SAME day, 9am EST (14:00 UTC).
  const d = new Date('2026-01-14T08:00:00Z');
  const next = nextQuietHoursEnd(d);
  ok(next.toISOString() === '2026-01-14T14:00:00.000Z', 'EST early-morning: next 9am ET stays the SAME calendar day, at 14:00 UTC (9am EST)');
}
// ---- nextQuietHoursEnd across a month boundary ----
{
  // 2026-01-31 11:00pm EST (Feb 1 04:00 UTC) -> next 9am should be Feb 1, 9am EST (14:00 UTC).
  const d = new Date('2026-02-01T04:00:00Z');
  const next = nextQuietHoursEnd(d);
  ok(next.toISOString() === '2026-02-01T14:00:00.000Z', 'rolling into a new month computes the correct next-day date, not just +1 on the day number');
}

console.log(`quiet-hours: ${n}/${n} passing`);
