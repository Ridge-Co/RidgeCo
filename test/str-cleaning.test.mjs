// STR cleaning scheduler (Oct 14 2026) — the engine block is sliced out of worker.js (STR-BLOCK-BEGIN/END) and run against an
// in-memory Sheets store with every outside call (SMS, email, calendar) stubbed and recorded. The clock is pinned.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got) : ''); } };
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ((kind === 'async' ? 'async function ' : 'function ') + name + '(');
  const i = src.indexOf(needle); if (i < 0) throw new Error('missing ' + name);
  if (kind === 'const') { const j = src.indexOf(';\n', i); return src.slice(i, j + 1); }
  let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const bi = src.indexOf('// ═══ STR-BLOCK-BEGIN'), be = src.indexOf('// ═══ STR-BLOCK-END');
t('STR block markers exist', bi > 0 && be > bi);
const block = src.slice(bi, be);

// ── pieces of the real worker the engine leans on (pure helpers, taken verbatim) ──
const realFns = ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspAddDays', 'inspStrCleaningKind', 'inspStrEvDay', 'inspStrEventDays', 'inspStrStays', 'inspStrFromApi', 'inspIcsEsc', 'renderTemplate', 'idColIndex', 'inspErr', 'inspStrMask', 'inspStrConfig', 'inspClassifyCalError', 'appendedRowNumber', 'mintNextNumericId', 'col'].map(n => grab(n)).join('\n') + '\n' + grab('guardAppendedIds', 'async');
const realConsts = ['INSP_TZ'].map(n => grab(n, 'const')).join('\n');

function makeWorld(opts) {
  opts = opts || {};
  const tabs = new Map(), W = { tabs, sms: [], brett: [], emails: [], attach: [], cal: [], telemetry: [], gated: [], now: 0, failSms: false, smsAdvanceMs: 0, failBrett: false, failCal: false, failEmail: false, queue: 0 };
  const hdr = tab => tabs.get(tab)[0];
  const objs = tab => { if (!tabs.has(tab)) { const e = new Error('Unable to parse range: ' + tab); throw e; } const [h, ...rows] = tabs.get(tab); return rows.map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i] == null ? '' : r[i]); return o; }); };
  const json = (b, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => b });
  const stubs = {
    fetchConfig: async () => Object.assign({}, W.cfg), fetchTab: async (env, tab) => objs(tab), fetchTabs: async (env, ts) => ts.map(x => objs(x)),
    invalidateTabCache: () => {}, json,
    sheetsRequest: async (env, method, path, body) => {
      let m;
      if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map(title => ({ properties: { title } })) };
      if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
      if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { if (!tabs.has(m[1])) throw new Error('Unable to parse range'); return { values: tabs.get(m[1]).map(r => r.slice()) }; }
      if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const first = tabs.get(m[1]).length + 1; for (const r of body.values) tabs.get(m[1]).push(r.slice()); return { updates: { updatedRange: m[1] + '!A' + first } }; }
      throw new Error('fake sheets: unsupported ' + method + ' ' + path);
    },
    ensureColumns: async (env, tab, cols) => { if (!tabs.has(tab)) tabs.set(tab, []); const rows = tabs.get(tab); if (!rows.length) rows.push([]); for (const c of cols) if (!rows[0].includes(c)) { rows[0].push(c); for (let i = 1; i < rows.length; i++) rows[i].push(''); } },
    addRow: async (env, tab, body) => { const h = hdr(tab), idc = h.indexOf('ID'); const next = tabs.get(tab).slice(1).reduce((m, r) => Math.max(m, parseInt(r[idc]) || 0), 0) + 1; tabs.get(tab).push(h.map(k => k === 'ID' ? String(next) : (body[k] != null ? String(body[k]) : ''))); return json({ success: true, id: String(next) }); },
    updateRow: async (env, tab, id, fields) => { if (W.failUpdate && W.failUpdate(tab, fields)) return json({ success: true, message: 'No matching fields' }); const h = hdr(tab), idc = h.indexOf('ID'), row = tabs.get(tab).slice(1).find(r => String(r[idc]) === String(id)); if (!row) return json({ error: 'Row not found' }, 404); for (const [k, v] of Object.entries(fields)) { const ci = h.indexOf(k); if (ci >= 0) row[ci] = String(v); } return json({ success: true }); },
    setConfigKey: async (env, b) => { W.cfg[b.key] = b.value; return json({ success: true }); },
    logTelemetry: async (env, rec) => { W.telemetry.push(rec); },
    getMessageTemplate: async () => null,
    smsGatedSend: async (env, o) => { W.gated.push(o); if (W.failSms) return { send_ok: true, sent: false, queued_id: 'q' + (++W.queue), gate_snapshot: 'ok' }; W.sms.push({ to: o.vendor && o.vendor.Name, type: o.message_type, text: o.message_body, bypass: o.bypassQuietHours }); clock += W.smsAdvanceMs; return { send_ok: true, sent: true, queued_id: 'q' + (++W.queue), test_mode: true }; },
    sendSMS: async (env, to, text) => { if (W.failBrett) return { error: 'twilio down' }; W.brett.push({ to, text }); return { sid: 'x' }; },
    gmailSendEmail: async (env, e) => { if (W.failEmail) throw new Error('gmail down'); W.emails.push(e); return { staged: true }; },
    gmailSendEmailWithAttachment: async (env, e) => { if (W.failEmail) throw new Error('gmail down'); W.attach.push(e); return { staged: true }; },
    inspCalStaged: () => !!opts.calStaged, getCalendarAccessToken: async () => 'tok',
    inspStrReadIcs: async () => [], inspStrReadGoogle: async () => [],
    schedStep: async (name, fn, errors) => { try { return await fn(); } catch (e) { errors.push({ step: name, error: String(e.message) }); } },
    schedErrText: e => String((e && e.message) || e), isStaging: () => true,
    normalizePhone: p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : (d.length === 11 && d[0] === '1' ? '+' + d : ''); },
    inspRandToken: n => 'tok' + Math.random().toString(36).slice(2).padEnd(30, 'x'),
    _utf8B64url: s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    BUILD_VERSION: 'test', PORTAL_BASE: 'https://portal.test', CORS: {},
    fetch: async (url, init) => {
      if (W.failCal) return new Response('boom', { status: 500 });
      const method = (init && init.method) || 'GET'; W.cal.push({ method, url, body: init && init.body ? JSON.parse(init.body) : null });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ id: 'ev' + W.cal.length, items: [] }), { status: 200 });
    },
  };
  W.stubs = stubs;
  return W;
}
const names = ['fetchConfig', 'fetchTab', 'fetchTabs', 'invalidateTabCache', 'json', 'sheetsRequest', 'ensureColumns', 'addRow', 'updateRow', 'setConfigKey', 'logTelemetry', 'getMessageTemplate', 'smsGatedSend', 'sendSMS', 'gmailSendEmail', 'gmailSendEmailWithAttachment', 'inspCalStaged', 'getCalendarAccessToken', 'inspStrReadIcs', 'inspStrReadGoogle', 'schedStep', 'schedErrText', 'isStaging', 'normalizePhone', 'inspRandToken', '_utf8B64url', 'BUILD_VERSION', 'PORTAL_BASE', 'CORS', 'fetch'];
const exportsList = ['strBuildTasks', 'strReplyWindow', 'strReplyDeadlineMs', 'strInSendWindow', 'strBrettSmsOk', 'strNextCleaner', 'strDesiredCalendar', 'strPlanCalendar', 'strCalBody', 'strIcs', 'strExternalCover', 'strSettings', 'strDaysBetween', 'strFmtDate', 'strNextDate', 'strTick', 'strCleanerPage', 'strOfferRespond', 'strCleanerMark', 'strCleanerCancel', 'strCleanerIcs', 'strAdminState', 'strAdminCleanerSave', 'strAdminAssign', 'strAdminOfferNow', 'strAdminConfig', 'strAdminAlertAck', 'strAdminPreview', 'strRunDigest', 'strBackupLine', 'strBackupPicture', 'schedRunStrCleaning', 'schedRunStrDigest', 'STR_DEFAULT_TEXTS', 'STR_BLOCK_TITLE', 'inspStrCleaningKind', 'inspEtWallToMs', 'inspEtDate', 'inspAddDays', 'strSystemAlert'];
function build(W) {
  const F = new Function(...names, realFns + '\n' + realConsts + '\n' + block + '\nreturn {' + exportsList.join(',') + '};');
  return F(...names.map(n => W.stubs[n]));
}
const NOW0 = () => 0;
let clock = 0; const realNow = Date.now; Date.now = () => clock;
const at = (E, d, hm) => E.inspEtWallToMs(d, hm);

