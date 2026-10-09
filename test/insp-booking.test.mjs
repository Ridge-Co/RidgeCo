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
const consts = ['INSP_TZ', 'INSP_STEP_MIN', 'INSP_HORIZON_DAYS', 'INSP_MIN_NOTICE_MIN', 'INSP_DEFAULT_BUFFER_MIN', 'INSP_PARK_MIN', 'INSP_DRIVE_FACTOR', 'INSP_DEFAULT_BOOK_BY_HOURS', 'INSP_PACK_SLACK_MIN'].map(n => grab(n, 'const')).join('\n');
const fns = ['nyOffsetMinutes', 'inspDurationMin', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspEtDow', 'inspBlockExpiryMs', 'inspBlackoutsCover', 'inspEstimateDriveMin', 'inspPadDriveMin', 'inspComputeSlots', 'inspAdjacentDrive', 'inspEventsToBusy', 'inspPackSlackMin', 'inspBlockWindowEndMs'].map(n => grab(n)).join('\n');
const E = new Function(consts + '\n' + fns + '\nreturn { inspBlockExpiryMs, inspDurationMin, inspParseHHMM, inspEtWallToMs, inspEtDate, inspEtMinutes, inspEtDow, inspBlackoutsCover, inspEstimateDriveMin, inspPadDriveMin, inspComputeSlots, inspAdjacentDrive, inspEventsToBusy };')();

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

// ── booking cutoff (expiry) ──
const EXP = (b, h) => E.inspBlockExpiryMs(b, h);
t('default cutoff = 48h before block start', EXP({ Date: '2026-10-13', Start_Time: '10:00' }) === at('2026-10-11', '10:00'));
t('hours field overrides the default', EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By_Hours: '24' }) === at('2026-10-12', '10:00'));
t('hours 0 = open until the block starts', EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By_Hours: '0' }) === at('2026-10-13', '10:00'));
t('exact Book_By wins over hours', EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By_Hours: '24', Book_By: '2026-10-09T17:30' }) === at('2026-10-09', '17:30'));
t('config default hours are honoured', EXP({ Date: '2026-10-13', Start_Time: '10:00' }, 72) === at('2026-10-10', '10:00'));
t('garbage cutoff fails closed (NaN)', Number.isNaN(EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By: 'soon' })) && Number.isNaN(EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By_Hours: '-5' })) && Number.isNaN(EXP({ Date: '2026-10-13', Start_Time: '10:00', Book_By_Hours: 'abc' })));
const wk = [{ Date: '2026-10-13', Start_Time: '10:00', End_Time: '14:00', Active: 'TRUE' }];
t('before the cutoff: slots offered, each carries its expiry', (() => { const r = E.inspComputeSlots({ blocks: wk, busy: [], blackouts: [], durationMin: 75, nowMs: at('2026-10-10', '12:00') }); return r.length > 0 && r.every(x => x.expiresMs === at('2026-10-11', '10:00')); })());
t('after the 48h cutoff: nothing offered', E.inspComputeSlots({ blocks: wk, busy: [], blackouts: [], durationMin: 75, nowMs: at('2026-10-11', '10:01') }).length === 0);
t('exactly at the cutoff: closed', E.inspComputeSlots({ blocks: wk, busy: [], blackouts: [], durationMin: 75, nowMs: at('2026-10-11', '10:00') }).length === 0);
t('block with its own later cutoff stays open', E.inspComputeSlots({ blocks: [{ ...wk[0], Book_By_Hours: '0' }], busy: [], blackouts: [], durationMin: 75, nowMs: at('2026-10-12', '12:00') }).length > 0);
t('unreadable cutoff hides the block', E.inspComputeSlots({ blocks: [{ ...wk[0], Book_By: 'nope' }], busy: [], blackouts: [], durationMin: 75, nowMs: NOW }).length === 0);
t('overlapping blocks keep the LATER cutoff on a shared slot', (() => { const r = E.inspComputeSlots({ blocks: [wk[0], { ...wk[0], Book_By_Hours: '0' }], busy: [], blackouts: [], durationMin: 75, nowMs: at('2026-10-10', '12:00') }); return r.length > 0 && r.every(x => x.expiresMs === at('2026-10-13', '10:00')); })());

