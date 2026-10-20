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
    if (method === 'GET' && mid && !/\/events\?/.test(url)) { W.cal.push({ method, url, body: null }); const e = W.calEvents.find(x => x.id === decodeURIComponent(mid[1])); if (!e) return new Response('gone', { status: 404 }); return new Response(JSON.stringify({ id: e.id, status: 'confirmed', summary: e.summary, extendedProperties: e.extendedProperties }), { status: 200 }); }
    return orig(url, init);
  };
  const origU = W.stubs.updateRow; W.stubs.updateRow = async (env, tab, id, fields) => { if (W.failUpdateTab === tab) { W.sheetCalls += 2; return { ok: true, status: 200, json: async () => ({ success: true }) }; } return origU(env, tab, id, fields); }; // a write the sheet accepts but never keeps
  const E = build(W); clock = E.inspEtWallToMs('2026-10-20', '10:00');
  const r = await E.strTick({}, {}); if (!r.ok) console.log('SETUP TICK ERRORS', JSON.stringify(r.errors));
  W.gated.length = 0; W.sms.length = 0; W.brett.length = 0; W.emails.length = 0; W.attach.length = 0; W.cal.length = 0; W.telemetry.length = 0; W.sheetCalls = 0;
  return { W, E };
}
const tick = async (E, d, hm) => { CUR = E.W; if (d) clock = E.inspEtWallToMs(d, hm || '10:00'); E.__cold(); return await E.strTick({}, {}); };
async function ask(E, date, note, over) {
  CUR = E.W; E.__cold();
  const pv = await J(E.strAdminPendingPreview({}, { date, note }));
  if (!pv.ok) return { pv, cr: pv };
  E.__cold(); const c0 = costNow(E.W);
  const cr = await J(E.strAdminPendingCreate({}, Object.assign({ date, note, sig: pv.plan.sig, text: pv.plan.text }, over || {})));
  const c = costNow(E.W) - c0; if (c > 48) t('create stayed under the 50-subrequest limit', false, c); else pass++;
  return { pv, cr };
}
async function answer(E, who, action, offerId) { CUR = E.W; E.__cold(); const c0 = costNow(E.W), r = await J(E.strOfferRespond({}, { k: tok(E.W, who), offer_id: offerId, action })), c = costNow(E.W) - c0; if (c > 48) t('answer stayed under the 50-subrequest limit', false, c); else pass++; return r; }
async function heldByKayla(over, mut) {
  const w = await world(over, mut), { W, E } = w;
  const a = await ask(E, PD, 'TEST-inquiry');
  const g = offerOf(W, '1', PK); await answer(E, '1', 'decline', g.ID);
  const k = offerOf(W, '2', PK, 'pending'), y = await answer(E, '2', 'accept', k.ID);
  return Object.assign(w, { a, y, k });
}
const BOOK = (W, s, e, g) => W.stays.push({ start: s, end: e, guest: g || 'Pat' });
const pageOf = async (E, id) => J(E.strCleanerPage({}, new URL('https://x.test/str/c/page?k=' + tok(E.W, id))));

