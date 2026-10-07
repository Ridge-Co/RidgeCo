// Inspection booking (Oct 7 2026) — pure engine coverage, run against the live worker source.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const') { const j = src.indexOf(';', i); return src.slice(i, j + 1); }
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const consts = ['INSP_TZ', 'INSP_STEP_MIN', 'INSP_HORIZON_DAYS', 'INSP_MIN_NOTICE_MIN', 'INSP_DEFAULT_BUFFER_MIN', 'INSP_PARK_MIN', 'INSP_DRIVE_FACTOR'].map(n => grab(n, 'const')).join('\n');
const fns = ['nyOffsetMinutes', 'inspDurationMin', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspEtDow', 'inspBlackoutsCover', 'inspEstimateDriveMin', 'inspPadDriveMin', 'inspComputeSlots', 'inspAdjacentDrive', 'inspEventsToBusy'].map(n => grab(n)).join('\n');
const E = new Function(consts + '\n' + fns + '\nreturn { inspDurationMin, inspParseHHMM, inspEtWallToMs, inspEtDate, inspEtMinutes, inspEtDow, inspBlackoutsCover, inspEstimateDriveMin, inspPadDriveMin, inspComputeSlots, inspAdjacentDrive, inspEventsToBusy };')();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };

// ── duration ──
t('1 unit = 40', E.inspDurationMin(1, 1) === 40, E.inspDurationMin(1, 1));
t('2 units (one building) = 75, shorter than the flat 80', E.inspDurationMin(2, 1) === 75, E.inspDurationMin(2, 1));
t('3 units = 110 (~2h, Brett\'s example)', E.inspDurationMin(3, 1) === 110, E.inspDurationMin(3, 1));
t('4 units = 140', E.inspDurationMin(4, 1) === 140, E.inspDurationMin(4, 1));
t('6 units in 2 buildings = 220', E.inspDurationMin(6, 2) === 220, E.inspDurationMin(6, 2));
t('duration is monotonic in units', [1,2,3,4,5,6,8,10,12].every((u, i, a) => i === 0 || E.inspDurationMin(u, 1) > E.inspDurationMin(a[i - 1], 1)));
t('garbage input never goes below the 30 min floor', E.inspDurationMin(0, 0) >= 30 && E.inspDurationMin(-5, 'x') >= 30);
t('buildings cannot exceed units', E.inspDurationMin(2, 9) === E.inspDurationMin(2, 2));

// ── time parsing / ET conversion (EDT in Oct, EST in Dec) ──
t('parse 9:30', E.inspParseHHMM('9:30') === 570);
t('parse 1:15 pm', E.inspParseHHMM('1:15 pm') === 13 * 60 + 15);
t('parse 12:00 AM = 0', E.inspParseHHMM('12:00 AM') === 0);
t('parse 12:00 PM = 720', E.inspParseHHMM('12:00 PM') === 720);
t('parse junk is NaN', Number.isNaN(E.inspParseHHMM('noon')) && Number.isNaN(E.inspParseHHMM('')));
t('Oct 14 10:00 ET = 14:00Z (EDT)', new Date(E.inspEtWallToMs('2026-10-14', '10:00')).toISOString() === '2026-10-14T14:00:00.000Z');
t('Dec 8 10:00 ET = 15:00Z (EST)', new Date(E.inspEtWallToMs('2026-12-08', '10:00')).toISOString() === '2026-12-08T15:00:00.000Z');
t('DST fall-back day Nov 1 2026 09:00 ET = 14:00Z', new Date(E.inspEtWallToMs('2026-11-01', '09:00')).toISOString() === '2026-11-01T14:00:00.000Z');
t('bad date -> NaN', Number.isNaN(E.inspEtWallToMs('nope', '10:00')));
t('round trip date/minutes', (() => { const ms = E.inspEtWallToMs('2026-10-14', '13:45'); return E.inspEtDate(ms) === '2026-10-14' && E.inspEtMinutes(ms) === 13 * 60 + 45; })());
t('dow 2026-10-14 = Wed', E.inspEtDow('2026-10-14') === 'Wed');

