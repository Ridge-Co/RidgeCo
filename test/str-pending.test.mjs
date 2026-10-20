// STR PENDING CLEANING (Oct 20 2026, Brett): a cleaning date with no booking yet. Harness reused from str-swap-bulk.test.mjs.
// STR admin swap + bulk changes (Oct 20 2026, Brett). The STR block is sliced out of worker.js and run against an in-memory Sheets store AND an
// in-memory Google Calendar; every outside call (SMS, email, calendar) is stubbed and recorded; the clock is pinned. Fault injection throughout:
// calendar permission denied / write accepted but not visible, text failure, Sheets write that does not land, out-marked cleaner,
// batch partial failure, stale preview, duplicate Send, concurrent Send, held-until-8am texts.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 700) : ''); } };
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
const realFns = ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspAddDays', 'inspStrCleaningKind', 'inspStrEvDay', 'inspStrEventDays', 'inspStrStays', 'inspStrFromApi', 'inspIcsEsc', 'renderTemplate', 'idColIndex', 'inspErr', 'inspStrMask', 'inspStrConfig', 'inspClassifyCalError', 'appendedRowNumber', 'mintNextNumericId', 'col'].map(n => grab(n)).join('\n') + '\n' + grab('guardAppendedIds', 'async');
const realConsts = ['INSP_TZ'].map(n => grab(n, 'const')).join('\n');

