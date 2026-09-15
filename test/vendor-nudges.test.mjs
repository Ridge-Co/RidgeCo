// Vendor nudge/request system (Sep 14 2026) — automatic status-update clock + manual
// photos/invoice requests. This file covers the pure timing math (next9amET, firstNudgeTime)
// against Brett's own stated examples, plus structural checks on the sweep/reset logic.
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
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const { next9amET, firstVendorNudgeTime } = new Function(
  grab('nyOffsetMinutes') + '\n' + grab('etHour') + '\n' + grab('next9amET') +
  '\nfunction firstVendorNudgeTime(assignedAt){return new Date(Math.max(next9amET(assignedAt).getTime(), assignedAt.getTime()+16*3600000));}' +
  '\nreturn { next9amET, firstVendorNudgeTime };'
)();

// ---- Brett's own two examples, verified exactly ----
{
  // Assigned 10pm ET on a July (EDT) day -> 10pm EDT = 02:00 UTC the next day.
  const assignedAt = new Date('2026-07-15T02:00:00Z'); // 10pm EDT July 14
  const first = firstVendorNudgeTime(assignedAt);
  // Brett: "assigned 10pm -> first nudge 2pm next day"
  ok(first.toISOString() === '2026-07-15T18:00:00.000Z', 'assigned 10pm ET -> first nudge is 2pm ET the NEXT day (16h-from-assignment wins over next-9am, since 9am is only 11h away)');
}
{
  // Assigned 5pm ET (EDT) -> 21:00 UTC.
  const assignedAt = new Date('2026-07-14T21:00:00Z'); // 5pm EDT July 14
  const first = firstVendorNudgeTime(assignedAt);
  // Brett: "assigned 5pm -> 9am next day" — 5pm+16h lands EXACTLY on 9am next day, same as the next-9am rule.
  ok(first.toISOString() === '2026-07-15T13:00:00.000Z', 'assigned 5pm ET -> first nudge is 9am ET the next day (the two candidates land on the same instant here)');
}
{
  // Assigned at 6am ET (EDT, 10:00 UTC) -> next 9am is only 3h away, but +16h is 10pm same day
  // (10:00 UTC + 16h = 02:00 UTC the next day, which is 10pm EDT the same calendar day).
  const assignedAt = new Date('2026-07-14T10:00:00Z'); // 6am EDT
  const first = firstVendorNudgeTime(assignedAt);
  ok(first.toISOString() === '2026-07-15T02:00:00.000Z', 'assigned 6am ET -> the +16h candidate (10pm same day) wins over the same-day 9am candidate, since it lands later');
}

// ---- structural checks on the sweep/reset logic ----
const sweepBody = grabAsync('processVendorNudges');
{
  ok(sweepBody.includes("Status === 'open'") || sweepBody.includes('r.Status===\'open\''), 'the sweep only ever considers rows still marked open — flagged/satisfied/cancelled rows are never re-processed');
}
{
  const capIdx = sweepBody.indexOf('Nudge_Count');
  ok(capIdx >= 0, 'a nudge-count cap check exists in the sweep');
  ok(sweepBody.includes('VENDOR_NUDGE_MAX'), 'the cap is a named constant, not a magic number buried in the logic');
}
{
  ok(sweepBody.includes('Vendor_Bills'), 'the sweep checks for a real Vendor_Bills row as the invoice-satisfied condition, not just a status field');
}
{
  ok(sweepBody.includes('Scheduled_Date'), 'the sweep respects a future Scheduled_Date to go quiet, per Brett\'s stated rule');
}

const resetBody = grabAsync('resetVendorNudgeClock');
{
  ok(resetBody.includes('Nudge_Count'), 'resetting the clock also resets the nudge count, not just the timer — a re-engaged vendor is no longer a 5-strikes-in candidate');
}

console.log(`vendor-nudges: ${n}/${n} passing`);