// ── blackouts ──
const at = (d, hm) => E.inspEtWallToMs(d, hm);
const day = [{ Type: 'date', Date: '2026-10-14', Date_End: '', Active: 'TRUE' }];
t('date blackout covers the day', E.inspBlackoutsCover(day, at('2026-10-14', '10:00'), at('2026-10-14', '11:00')));
t('date blackout misses other day', !E.inspBlackoutsCover(day, at('2026-10-15', '10:00'), at('2026-10-15', '11:00')));
const range = [{ Type: 'date', Date: '2026-10-14', Date_End: '2026-10-16', Active: 'TRUE' }];
t('range covers middle day', E.inspBlackoutsCover(range, at('2026-10-15', '10:00'), at('2026-10-15', '11:00')));
t('inactive blackout ignored', !E.inspBlackoutsCover([{ Type: 'date', Date: '2026-10-14', Active: 'FALSE' }], at('2026-10-14', '10:00'), at('2026-10-14', '11:00')));
const fri3 = [{ Type: 'weekly', Day_Of_Week: 'Fri', Start_Time: '15:00', End_Time: '', Active: 'TRUE' }];
t('weekly Fri after 3pm blocks 2:30-3:30 slot', E.inspBlackoutsCover(fri3, at('2026-10-16', '14:30'), at('2026-10-16', '15:30')));
t('weekly Fri after 3pm allows 1:00-2:00', !E.inspBlackoutsCover(fri3, at('2026-10-16', '13:00'), at('2026-10-16', '14:00')));
t('weekly Fri does not hit Thursday', !E.inspBlackoutsCover(fri3, at('2026-10-15', '16:00'), at('2026-10-15', '17:00')));
t('annual 12-25', E.inspBlackoutsCover([{ Type: 'annual', Month_Day: '12-25', Active: 'TRUE' }], at('2026-12-25', '10:00'), at('2026-12-25', '11:00')));
t('unreadable time window fails CLOSED', E.inspBlackoutsCover([{ Type: 'date', Date: '2026-10-14', Start_Time: 'garbage', Active: 'TRUE' }], at('2026-10-14', '10:00'), at('2026-10-14', '11:00')));

// ── slot computation ──
const NOW = at('2026-10-07', '08:00');
const blk = [{ Date: '2026-10-14', Start_Time: '10:00', End_Time: '14:00', Active: 'TRUE' }];
const base = { blocks: blk, busy: [], blackouts: [], durationMin: 75, nowMs: NOW };
let s = E.inspComputeSlots(base);
t('empty calendar: first slot at block start', s.length && s[0].startMs === at('2026-10-14', '10:00'));
t('empty calendar: last 75-min slot ends exactly at block end', s[s.length - 1].endMs === at('2026-10-14', '14:00'), new Date(s[s.length - 1].endMs).toISOString());
t('15-minute grid: 4h block, 75 min -> 12 starts', s.length === 12, s.length);
t('a duration longer than the block yields nothing', E.inspComputeSlots({ ...base, durationMin: 300 }).length === 0);
// a calendar event 12:00-13:00 with default 30-min buffer both sides
const ev = [{ startMs: at('2026-10-14', '12:00'), endMs: at('2026-10-14', '13:00'), key: 'e1' }];
s = E.inspComputeSlots({ ...base, busy: ev, durationMin: 60 });
t('event blocks overlap + default buffer', s.every(x => !(x.startMs < at('2026-10-14', '13:30') && x.endMs + 30 * 60000 > at('2026-10-14', '12:00'))));
t('slot ending exactly buffer-before event is allowed', s.some(x => x.endMs === at('2026-10-14', '11:30')));
t('slot starting exactly buffer-after event is allowed? (13:30 + 60 = 14:30 > block end, so none)', !s.some(x => x.startMs === at('2026-10-14', '13:30')));
// real drive time shrinks the buffer to 10 min
s = E.inspComputeSlots({ ...base, busy: ev, durationMin: 60, driveMap: { e1: { from: 10, to: 10 } } });
t('short real drive time reopens the slot before the event (ends 11:50)', s.some(x => x.endMs === at('2026-10-14', '11:45')) && !s.some(x => x.endMs === at('2026-10-14', '11:50')));
// long drive time (45 min) pushes it out
s = E.inspComputeSlots({ ...base, busy: ev, durationMin: 60, driveMap: { e1: { from: 45, to: 45 } } });
t('long drive time: nothing ends after 11:15', s.every(x => x.endMs <= at('2026-10-14', '11:15') || x.startMs >= at('2026-10-14', '13:45')));
// asymmetric: from smaller than to
s = E.inspComputeSlots({ ...base, durationMin: 60, busy: [{ startMs: at('2026-10-14', '10:00'), endMs: at('2026-10-14', '11:00'), key: 'b1' }], driveMap: { b1: { from: 20, to: 5 } } });
t('after a stop, wait the "from" drive time', s[0].startMs === at('2026-10-14', '11:30'), new Date(s[0].startMs).toISOString());
// blackout + notice + horizon
t('blackout removes the whole block', E.inspComputeSlots({ ...base, blackouts: day }).length === 0);
t('min notice: block today starting in 1h offers nothing before notice', E.inspComputeSlots({ ...base, blocks: [{ Date: '2026-10-07', Start_Time: '09:00', End_Time: '12:00' }], durationMin: 40, nowMs: NOW }).every(x => x.startMs >= NOW + 120 * 60000));
t('horizon: block 90 days out is not offered', E.inspComputeSlots({ ...base, blocks: [{ Date: '2027-01-20', Start_Time: '10:00', End_Time: '14:00' }] }).length === 0);
t('inactive block ignored', E.inspComputeSlots({ ...base, blocks: [{ ...blk[0], Active: 'FALSE' }] }).length === 0);
t('malformed block ignored (no throw)', E.inspComputeSlots({ ...base, blocks: [{ Date: 'x', Start_Time: 'y', End_Time: 'z' }] }).length === 0);
t('overlapping blocks do not duplicate starts', E.inspComputeSlots({ ...base, blocks: [blk[0], { Date: '2026-10-14', Start_Time: '11:00', End_Time: '15:00' }] }).filter(x => x.startMs === at('2026-10-14', '11:00')).length === 1);