// ═══ 0. static checks ═══
{
  t('routes wired', ['preview', 'create', 'cancel', 'convert', 'send-now'].every(r => src.includes(`path === '/str/admin/pending/${r}'`)));
  t('staging guard: preview open; create only with a TEST- note; cancel/convert/send-now only on a TEST- inquiry', /pending\/preview'\) return true/.test(src) && /pending\/create'\) return String\(\(body && body\.note\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src) && /pending\/cancel' \|\| path === '\/str\/admin\/pending\/convert'.*Pending_Note \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
  const W0 = makeWorld(); const E0 = build(W0), D = E0.STR_DEFAULT_TEXTS;
  for (const ty of ['str_pending_offer', 'str_pending_yes', 'str_pending_booked', 'str_pending_cancelled']) {
    const m = new RegExp("Message_Type: '" + ty + "', Channel: 'sms', Subject: '', Body:\\s*\\n\\s*\"([^\"]*)\"").exec(src);
    t('seeded template ' + ty + ' matches the built-in wording', !!m && m[1] === D[ty], m && m[1]);
    t(ty + ' never says primary / rank / priority / backup 1', !/primary|rank|priority|backup (1|2)/i.test(D[ty]));
  }
  t('offer / yes / cancelled texts state no deadline', ['str_pending_offer', 'str_pending_yes', 'str_pending_cancelled'].every(ty => !/\b(deadline|within|reply by|hours?)\b/i.test(D[ty])));
  t('offer wording: not booked yet, asks "if it does book", asks for an answer as soon as you can', /it isn't booked yet/.test(D.str_pending_offer) && /if it does book/.test(D.str_pending_offer) && /as soon as you can/.test(D.str_pending_offer) && /\{Link\}/.test(D.str_pending_offer));
  t('yes-reply wording is exactly the approved text', D.str_pending_yes === "Thanks - we'll let you know if it books. Nothing is confirmed yet.");
  t('booked text says it is now booked and asks to update availability', /now booked/.test(D.str_pending_booked) && /update your availability/.test(D.str_pending_booked));
  t('guard: a "(PENDING)" title is never read as a cleaner on the calendar', E0.inspStrCleaningKind('Gina Cleaning (PENDING)') === '' && E0.inspStrCleaningKind('Gina Cleaning') === 'cleaner' && E0.inspStrCleaningKind('Gina cleaning - tentative') === '');
  t('new columns are provisioned on STR_Turnovers', ['Pending', 'Pending_Note', 'Pending_Text', 'Pending_Mail', 'Pending_Cal', 'Pending_Body', 'Converted_To', 'Manual_Until'].every(c => E0.STR_TABS.STR_Turnovers.includes(c)));
}

// ═══ 1. Brett asks about a date: preview writes nothing, then create asks Gina (first in the queue) ═══
{
  const { W, E } = await world(); CUR = W;
  const before = rowsOf(W, 'STR_Turnovers').length, offersBefore = rowsOf(W, 'STR_Offers').length;
  E.__cold(); let c0 = costNow(W);
  const pv = await J(E.strAdminPendingPreview({}, { date: PD, note: 'TEST-family of 4' }));
  t('preview ok, no rows written, no text sent', pv.ok && rowsOf(W, 'STR_Turnovers').length === before && rowsOf(W, 'STR_Offers').length === offersBefore && !W.sms.length && !W.gated.length, pv);
  t('preview stayed under the subrequest limit', costNow(W) - c0 <= 48, costNow(W) - c0);
  t('preview: Gina is first, then Kayla, then Rachel (queue order)', pv.plan.first.first === 'Gina' && pv.plan.queue.map(q => q.name + ':' + q.state).join() === 'Gina:first,Kayla:then,Rachel:then', pv.plan.queue);
  t('preview shows the exact text with the link placeholder, "not booked yet", no deadline', /isn't booked yet/.test(pv.plan.text) && /\{Link\}/.test(pv.plan.text) && !/ by |deadline|hours/i.test(pv.plan.text) && /Hi Gina/.test(pv.plan.text), pv.plan.text);
  t('preview says it sends right away inside 8 AM - 9 PM', pv.plan.send_mode === 'now' && pv.plan.in_window === true);
  for (const [name, body, code] of [['past date', { date: '2026-10-19' }, 'past_date'], ['garbage date', { date: 'soon' }, 'bad_date'], ['date with a real turnover', { date: '2026-10-25' }, 'already_booked'], ['too far out', { date: '2027-06-01' }, 'too_far']]) {
    const r = await J(E.strAdminPendingPreview({}, body)); t('preview rejects ' + name, r.ok === false && r.error === code, r);
  }
  const bad = await J(E.strAdminPendingCreate({}, { date: PD, note: 'x', sig: 'wrong', text: pv.plan.text })); t('create with a stale / wrong preview signature is refused and writes nothing', bad.ok === false && bad.error === 'stale_preview' && rowsOf(W, 'STR_Turnovers').length === before && !W.sms.length, bad);
  const empty = await J(E.strAdminPendingCreate({}, { date: PD, note: 'x', sig: pv.plan.sig, text: '' })); t('create with an empty text is refused', empty.ok === false && empty.error === 'text_empty' && rowsOf(W, 'STR_Turnovers').length === before, empty);

  const custom = 'Hi Gina, tiny favour: might we need you for Nov 15 at Milam Ridge? Not booked yet. Tap here: {Link}';
  E.__cold(); c0 = costNow(W);
  const cr = await J(E.strAdminPendingCreate({}, { date: PD, note: 'TEST-family of 4', sig: pv.plan.sig, text: custom }));
  t('create ok, Gina asked, one text', cr.ok && cr.advance && cr.advance.action === 'offered' && W.sms.length === 1 && W.sms[0].to.includes('Regina') && W.sms[0].type === 'str_pending_offer', { cr, sms: W.sms });
  t('create stayed under the subrequest limit', costNow(W) - c0 <= 48, costNow(W) - c0);
  t("Brett's edited wording is what was sent, with her own link in place of {Link}", /tiny favour/.test(W.sms[0].text) && /cleaner\.html\?k=TOKGINA/.test(W.sms[0].text) && /offer=/.test(W.sms[0].text) && !/\{Link\}/.test(W.sms[0].text), W.sms[0].text);
  const p = pend(W);
  t('pending row: Pending=TRUE, status offering, note kept, one offer pending for Gina', p && p.Pending === 'TRUE' && p.Status === 'offering' && p.Pending_Note === 'TEST-family of 4' && offersOf(W, PK).length === 1 && offersOf(W, PK)[0].Status === 'pending', { p, o: offersOf(W, PK) });
  t('status reads "Waiting on Gina"', cr.status.label === 'Waiting on Gina', cr.status);
  const dup = await J(E.strAdminPendingCreate({}, { date: PD, note: 'TEST-family of 4', sig: pv.plan.sig, text: custom }));
  t('pressing Create again does not ask again or add a second row', dup.ok === false && dup.error === 'already_pending' && W.sms.length === 1 && rowsOf(W, 'STR_Turnovers').filter(r => r.Pending === 'TRUE').length === 1, dup);
  t('log has the creation and the offer', logs(W, 'pending_created').length === 1 && logs(W, 'offer_sent').filter(l => l.Task_Key === PK).length === 1);
  await tick(E, null); await tick(E, null);
  t('no NOT COVERED alert is ever raised for a pending date', alertsOf(W, /^unc\|/).filter(a => /11-15|pending/.test(a.Alert_Key)).length === 0);
  t('no red block and no (PENDING) event while nobody has said yes', !W.calEvents.some(e => e.start && e.start.date === PD) && !W.calEvents.some(e => e.start && e.start.dateTime && /2026-11-15/.test(e.start.dateTime)), W.calEvents.filter(e => /11-15/.test(JSON.stringify(e.start))));
  const st = await J(E.strAdminState({})); t('admin state lists it in "pending", not in the real turnovers', st.pending.length === 1 && st.pending[0].key === PK && st.pending[0].status_label === 'Waiting on Gina' && !st.tasks.some(x => x.date === PD), st.pending);
  t('the original real turnovers are untouched (no pending key among them)', st.tasks.every(x => !/pending/.test(x.key)));
  const page = await pageOf(E, '1'), mine = page.pending[0];
  t("Gina's page: pending date marked \"Pending - not booked\" with the question for her; real tasks list has no pending", page.pending.length === 1 && mine.status_label === 'Pending - not booked' && mine.offer_id && !page.tasks.some(x => x.date === PD) && !page.offers.some(o => /pending/.test(o.task_key)), page.pending);
  const page2 = await pageOf(E, '3'); t("Rachel's page lists the date too (so she can mark backup) but has no question", page2.pending.length === 1 && !page2.pending[0].offer_id, page2.pending);
  const ics = await E.strCleanerIcs({}, new URL('https://x.test/str/c/ics?k=' + tok(W, '1'))); t('the .ics file has no pending date', !/20261115/.test(await ics.text()));
  const dg = await E.strRunDigest({}, { dry: true }); t('digest never lists the pending date', !JSON.stringify(dg).includes('Nov 15'));
}

// ═══ 2. Passing, saying yes, backups, the tentative hold ═══
{
  const { W, E, y, k } = await heldByKayla(); CUR = W;
  const gOff = offerOf(W, '1', PK);
  t('Gina said no: her offer is declined and Kayla was asked next with the pending wording', gOff.Status === 'declined' && smsTo(W, 'Kayla', 'str_pending_offer').length === 1, W.sms);
  t("Kayla's yes is a TENTATIVE HOLD: status pending_held, held via pending_yes, not assigned", y.ok && y.result === 'held' && pend(W).Status === 'pending_held' && pend(W).Assigned_Cleaner_ID === '2' && pend(W).Assigned_Via === 'pending_yes', { y, p: pend(W) });
  t('she gets exactly the approved "nothing is confirmed" text, once', smsTo(W, 'Kayla', 'str_pending_yes').length === 1 && smsTo(W, 'Kayla', 'str_pending_yes')[0].text === "Thanks - we'll let you know if it books. Nothing is confirmed yet.", smsTo(W, 'Kayla'));
  t('nobody got an "assigned" or "filled" text, and the real turnovers have no row for the date', !W.sms.some(s => /assigned|filled/.test(s.type)) && !rowsOf(W, 'STR_Turnovers').some(r => r.Task_Key === RK));
  t('Brett was told right away that Kayla CAN do it (tentative, you can accept the booking)', W.brett.some(b => /PENDING DATE: Kayla CAN clean/.test(b.text) && /accept the booking/.test(b.text)), W.brett);
  const st0 = await J(E.strAdminState({})); t('status reads "Held by Kayla - tentative"', st0.pending[0].status_label === 'Held by Kayla - tentative' && st0.pending[0].held_by === 'Kayla', st0.pending[0]);
  const again = await answer(E, '2', 'accept', k.ID); t('saying yes twice is harmless: "already", no second text', again.result === 'already_yours' && smsTo(W, 'Kayla', 'str_pending_yes').length === 1, again);
  await tick(E, null);
  const ev = pendingEvents(W);
  t('the tick puts ONE all-day "Kayla Cleaning (PENDING)" event on the calendar with the Hub marks and a pending flag', ev.length === 1 && ev[0].summary === 'Kayla Cleaning (PENDING)' && ev[0].start.date === PD && ev[0].end.date === '2026-11-16' && ev[0].extendedProperties.private.ridgecoStr === '1' && ev[0].extendedProperties.private.ridgecoStrKey === PK && ev[0].extendedProperties.private.ridgecoStrPending === '1', ev);
  const w0 = calWrites(W); await tick(E, null); t('a second tick writes nothing more to the calendar', calWrites(W) === w0 && pendingEvents(W).length === 1);
  t('no NOT COVERED alert for a held pending date', alertsOf(W, /^unc\|/).filter(a => /11-15/.test(a.Alert_Key)).length === 0);
  const ics = await (await E.strCleanerIcs({}, new URL('https://x.test/str/c/ics?k=' + tok(W, '2')))).text(); t("a tentative hold is not on her calendar file", !/20261115/.test(ics));
  const pg = await pageOf(E, '2'); t('her page shows "You said yes - tentative" and lets her give it back', pg.pending[0].held_by_me && pg.pending[0].can_release && pg.pending[0].status_label === 'You said yes - tentative', pg.pending);
  const pr = await pageOf(E, '3'); t('Rachel sees it only as "Pending - not booked"', !pr.pending[0].held_by_me && pr.pending[0].held_by_other && pr.pending[0].status_label === 'Pending - not booked');
  const late = await answer(E, '1', 'accept', gOff.ID); t('a cleaner who already passed cannot take the hold from Kayla', late.result === 'filled' || late.result === 'already', late);
  t("the hold is still Kayla's", pend(W).Assigned_Cleaner_ID === '2' && pend(W).Status === 'pending_held');
}

// ═══ 3. Nobody says yes ═══
{
  const { W, E } = await world(); CUR = W;
  await ask(E, PD, 'TEST-none');
  for (const [cid, who] of [['1', 'Gina'], ['2', 'Kayla'], ['3', 'Rachel']]) { const o = offerOf(W, cid, PK, 'pending'); t(who + ' was asked in queue order', !!o, offersOf(W, PK)); if (o) await answer(E, cid, 'decline', o.ID); }
  const st = await J(E.strAdminState({}));
  t('queue exhausted: status exhausted, label "Nobody available"', pend(W).Status === 'exhausted' && st.pending[0].status_label === 'Nobody available', pend(W));
  t('Brett told right away that nobody can do it (one alert)', alertsOf(W, /^pnone\|/).length === 1 && W.brett.filter(b => /nobody can clean/i.test(b.text)).length === 1, W.brett);
  const n = W.brett.length; await tick(E, null); await tick(E, null);
  t('further ticks do not repeat the "nobody" alert and raise no NOT COVERED alert', W.brett.length === n && alertsOf(W, /^unc\|/).filter(a => /11-15/.test(a.Alert_Key)).length === 0, W.brett.slice(n));
  t('exactly three texts went out (one per cleaner)', W.sms.filter(s => s.type === 'str_pending_offer').length === 3);
}

// ═══ 4. Send window: respected by default, "send now even if late" is explicit ═══
{
  const { W, E } = await world(); CUR = W; clock = at(E, '2026-10-20', '22:30');
  const pv = await J(E.strAdminPendingPreview({}, { date: PD, note: 'TEST-late' }));
  t('preview at 10:30 PM says it will wait until 8 AM and offers "send now"', pv.plan.send_mode === 'after_window' && pv.plan.in_window === false && /8 AM/.test(pv.plan.send_when), pv.plan);
  const cr = await J(E.strAdminPendingCreate({}, { date: PD, note: 'TEST-late', sig: pv.plan.sig, text: pv.plan.text }));
  t('default: nothing is texted at night; saved as "Not asked yet"', cr.ok && cr.advance.action === 'waiting_send_window' && !W.sms.length && pend(W).Status === 'open' && cr.status.label === 'Not asked yet', cr);
  await tick(E, '2026-10-20', '23:10'); t('a tick at night still sends nothing', !W.sms.length);
  const st = await J(E.strAdminState({})); t('board marks it as waiting for 8 AM and can send now', st.pending[0].waiting_for_window === true && st.pending[0].can_send_now && st.pending[0].next_up === 'Gina', st.pending[0]);
  await tick(E, '2026-10-21', '08:05'); t('the first tick after 8 AM asks Gina', smsTo(W, 'Regina', 'str_pending_offer').length === 1 && offerOf(W, '1', PK, 'pending'), W.sms);
}
{
  const { W, E } = await world(); CUR = W; clock = at(E, '2026-10-20', '22:30');
  await ask(E, PD, 'TEST-late'); t('(setup) waiting', !W.sms.length);
  E.__cold(); const c0 = costNow(W), r = await J(E.strAdminPendingSendNow({}, { task_key: PK }));
  t('"Send now even if late" texts Gina immediately at 10:30 PM', r.ok && r.result.action === 'offered' && smsTo(W, 'Regina', 'str_pending_offer').length === 1, r);
  t('send-now stayed under the subrequest limit', costNow(W) - c0 <= 48, costNow(W) - c0);
  const r2 = await J(E.strAdminPendingSendNow({}, { task_key: PK })); t('pressing it again does not text twice', smsTo(W, 'Regina').length === 1 && r2.result.action === 'waiting_reply', r2);
  await answer(E, '1', 'decline', offerOf(W, '1', PK, 'pending').ID);
  t('after a pass at night the next cleaner is NOT texted until 8 AM (a pending date is never urgent)', !smsTo(W, 'Kayla').length && (await J(E.strAdminState({}))).pending[0].status_label === 'Waiting to ask the next cleaner');
}

// ═══ 5. The booking arrives: automatic conversion ═══
{
  const { W, E } = await heldByKayla(); CUR = W;
  await tick(E, null); const evId = pendingEvents(W)[0].id; W.sms.length = 0; W.attach.length = 0; W.brett.length = 0; W.cal.length = 0;
  BOOK(W, '2026-11-13', PD, 'Pat');
  const r = await tick(E, null);
  const real = pend(W, RK), p = pend(W);
  t('tick ok', r.ok, r.errors);
  t('the real checkout turnover now exists and the HOLDER is assigned (via pending_converted)', real && real.Status === 'covered' && real.Assigned_Cleaner_ID === '2' && real.Assigned_Via === 'pending_converted', real);
  t('the pending row is marked converted and points to the real turnover', p.Status === 'pending_converted' && p.Converted_To === RK, p);
  t('Kayla got exactly one "now booked" text', smsTo(W, 'Kayla', 'str_pending_booked').length === 1 && /now booked/.test(smsTo(W, 'Kayla')[0].text) && /update your availability/.test(smsTo(W, 'Kayla')[0].text), W.sms);
  t('she got a calendar invite email (one)', W.attach.length === 1 && W.attach[0].to === 'kayla@x.test', W.attach.map(a => a.to));
  t('nobody else was texted (Gina passed, Rachel never asked), and no "slot filled" texts', W.sms.length === 1 && !W.sms.some(s => /filled|backup/.test(s.type)), W.sms);
  const evs = W.calEvents.filter(e => e.start && e.start.date === PD);
  t('the (PENDING) event became the normal "Kayla Cleaning" event IN PLACE (same id, real key, no pending flag), no duplicate', evs.length === 1 && evs[0].id === evId && evs[0].summary === 'Kayla Cleaning' && evs[0].extendedProperties.private.ridgecoStrKey === RK && evs[0].extendedProperties.private.ridgecoStrKind === 'cover' && !evs[0].extendedProperties.private.ridgecoStrPending, evs);
  t('the conversion was proven by a re-read of the event', W.cal.some(c => c.method === 'PATCH') && W.cal.some(c => c.method === 'GET' && /\/events\/[^?]+\?fields=id,status,summary/.test(c.url)));
  t('Pending_Text / Pending_Mail show sent', /^sent:/.test(p.Pending_Text) && /^sent:/.test(p.Pending_Mail), p);
  t('log has pending_converted and pending_booked_text_sent', logs(W, 'pending_converted').length === 1 && logs(W, 'pending_booked_text_sent').length === 1);
  t('no NOT COVERED alert fired', alertsOf(W, /^unc\|/).filter(a => /11-15/.test(a.Alert_Key)).length === 0);
  W.sms.length = 0; W.attach.length = 0; W.brett.length = 0; const w0 = calWrites(W), sig = () => JSON.stringify(rowsOf(W, 'STR_Turnovers').map(r => [r.Task_Key, r.Status, r.Assigned_Cleaner_ID, r.Pending_Text, r.Pending_Mail, r.Pending_Cal])), s0 = sig(), lg0 = rowsOf(W, 'STR_Log').length;
  await tick(E, null); await tick(E, null); await tick(E, null, '10:20');
  t('conversion run again and again: no text, no email, no calendar write, no state change, no new log rows', !W.sms.length && !W.attach.length && calWrites(W) === w0 && sig() === s0 && rowsOf(W, 'STR_Log').length === lg0, { sms: W.sms });
  const st = await J(E.strAdminState({})); t('board shows "Booked - confirmed (Kayla is on the schedule)" and the real turnover as covered', /Booked - confirmed \(Kayla is on the schedule\)/.test(st.pending[0].status_label) && st.tasks.find(x => x.key === RK).status === 'covered', st.pending[0]);
  const mc = await J(E.strAdminPendingConvert({}, { task_key: PK })); t('pressing "Mark as booked now" afterwards does nothing (already closed, no text)', mc.ok && mc.already && !W.sms.length, mc);
  const cn = await J(E.strAdminPendingCancel({}, { task_key: PK, notify: true })); t('cancelling a converted inquiry does nothing (no text)', cn.ok && cn.already && !W.sms.length, cn);
  const ics = await (await E.strCleanerIcs({}, new URL('https://x.test/str/c/ics?k=' + tok(W, '2')))).text(); t('her calendar file now carries the real date', /20261115/.test(ics));
}

// ═══ 6. Booking appears while Kayla is still being asked (nobody held it yet) ═══
{
  const { W, E } = await world(); CUR = W;
  await ask(E, PD, 'TEST-mid'); await answer(E, '1', 'decline', offerOf(W, '1', PK).ID);
  const kOff = offerOf(W, '2', PK, 'pending'); t('(setup) Kayla has the question out', !!kOff);
  W.sms.length = 0; BOOK(W, '2026-11-13', PD);
  const r = await tick(E, null); t('tick ok', r.ok, r.errors);
  const real = pend(W, RK), p = pend(W);
  t('inquiry converted with no holder; real turnover is an ordinary one with the offer moved onto it', p.Status === 'pending_converted' && real && real.Status === 'offering' && p.Pending_Text === '' && offerOf(W, '2', RK, 'pending') && offerOf(W, '2', RK, 'pending').ID === kOff.ID, { p, real, o: offersOf(W, RK) });
  t('Gina, who passed, is remembered as passed on the real date; the conversion re-texts nobody', offerOf(W, '1', RK, 'declined') && !W.sms.length, W.sms);
  t('no "now booked" text, no invite (nobody held it)', !W.sms.some(s => s.type === 'str_pending_booked') && !W.attach.length);
  const ans = await answer(E, '2', 'accept', kOff.ID);
  t("Kayla's reply to the (earlier) question now makes her the real assignee, with the normal 'you're set' text", ans.result === 'accepted' && pend(W, RK).Status === 'covered' && pend(W, RK).Assigned_Cleaner_ID === '2' && smsTo(W, 'Kayla', 'str_assigned').length === 1, ans);
  await tick(E, null); t('the calendar then shows the normal event (no pending one)', W.calEvents.some(e => e.summary === 'Kayla Cleaning' && e.start.date === PD) && !pendingEvents(W).length);
}
{
  const { W, E } = await world(); CUR = W;
  await ask(E, PD, 'TEST-mid2'); await answer(E, '1', 'decline', offerOf(W, '1', PK).ID);
  const kOff = offerOf(W, '2', PK, 'pending'); BOOK(W, '2026-11-13', PD); await tick(E, null);
  W.sms.length = 0; await answer(E, '2', 'decline', kOff.ID);
  t('after Kayla passes on the booked date Rachel is asked with the normal offer wording; Gina is never asked again', smsTo(W, 'Rachel', 'str_offer').length === 1 && !smsTo(W, 'Regina').length, W.sms);
}
{
  const { W, E } = await world(); CUR = W; clock = at(E, '2026-10-20', '22:30');
  await ask(E, PD, 'TEST-night'); BOOK(W, '2026-11-13', PD); await tick(E, '2026-10-20', '22:40');
  t('converted with nobody asked: ordinary open turnover, no pending text went out, no assignment', pend(W).Status === 'pending_converted' && pend(W, RK).Status === 'open' && !W.sms.length, { p: pend(W), real: pend(W, RK) });
  await tick(E, '2026-10-21', '08:05'); t('at 8 AM the normal queue asks Gina with the normal offer wording', smsTo(W, 'Regina', 'str_offer').length === 1 && !smsTo(W, 'Regina', 'str_pending_offer').length, W.sms);
}

// ═══ 7. Edge cases of matching ═══
{
  const { W, E } = await heldByKayla(); CUR = W; W.sms.length = 0; W.attach.length = 0;
  BOOK(W, '2026-11-13', PD, 'Pat'); BOOK(W, '2026-11-14', PD, 'Quinn');
  const r = await tick(E, null); await tick(E, null);
  t('two stays ending the same day: one real turnover, one conversion, one text, one invite', r.ok && rowsOf(W, 'STR_Turnovers').filter(x => x.Task_Key === RK).length === 1 && smsTo(W, 'Kayla', 'str_pending_booked').length === 1 && W.attach.length === 1 && logs(W, 'pending_converted').length === 1, { sms: W.sms });
}
{
  const { W, E } = await heldByKayla(); CUR = W; W.sms.length = 0; W.brett.length = 0;
  BOOK(W, '2026-11-14', '2026-11-16', 'Pat');
  await tick(E, null); await tick(E, null);
  t('adjacent-day booking: the inquiry is NOT converted and Kayla keeps a tentative hold', pend(W).Status === 'pending_held' && pend(W).Assigned_Cleaner_ID === '2' && !pend(W, RK));
  t('Brett is told ONCE that a booking ends a day away and was not matched', alertsOf(W, /^padj\|/).length === 1 && W.brett.filter(b => /NOT matched|Not matched automatically|checks out on/.test(b.text)).length === 1, W.brett);
  t('the new date goes through the normal path: a real turnover for Nov 16 exists, nobody is assigned to it from the inquiry, and no pending text is used', pend(W, 'milam-ridge|checkout|2026-11-16') && pend(W, 'milam-ridge|checkout|2026-11-16').Assigned_Via !== 'pending_converted' && !W.sms.some(s => /pending/.test(s.type)), pend(W, 'milam-ridge|checkout|2026-11-16'));
  t('Kayla was not texted anything', !smsTo(W, 'Kayla').length);
  const cn = await J(E.strAdminPendingCancel({}, { task_key: PK })); await tick(E, null);
  t('cancelling it removes the tentative calendar event and texts nobody', cn.ok && !pendingEvents(W).length && !smsTo(W, 'Kayla').length && pend(W).Status === 'pending_cancelled', cn);
}
{
  const { W, E } = await heldByKayla(); CUR = W; W.sms.length = 0; W.brett.length = 0; W.attach.length = 0;
  BOOK(W, '2026-11-13', PD, 'Pat'); W.calEvents.push(W.ev('hx', 'Rachel Cleaning', PD));
  const r = await tick(E, null);
  t('booked but already covered by a hand-typed entry: the real turnover keeps it; Kayla NOT assigned, NOT texted; Brett told', pend(W, RK).Status === 'ext_covered' && pend(W).Status === 'pending_converted' && /conflict/.test(pend(W).Pending_Text) && !W.sms.length && !W.attach.length && W.brett.some(b => /ALREADY COVERED/.test(b.text)), { r: r.errors, p: pend(W), real: pend(W, RK), brett: W.brett });
}

// ═══ 8. The held cleaner cancels (or marks herself out): the backup mechanism promotes the next one ═══
{
  const { W, E } = await heldByKayla(); CUR = W;
  await tick(E, null); t("(setup) Kayla's (PENDING) event exists", pendingEvents(W).length === 1);
  W.sms.length = 0; W.brett.length = 0;
  await J(E.strCleanerMark({}, { k: tok(W, '3'), marks: [{ date: PD, mark: 'can' }] }));
  E.__cold(); const c0 = costNow(W), r = await J(E.strCleanerCancel({}, { k: tok(W, '2'), task_key: PK }));
  t('Kayla gave the hold back: ok', r.ok, r); t('release stayed under the subrequest limit', costNow(W) - c0 <= 48, costNow(W) - c0);
  await tick(E, null); // (anything the call had no room for is done by the scheduler)
  t('Rachel (marked available as backup) is asked next - exactly once - with the pending wording, not the normal one', smsTo(W, 'Rachel', 'str_pending_offer').length === 1 && !W.sms.some(s => s.type === 'str_offer' || s.type === 'str_promote'), W.sms);
  t('Kayla is marked out for that date; the pending row is back to offering, no holder', markOf(W, '2', PD) === 'out' && pend(W).Status === 'offering' && pend(W).Assigned_Cleaner_ID === '', pend(W));
  t('Brett is told the hold was released', W.brett.some(b => /PENDING HOLD RELEASED: Kayla/.test(b.text)), W.brett);
  await tick(E, null); t("the tentative event for Kayla is removed", pendingEvents(W).length === 0);
  const rOff = offerOf(W, '3', PK, 'pending'); await answer(E, '3', 'accept', rOff.ID); await tick(E, null);
  t('Rachel says yes: she now holds it and the (PENDING) event is hers', pend(W).Assigned_Cleaner_ID === '3' && pendingEvents(W).length === 1 && pendingEvents(W)[0].summary === 'Rachel Cleaning (PENDING)', pendingEvents(W));
  const rr = await J(E.strCleanerCancel({}, { k: tok(W, '2'), task_key: PK })); t('someone who does not hold it cannot give it back', rr.ok === false && rr.error === 'not_yours', rr);
}
{
  const { W, E } = await heldByKayla(); CUR = W; W.sms.length = 0; W.brett.length = 0;
  const r = await J(E.strCleanerMark({}, { k: tok(W, '2'), marks: [{ date: PD, mark: 'out' }] }));
  await tick(E, null);
  t('marking out on a held pending date gives the hold back and the next cleaner is asked', r.ok && pend(W).Assigned_Cleaner_ID === '' && smsTo(W, 'Rachel', 'str_pending_offer').length === 1 && W.brett.some(b => /HOLD RELEASED/.test(b.text)), { r, sms: W.sms });
}
{
  const { W, E } = await world(); CUR = W; await ask(E, PD, 'TEST-markout'); W.sms.length = 0;
  await J(E.strCleanerMark({}, { k: tok(W, '1'), marks: [{ date: PD, mark: 'out' }] }));
  t('marking out while she is the one being asked counts as a pass: Kayla is asked next', offerOf(W, '1', PK).Status === 'declined' && smsTo(W, 'Kayla', 'str_pending_offer').length === 1, W.sms);
}

// ═══ 9. Expiry: the date passes with no booking ═══
{
  const { W, E } = await heldByKayla(); CUR = W; await tick(E, null); t('(setup) tentative event present', pendingEvents(W).length === 1);
  W.sms.length = 0; W.brett.length = 0; W.attach.length = 0;
  const r = await tick(E, '2026-11-16', '10:00'); t('tick ok', r.ok, r.errors);
  t('inquiry marked expired; nobody texted; no email', pend(W).Status === 'pending_expired' && !W.sms.length && !W.attach.length, { p: pend(W), sms: W.sms });
  t('the (PENDING) calendar event is removed (and proven gone)', pendingEvents(W).length === 0 && pend(W).Pending_Cal === 'done', { ev: W.calEvents, p: pend(W) });
  t('expiry is logged', logs(W, 'pending_expired').length === 1);
  t("the 'Kayla CAN do it' alert is closed", alertsOf(W, /^pyes\|/).every(a => a.Resolved_At), alertsOf(W, /^pyes\|/));
  const sig = () => JSON.stringify(rowsOf(W, 'STR_Turnovers').map(r => [r.Task_Key, r.Status, r.Pending_Cal])), s0 = sig(), w0 = calWrites(W), l0 = rowsOf(W, 'STR_Log').length;
  await tick(E, null); await tick(E, '2026-11-17', '09:00');
  t('expiry sweep run twice more: no change, no texts, no calendar writes, no new log row', sig() === s0 && !W.sms.length && calWrites(W) === w0 && rowsOf(W, 'STR_Log').length === l0, { sms: W.sms });
  const st = await J(E.strAdminState({})); t('board says "Date passed - no booking"', st.pending.every(x => x.status_label === 'Date passed - no booking'), st.pending);
}
{
  const { W, E } = await world(); CUR = W; clock = at(E, '2026-10-20', '22:30'); await ask(E, PD, 'TEST-exp-open');
  W.sms.length = 0; await tick(E, '2026-11-16', '09:00'); t('an unasked inquiry whose date passed expires without texting anyone', pend(W).Status === 'pending_expired' && !W.sms.length, W.sms);
}

// ═══ 10. Brett cancels an inquiry ═══
{
  const { W, E } = await heldByKayla(); CUR = W; await tick(E, null); W.sms.length = 0;
  E.__cold(); const c0 = costNow(W), pv = await J(E.strAdminPendingCancel({}, { task_key: PK, preview: true }));
  t('cancel preview shows who would be told and the exact text, and changes nothing', pv.ok && pv.preview.holder.first === 'Kayla' && /didn't book after all/.test(pv.preview.text) && pend(W).Status === 'pending_held' && !W.sms.length, pv);
  E.__cold(); const c1 = costNow(W), cn = await J(E.strAdminPendingCancel({}, { task_key: PK, notify: true, text: pv.preview.text + ' Enjoy your week!' })); const c2 = costNow(W) - c1; await tick(E, null);
  t('cancel with the opt-in: the held cleaner gets the (edited) polite text once; the inquiry is cancelled', cn.ok && pend(W).Status === 'pending_cancelled' && smsTo(W, 'Kayla', 'str_pending_cancelled').length === 1 && /Enjoy your week/.test(smsTo(W, 'Kayla')[0].text), { cn, sms: W.sms });
  t('cancel stayed under the subrequest limit', c2 <= 48, c2);
  t('the tentative event was removed', pendingEvents(W).length === 0);
  const cn2 = await J(E.strAdminPendingCancel({}, { task_key: PK, notify: true })); t('cancelling again does nothing and texts nobody', cn2.already && smsTo(W, 'Kayla').length === 1, cn2);
  await tick(E, null); await tick(E, null); t('later ticks do not text her again', smsTo(W, 'Kayla').length === 1 && !W.sms.some(s => s.type === 'str_pending_booked'));
  BOOK(W, '2026-11-13', PD); await tick(E, null); t('a booking arriving after the cancel is just a normal new turnover (no hold, no "booked" text)', !smsTo(W, 'Kayla', 'str_pending_booked').length && !(pend(W, RK) && pend(W, RK).Status === 'covered'));
}
{
  const { W, E } = await heldByKayla(); CUR = W; W.sms.length = 0;
  const cn = await J(E.strAdminPendingCancel({}, { task_key: PK }));
  t('cancel WITHOUT the opt-in texts nobody', cn.ok && !W.sms.length && pend(W).Pending_Text === '', cn);
}
{
  const { W, E } = await world(); CUR = W; await ask(E, PD, 'TEST-wait'); W.sms.length = 0;
  const cn = await J(E.strAdminPendingCancel({}, { task_key: PK, notify: true }));
  const pg = await pageOf(E, '1');
  t('cancel while Gina is still deciding: her question just closes; nobody is texted; her page stops showing it', cn.ok && !W.sms.length && offerOf(W, '1', PK).Status === 'superseded' && !pg.pending.length, cn);
  const late = await answer(E, '1', 'accept', offerOf(W, '1', PK).ID); t('a late "yes" to a cancelled inquiry is politely refused and changes nothing', late.result === 'cancelled' && pend(W).Status === 'pending_cancelled' && !W.sms.length, late);
}
{
  const { W, E } = await heldByKayla(); CUR = W; clock = at(E, '2026-10-20', '22:30'); W.sms.length = 0;
  const cn = await J(E.strAdminPendingCancel({}, { task_key: PK, notify: true }));
  t('night cancel: the opt-in text is held (not sent at 10:30 PM)', cn.ok && !W.sms.length && pend(W).Pending_Text === 'due', cn);
  await tick(E, '2026-10-21', '08:05'); await tick(E, null); t('sent once after 8 AM', smsTo(W, 'Kayla', 'str_pending_cancelled').length === 1 && /^sent:/.test(pend(W).Pending_Text));
}

// ═══ 11. "Mark as booked now" (the feed is lagging) ═══
{
  const { W, E } = await heldByKayla(); CUR = W; await tick(E, null); W.sms.length = 0; W.attach.length = 0;
  E.__cold(); const c0 = costNow(W), r = await J(E.strAdminPendingConvert({}, { task_key: PK }));
  const cc = costNow(W) - c0; await tick(E, null);
  t('convert ok: real turnover created, Kayla assigned, one "now booked" text, one invite (whatever the call had no room for is done by the next scheduler run)', r.ok && pend(W, RK).Status === 'covered' && pend(W, RK).Assigned_Cleaner_ID === '2' && smsTo(W, 'Kayla', 'str_pending_booked').length === 1 && W.attach.length === 1, { r, sms: W.sms });
  t('convert stayed under the subrequest limit', cc <= 48, cc);
  t('the real turnover is protected for ~3 days while the feed catches up (Manual_Until set)', pend(W, RK).Manual_Until && Date.parse(pend(W, RK).Manual_Until) > clock + 2.5 * 86400000, pend(W, RK));
  t('calendar: the (PENDING) event is already the normal event', W.calEvents.filter(e => e.start.date === PD).length === 1 && W.calEvents.find(e => e.start.date === PD).summary === 'Kayla Cleaning', W.calEvents);
  await tick(E, null); await tick(E, null); await tick(E, null);
  t('three ticks with the feed still behind: the manual turnover is NOT cancelled and nobody is re-texted', pend(W, RK).Status === 'covered' && smsTo(W, 'Kayla').length === 1, pend(W, RK));
  BOOK(W, '2026-11-13', PD); await tick(E, null);
//@@APPEND@@