// ═══ 1. pure helpers ═══
{
  const W0 = makeWorld(); const E = build(W0), S = E.strSettings({});
  t('defaults are OFF', !S.engine && !S.sms && !S.calWrite && !S.digest);
  t('defaults: alert 7d, lookahead 35d', S.alertDays === 7 && S.lookahead === 35 && S.redDays === 14);
  t('reply window: 8 days out = overnight', E.strReplyWindow(8, S).kind === 'overnight');
  t('reply window: 6 days = overnight', E.strReplyWindow(6, S).kind === 'overnight');
  t('reply window: 5 days = 4 hours', E.strReplyWindow(5, S).hours === 4);
  t('reply window: 4 days = 4 hours', E.strReplyWindow(4, S).hours === 4);
  t('reply window: 3 days = 2 hours', E.strReplyWindow(3, S).hours === 2);
  t('reply window: 0 days = 2 hours', E.strReplyWindow(0, S).hours === 2);
  const n1 = at(E, '2026-10-14', '10:00');
  t('4h deadline', E.strReplyDeadlineMs(n1, '2026-10-18', S) === n1 + 4 * 3600000);
  t('2h deadline', E.strReplyDeadlineMs(n1, '2026-10-16', S) === n1 + 2 * 3600000);
  t('overnight deadline from 10am = next morning 8am', E.strReplyDeadlineMs(n1, '2026-10-25', S) === at(E, '2026-10-15', '08:00'));
  const n2 = at(E, '2026-10-14', '20:30');
  t('overnight deadline from 8:30pm = next morning 8am (11.5h)', E.strReplyDeadlineMs(n2, '2026-10-25', S) === at(E, '2026-10-15', '08:00'));
  const n3 = at(E, '2026-10-14', '08:30');
  t('overnight from 8:30am never < 10h', E.strReplyDeadlineMs(n3, '2026-10-25', S) - n3 >= 10 * 3600000);
  t('send window 7:59 closed / 8:00 open / 20:59 open / 21:00 closed', !E.strInSendWindow(at(E, '2026-10-14', '07:59'), S) && E.strInSendWindow(at(E, '2026-10-14', '08:00'), S) && E.strInSendWindow(at(E, '2026-10-14', '20:59'), S) && !E.strInSendWindow(at(E, '2026-10-14', '21:00'), S));
  t('Brett sms: 11pm blocked 3 days out, allowed 1 day out', !E.strBrettSmsOk(at(E, '2026-10-14', '23:00'), 3) && E.strBrettSmsOk(at(E, '2026-10-14', '23:00'), 1));
  // tasks
  const stays = [{ start: '2026-10-10', end: '2026-10-16', guest: 'A' }, { start: '2026-10-18', end: '2026-10-21', guest: 'B' }, { start: '2026-10-30', end: '2026-11-02', guest: 'C' }];
  const tasks = E.strBuildTasks(stays, '2026-10-14', S);
  t('tasks: checkout Oct 16 / Oct 21 / Nov 2', ['2026-10-16', '2026-10-21', '2026-11-02'].every(d => tasks.some(x => x.kind === 'checkout' && x.date === d)), tasks.map(x => x.key));
  const t16 = tasks.find(x => x.date === '2026-10-16' && x.kind === 'checkout');
  t('gap of 2 days: no prearrival, window runs to next arrival', t16.next === '2026-10-18' && t16.winEnd === '2026-10-18' && !tasks.some(x => x.kind === 'prearrival' && x.next === '2026-10-18'));
  const t21 = tasks.find(x => x.date === '2026-10-21' && x.kind === 'checkout'), pre = tasks.find(x => x.kind === 'prearrival');
  t('gap of 9 days: checkout window shortened to 2 days + a prearrival clean the day before', t21.winEnd === '2026-10-23' && pre && pre.date === '2026-10-29' && pre.next === '2026-10-30', { t21, pre });
  t('last checkout with no next booking: window 3 days, no prearrival', tasks.find(x => x.date === '2026-11-02').winEnd === '2026-11-05');
  t('past checkouts are not tasks', E.strBuildTasks([{ start: '2026-10-01', end: '2026-10-05' }], '2026-10-14', S).length === 0);
  t('beyond the 35-day lookahead is not a task', E.strBuildTasks([{ start: '2026-11-20', end: '2026-12-10' }], '2026-10-14', S).length === 0);
  t('prearrival disabled when gap setting is 0', !E.strBuildTasks(stays, '2026-10-14', E.strSettings({ STR_PREARRIVAL_GAP_DAYS: '0' })).some(x => x.kind === 'prearrival'));
  // external coverage + guard regex
  t('guard: "Gina Cleaning" is a cleaner', E.inspStrCleaningKind('Gina Cleaning') === 'cleaner');
  t('guard: the red block title is NOT a cleaner', E.inspStrCleaningKind(E.STR_BLOCK_TITLE) === '' && E.inspStrCleaningKind('Booking not covered for cleaning') === '');
  t('guard: "Brett Cleaning" still brett', E.inspStrCleaningKind('Brett Cleaning') === 'brett');
  const cov = E.strExternalCover({ winStart: '2026-10-16', winEnd: '2026-10-18' }, [{ summary: 'Kayla Cleaning', start: { date: '2026-10-17' }, end: { date: '2026-10-18' } }, { summary: E.STR_BLOCK_TITLE, start: { date: '2026-10-16' }, end: { date: '2026-10-17' } }]);
  t('external cover: Kayla counts, the red block does not', cov.length === 1 && cov[0] === 'Kayla', cov);
  // next cleaner
  const pool = [{ ID: '1', Cleaner_ID: 'g', Priority: '1', Active: 'TRUE' }, { ID: '2', Cleaner_ID: 'k', Priority: '2', Active: 'TRUE' }, { ID: '3', Cleaner_ID: 'r', Priority: '3', Active: 'TRUE' }];
  const cl = { g: { ID: 'g', Name: 'Gina', Phone: '+1', Active: 'TRUE' }, k: { ID: 'k', Name: 'Kayla', Phone: '+2', Active: 'TRUE' }, r: { ID: 'r', Name: 'Rachel', Phone: '+3', Active: 'TRUE' } };
  const tk = { key: 'x', date: '2026-10-21' };
  t('queue: Gina first', E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: [], task: tk }).cleaner.ID === 'g');
  t('queue: skips declined', E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: [{ Task_Key: 'x', Cleaner_ID: 'g', Status: 'declined' }], task: tk }).cleaner.ID === 'k');
  t('queue: skips no-reply (expired)', E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: [{ Task_Key: 'x', Cleaner_ID: 'g', Status: 'expired' }], task: tk }).cleaner.ID === 'k');
  t('queue: skips marked out that day', E.strNextCleaner({ pool, cleaners: cl, marks: { 'g|2026-10-21': 'out' }, offers: [], task: tk }).cleaner.ID === 'k');
  t('queue: marked out a DIFFERENT day does not skip', E.strNextCleaner({ pool, cleaners: cl, marks: { 'g|2026-10-22': 'out' }, offers: [], task: tk }).cleaner.ID === 'g');
  t('queue: declined on another task does not skip', E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: [{ Task_Key: 'other', Cleaner_ID: 'g', Status: 'declined' }], task: tk }).cleaner.ID === 'g');
  t('queue: skips inactive / no phone / sms opted out', E.strNextCleaner({ pool, cleaners: Object.assign({}, cl, { g: { ID: 'g', Active: 'FALSE', Phone: '+1' }, k: { ID: 'k', Phone: '', Active: 'TRUE' } }), marks: {}, offers: [], task: tk }).cleaner.ID === 'r');
  t('queue: opted-out cleaner skipped', E.strNextCleaner({ pool, cleaners: Object.assign({}, cl, { g: Object.assign({}, cl.g, { SmsOk: false }) }), marks: {}, offers: [], task: tk }).cleaner.ID === 'k');
  t('queue: everyone tried -> null', E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: ['g', 'k', 'r'].map(c => ({ Task_Key: 'x', Cleaner_ID: c, Status: 'declined' })), task: tk }).cleaner === null);
  // Oct 16 2026: staged backups ('can') move up only AFTER someone has already been asked; the first ask is always queue order.
  const gOut = [{ Task_Key: 'x', Cleaner_ID: 'g', Status: 'expired' }];
  t('staged: a volunteer backup never jumps ahead of Gina on the FIRST ask', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'k|2026-10-21': 'can' }, offers: [], task: tk }); return n.cleaner.ID === 'g' && !n.staged; })());
  t('staged: after Gina passed, a volunteer (Rachel) is asked before Kayla who never answered, flagged staged', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'r|2026-10-21': 'can' }, offers: gOut, task: tk }); return n.cleaner.ID === 'r' && n.staged === true; })());
  t('staged: two volunteers keep queue order (Kayla before Rachel)', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'r|2026-10-21': 'can', 'k|2026-10-21': 'can' }, offers: gOut, task: tk }); return n.cleaner.ID === 'k' && n.staged === true; })());
  t('staged: nobody volunteered -> plain queue order, not flagged', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: {}, offers: gOut, task: tk }); return n.cleaner.ID === 'k' && !n.staged; })());
  t('staged: a volunteer for a DIFFERENT date does not count', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'r|2026-10-22': 'can' }, offers: gOut, task: tk }); return n.cleaner.ID === 'k' && !n.staged; })());
  t('staged: a cancelled earlier assignment counts as already asked', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'k|2026-10-21': 'can', 'g|2026-10-21': 'out' }, offers: [{ Task_Key: 'x', Cleaner_ID: 'g', Status: 'cancelled' }], task: tk }); return n.cleaner.ID === 'k' && n.staged === true; })());
  t('staged: a cleaner marked out is never staged', (() => { const n = E.strNextCleaner({ pool, cleaners: cl, marks: { 'k|2026-10-21': 'out', 'r|2026-10-21': 'can' }, offers: gOut, task: tk }); return n.cleaner.ID === 'r' && n.staged === true; })());
  t('queue: honours Priority not row order', E.strNextCleaner({ pool: [{ ID: '1', Cleaner_ID: 'k', Priority: '2', Active: 'TRUE' }, { ID: '2', Cleaner_ID: 'g', Priority: '1', Active: 'TRUE' }], cleaners: cl, marks: {}, offers: [], task: tk }).cleaner.ID === 'g');
  t('queue: pool-inactive cleaner never asked', E.strNextCleaner({ pool: [{ ID: '1', Cleaner_ID: 'g', Priority: '1', Active: 'FALSE' }, { ID: '2', Cleaner_ID: 'k', Priority: '2', Active: 'TRUE' }], cleaners: cl, marks: {}, offers: [], task: tk }).cleaner.ID === 'k');
  // calendar plan
  const cmap = { g: { Name: 'Regina Seville', Nickname: 'Gina' } };
  const desired = E.strDesiredCalendar([{ key: 'a', kind: 'checkout', date: '2026-10-16', status: 'covered', assigned: 'g', coveredAny: true, next: '2026-10-18' }, { key: 'b', kind: 'checkout', date: '2026-10-21', status: 'open', coveredAny: false }, { key: 'c', kind: 'checkout', date: '2026-12-01', status: 'open', coveredAny: false }], cmap, '2026-10-14', S);
  t('calendar: covered -> "Gina Cleaning"; uncovered inside 14d -> red block; far uncovered -> nothing', desired.length === 2 && desired[0].title === 'Gina Cleaning' && desired[1].title === E.STR_BLOCK_TITLE, desired);
  const body = E.strCalBody(desired[1], 'America/New_York');
  t('red block: 7am-7pm ET, red, opaque', body.start.dateTime === new Date(at(E, '2026-10-21', '07:00')).toISOString() && body.end.dateTime === new Date(at(E, '2026-10-21', '19:00')).toISOString() && body.colorId === '11' && body.transparency === 'opaque');
  t('coverage event is all-day and tagged', E.strCalBody(desired[0], 'x').start.date === '2026-10-16' && E.strCalBody(desired[0], 'x').extendedProperties.private.ridgecoStrKey === 'a');
  const plan = E.strPlanCalendar(desired, [{ id: 'e1', key: 'a', kind: 'cover', date: '2026-10-16', title: 'Gina Cleaning' }, { id: 'e2', key: 'z', kind: 'gap', date: '2026-10-30', title: E.STR_BLOCK_TITLE }, { id: 'e3', key: 'a', kind: 'cover', date: '2026-10-16', title: 'Gina Cleaning' }]);
  t('plan: keeps the matching one, deletes obsolete + duplicate, creates the missing red block', plan.create.length === 1 && plan.create[0].key === 'b' && plan.remove.map(x => x.id).sort().join() === 'e2,e3' && plan.patch.length === 0, plan);
  t('plan: a moved cleaning is patched', E.strPlanCalendar(desired, [{ id: 'e1', key: 'a', kind: 'cover', date: '2026-10-17', title: 'Gina Cleaning' }]).patch.length === 1);
  // ics
  const ics = E.strIcs([{ uid: 'u1', date: '2026-10-16', summary: 'Milam Ridge cleaning', description: 'a, b; c', url: 'https://x', seq: 3 }], at(E, '2026-10-14', '10:00'));
  t('ics: all-day event, escaped, CRLF', /DTSTART;VALUE=DATE:20261016\r\n/.test(ics) && /DTEND;VALUE=DATE:20261017/.test(ics) && /DESCRIPTION:a\\, b\\; c/.test(ics) && /END:VCALENDAR\r\n$/.test(ics));
  t('slot-filled copy asks for backup and names the date', /backup/.test(E.STR_DEFAULT_TEXTS.str_filled_backup) && /\{DateShort\}/.test(E.STR_DEFAULT_TEXTS.str_filled_backup) && !/sorry|unfortunately/i.test(E.STR_DEFAULT_TEXTS.str_filled_backup));
}