// ── key pickup before the first inspection of the day ──
const kb = [{ Date: '2026-10-14', Start_Time: '10:00', End_Time: '16:00', Active: 'TRUE', Book_By_Hours: '0' }];
const kBase = { blocks: kb, busy: [], blackouts: [], durationMin: 75, nowMs: NOW, key: { min: 30, driveMap: {} }, keyFirstByDate: {} };
let ks = E.inspComputeSlots(kBase);
t('key: block opens 10:00 -> first inspection is 10:30, pickup 10:00', ks[0].startMs === at('2026-10-14', '10:30') && ks[0].keyStartMs === at('2026-10-14', '10:00'), ks[0] && new Date(ks[0].startMs).toISOString());
t('key: nothing starts before 10:30', ks.every(x => x.startMs >= at('2026-10-14', '10:30')));
t('key: with no key config the first slot is the block start', E.inspComputeSlots({ ...kBase, key: null })[0].startMs === at('2026-10-14', '10:00'));
// first booking at 11:00 (11:00-12:15) already exists -> later slots need no pickup, earlier ones still can't fit
const first11 = { [ '2026-10-14' ]: at('2026-10-14', '11:00') };
const b11 = [{ startMs: at('2026-10-14', '11:00'), endMs: at('2026-10-14', '12:15'), key: 'b1' }];
ks = E.inspComputeSlots({ ...kBase, busy: b11, driveMap: { b1: { from: 10, to: 10 } }, keyFirstByDate: first11 });
t('key: slot after the first booking needs no pickup', ks.length > 0 && ks.filter(x => x.startMs >= at('2026-10-14', '12:25')).every(x => x.keyStartMs === null));
t('key: nothing fits before an 11:00 first booking (pickup + 75 min cannot)', ks.every(x => x.startMs >= at('2026-10-14', '12:25')), ks.map(x => new Date(x.startMs).toISOString()).slice(0, 3));
// first booking at 14:00; a booking that would become the new first needs its own pickup
const b14 = [{ startMs: at('2026-10-14', '14:00'), endMs: at('2026-10-14', '15:15'), key: 'b2' }];
ks = E.inspComputeSlots({ ...kBase, busy: b14, driveMap: { b2: { from: 10, to: 10 } }, keyFirstByDate: { '2026-10-14': at('2026-10-14', '14:00') } });
const early = ks.find(x => x.startMs === at('2026-10-14', '12:15'));
t('key: slot earlier than the current first booking carries a pickup right before it', early && early.keyStartMs === at('2026-10-14', '11:45'), early);
t('key: 10:30-11:45 (before a 14:00 first booking) is still bookable, with pickup 10:00', (() => { const x = ks.find(y => y.startMs === at('2026-10-14', '10:30')); return x && x.keyStartMs === at('2026-10-14', '10:00'); })());
t('key: slot after the 14:00 booking has no pickup', ks.filter(x => x.startMs >= at('2026-10-14', '15:25')).every(x => x.keyStartMs === null));
// a calendar event 10:00-10:30 blocks the pickup window -> first slot moves later
ks = E.inspComputeSlots({ ...kBase, busy: [{ startMs: at('2026-10-14', '10:00'), endMs: at('2026-10-14', '10:30'), key: 'e1' }], driveMap: { e1: { from: 5, to: 5 } }, key: { min: 30, driveMap: { e1: { from: 10, to: 10 } } } });
t('key: your own calendar event before the first slot pushes it out (pickup needs 10m drive after it)', ks[0].startMs >= at('2026-10-14', '11:10'), new Date(ks[0].startMs).toISOString());
t('key: pickup honours blackouts', E.inspComputeSlots({ ...kBase, blackouts: [{ Type: 'date', Date: '2026-10-14', Start_Time: '10:00', End_Time: '10:40', Active: 'TRUE' }] }).every(x => x.startMs >= at('2026-10-14', '10:45')));
t('key: another day is independent', (() => { const r = E.inspComputeSlots({ ...kBase, blocks: [...kb, { Date: '2026-10-15', Start_Time: '09:00', End_Time: '12:00', Active: 'TRUE', Book_By_Hours: '0' }], keyFirstByDate: first11 }); const d15 = r.filter(x => E.inspEtDate(x.startMs) === '2026-10-15'); return d15[0].startMs === at('2026-10-15', '09:30') && d15[0].keyStartMs === at('2026-10-15', '09:00'); })());

// ── drive padding / estimate ──
t('pad: 600s drive = ceil(10*1.25)+5 = 18', E.inspPadDriveMin(600) === 18, E.inspPadDriveMin(600));
t('estimate has a 10 minute floor', E.inspEstimateDriveMin(39.3, -76.6, 39.3, -76.6) === 10);
t('estimate grows with distance', E.inspEstimateDriveMin(39.3, -76.6, 39.4, -76.6) > E.inspEstimateDriveMin(39.3, -76.6, 39.31, -76.6));