const colIdx = L => { let n = 0; for (const ch of L) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function makeWorld(opts) {
  opts = opts || {};
  const tabs = new Map(), W = { tabs, sms: [], brett: [], emails: [], attach: [], cal: [], telemetry: [], gated: [], failSms: false, failEmail: false, queue: 0, calMode: 'ok', calEvents: [], evSeq: 0, stays: [], sheetCalls: 0, reads: 0, failBatchTab: null, failAppendTab: null, failMarkRows: false };
  const hdr = tab => tabs.get(tab)[0];
  const objs = tab => { if (!tabs.has(tab)) throw new Error('Unable to parse range: ' + tab); const [h, ...rows] = tabs.get(tab); return rows.map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i] == null ? '' : r[i]); return o; }); };
  const json = (b, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => b });
  const stubs = {
    fetchConfig: async () => Object.assign({}, W.cfg), fetchTab: async (env, tab) => (W.sheetCalls++, W.reads++, objs(tab)), fetchTabs: async (env, ts) => (W.sheetCalls++, W.reads++, ts.map(x => objs(x))), /* real addRow / updateRow / ensureColumns each make 1-2 Sheets calls; the fakes below charge the same */
    invalidateTabCache: () => {}, json,
    sheetsRequest: async (env, method, path, body) => {
      W.sheetCalls++; let m; if (method === 'GET') W.reads++;
      if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map(title => ({ properties: { title } })) };
      if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
      if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { if (!tabs.has(m[1])) throw new Error('Unable to parse range'); return { values: tabs.get(m[1]).map(r => r.slice()) }; }
      if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const first = tabs.get(m[1]).length + 1; if (W.failAppendTab !== m[1]) for (const r of body.values) tabs.get(m[1]).push(r.slice()); return { updates: { updatedRange: m[1] + '!A' + first } }; }
      if (method === 'POST' && path === '/values:batchUpdate') {
        if (W.throwOnceBatch) { W.throwOnceBatch = false; throw new Error('Sheets hiccup'); }
        for (const d of body.data) { const mm = /^([^!]+)!([A-Z]+)(\d+)$/.exec(d.range); if (!mm) throw new Error('bad range ' + d.range); if (W.failBatchTab === mm[1]) continue; /* accepted but never lands */ const rows = tabs.get(mm[1]); const row = rows[parseInt(mm[3], 10) - 1]; row[colIdx(mm[2])] = d.values[0][0]; }
        return { totalUpdatedCells: body.data.length };
      }
      throw new Error('fake sheets: unsupported ' + method + ' ' + path);
    },
    ensureColumns: async (env, tab, cols) => { W.sheetCalls++; W.reads++; if (!tabs.has(tab)) tabs.set(tab, []); const rows = tabs.get(tab); if (!rows.length) rows.push([]); for (const c of cols) if (!rows[0].includes(c)) { rows[0].push(c); for (let i = 1; i < rows.length; i++) rows[i].push(''); } },
    addRow: async (env, tab, body) => { W.sheetCalls += 2; W.reads++; const h = hdr(tab), idc = h.indexOf('ID'); const next = tabs.get(tab).slice(1).reduce((m, r) => Math.max(m, parseInt(r[idc]) || 0), 0) + 1; tabs.get(tab).push(h.map(k => k === 'ID' ? String(next) : (body[k] != null ? String(body[k]) : ''))); return json({ success: true, id: String(next) }); },
    updateRow: async (env, tab, id, fields) => { W.sheetCalls += 2; W.reads++; const h = hdr(tab), idc = h.indexOf('ID'), row = tabs.get(tab).slice(1).find(r => String(r[idc]) === String(id)); if (!row) return json({ error: 'Row not found' }, 404); for (const [k, v] of Object.entries(fields)) { const ci = h.indexOf(k); if (ci >= 0) row[ci] = String(v); } return json({ success: true }); },
    setConfigKey: async (env, b) => { W.cfg[b.key] = b.value; return json({ success: true }); },
    logTelemetry: async (env, rec) => { W.telemetry.push(rec); },
    getMessageTemplate: async () => null,
    smsGatedSend: async (env, o) => { W.sheetCalls += 8; W.reads += 3; W.gated.push(o); if (W.failSms) return { send_ok: true, sent: false, queued_id: 'q' + (++W.queue), gate_snapshot: 'ok' }; W.sms.push({ to: o.vendor && o.vendor.Name, type: o.message_type, text: o.message_body, bypass: o.bypassQuietHours }); return { send_ok: true, sent: true, queued_id: 'q' + (++W.queue), test_mode: false }; },
    sendSMS: async (env, to, text) => { W.brett.push({ to, text }); return { sid: 'x' }; },
    gmailSendEmail: async (env, e) => { W.emails.push(e); return { staged: true }; },
    gmailSendEmailWithAttachment: async (env, e) => { if (W.failEmail) throw new Error('gmail down'); W.attach.push(e); return { staged: true }; },
    inspCalStaged: () => !!opts.calStaged, getCalendarAccessToken: async () => 'tok',
    inspStrReadIcs: async () => W.stays.map(s => ({ summary: s.guest, start: { date: s.start }, end: { date: s.end } })), inspStrReadGoogle: async () => [],
    schedStep: async (name, fn, errors) => { try { return await fn(); } catch (e) { errors.push({ step: name, error: String(e.message) }); } },
    schedErrText: e => String((e && e.message) || e), isStaging: () => true,
    normalizePhone: p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : (d.length === 11 && d[0] === '1' ? '+' + d : ''); },
    inspRandToken: n => 'tok' + Math.random().toString(36).slice(2).padEnd(30, 'x'),
    _utf8B64url: s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    BUILD_VERSION: 'test', PORTAL_BASE: 'https://portal.test', CORS: {},
    fetch: async (url, init) => {
      const method = (init && init.method) || 'GET', body = init && init.body ? JSON.parse(init.body) : null;
      W.cal.push({ method, url, body });
      const mid = /\/events\/([^?/]+)/.exec(url), isList = /\/events\?/.test(url);
      if (method === 'GET' && isList) { if (W.calMode === 'down') return new Response('boom', { status: 500 }); return new Response(JSON.stringify({ items: W.calEvents.map(e => ({ id: e.id, status: 'confirmed', summary: e.summary, start: e.start, end: e.end, extendedProperties: e.extendedProperties })) }), { status: 200 }); }
      if (W.calMode === 'perm') return new Response(JSON.stringify({ error: { code: 403, message: 'Forbidden' } }), { status: 403 });
      if (method === 'DELETE') { if (W.calMode !== 'ghost') { const i = W.calEvents.findIndex(e => e.id === decodeURIComponent(mid[1])); if (i < 0) return new Response('gone', { status: 410 }); W.calEvents.splice(i, 1); } return new Response(null, { status: 204 }); }
      if (method === 'POST') { const id = 'gen' + (++W.evSeq); if (W.calMode !== 'ghost') W.calEvents.push({ id, summary: body.summary, start: body.start, end: body.end, extendedProperties: body.extendedProperties }); return new Response(JSON.stringify({ id }), { status: 200 }); }
      if (method === 'PATCH') { const e = W.calEvents.find(x => x.id === decodeURIComponent(mid[1])); if (e && W.calMode !== 'ghost') Object.assign(e, { summary: body.summary, start: body.start, end: body.end, extendedProperties: body.extendedProperties }); return new Response(JSON.stringify({ id: decodeURIComponent(mid[1]) }), { status: 200 }); }
      return new Response('{}', { status: 200 });
    },
  };
  W.stubs = stubs;
  return W;
}
const names = ['fetchConfig', 'fetchTab', 'fetchTabs', 'invalidateTabCache', 'json', 'sheetsRequest', 'ensureColumns', 'addRow', 'updateRow', 'setConfigKey', 'logTelemetry', 'getMessageTemplate', 'smsGatedSend', 'sendSMS', 'gmailSendEmail', 'gmailSendEmailWithAttachment', 'inspCalStaged', 'getCalendarAccessToken', 'inspStrReadIcs', 'inspStrReadGoogle', 'schedStep', 'schedErrText', 'isStaging', 'normalizePhone', 'inspRandToken', '_utf8B64url', 'BUILD_VERSION', 'PORTAL_BASE', 'CORS', 'fetch'];
const exportsList = ['strTick', 'strAdminState', 'strAdminAssign', 'strChangePreview', 'strChangeApply', 'strCleanerMark', 'strBatchSet', 'strMatchCleaner', 'strCleanText', 'strHash', 'strExternalEvents', 'STR_DEFAULT_TEXTS', 'inspEtWallToMs', 'inspEtDate', 'inspAddDays', 'strInSendWindow', 'strOutboxDrain', 'STR_CHANGE_MAX', 'STR_TEXT_MAX', 'STR_TABS', 'strCleanerPage', 'strOfferRespond', 'strCleanerCancel', 'strCleanerIcs', 'strAdminPendingPreview', 'strAdminPendingCreate', 'strAdminPendingCancel', 'strAdminPendingConvert', 'strAdminPendingSendNow', 'strRunDigest', 'strDaysBetween', 'inspStrCleaningKind'];
let CUR = null; Object.defineProperty(globalThis, '__sheetsFetchCount', { get: () => (CUR ? CUR.sheetCalls : 0), configurable: true });
function build(W) { CUR = W; const F = new Function(...names, realFns + '\n' + realConsts + '\n' + block + '\nreturn {' + exportsList.join(',') + ', __cold: () => { __strTabsReady = false; }};'); const E = F(...names.map(n => W.stubs[n])); E.W = W; return E; }
// what one HTTP call really costs: Sheets calls + Calendar calls + Twilio + Gmail (the limit is about 50 per call)
const costNow = W => W.sheetCalls + W.cal.length + W.sms.length + W.attach.length * 4 + W.brett.length + W.emails.length * 3;
let clock = 0; Date.now = () => clock;
const held = W => W.sms.filter(s => /^str_(assigned|swapped|admin)/.test(s.type));
async function finish(E, r, planId) { let n = 0; while (r && r.status === 'applying' && n < 30) { E.__cold(); r = await J(E.strChangeApply({}, { plan_id: planId, resume: true })); n++; } return r; }
const rowsOf = (W, tab) => { if (!W.tabs.has(tab)) return []; const [h, ...r] = W.tabs.get(tab); return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] || '']))); };
const J = async r => { const o = await r; return typeof o.json === 'function' ? await o.json() : o; };
const GINA = 'TOKGINA' + 'a'.repeat(30);