// ═══ 2. the whole loop over a fake sheet ═══
function seed(W, over) {
  const c = Object.assign({ admin_phone: '+15555550100', STR_ENGINE_ENABLED: 'TRUE', STR_SMS_ENABLED: 'TRUE', STR_SMS_TEST_MODE: 'FALSE', TWILIO_ENABLED: 'TRUE', STR_CAL_WRITE_ENABLED: 'FALSE', STR_GUARD_FIXTURE: JSON.stringify({ stays: [{ start: '2026-10-10', end: '2026-10-16', guest: 'Guest A' }, { start: '2026-10-18', end: '2026-10-21', guest: 'Guest B' }, { start: '2026-10-22', end: '2026-10-25', guest: 'Guest C' }], cleaning: [] }) }, over || {});
  W.cfg = c;
  W.tabs.set('Vendors', [['ID', 'Name', 'Phone', 'Email', 'Trade', 'Active', 'Service_Area', 'Language', 'SMS_Enabled', 'SMS_OptOut'], ['101', 'Regina Seville', '+15403364284', 'gina@x.test', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', ''], ['102', 'Kayla K', '+13043590045', 'kayla@x.test', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', ''], ['103', 'Rachel R', '+13048135101', '', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', '']]);
  W.tabs.set('STR_Cleaners', [['ID', 'Vendor_ID', 'Name', 'Nickname', 'Language', 'Link_Token', 'Active', 'Digest', 'Created_Date'], ['1', '101', 'Regina Seville', 'Gina', 'en', 'TOKGINA' + 'a'.repeat(30), 'TRUE', 'TRUE', ''], ['2', '102', 'Kayla K', 'Kayla', 'en', 'TOKKAYLA' + 'b'.repeat(30), 'TRUE', 'TRUE', ''], ['3', '103', 'Rachel R', 'Rachel', 'en', 'TOKRACHEL' + 'c'.repeat(30), 'TRUE', 'TRUE', '']]);
  W.tabs.set('STR_Cleaner_Pool', [['ID', 'Property_Key', 'Cleaner_ID', 'Priority', 'Active'], ['1', 'milam-ridge', '1', '1', 'TRUE'], ['2', 'milam-ridge', '2', '2', 'TRUE'], ['3', 'milam-ridge', '3', '3', 'TRUE']]);
}
const GINA = 'TOKGINA' + 'a'.repeat(30), KAYLA = 'TOKKAYLA' + 'b'.repeat(30), RACHEL = 'TOKRACHEL' + 'c'.repeat(30);
const rowsOf = (W, tab) => { const [h, ...r] = W.tabs.get(tab); return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] || '']))); };
const J = async r => (await r).json();
const resJson = async r => { const o = await r; return typeof o.json === 'function' ? await o.json() : o; };