// ── wiring (source checks) ──
const has = re => re.test(src);
t('public paths registered', has(/'\/insp-book\/info','\/insp-book\/slots','\/insp-book\/request','\/insp-book\/status','\/insp-book\/cancel','\/insp-book\/approval','\/insp-book\/decide','\/insp-book\/mine','\/insp-book\/ics'/));
t('router has every public route', ['info', 'status', 'approval'].every(p => has(new RegExp("path === '/insp-book/" + p + "'"))) && ['slots', 'request', 'cancel', 'decide'].every(p => has(new RegExp("path === '/insp-book/" + p + "'"))));
t('INSP_TABS includes the new tabs', has(/Insp_Open_Blocks: INSP_OPEN_BLOCK_HEADERS,\s*\n\s*Insp_Bookings: INSP_BOOKING_HEADERS/));
t('header consts are defined BEFORE INSP_TABS (no TDZ crash at load)', src.indexOf('const INSP_OPEN_BLOCK_HEADERS') < src.indexOf('const INSP_TABS ='));
t('customers carry Book_Token + key pickup fields', has(/INSP_CUSTOMER_HEADERS = \[[^\]]*'Book_Token'[^\]]*'Key_Address','Key_Pickup_Min'\]/));
t('blocks carry the cutoff fields; bookings carry Key_Pickup', has(/INSP_OPEN_BLOCK_HEADERS = \[[^\]]*'Book_By_Hours','Book_By'\]/) && has(/INSP_BOOKING_HEADERS = \[[^\]]*'Key_Pickup'\]/));
t('key-pickup admin route is registered and test-guarded', has(/path === '\/insp\/customer\/key-pickup'\)\s+return await inspCustomerKeyPickup/) && has(/path === '\/insp\/customer\/key-pickup'\) return await isTestRecord/));
t('our key-pickup calendar events never count as busy', has(/private\.ridgecoInspBooking \|\| ev\.extendedProperties\.private\.ridgecoInspKey/));
t('calendar read failure aborts availability (no silent empty list)', has(/calendar_unavailable', 'Scheduling is temporarily unavailable/));
t('test-token guard covers insp admin writes', has(/path === '\/insp\/open-block\/add'\) return !!\(body && body\.Customer_ID/));
t('BUILD_VERSION bumped', has(/BUILD_VERSION = '\d{4}-\d{2}-\d{2}\.\d+-[a-z0-9-]+'/));
t('no bare request.json in new block', !/INSPECTION BOOKING[\s\S]*await request\.json\(\)/.test(src));