// ── adjacent drive (approval card) ──
const busy2 = [{ startMs: at('2026-10-14', '09:00'), endMs: at('2026-10-14', '10:00'), key: 'b1', title: 'A' }, { startMs: at('2026-10-14', '13:00'), endMs: at('2026-10-14', '14:00'), key: 'b2', title: 'B' }];
const adj = E.inspAdjacentDrive(busy2, { b1: { from: 12, to: 14 }, b2: { from: 9, to: 21 } }, at('2026-10-14', '10:30'), at('2026-10-14', '11:45'));
t('adjacent: previous stop + from-minutes', adj.before && adj.before.key === 'b1' && adj.before.min === 12);
t('adjacent: next stop + to-minutes', adj.after && adj.after.key === 'b2' && adj.after.min === 21);
t('adjacent: none -> null', E.inspAdjacentDrive([], {}, 1, 2).before === null);

// ── calendar events -> busy ──
const items = [
  { id: 'a', summary: 'Dentist', start: { dateTime: '2026-10-14T15:00:00-04:00' }, end: { dateTime: '2026-10-14T16:00:00-04:00' }, location: '1 Main St' },
  { id: 'b', summary: 'Free thing', start: { dateTime: '2026-10-14T15:00:00-04:00' }, end: { dateTime: '2026-10-14T16:00:00-04:00' }, transparency: 'transparent' },
  { id: 'c', summary: 'Cancelled', status: 'cancelled', start: { dateTime: '2026-10-14T15:00:00-04:00' }, end: { dateTime: '2026-10-14T16:00:00-04:00' } },
  { id: 'd', summary: 'Declined', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-10-14T15:00:00-04:00' }, end: { dateTime: '2026-10-14T16:00:00-04:00' } },
  { id: 'e', summary: 'Ours', extendedProperties: { private: { ridgecoInspBooking: '7' } }, start: { dateTime: '2026-10-14T15:00:00-04:00' }, end: { dateTime: '2026-10-14T16:00:00-04:00' } },
  { id: 'f', summary: 'All-day busy', start: { date: '2026-10-15' }, end: { date: '2026-10-16' } },
  { id: 'g', summary: 'bad' },
];
const bz = E.inspEventsToBusy(items);
t('events->busy keeps only real busy events (dentist + all-day)', bz.length === 2 && bz[0].key === 'ea' && bz[1].key === 'ef', bz.map(x => x.key));
t('events->busy carries location', bz[0].location === '1 Main St');
t('all-day event spans the ET day', bz[1].endMs - bz[1].startMs === 86400000);

// ── drive padding / estimate ──
t('pad: 600s drive = ceil(10*1.25)+5 = 18', E.inspPadDriveMin(600) === 18, E.inspPadDriveMin(600));
t('estimate has a 10 minute floor', E.inspEstimateDriveMin(39.3, -76.6, 39.3, -76.6) === 10);
t('estimate grows with distance', E.inspEstimateDriveMin(39.3, -76.6, 39.4, -76.6) > E.inspEstimateDriveMin(39.3, -76.6, 39.31, -76.6));

// ── wiring (source checks) ──
const has = re => re.test(src);
t('public paths registered', has(/'\/insp-book\/info','\/insp-book\/slots','\/insp-book\/request','\/insp-book\/status','\/insp-book\/cancel','\/insp-book\/approval','\/insp-book\/decide'/));
t('router has every public route', ['info', 'status', 'approval'].every(p => has(new RegExp("path === '/insp-book/" + p + "'"))) && ['slots', 'request', 'cancel', 'decide'].every(p => has(new RegExp("path === '/insp-book/" + p + "'"))));
t('INSP_TABS includes the new tabs', has(/Insp_Open_Blocks: INSP_OPEN_BLOCK_HEADERS,\s*\n\s*Insp_Bookings: INSP_BOOKING_HEADERS/));
t('header consts are defined BEFORE INSP_TABS (no TDZ crash at load)', src.indexOf('const INSP_OPEN_BLOCK_HEADERS') < src.indexOf('const INSP_TABS ='));
t('customers carry Book_Token', has(/INSP_CUSTOMER_HEADERS = \[[^\]]*'Book_Token'\]/));
t('calendar read failure aborts availability (no silent empty list)', has(/calendar_unavailable', 'Scheduling is temporarily unavailable/));
t('test-token guard covers insp admin writes', has(/path === '\/insp\/open-block\/add'\) return !!\(body && body\.Customer_ID/));
t('BUILD_VERSION bumped', has(/BUILD_VERSION = '\d{4}-\d{2}-\d{2}\.\d+-[a-z0-9-]+'/));
t('no bare request.json in new block', !/INSPECTION BOOKING[\s\S]*await request\.json\(\)/.test(src));

console.log(`insp-booking: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