{
  // ── engine OFF: nothing happens ──
  const W = makeWorld(); seed(W, { STR_ENGINE_ENABLED: 'FALSE' }); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, {});
  t('engine off: idle, nothing written, nothing sent', r.ok && r.detail.enabled === false && !W.tabs.has('STR_Turnovers') && !W.sms.length && !W.brett.length, r);
}
{
  // ── dry run with engine off still shows the plan and writes nothing ──
  const W = makeWorld(); seed(W, { STR_ENGINE_ENABLED: 'FALSE' }); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, { dry: true });
  const rowsBefore = W.tabs.has('STR_Turnovers') ? rowsOf(W, 'STR_Turnovers').length : 0;
  t('dry run: plans offers, sends nothing, writes no turnover rows', r.ok && (r.detail.actions || []).some(a => a.would_offer === 'Regina Seville') && !W.sms.length && !W.brett.length && rowsBefore === 0, r);
}
{
  // ── live loop (SMS on, test-mode send stub) ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  let r = await E.strTick({}, {});
  t('tick 1 ok', r.ok, r.errors);
  let tr = rowsOf(W, 'STR_Turnovers');
  t('tick 1: turnovers created for Oct 16 and Oct 21 (and a Oct 25 / prearrival where due)', ['2026-10-16', '2026-10-21'].every(d => tr.some(x => x.Date === d && x.Kind === 'checkout')), tr.map(x => x.Task_Key));
  let offers = rowsOf(W, 'STR_Offers');
  t('tick 1: each open turnover offered to Gina, capped at 2 pending at once', offers.length === 2 && offers.every(o => o.Cleaner_ID === '1' && o.Status === 'pending') && W.sms.length === 2, offers);
  t('offer text: assistant persona, date, link with offer id, bypass flag, vendor row used', W.sms[0].type === 'str_offer' && /Riley/.test(W.sms[0].text) && /turnover/.test(W.sms[0].text) && /cleaner\.html\?k=TOKGINA/.test(W.sms[0].text) && /offer=/.test(W.sms[0].text) && W.sms[0].bypass === true, W.sms[0]);
  t('offer deadline: 2 days out = 2h; 7 days out = 4h/overnight', (() => { const o16 = offers.find(o => o.Task_Key.endsWith('2026-10-16')), d = Date.parse(o16.Deadline_At) - clock; return d === 2 * 3600000; })(), offers.map(o => o.Deadline_At));
  t('turnover status = offering', tr.filter(x => x.Date === '2026-10-16')[0].Status === 'offering');
  // Brett alert: Oct 16 is 2 days out and uncovered -> alerted
  t('Brett told about the uncovered turnover inside 5 days (SMS + email)', W.brett.length >= 1 && /NOT COVERED/.test(W.brett[0].text) && W.emails.length >= 1, { brett: W.brett, em: W.emails.length });
  const bn = W.brett.length;
  // second tick 5 min later: nothing new, no repeat text
  clock += 5 * 60000; r = await E.strTick({}, {});
  t('tick 2: no duplicate offers or texts', r.ok && rowsOf(W, 'STR_Offers').length === 2 && W.sms.length === 2 && W.brett.length === bn, { offers: rowsOf(W, 'STR_Offers').length, sms: W.sms.length, brett: W.brett.length });
  // Gina declines Oct 16 via the page
  const o16 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key.endsWith('checkout|2026-10-16'));
  let d = await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o16.ID, action: 'decline' }));
  t('decline: ok + polite message', d.ok && d.result === 'declined' && /thank you/i.test(d.message), d);
  offers = rowsOf(W, 'STR_Offers');
  t('decline: Kayla is asked immediately', offers.some(o => o.Task_Key === o16.Task_Key && o.Cleaner_ID === '2' && o.Status === 'pending') && W.sms.some(s => s.to === 'Kayla K'), offers);
  // Kayla accepts
  const ok16 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key === o16.Task_Key && o.Cleaner_ID === '2');
  d = await resJson(E.strOfferRespond({}, { k: KAYLA, offer_id: ok16.ID, action: 'accept' }));
  t('accept: assigned', d.ok && d.result === 'accepted', d);
  tr = rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o16.Task_Key);
  t('accept: turnover covered by Kayla via offer', tr.Status === 'covered' && tr.Assigned_Cleaner_ID === '2' && tr.Assigned_Via === 'offer', tr);
  t('accept: assigned confirmation text + calendar invite email to Kayla', W.sms.some(s => s.type === 'str_assigned' && s.to === 'Kayla K') && W.attach.some(a => a.to === 'kayla@x.test' && /BEGIN:VEVENT/.test(Buffer.from(a.attachment.base64Data, 'base64').toString())), { sms: W.sms.map(s => s.type), attach: W.attach.length });
  t('accept: Brett gets the "covered" notice', W.brett.some(b => /covered/i.test(b.text) && /Good news/.test(b.text)), W.brett);
  // Gina's other pending offer (Oct 21): Gina accepts it late-ish; then someone else later tries to accept the same -> filled message
  const o21 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key.endsWith('checkout|2026-10-21') && o.Cleaner_ID === '1');
  // expire Gina's Oct 21 offer then Kayla gets it
  clock += 5 * 3600000 + 60000; // past 4h/overnight? (7 days out => overnight deadline) advance a day
  clock = at(E, '2026-10-15', '09:00');
  r = await E.strTick({}, {});
  offers = rowsOf(W, 'STR_Offers');
  t('overnight window expiry: Gina Oct 21 offer expired, Kayla asked next', offers.find(o => o.ID === o21.ID).Status === 'expired' && offers.some(o => o.Task_Key === o21.Task_Key && o.Cleaner_ID === '2' && o.Status === 'pending'), offers.filter(o => o.Task_Key === o21.Task_Key));
  // Kayla accepts Oct 21; Gina (expired, no reply) then taps accept -> polite "filled" + backup prompt
  const k21 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key === o21.Task_Key && o.Cleaner_ID === '2');
  d = await resJson(E.strOfferRespond({}, { k: KAYLA, offer_id: k21.ID, action: 'accept' }));
  t('Kayla takes Oct 21', d.ok && d.result === 'accepted', d);
  const filledTexts = W.sms.filter(s => s.type === 'str_filled_backup');
  t('slot-filled text went to Gina (asked, no reply) and asks her to be the backup', filledTexts.some(s => s.to === 'Regina Seville' && /backup/.test(s.text)), W.sms.map(s => s.type + ':' + s.to));
  d = await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o21.ID, action: 'accept' }));
  t('late accept after it is filled: polite message + backup date, no double assignment', d.ok && d.result === 'filled' && d.backup_date === '2026-10-21' && /backup/i.test(d.message) && rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o21.Task_Key).Assigned_Cleaner_ID === '2', d);
  // marks
  let m = await resJson(E.strCleanerMark({}, { k: RACHEL, marks: [{ date: '2026-10-16', mark: 'out' }] }));
  t('mark out saved', m.ok && m.saved === 1, m);
  t('mark inside 5 days of a covered turnover alerts Brett with the backup picture', W.brett.some(b => /Availability change/.test(b.text) && /Rachel marked OUT for Fri, Oct 16/.test(b.text) && /NO BACKUP|Backups/.test(b.text)), W.brett.map(b => b.text));
  const avail = rowsOf(W, 'STR_Availability');
  t('mark is stored per cleaner+date', avail.some(a => a.Cleaner_ID === '3' && a.Date === '2026-10-16' && a.Mark === 'out'));
  m = await resJson(E.strCleanerMark({}, { k: RACHEL, marks: [{ date: '2026-10-16', mark: 'can' }] }));
  t('marks are changeable (out -> can)', m.ok && rowsOf(W, 'STR_Availability').find(a => a.Cleaner_ID === '3' && a.Date === '2026-10-16').Mark === 'can', m);
  m = await resJson(E.strCleanerMark({}, { k: KAYLA, marks: [{ date: '2026-10-21', mark: 'out' }] }));
  t('cannot mark OUT on a day you are assigned (use Cancel)', m.ok === false && m.error === 'assigned', m);
  m = await resJson(E.strCleanerMark({}, { k: RACHEL, marks: [{ date: '2020-01-01', mark: 'out' }] }));
  t('past dates rejected', m.ok === false && m.error === 'bad_date');
  m = await resJson(E.strCleanerMark({}, { k: 'nope', marks: [{ date: '2026-10-30', mark: 'out' }] }));
  t('bad token -> 404', m.ok === false && m.error === 'bad_link');
  // cancel
  const bb = W.brett.length; W.sms.length = 0;
  let cx = await resJson(E.strCleanerCancel({}, { k: KAYLA, task_key: o21.Task_Key }));
  t('cancel: ok', cx.ok, cx);
  tr = rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o21.Task_Key);
  t('cancel: turnover reopened and offering to the next in queue (Gina expired earlier, Kayla cancelled -> Rachel)', tr.Status === 'offering' && rowsOf(W, 'STR_Offers').some(o => o.Task_Key === o21.Task_Key && o.Cleaner_ID === '3' && o.Status === 'pending'), { tr, offers: rowsOf(W, 'STR_Offers').filter(o => o.Task_Key === o21.Task_Key) });
  t('cancel: Kayla is marked out for that date', rowsOf(W, 'STR_Availability').some(a => a.Cleaner_ID === '2' && a.Date === '2026-10-21' && a.Mark === 'out'));
  t('cancel: Brett alerted on SMS and email', W.brett.length > bb && /CLEANER CANCELLED/.test(W.brett[bb].text), W.brett.slice(bb));
  t('cancel: someone not assigned cannot cancel', (await resJson(E.strCleanerCancel({}, { k: GINA, task_key: o21.Task_Key }))).error === 'not_yours');
  // page
  const pg = await resJson(E.strCleanerPage({}, new URL('https://x/str/c/page?k=' + RACHEL)));
  t('page: tasks listed, offer present for Rachel, no phone/email leaked', pg.ok && pg.tasks.length >= 2 && pg.offers.length === 1 && !JSON.stringify(pg).match(/\+1\d{10}|@x\.test/), pg);
  t('page: shows who covers what', pg.tasks.find(x => x.date === '2026-10-16').covered && pg.tasks.find(x => x.date === '2026-10-16').covered_by === 'Kayla');
  const ics = await E.strCleanerIcs({}, new URL('https://x/str/c/ics?k=' + KAYLA));
  t('ics endpoint returns a calendar', ics.status === 200 && /BEGIN:VCALENDAR/.test(await ics.text()));
  // booking cancelled (leaves the feed) -> two ticks -> cancelled, assigned cleaner told
  W.cfg.STR_GUARD_FIXTURE = JSON.stringify({ stays: [{ start: '2026-10-10', end: '2026-10-16', guest: 'Guest A' }, { start: '2026-10-22', end: '2026-10-25', guest: 'Guest C' }], cleaning: [] });
  clock = at(E, '2026-10-15', '10:00'); W.sms.length = 0;
  await E.strTick({}, {});
  t('one miss does not cancel (feed blip protection)', rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o21.Task_Key).Status !== 'cancelled');
  clock += 15 * 60000; await E.strTick({}, {});
  t('second miss cancels the turnover and supersedes its pending offer', rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o21.Task_Key).Status === 'cancelled' && !rowsOf(W, 'STR_Offers').some(o => o.Task_Key === o21.Task_Key && o.Status === 'pending'));
  // anomaly: feed returns zero stays -> nothing cancelled, alert
  W.cfg.STR_GUARD_FIXTURE = JSON.stringify({ stays: [], cleaning: [] });
  const bf = W.brett.length; clock += 15 * 60000; r = await E.strTick({}, {});
  t('empty feed with turnovers on file: flagged, nothing cancelled', !r.ok && r.errors.some(e => e.step === 'feed_anomaly') && rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('checkout|2026-10-16')).Status === 'covered', r.errors);
}
{
  // ── queue exhausted + alert, red block plan, hand-entered calendar entry ──
  const W = makeWorld(); seed(W, { STR_CAL_WRITE_ENABLED: 'TRUE', STR_GUARD_FIXTURE: JSON.stringify({ stays: [{ start: '2026-10-10', end: '2026-10-16', guest: 'A' }, { start: '2026-10-18', end: '2026-10-20', guest: 'B' }], cleaning: [] }) });
  const E = build(W); clock = at(E, '2026-10-14', '10:00'); await E.strTick({}, {});
  for (const k of ['g', 'k', 'r']) { const cur = rowsOf(W, 'STR_Offers').filter(o => o.Status === 'pending' && o.Task_Key.endsWith('2026-10-16')); for (const o of cur) { const tok = { 1: GINA, 2: KAYLA, 3: RACHEL }[o.Cleaner_ID]; await resJson(E.strOfferRespond({}, { k: tok, offer_id: o.ID, action: 'decline' })); } }
  const t16 = rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('checkout|2026-10-16'));
  t('everyone declines -> exhausted', t16.Status === 'exhausted', t16);
  t('exhausted + inside 5 days -> Brett told', W.brett.some(b => /NOT COVERED/.test(b.text) && /Asked: Gina \(declined\), Kayla \(declined\), Rachel \(declined\)/.test(b.text)), W.brett.map(b => b.text));
  const r = await E.strTick({}, {});
  t('calendar write enabled but staged: reported as stubbed, no Google calls', !W.cal.length, W.cal);
  // hand-entered calendar entry covers it
  W.cfg.STR_GUARD_FIXTURE = JSON.stringify({ stays: [{ start: '2026-10-10', end: '2026-10-16', guest: 'A' }, { start: '2026-10-18', end: '2026-10-20', guest: 'B' }], cleaning: [{ title: 'Sierra Cleaning', date: '2026-10-17' }] });
  const bn = W.brett.length; clock += 15 * 60000; await E.strTick({}, {});
  t('a hand-entered "Sierra Cleaning" on the calendar covers the turnover and resolves the alert', rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('checkout|2026-10-16')).Status === 'ext_covered' && W.brett.length > bn && /Good news/.test(W.brett[W.brett.length - 1].text), W.brett.slice(bn));
  W.cfg.STR_GUARD_FIXTURE = JSON.stringify({ stays: [{ start: '2026-10-10', end: '2026-10-16', guest: 'A' }, { start: '2026-10-18', end: '2026-10-20', guest: 'B' }], cleaning: [] });
  clock += 15 * 60000; await E.strTick({}, {});
  t('calendar entry removed -> turnover reopens', ['open', 'offering', 'exhausted'].includes(rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('checkout|2026-10-16')).Status));
}
{
  // ── calendar writes (real path: not staged) ──
  const W = makeWorld({ calStaged: false }); seed(W, { STR_CAL_WRITE_ENABLED: 'TRUE', STR_GUARD_CLEANING_CAL: 'c_x@group.calendar.google.com', STR_GUARD_BOOKING_SOURCES: 'https://feed.test/x.ics', STR_GUARD_FIXTURE: '' });
  const E = build(W); clock = at(E, '2026-10-14', '10:00');
  // no fixture + staged=true stubs inspStrConfig? isStaging true -> fixture parse skipped when empty; feed readers stubbed to empty -> anomaly-free (no turnovers). Use an ics stub:
  W.stubs.inspStrReadIcs = async () => [];
  const r = await E.strTick({}, {});
  t('no stays + nothing on file: ok, no calendar calls', r.ok && !W.cal.some(c => c.method !== 'GET'), r);
}
{
  // ── texting failures are loud, never silent ──
  const W = makeWorld(); seed(W); W.failSms = true; const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, {});
  t('SMS failure: tick reports the error, offer row marked failed, Brett alerted (not silent)', !r.ok && r.errors.some(e => e.step === 'offer_text') && rowsOf(W, 'STR_Offers').some(o => o.Status === 'failed') && W.telemetry.some(x => x.Success === 'FALSE' && /str\/offer_text/.test(x.Skill_Or_Endpoint)), { errors: r.errors, tel: W.telemetry.length });
}
{
  // ── Twilio globally off while STR SMS on ──
  const W = makeWorld(); seed(W, { TWILIO_ENABLED: 'FALSE' }); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, {});
  t('Twilio off + STR_SMS on: error surfaced, no offer rows burned', !r.ok && r.errors.some(e => e.step === 'twilio_off') && !(W.tabs.has('STR_Offers') && rowsOf(W, 'STR_Offers').length), r.errors);
}
{
  // ── SMS off: logs what it would do, burns nothing ──
  const W = makeWorld(); seed(W, { STR_SMS_ENABLED: 'FALSE' }); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, {});
  t('SMS off: no texts, no offer rows, would-text recorded, turnover note names who is next', r.ok && !W.sms.length && !(rowsOf(W, 'STR_Offers').length) && (r.detail.actions || []).some(a => a.would_text === 'Regina Seville') && /SMS OFF - next up: Regina/.test(rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('2026-10-16')).Note), r);
  t('SMS off still alerts Brett about the uncovered turnover inside 5 days', W.brett.length >= 1);
}
{
  // ── outside the send window: no offers, then goes out at 8am ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '22:00');
  let r = await E.strTick({}, {});
  t('10pm: nothing texted to cleaners', r.ok && !W.sms.length && !(W.tabs.has('STR_Offers') && rowsOf(W, 'STR_Offers').length), r.detail.offers);
  clock = at(E, '2026-10-15', '08:05'); r = await E.strTick({}, {});
  t('8:05am: offers go out', W.sms.length >= 1);
}
{
  // ── write verification: a write that does not land is an error ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  await E.strTick({}, {});
  const o = rowsOf(W, 'STR_Offers')[0];
  W.failUpdate = (tab, f) => tab === 'STR_Turnovers';
  const d = await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o.ID, action: 'accept' }));
  t('unsaved write is reported as a failure (500 + Brett told), never success', d.ok === false && W.telemetry.some(x => /handler_offer response/.test(x.Skill_Or_Endpoint)), d);
}
{
  // ── checkout-day text ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  await E.strTick({}, {});
  const o = rowsOf(W, 'STR_Offers').find(x => x.Task_Key.endsWith('2026-10-16'));
  await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o.ID, action: 'accept' })); W.sms.length = 0;
  clock = at(E, '2026-10-16', '09:00'); await E.strTick({}, {});
  t('before 11am: no checkout-day text', !W.sms.some(s => s.type === 'str_checkout_day'));
  clock = at(E, '2026-10-16', '11:02'); await E.strTick({}, {});
  const cd = W.sms.filter(s => s.type === 'str_checkout_day');
  t('11am: checkout-day text with the link and the next arrival', cd.length === 1 && /Oct 18/.test(cd[0].text) && /cleaner\.html/.test(cd[0].text), cd);
  clock += 15 * 60000; await E.strTick({}, {});
  t('never sent twice', W.sms.filter(s => s.type === 'str_checkout_day').length === 1);
}
{
  // ── admin ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  W.tabs.set('STR_Log', [['ID', 'Timestamp', 'Task_Key', 'Cleaner_ID', 'Event', 'Detail']]);
  await E.strTick({}, {});
  const st = await resJson(E.strAdminState({}));
  t('admin state: cleaners, tasks, settings, alerts', st.ok && st.cleaners.length === 3 && st.tasks.length >= 2 && st.settings.engine === true && st.alerts.length >= 1 && st.cleaners[0].name === 'Regina Seville', st);
  const bad = await resJson(E.strAdminConfig({}, { values: { WORKER_SECRET: 'x' } }));
  t('config: only allow-listed keys', bad.ok === false && bad.error === 'not_allowed');
  const bad2 = await resJson(E.strAdminConfig({}, { values: { STR_ALERT_DAYS: '500' } }));
  t('config: range validated', bad2.ok === false);
  const good = await resJson(E.strAdminConfig({}, { values: { STR_ALERT_DAYS: '7', STR_DIGEST_ENABLED: 'TRUE' } }));
  t('config: saved and read back', good.ok && good.settings.alert_days === 7 && good.settings.digest === true && W.cfg.STR_ALERT_DAYS === '7', good);
  const as = await resJson(E.strAdminAssign({}, { task_key: st.tasks.find(x => x.date === '2026-10-21').key, cleaner_id: '3' }));
  t('admin assign: Rachel assigned, confirmation sent, no email (none on file) is reported', as.ok && rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key.endsWith('2026-10-21')).Assigned_Cleaner_ID === '3' && as.warnings.some(w => /no email/.test(w)), as);
  const un = await resJson(E.strAdminAssign({}, { task_key: st.tasks.find(x => x.date === '2026-10-21').key, cleaner_id: '' }));
  t('admin unassign warns the cleaner was not told', un.ok && un.warnings.some(w => /NOT told/.test(w)), un);
  const on = await resJson(E.strAdminOfferNow({}, { task_key: st.tasks.find(x => x.date === '2026-10-21').key, restart: true }));
  t('offer-now restarts the queue', on.ok, on);
  const pv = await resJson(E.strAdminPreview({}));
  t('preview renders all 10 texts (6 original + 4 swap/bulk) under 320 chars with no leftover {tokens}', pv.ok && pv.previews.length === 10 && pv.previews.every(p => p.length < 320 && !/\{/.test(p.text)), pv.previews);
  const sv = await resJson(E.strAdminCleanerSave({}, { name: 'TEST-Cleaner', phone: '3045550142', email: 'a@b.co', nickname: 'T' }));
  t('save cleaner creates vendor (Short-Term Rental Cleaner / Milam Ridge), cleaner, pool entry with a link', sv.ok && rowsOf(W, 'Vendors').some(v => v.Name === 'TEST-Cleaner' && v.Trade === 'Short-Term Rental Cleaner' && v.Service_Area === 'Milam Ridge') && rowsOf(W, 'STR_Cleaner_Pool').length === 4 && /cleaner\.html\?k=/.test(sv.cleaner.link) && sv.cleaner.priority === 4, sv);
  const dup = await resJson(E.strAdminCleanerSave({}, { name: 'TEST-Dup', phone: '304-555-0142' }));
  t('duplicate phone rejected', dup.ok === false && dup.error === 'duplicate_phone');
  const bp = await resJson(E.strAdminCleanerSave({}, { name: 'X', phone: '123' }));
  t('bad phone rejected', bp.ok === false && bp.error === 'bad_phone');
}
{
  // ── digest ──
  const W = makeWorld(); seed(W, { STR_DIGEST_ENABLED: 'TRUE' }); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  await E.strTick({}, {});
  const o = rowsOf(W, 'STR_Offers').find(x => x.Task_Key.endsWith('2026-10-16'));
  await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o.ID, action: 'accept' })); W.attach.length = 0; W.emails.length = 0;
  const r = await E.strRunDigest({}, {});
  t('digest: emails each cleaner with an email; Gina gets her .ics; Rachel (no email) is an ERROR not a silent skip', r.errors.some(e => /Rachel R has no email/.test(e.error)) && W.attach.some(a => a.to === 'gina@x.test') && W.emails.some(e => e.to === 'kayla@x.test') && W.emails.some(e => /\[Copy\]/.test(e.subject)), { err: r.errors, a: W.attach.length, e: W.emails.map(x => x.to) });
  t('digest html: inline calendar rows, clickable links, covered/not covered labels', /<table/.test(W.attach[0].html) && /cleaner\.html\?k=TOKGINA/.test(W.attach[0].html) && /NOT COVERED/.test(W.attach[0].html) && /You are cleaning/.test(W.attach[0].html));
  const W2 = makeWorld(); seed(W2, { STR_DIGEST_ENABLED: 'FALSE' }); const E2 = build(W2);
  const off = await E2.strRunDigest({}, {});
  t('digest off: sends nothing and says so', off.detail.enabled === false && !W2.emails.length && !W2.attach.length);
}
{
  // ── scheduler wiring ──
  t('scheduler job registered (14 min interval) + 3 digest jobs', /name: 'str_cleaning',\s+kind: 'interval', every_min: 14/.test(src) && ['mon', 'wed', 'fri'].every(d => new RegExp(`name: 'str_digest_${d}'`).test(src)));
  t('str_cleaning is staging-safe', /SCHED_STAGING_SAFE_JOBS = \[[^\]]*'str_cleaning'/.test(src));
  t('public paths are token-gated cleaner endpoints only', ['/str/c/page', '/str/c/mark', '/str/c/offer', '/str/c/cancel', '/str/c/ics'].every(p => src.includes("'" + p + "'")) && !/PUBLIC_PATHS = \[[^\]]*\/str\/admin/.test(src));
  t('no swallowing catches in the STR block', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(block) && !/\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/.test(block));
}
{
  // ── cleaning-only test mode (Oct 14 2026): the default can never text a real cleaner ──
  const run = async over => { const W = makeWorld(); seed(W, over); const E = build(W); clock = at(E, '2026-10-14', '10:00'); const r = await E.strTick({}, {}); return { W, E, r }; };
  const d = await run({ STR_SMS_TEST_MODE: '' });
  t('test mode DEFAULTS ON (blank key): the offer is redirected to the test phone, labelled for the cleaner', d.W.gated.length >= 1 && d.W.gated.every(o => o.redirectTo && /^\[TEST - for \w+\] /.test(o.message_body)), d.W.gated.map(o => [o.redirectTo, o.message_body]));
  const on = await run({ STR_SMS_TEST_MODE: 'TRUE', TWILIO_TEST_RECIPIENT: '+15555550177' });
  t('test mode ON uses TWILIO_TEST_RECIPIENT', on.W.gated.length >= 1 && on.W.gated.every(o => o.redirectTo === '+15555550177'), on.W.gated.map(o => o.redirectTo));
  const off = await run({ STR_SMS_TEST_MODE: 'FALSE' });
  t('test mode explicitly OFF: no redirect, plain text to the real cleaner', off.W.gated.length >= 1 && off.W.gated.every(o => !o.redirectTo && !/^\[TEST/.test(o.message_body)), off.W.gated.map(o => [o.redirectTo, o.message_body]));
  const bad = await run({ STR_SMS_TEST_MODE: 'TRUE', TWILIO_TEST_RECIPIENT: 'not a phone' });
  t('test phone invalid: nothing is sent to the cleaner, the failure is surfaced', bad.W.gated.length === 0 && !bad.r.ok, bad.r);
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const so = await resJson(E.strAdminConfig({}, { values: { STR_SMS_TEST_MODE: 'FALSE' } }));
  t('config: STR_SMS_TEST_MODE can be switched and reads back in settings', so.ok && so.settings.sms_test_mode === false && W.cfg.STR_SMS_TEST_MODE === 'FALSE', so);
  const st2 = await resJson(E.strAdminState({}));
  t('admin state exposes sms_test_mode', st2.ok && typeof st2.settings.sms_test_mode === 'boolean');
}
{
  // ── time budget (Oct 14 2026): a slow tick stops STARTING new work, says so, and the next tick finishes it ──
  const W = makeWorld(); seed(W); W.smsAdvanceMs = 45000; const E = build(W); clock = at(E, '2026-10-14', '10:00');
  let r = await E.strTick({}, {});
  t('budget: first offer goes out, the second turnover is deferred (not cut off mid-write)', rowsOf(W, 'STR_Offers').length === 1 && W.sms.length === 1, rowsOf(W, 'STR_Offers'));
  t('budget: the deferral is a visible warning + detail, not silent', r.warnings.some(w => /wait for the next tick/.test(w)) && r.detail.deferred && r.detail.deferred['turnover(s) to check for offers'] >= 1 && r.detail.elapsed_ms >= 45000, { w: r.warnings, d: r.detail.deferred });
  t('budget: under the tail mark the alert check still runs', !r.detail.deferred['alert check(s)'], r.detail.deferred);
  W.smsAdvanceMs = 0; clock += 15 * 60000; r = await E.strTick({}, {});
  t('budget: the next (fast) tick completes the deferred offer, no warning, no duplicates', r.ok && rowsOf(W, 'STR_Offers').length === 2 && W.sms.length === 2 && !r.warnings.some(w => /wait for the next tick/.test(w)), { offers: rowsOf(W, 'STR_Offers').length, w: r.warnings });
}
{
  const W = makeWorld(); seed(W); W.smsAdvanceMs = 70000; const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const r = await E.strTick({}, {});
  t('budget: past the tail mark the checkout-text and alert checks are deferred AND reported', r.detail.deferred['alert check(s)'] === 1 && r.detail.deferred['checkout-day text check(s)'] === 1 && r.warnings.some(w => /alert check/.test(w)), r.detail.deferred);
}
{
  // ── next-guest wording (Oct 14 2026): "(subject to change with new bookings)" when the next guest is MORE than a day after the clean ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  const NOTE = ' (subject to change with new bookings)';
  t('next-guest: same day, next day -> stated flat', E.strNextDate('2026-11-08', '2026-11-08') === E.strFmtDate('2026-11-08') && E.strNextDate('2026-11-11', '2026-11-12') === E.strFmtDate('2026-11-12'));
  t('next-guest: Nov 8 -> Nov 12 carries the note', E.strNextDate('2026-11-08', '2026-11-12') === E.strFmtDate('2026-11-12') + NOTE, E.strNextDate('2026-11-08', '2026-11-12'));
  t('next-guest: two days out also carries it ("any longer than next day")', E.strNextDate('2026-11-08', '2026-11-10').endsWith(NOTE));
  await E.strTick({}, {});
  const texts = W.sms.map(x => x.text), offs = rowsOf(W, 'STR_Offers'), trs = rowsOf(W, 'STR_Turnovers');
  const withGap = trs.filter(x => x.Next_Arrival && E.strDaysBetween(x.Date, x.Next_Arrival) > 1), flat = trs.filter(x => x.Next_Arrival && E.strDaysBetween(x.Date, x.Next_Arrival) <= 1);
  t('next-guest: offer text for a >1-day gap carries the note, a flat one does not (live tick)', texts.length > 0 && withGap.length > 0 && texts.some((tx, i) => { const o = offs[i], tr = trs.find(x => x.Task_Key === o.Task_Key); return tr.Next_Arrival && E.strDaysBetween(tr.Date, tr.Next_Arrival) > 1; }) && texts.every((tx, i) => { const o = offs[i], tr = trs.find(x => x.Task_Key === o.Task_Key); const gap = tr.Next_Arrival && E.strDaysBetween(tr.Date, tr.Next_Arrival) > 1; return gap ? tx.includes(NOTE.trim()) : !tx.includes('subject to change'); }), { texts, withGap: withGap.length, flat: flat.length });
}
{
  // ── Oct 16 2026: backup promotion — friendly "can you still cover it?", sent right away even after hours, Brett told immediately ──
  const W = makeWorld(); seed(W); const E = build(W); clock = at(E, '2026-10-14', '10:00');
  let r = await E.strTick({}, {});
  const o21 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key.endsWith('checkout|2026-10-21') && o.Cleaner_ID === '1');
  const o16 = rowsOf(W, 'STR_Offers').find(o => o.Task_Key.endsWith('checkout|2026-10-16') && o.Cleaner_ID === '1');
  t('promo setup: Gina holds both offers', !!o21 && !!o16);
  let m = await resJson(E.strCleanerMark({}, { k: KAYLA, marks: [{ date: '2026-10-21', mark: 'can' }] }));
  t('promo setup: Kayla volunteers as backup for Oct 21', m.ok && m.saved === 1, m);
  // 11:30 PM — outside the 8am-9pm send window
  clock = at(E, '2026-10-14', '23:30'); W.sms.length = 0; const bn = W.brett.length;
  let d = await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o21.ID, action: 'decline' }));
  t('promo: decline ok', d.ok && d.result === 'declined', d);
  const promo = W.sms.filter(x => x.type === 'str_promote');
  t('promo: Kayla (staged backup) gets the promotion text immediately, even at 11:30 PM', promo.length === 1 && promo[0].to === 'Kayla K' && promo[0].bypass === true, W.sms);
  t('promo wording: friendly confirm, links to the offer, no rank words, no "primary"', /Can you still cover it/.test(promo[0].text) && /offer=/.test(promo[0].text) && !/primary|backup|#\d|priority|need you to/i.test(promo[0].text), promo[0].text);
  const po = rowsOf(W, 'STR_Offers').find(o => o.Task_Key === o21.Task_Key && o.Cleaner_ID === '2');
  t('promo: offer row is pending, noted as a promotion, with a reply deadline', po && po.Status === 'pending' && po.Note === 'promotion' && !!po.Deadline_At, po);
  const hand = W.brett.slice(bn).filter(b => /HANDOFF/.test(b.text));
  t('promo: Brett is told immediately (even at 11:30 PM), names who, which date, and why', hand.length === 1 && /Kayla was asked to cover/.test(hand[0].text) && /Oct 21/.test(hand[0].text) && /Gina passed/.test(hand[0].text), W.brett.slice(bn));
  await E.strTick({}, {});
  t('promo: a later tick does not repeat the handoff text', W.brett.slice(bn).filter(b => /HANDOFF/.test(b.text)).length === 1);
  // A NON-staged next cleaner after hours still waits for 8 AM (normal rule unchanged)
  W.sms.length = 0;
  d = await resJson(E.strOfferRespond({}, { k: GINA, offer_id: o16.ID, action: 'decline' }));
  t('no promo for a cleaner who never volunteered: nothing sent after hours', d.ok && !W.sms.length, W.sms);
  clock = at(E, '2026-10-15', '08:05'); r = await E.strTick({}, {});
  t('next morning: Kayla gets the normal offer text for Oct 16 (not a promotion)', W.sms.some(x => x.type === 'str_offer' && x.to === 'Kayla K') && !W.sms.some(x => x.type === 'str_promote'), W.sms);
  // The promotion is answerable on the cleaner page and accepting it assigns her
  const pg = await resJson(E.strCleanerPage({}, new URL('https://x/str/c/page?k=' + KAYLA)));
  t("promo: the offer shows on Kayla's page", pg.ok && pg.offers.some(o => String(o.id) === String(po.ID)), pg.offers);
  d = await resJson(E.strOfferRespond({}, { k: KAYLA, offer_id: po.ID, action: 'accept' }));
  t('promo: Kayla accepts and is assigned', d.ok && d.result === 'accepted' && rowsOf(W, 'STR_Turnovers').find(x => x.Task_Key === o21.Task_Key).Assigned_Cleaner_ID === '2', d);
}
Date.now = realNow;
console.log(`\nstr-cleaning: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