// ── partner calendar entries (ICS), invite MIME, My bookings ──
const CAL = new Function(grab('PORTAL_BASE', 'const') + '\n' + ['_utf8B64url', 'inspBookUrl', 'inspIcsEsc', 'inspIcsStamp', 'inspIcsFold', 'inspIcs', 'inspGoogleCalUrl', 'inspB64Wrapped', 'inspBuildInviteMime'].map(n => grab(n)).join('\n') + '\nreturn { inspIcs, inspGoogleCalUrl, inspBuildInviteMime, inspIcsEsc, inspIcsStamp };')();
const bk = { ID: '7', Manage_Token: 'tok_abc-123', Formatted_Address: '100 Main St, Baltimore, MD 21202, USA', Start_ISO: '2026-10-13T16:00:00.000Z', End_ISO: '2026-10-13T16:40:00.000Z', Contact_Name: 'Josiah, "J" Smith' };
const icsP = CAL.inspIcs(bk, 'PUBLISH'), icsR = CAL.inspIcs(bk, 'REQUEST', { organizer: 'ridgecomaintenance@gmail.com', attendee: 'j@x.com' }), icsC = CAL.inspIcs(bk, 'CANCEL', { organizer: 'ridgecomaintenance@gmail.com', attendee: 'j@x.com' });
t('ics: CRLF lines, begins/ends correctly', icsP.startsWith('BEGIN:VCALENDAR\r\n') && icsP.endsWith('END:VCALENDAR\r\n') && !/[^\r]\n/.test(icsP));
t('ics: start/end in UTC', /DTSTART:20261013T160000Z\r\n/.test(icsP) && /DTEND:20261013T164000Z\r\n/.test(icsP));
t('ics: stable UID across invite and cancel (so the cancel removes the same entry)', /UID:insp-7@ridgeco/.test(icsR) && /UID:insp-7@ridgeco/.test(icsC));
t('ics: cancel has higher SEQUENCE and CANCELLED status', /SEQUENCE:0/.test(icsR) && /SEQUENCE:1/.test(icsC) && /STATUS:CANCELLED/.test(icsC) && /METHOD:CANCEL/.test(icsC) && /STATUS:CONFIRMED/.test(icsR));
t('ics: download version has no organizer/attendee, email version does', !/ORGANIZER|ATTENDEE/.test(icsP) && /ORGANIZER;CN=Ridge Co:mailto:ridgecomaintenance@gmail.com/.test(icsR) && /ATTENDEE;CN="Josiah, J Smith"[^\r]*mailto:j@x.com/.test(icsR.replace(/\r\n /g, '')));
t('ics: address commas escaped, location present', /LOCATION:100 Main St\\, Baltimore\\, MD 21202\\, USA/.test(icsP.replace(/\r\n /g, '')));
t('ics: no line longer than 75 chars', icsR.split('\r\n').every(l => l.length <= 75));
t('ics: description carries the manage link', icsP.replace(/\r\n /g, '').includes('m=tok_abc-123'));
t('google calendar url has dates + encoded text', (u => u.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE') && u.includes('dates=20261013T160000Z/20261013T164000Z') && u.includes('text=Inspection%3A%20100%20Main%20St'))(CAL.inspGoogleCalUrl(bk)));
const mime = CAL.inspBuildInviteMime({ from: 'ridgecomaintenance@gmail.com', to: 'j@x.com', subject: 'Inspection confirmed: 100 Main St — café', html: '<p>Confirmed ✓</p>', ics: icsR, method: 'REQUEST' });
const dec = b64 => Buffer.from(b64.replace(/\r\n/g, ''), 'base64').toString('utf8');
const calPart = mime.split('Content-Type: text/calendar; charset="UTF-8"; method=REQUEST\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
const filePart = mime.split('Content-Disposition: attachment; filename="invite.ics"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
const htmlPart = mime.split('Content-Type: text/html; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];
t('mime: inline calendar part decodes back to the ics (method=REQUEST)', dec(calPart) === icsR);
t('mime: attached invite.ics decodes to the same ics', dec(filePart) === icsR);
t('mime: html part decodes (non-ASCII survives)', dec(htmlPart) === '<p>Confirmed ✓</p>');
t('mime: subject is an encoded-word that decodes with non-ASCII intact', dec(/Subject: =\?UTF-8\?B\?([^?]*)\?=/.exec(mime)[1]) === 'Inspection confirmed: 100 Main St — café');
t('mime: multipart boundaries balanced', (m => { const ids = [...mime.matchAll(/boundary="([^"]+)"/g)].map(x => x[1]); return ids.length === 2 && ids.every(id => mime.includes('--' + id + '--')); })());
t('mime: no bare LF', !/[^\r]\n/.test(mime));
t('partner notify: requested kind + invite on approve + cancel only after approved', has(/kind === 'requested' \? `Request received/) && has(/icsMethod = kind === 'approved' \? 'REQUEST' : \(kind === 'cancelled' && prevStatus === 'approved' \? 'CANCEL' : ''\)/));
t('partner is told when the request lands (before Notify_Log write)', has(/inspNotifyPartner\(env, rec, 'requested'\)/));
t('ics-send failure falls back to the plain email and still logs', has(/partner email invite FAILED \(' \+ e\.message \+ '\) — sending without the calendar file/));
t('staging never sends real invite mail', /async function inspSendPartnerEmail[\s\S]{0,400}isStaging\(env\)\) \{ const r = await gmailSendEmail/.test(src));
t('mine + ics are routed GETs and token-checked', has(/path === '\/insp-book\/mine'\)\s+return await inspBookMine/) && has(/path === '\/insp-book\/ics'\)\s+return await inspBookIcs/) && /async function inspBookMine[\s\S]{0,300}inspCustomerByToken/.test(src) && /async function inspBookIcs[\s\S]{0,300}inspBookingByManage/.test(src));
t('ics download only for approved bookings', /async function inspBookIcs[\s\S]{0,500}b\.Status !== 'approved'\) return json\(\{ ok: false, error: 'not_approved'/.test(src));
t('mine lists only that customer\'s active upcoming bookings', /async function inspBookMine[\s\S]{0,900}String\(r\.Customer_ID\) === String\(c\.ID\)[\s\S]{0,200}INSP_ACTIVE_BOOKING\.includes\(r\.Status\)[\s\S]{0,120}Date\.parse\(r\.End_ISO\) > now/.test(src));
t('finish-booking remembers the previous status for the cancel invite', has(/prevStatus = b\.Status/) && has(/inspNotifyPartner\(env, b, kind, prevStatus\)/));
const html = fs.readFileSync('inspect-book.html', 'utf8');
t('page: My bookings loads on the main link and can cancel + add to calendar', html.includes("/insp-book/mine?k=") && html.includes('function cancelOne') && html.includes('function calButtons') && html.includes("/insp-book/ics?t="));
t('page: manage view shows add-to-calendar only when approved', html.includes("b.status==='approved'?calButtons(M,b.google_cal_url)"));

// ── conflict guard (write-then-verify at booking, live re-check at approval) ──
const CF = new Function(['INSP_TZ'].map(n => grab(n, 'const')).join('\n') + '\n' + ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspFmtEt', 'inspFmtEtTime', 'inspEventsToBusy', 'inspConflictsFrom'].map(n => grab(n)).join('\n') + '\nreturn { inspConflictsFrom };')();
const S = '2026-10-13T16:00:00.000Z', Eend = '2026-10-13T16:40:00.000Z', sMs = Date.parse(S), eMs = Date.parse(Eend);
const evt = (o) => ({ id: 'x', status: 'confirmed', summary: 'Dentist', start: { dateTime: '2026-10-13T16:30:00.000Z' }, end: { dateTime: '2026-10-13T17:00:00.000Z' }, ...o });
t('conflict: own hold is ignored (by event id)', CF.inspConflictsFrom([evt({ id: 'mine', extendedProperties: { private: { ridgecoInspBooking: 'new' } }, start: { dateTime: S }, end: { dateTime: Eend } })], sMs, eMs, { eventId: 'mine' }).length === 0);
t('conflict: own booking is ignored (by booking id) when approving', CF.inspConflictsFrom([evt({ id: 'h', extendedProperties: { private: { ridgecoInspBooking: '4' } }, start: { dateTime: S }, end: { dateTime: Eend } })], sMs, eMs, { bookingId: '4' }).length === 0);
t('conflict: Brett\'s own event overlapping is caught with its title', (r => r.length === 1 && r[0].kind === 'event' && r[0].title === 'Dentist')(CF.inspConflictsFrom([evt({})], sMs, eMs, { eventId: 'mine' })));
t('conflict: another partner\'s hold overlapping is caught (title hidden)', (r => r.length === 1 && r[0].kind === 'booking' && r[0].title === 'Another inspection booking')(CF.inspConflictsFrom([evt({ id: 'other', summary: 'PENDING: Secret address', extendedProperties: { private: { ridgecoInspBooking: '9' } } })], sMs, eMs, { eventId: 'mine' })));
t('conflict: back-to-back (touching) is NOT a conflict', CF.inspConflictsFrom([evt({ start: { dateTime: Eend }, end: { dateTime: '2026-10-13T17:00:00.000Z' } }), evt({ id: 'y', start: { dateTime: '2026-10-13T15:00:00.000Z' }, end: { dateTime: S } })], sMs, eMs, {}).length === 0);
t('conflict: cancelled, declined and free ("show as available") events are not conflicts', CF.inspConflictsFrom([evt({ status: 'cancelled' }), evt({ id: 'a', transparency: 'transparent' }), evt({ id: 'b', attendees: [{ self: true, responseStatus: 'declined' }] })], sMs, eMs, {}).length === 0);
t('conflict: key-pickup blocks never count', CF.inspConflictsFrom([evt({ extendedProperties: { private: { ridgecoInspKey: '2_2026-10-13' } } })], sMs, eMs, {}).length === 0);
t('conflict: all-day busy event on that day is caught', CF.inspConflictsFrom([{ id: 'ad', status: 'confirmed', summary: 'Out of town', start: { date: '2026-10-13' }, end: { date: '2026-10-14' } }], sMs, eMs, {}).length === 1);
t('booking request verifies after writing the hold, rolls it back and returns fresh slots', /createdEventId = ev\.id; rec\.Calendar_Event_ID = ev\.id;[\s\S]{0,800}inspFindConflicts\(env, a\.cfg, slot\.startMs, slot\.endMs, \{ eventId: ev\.id \}\)[\s\S]{0,1600}error: 'slot_taken'/.test(src));
t('verify failure cancels the hold and alerts (never silent)', /Could not verify your calendar after placing a booking hold, so it was cancelled/.test(src));
t('approval re-checks live; override allowed; check failure blocks with an alert', /decision === 'approve' && !override[\s\S]{0,1600}error: 'conflict'/.test(src) && /could not re-check your calendar before approving/.test(src));
t('both decide routes pass the override flag', /inspBookingDecide\(env, id, body\.decision, body\.note, 'link', body\.override === true\)/.test(src) && /'admin', !!\(body && body\.override === true\)\)/.test(src));
t('approval page shows conflicts + Approve anyway; admin tab confirms', html.includes('Approve anyway') && html.includes('override:ov===true') && fs.readFileSync('inspect.html', 'utf8').includes("r.error==='conflict'"));

// ── STR cleaning-coverage guard ──
const SG = new Function(['INSP_TZ'].map(n => grab(n, 'const')).join('\n') + '\n' + ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspAddDays', 'inspIcsTime', 'inspParseIcs', 'inspStrFromApi', 'inspStrEvDay', 'inspStrEventDays', 'inspStrCleaningKind', 'inspStrStays', 'inspStrCompute', 'inspStrDayText'].map(n => grab(n)).join('\n') + '\nreturn { inspParseIcs, inspStrCleaningKind, inspStrStays, inspStrCompute, inspStrDayText, inspStrEventDays, inspAddDays, inspStrFromApi };')();
t('cleaning titles: "Gina Cleaning" / "Kayla Cleaning" / "Rachel cleaning" are covered', ['Gina Cleaning', 'Kayla Cleaning', 'rachel cleaning', 'Gina - Cleaning 11am'].every(x => SG.inspStrCleaningKind(x) === 'cleaner'));
t('cleaning titles: "Brett cleaning" is NOT covered (Brett must go)', SG.inspStrCleaningKind('Brett Cleaning') === 'brett' && SG.inspStrCleaningKind('brett cleaning') === 'brett');
t('cleaning titles: availability markers never count', ['Gina Available', 'Gina Not Available', 'Kayla N/A', 'Michele AM Only N/A 2+', 'Gina cleaning cancelled'].every(x => SG.inspStrCleaningKind(x) === ''));
const SG_ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261009', 'DTEND;VALUE=DATE:20261011', 'SUMMARY:Reserved', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART;TZID=America/New_York:20261011T160000', 'DTEND:20261013T150000Z', 'SUMMARY:Ali Reza\\, D.', 'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261023', 'DTEND;VALUE=DATE:20261025', 'STATUS:CANCELLED', 'SUMMARY:Old', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const sgEv = SG.inspParseIcs(SG_ICS);
t('ics: parses all-day, timed, escaped commas and cancelled', sgEv.length === 3 && sgEv[0].start.date === '2026-10-09' && sgEv[0].end.date === '2026-10-11' && sgEv[1].summary === 'Ali Reza, D.' && sgEv[2].status === 'CANCELLED');
const stays = SG.inspStrStays(sgEv);
t('stays: cancelled dropped; END date is the checkout day (timed 15:00Z = 11 AM ET -> same ET date)', stays.length === 2 && stays[0].end === '2026-10-11' && stays[1].end === '2026-10-13' && stays[1].start === '2026-10-11', stays);
const API = (summary, start, end) => SG.inspStrFromApi({ summary, status: 'confirmed', start: { date: start }, end: { date: end } });
const real = [{ start: '2026-10-07', end: '2026-10-09', guest: 'Allissa' }, { start: '2026-10-09', end: '2026-10-11', guest: 'Addison' }, { start: '2026-10-11', end: '2026-10-13', guest: 'Ali Reza' }, { start: '2026-10-16', end: '2026-10-18', guest: 'Jillian' }, { start: '2026-10-18', end: '2026-10-20', guest: 'Chase' }];
const cleaning = [API('Gina Cleaning', '2026-10-09', '2026-10-10'), API('Gina Cleaning', '2026-10-11', '2026-10-12'), API('Gina Available', '2026-10-12', '2026-10-13'), API('Kayla N/A', '2026-10-13', '2026-10-14'), API('Kayla Cleaning', '2026-10-18', '2026-10-19'), API('Gina Not Available', '2026-10-18', '2026-10-19'), API('Gina Cleaning', '2026-10-20', '2026-10-21')];
const R = SG.inspStrCompute(real, cleaning, '2026-10-08', '2026-11-30');
const by = d => R.checkouts.find(c => c.date === d);
t('compute: Oct 9 covered by Gina same-day (back-to-back arrival that day)', by('2026-10-09').covered && by('2026-10-09').next_arrival === '2026-10-09', by('2026-10-09'));
t('compute: Oct 11 covered (Gina Cleaning), Oct 13 uncovered (only "Kayla N/A")', by('2026-10-11').covered && !by('2026-10-13').covered && by('2026-10-13').reason === 'none');
t('compute: Oct 18 covered by Kayla Cleaning even though Gina is Not Available', by('2026-10-18').covered && by('2026-10-18').covered_by.length === 1);
t('compute: Oct 20 covered by Gina (no later arrival -> 14-day window)', by('2026-10-20').covered);
t('compute: closed list is exactly the uncovered checkout dates', JSON.stringify(R.closed) === JSON.stringify(['2026-10-13']), R.closed);
const R2 = SG.inspStrCompute([{ start: '2026-10-11', end: '2026-10-13', guest: 'A' }, { start: '2026-10-15', end: '2026-10-17', guest: 'B' }], [API('Rachel Cleaning', '2026-10-15', '2026-10-16')], '2026-10-08', '2026-11-30');
t('compute: cleaning on the next guest\'s ARRIVAL day counts (Brett: "that is fine")', R2.checkouts[0].covered && R2.checkouts[0].window_end === '2026-10-15', R2.checkouts[0]);
const R3 = SG.inspStrCompute([{ start: '2026-10-11', end: '2026-10-13', guest: 'A' }, { start: '2026-10-15', end: '2026-10-17', guest: 'B' }], [API('Rachel Cleaning', '2026-10-16', '2026-10-17'), API('Rachel Cleaning', '2026-10-10', '2026-10-11')], '2026-10-08', '2026-11-30');
t('compute: cleaning AFTER the next arrival or BEFORE the checkout does not count', !R3.checkouts[0].covered);
const R4 = SG.inspStrCompute([{ start: '2026-10-11', end: '2026-10-13', guest: 'A' }], [API('Brett Cleaning', '2026-10-13', '2026-10-14')], '2026-10-08', '2026-11-30');
t('compute: "Brett Cleaning" alone = uncovered with reason brett', !R4.checkouts[0].covered && R4.checkouts[0].reason === 'brett' && /only "Brett cleaning"/.test(SG.inspStrDayText(R4.checkouts[0], 'Cabin')));
const R5 = SG.inspStrCompute([{ start: '2026-10-11', end: '2026-10-13', guest: 'A' }], [API('Brett Cleaning', '2026-10-13', '2026-10-14'), API('Gina Cleaning', '2026-10-13', '2026-10-14')], '2026-10-08', '2026-11-30');
t('compute: Brett + a real cleaner the same day = covered', R5.checkouts[0].covered);
const R6 = SG.inspStrCompute([{ start: '2026-10-01', end: '2026-10-03', guest: 'old' }], [], '2026-10-08', '2026-11-30');
t('compute: past checkouts are ignored', R6.checkouts.length === 0 && R6.closed.length === 0);
t('multi-day all-day cleaning spans days (end exclusive)', JSON.stringify(SG.inspStrEventDays(API('Gina Cleaning', '2026-10-13', '2026-10-15'))) === JSON.stringify(['2026-10-13', '2026-10-14']));
// wiring
t('slot engine skips closed days; availability reads the guard fresh for real bookings', has(/o\.closedDates && o\.closedDates\.has\(b\.Date\)\) continue/) && has(/inspStrClosedOrThrow\(env, cfg, input\.freshGuard\)/) && has(/input\.freshGuard = true/));
t('guard read failure pauses booking + alerts (never silently offers days)', /async function inspStrClosedOrThrow[\s\S]{0,500}inspAlert[\s\S]{0,300}calendar_unavailable/.test(src));
t('approve + approval page include the no-cleaner conflict', has(/inspStrBookingConflict\(env, await fetchConfig\(env\), b, true\); if \(nc\) conf\.push\(nc\)/) && has(/if \(nc\) conflicts\.push\(nc\)/));
t('open-block add returns str_warnings; block list marks closed days', has(/str_warnings: strWarnings/) && has(/Str_Closed:/));
t('cron */15 runs the guard tick and alerts on its failure', /cron === '\*\/15 \* \* \* \*'[\s\S]{0,900}inspStrGuardTick\(env\)[\s\S]{0,300}inspAlert\(env, 'str_guard_tick'/.test(src));
t('tick: notifies once per change, re-alerts as a booking nears (24h/72h), reports reopened days, retries if notify failed', has(/bucket = hrs < 24 \? 'u1'/) && has(/Good news: /) && /if \(!res\.ok\) \{ await inspAlert\(env, 'str_guard_notify'/.test(src));
t('config save only touches the STR_GUARD keys and validates input', has(/sets\.STR_GUARD_BOOKING_SOURCES/) && has(/error: 'bad_sources'/) && has(/error: 'bad_cleaning_cal'/));
t('admin page: 2c card, pre-save cleaner check, closed badge', fs.readFileSync('inspect.html', 'utf8').includes('2c. Cabin cleaning protection') && fs.readFileSync('inspect.html', 'utf8').includes('/insp/str-guard/status?dates=') && fs.readFileSync('inspect.html', 'utf8').includes('Closed — no cleaner'));

// ── Uplisting probe (Oct 8): read-only, masked, never echoes the key ──
const UPL = new Function(grab('INSP_UPL_BASE', 'const') + '\n' + ['_utf8B64url', 'inspUplBasic', 'inspUplMask', 'inspUplShape'].map(n => grab(n)).join('\n') + '\nreturn { inspUplBasic, inspUplMask, inspUplShape };')();
t('probe auth: Basic base64 of the key alone, padded like standard base64', ['ab19f218-a24e-4000-8000-000000000000', 'k', 'ab', 'abc'].every(k => UPL.inspUplBasic(k) === 'Basic ' + Buffer.from(k).toString('base64')));
const uplMasked = UPL.inspUplMask({ data: [{ id: '1', attributes: { check_in: '2026-10-11', check_out: '2026-10-13', status: 'confirmed', note: 'call +1 (410) 555-0123 or a@b.com' }, guest: { first_name: 'Ann', last_name: 'Lee', email: 'ann@x.com', phone: '4105550123', nickname: 'AL' } }, { id: '2' }, { id: '3' }] });
t('probe mask: keeps dates/status, drops guest + contact details, trims arrays to 2', uplMasked.data.length === 2 && uplMasked.data[0].attributes.check_out === '2026-10-13' && uplMasked.data[0].attributes.status === 'confirmed' && !/Ann|Lee|ann@|a@b\.com|555/.test(JSON.stringify(uplMasked)), JSON.stringify(uplMasked));
t('probe shape: reports field names/types (date vs string), not values', JSON.stringify(UPL.inspUplShape({ data: [{ id: '1', attributes: { check_out: '2026-10-13', n: 2, ok: true } }] })) === JSON.stringify({ data: [{ id: 'string', attributes: { check_out: 'date', n: 'number', ok: 'boolean' } }] }));
const uplSrc = grab('inspUplProbe');
t('probe: GET-only, fixed base URL, no caller-supplied URL, never returns the key', /method: 'GET'/.test(uplSrc) && !/method: '(POST|PUT|PATCH|DELETE)'/.test(uplSrc) && !/searchParams|url\./.test(uplSrc) && /split\(key\)\.join\('\[key\]'\)/.test(uplSrc) && !/key: key|auth_header|Authorization: auth\b[\s\S]*json\(/.test(uplSrc.split('return json({ ok: true')[1] || ''));
t('probe: route wired (admin /insp/ GET, not on the public allow-list)', has(/path === '\/insp\/str-guard\/uplisting-probe'\) \{ try \{ return await inspUplProbe\(env\)/) && !/'\/insp\/str-guard\/uplisting-probe'/.test(src.slice(src.indexOf("'/insp-book/info','/insp-book/slots'") - 400, src.indexOf("'/insp-book/info','/insp-book/slots'") + 400)));
t('probe: missing key is reported (no_key), not a crash', /error: 'no_key'/.test(uplSrc));

// ── Source sanity (Oct 8): the cleaning calendar can never be the bookings feed ──
const SC = new Function(grab('isStaging') + '\n' + grab('inspStrConfig') + '\nreturn { inspStrConfig };')();
const scCal = 'c_abc@group.calendar.google.com';
const scBad = SC.inspStrConfig({ __STAGING__: false }, { STR_GUARD_BOOKING_SOURCES: scCal.toUpperCase(), STR_GUARD_CLEANING_CAL: scCal, STR_GUARD_ENABLED: 'TRUE' });
t('sanity: same id in both fields = guard OFF, bookings feed missing, problem explained', !scBad.enabled && scBad.missing.includes('bookings feed') && scBad.problems.length === 1 && /cleaning calendar/.test(scBad.problems[0]), scBad);
const scOk = SC.inspStrConfig({ __STAGING__: false }, { STR_GUARD_BOOKING_SOURCES: 'https://x.example/cal.ics ' + scCal, STR_GUARD_CLEANING_CAL: scCal });
t('sanity: a real feed + the cleaning calendar = on, cleaning cal dropped from the feeds', scOk.enabled && scOk.sources.length === 1 && scOk.sources[0].startsWith('https://') && scOk.problems.length === 1);
const scFine = SC.inspStrConfig({ __STAGING__: false }, { STR_GUARD_BOOKING_SOURCES: 'https://x.example/cal.ics', STR_GUARD_CLEANING_CAL: scCal });
t('sanity: normal config has no problems', scFine.enabled && scFine.problems.length === 0);
t('sanity: save refuses the cleaning calendar as the bookings feed; status reports problems; card has OFF/ON switch', has(/error: 'bookings_is_cleaning_cal'/) && has(/problems: sc\.problems/) && fs.readFileSync('inspect.html', 'utf8').includes('sgSwitch(false,this)') && fs.readFileSync('inspect.html', 'utf8').includes("r.error==='bookings_is_cleaning_cal'"));

console.log(`insp-booking: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