function seed(W, over) {
  W.cfg = Object.assign({ admin_phone: '+15555550100', STR_ENGINE_ENABLED: 'TRUE', STR_SMS_ENABLED: 'TRUE', STR_SMS_TEST_MODE: 'FALSE', TWILIO_ENABLED: 'TRUE', STR_CAL_WRITE_ENABLED: 'TRUE', STR_GUARD_CLEANING_CAL: 'cal_x@group.calendar.google.com', STR_GUARD_BOOKING_SOURCES: 'https://feed.test/x.ics' }, over || {});
  W.tabs.set('Vendors', [['ID', 'Name', 'Phone', 'Email', 'Trade', 'Active', 'Service_Area', 'Language', 'SMS_Enabled', 'SMS_OptOut'], ['101', 'Regina Seville', '+15403364284', 'gina@x.test', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', ''], ['102', 'Kayla', '+13043590045', 'kayla@x.test', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', ''], ['103', 'Rachel Twigg', '+13048135101', '', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', '']]);
  W.tabs.set('STR_Cleaners', [['ID', 'Vendor_ID', 'Name', 'Nickname', 'Language', 'Link_Token', 'Active', 'Digest', 'Created_Date'], ['1', '101', 'Regina Seville', 'Gina', 'en', GINA, 'TRUE', 'TRUE', ''], ['2', '102', 'Kayla', 'Kayla', 'en', 'TOKKAYLA' + 'b'.repeat(30), 'TRUE', 'TRUE', ''], ['3', '103', 'Rachel Twigg', 'Rachel', 'en', 'TOKRACHEL' + 'c'.repeat(30), 'TRUE', 'TRUE', '']]);
  W.tabs.set('STR_Cleaner_Pool', [['ID', 'Property_Key', 'Cleaner_ID', 'Priority', 'Active'], ['1', 'milam-ridge', '1', '1', 'TRUE'], ['2', 'milam-ridge', '2', '2', 'TRUE'], ['3', 'milam-ridge', '3', '3', 'TRUE']]);
  const ev = (id, title, d) => ({ id, summary: title, start: { date: d }, end: { date: new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + 1)).toISOString().slice(0, 10) } });
  W.ev = ev;
  W.stays = [{ start: '2026-10-15', end: '2026-10-20', guest: 'Chase' }, { start: '2026-10-21', end: '2026-10-25', guest: 'Benjamin Myers' }, { start: '2026-10-26', end: '2026-10-30', guest: 'Linda' }, { start: '2026-11-01', end: '2026-11-08', guest: 'Julie' }, { start: '2026-11-10', end: '2026-11-12', guest: 'Zed' }];
  W.calEvents = [ev('h1', 'Gina Cleaning', '2026-10-20'), ev('h2', 'Kayla Cleaning', '2026-10-25'), ev('h3', 'Gina Cleaning', '2026-10-30')];
}
async function setup(over, mut) {
  const W = makeWorld(); seed(W, over); if (mut) mut(W);
  const E = build(W); clock = E.inspEtWallToMs('2026-10-20', '10:00');
  const r = await E.strTick({}, {}); if (!r.ok) console.log('SETUP TICK ERRORS', JSON.stringify(r.errors));
  W.gated.length = 0; W.sms.length = 0; W.brett.length = 0; W.emails.length = 0; W.attach.length = 0; W.cal.length = 0; W.telemetry.length = 0; W.sheetCalls = 0;
  return { W, E };
}
const at = (E, d, hm) => E.inspEtWallToMs(d, hm);
const K25 = 'milam-ridge|checkout|2026-10-25', K20 = 'milam-ridge|checkout|2026-10-20', K30 = 'milam-ridge|checkout|2026-10-30', K108 = 'milam-ridge|checkout|2026-11-08';
const preview = async (E, body) => { CUR = E.W; E.__cold(); const c0 = costNow(E.W), r = await J(E.strChangePreview({}, body)); const c = costNow(E.W) - c0; if (c > 48) t('preview stayed under the 50-subrequest limit (cold start)', false, c); else pass++; return r; };
// apply exactly what the preview showed (optionally editing texts)
async function sendIt(E, p, body, edit) {
  CUR = E.W;
  const texts = {}; for (const r of p.recipients) texts[r.key] = { send: r.send_default, body: r.text };
  Object.assign(texts, edit || {});
  const call = async b => { E.__cold(); const c0 = costNow(E.W), r = await J(E.strChangeApply({}, b)), c = costNow(E.W) - c0; E.W.maxCall = Math.max(E.W.maxCall || 0, c); if (c > 48) t('apply call stayed under the 50-subrequest limit (cold start)', false, { c, status: r.status, stage: r.stage }); else pass++; return r; };
  let r = await call(Object.assign({}, body, { plan_id: p.plan_id, sig: p.sig, texts })), n = 1;
  while (r && r.status === 'applying' && !r.duplicate && n < 30) { r = await call({ plan_id: p.plan_id, resume: true }); n++; }
  if (r && typeof r === 'object') r.__calls = n;
  return r;
}
const tr = (W, key) => rowsOf(W, 'STR_Turnovers').find(r => r.Task_Key === key);
const markOf = (W, cid, d) => (rowsOf(W, 'STR_Availability').find(a => a.Cleaner_ID === cid && a.Date === d) || {}).Mark;


// ── helpers for this suite ──
const PD = '2026-11-15', PK = 'milam-ridge|pending|2026-11-15', RK = 'milam-ridge|checkout|2026-11-15';
const tok = (W, id) => rowsOf(W, 'STR_Cleaners').find(c => c.ID === id).Link_Token;
const offersOf = (W, key) => rowsOf(W, 'STR_Offers').filter(o => o.Task_Key === key);
const offerOf = (W, cid, key, status) => offersOf(W, key).filter(o => o.Task_Key === key && o.Cleaner_ID === cid && (!status || o.Status === status)).pop();
const smsTo = (W, who, type) => W.sms.filter(s => String(s.to).includes(who) && (!type || s.type === type));
const alertsOf = (W, re) => rowsOf(W, 'STR_Alerts').filter(a => re.test(a.Alert_Key));
const pend = (W, key) => rowsOf(W, 'STR_Turnovers').find(r => r.Task_Key === (key || PK));
const logs = (W, ev) => rowsOf(W, 'STR_Log').filter(l => l.Event === ev);
const pendingEvents = W => W.calEvents.filter(e => e.extendedProperties && e.extendedProperties.private && e.extendedProperties.private.ridgecoStrKind === 'pending');
const calWrites = W => W.cal.filter(c => c.method !== 'GET').length;
async function world(over, mut) {
  const W = makeWorld(); seed(W, over); if (mut) mut(W);
  const orig = W.stubs.fetch;
  W.stubs.fetch = async (url, init) => { // the fake calendar also answers a single-event read (used to prove every write)
    const method = (init && init.method) || 'GET', mid = /\/events\/([^?/]+)/.exec(url);
//@@APPEND@@