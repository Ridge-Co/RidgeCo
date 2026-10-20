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
const exportsList = ['strTick', 'strAdminState', 'strAdminAssign', 'strChangePreview', 'strChangeApply', 'strCleanerMark', 'strBatchSet', 'strMatchCleaner', 'strCleanText', 'strHash', 'strExternalEvents', 'STR_DEFAULT_TEXTS', 'inspEtWallToMs', 'inspEtDate', 'inspAddDays', 'strInSendWindow', 'strOutboxDrain', 'STR_CHANGE_MAX', 'STR_TEXT_MAX', 'STR_TABS'];
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

// ═══ 0. static checks ═══
{
  t('new tabs are provisioned', src.includes("STR_Outbox: ['ID', 'Plan_ID'") && src.includes("STR_Changes: ['ID', 'Plan_ID'"));
  t('routes wired (preview + apply)', /path === '\/str\/admin\/change\/preview'\)\s+return await strChangePreview/.test(src) && /path === '\/str\/admin\/change\/apply'\)\s+return await strChangeApply/.test(src));
  t('staging test guard: preview open, apply only for TEST- cleaners', /path === '\/str\/admin\/change\/preview'\) return true;/.test(src) && /path === '\/str\/admin\/change\/apply'\) \{ const _c = .*startsWith\('TEST-'\)/.test(src));
  const W0 = makeWorld(); const E0 = build(W0);
  const newTypes = ['str_assigned_multi', 'str_swapped_backup', 'str_swapped_backup_multi', 'str_admin_marked'];
  for (const ty of newTypes) {
    const m = new RegExp("Message_Type: '" + ty + "', Channel: 'sms', Subject: '', Body:\\s*\\n\\s*\"([^\"]*)\"").exec(src);
    t('seeded template ' + ty + ' exists and matches the built-in wording', !!m && m[1] === E0.STR_DEFAULT_TEXTS[ty], m && m[1]);
    t(ty + ' never says primary / rank / backup 1', !/primary|rank|backup (1|2)|priority/i.test(E0.STR_DEFAULT_TEXTS[ty]));
  }
  t('displaced-cleaner wording is friendly and needs no reply', /off the hook/.test(E0.STR_DEFAULT_TEXTS.str_swapped_backup) && /No reply needed/.test(E0.STR_DEFAULT_TEXTS.str_swapped_backup) && /backup/.test(E0.STR_DEFAULT_TEXTS.str_swapped_backup));
  t('the date-list match helper: Kayla / Gina / ambiguity', (() => { const cl = [{ ID: '1', Name: 'Regina Seville', Nickname: 'Gina' }, { ID: '2', Name: 'Kayla', Nickname: 'Kayla' }, { ID: '4', Name: 'Kayla Brown', Nickname: '' }]; return E0.strMatchCleaner('gina', cl).ID === '1' && E0.strMatchCleaner('Regina Seville', cl).ID === '1' && E0.strMatchCleaner('Michele', cl) === null && E0.strMatchCleaner('Kayla', cl) === null /* two Kaylas: never guess */; })());
  t('text sanitizer: control chars / runs of space collapse, empty stays empty', E0.strCleanText('a\u0000b\n\n  c\t d') === 'a b c d' && E0.strCleanText(null) === '' && E0.strCleanText('  ') === '');
}

// ═══ 1. the Oct 25 case: preview (Kayla hand-typed on the calendar -> Gina, Kayla becomes backup) ═══
{
  const { W, E } = await setup();
  t('setup: Oct 25 is covered from the calendar (ext_covered), nothing offered', tr(W, K25) && tr(W, K25).Status === 'ext_covered', tr(W, K25));
  const before = { sms: W.sms.length, log: rowsOf(W, 'STR_Log').length, av: rowsOf(W, 'STR_Availability').length, trs: JSON.stringify(rowsOf(W, 'STR_Turnovers')) };
  const p = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('preview ok with a plan id and signature', p.ok && /^[a-f0-9]{16}$/.test(p.plan_id) && p.sig && p.action === 'swap', p);
  const it = p.items[0];
  t('item will change; Kayla (hand-typed calendar entry) is the displaced cleaner', it.outcome === 'change' && it.displaced.length === 1 && it.displaced[0].name === 'Kayla' && it.displaced[0].source === 'calendar', it);
  t('calendar plan: remove the hand-typed entry and add Gina Cleaning', it.cal.hand.length === 1 && it.cal.hand[0].summary === 'Kayla Cleaning' && it.cal.title === 'Gina Cleaning' && it.cal.hub_create === true && p.calendar.mode === 'write', it.cal);
  const gina = p.recipients.find(r => r.key === 'new:1'), kayla = p.recipients.find(r => r.key === 'back:2');
  t('two recipients: Gina (assigned) and Kayla (backup)', p.recipients.length === 2 && gina && kayla, p.recipients.map(r => r.key));
  t('Gina text = the stock assigned confirmation for that date', /Gina, you're set for the Sun, Oct 25 turnover at Milam Ridge/.test(gina.text) && /cleaner\.html\?k=TOKGINA/.test(gina.text), gina.text);
  t('Kayla text = friendly, names Gina and the date, asks for backup, no reply needed', /Kayla/.test(kayla.text) && /Gina's going to cover the Sun, Oct 25 turnover at Milam Ridge, so you're off the hook/.test(kayla.text) && /backup/.test(kayla.text) && /No reply needed/.test(kayla.text), kayla.text);
  t('no text uses the words primary or rank', !p.recipients.some(r => /primary|rank/i.test(r.text)));
  t('both are SMS, send now (10am), default ticked', p.recipients.every(r => r.channel === 'sms' && r.can_send && r.send_default && r.timing.mode === 'now'));
  t('email invite is shown for Gina (existing behaviour) with her address', p.email && p.email.to === 'gina@x.test' && /You're set/.test(p.email.subject), p.email);
  t('preview WROTE and SENT nothing', W.sms.length === before.sms && rowsOf(W, 'STR_Log').length === before.log && rowsOf(W, 'STR_Availability').length === before.av && JSON.stringify(rowsOf(W, 'STR_Turnovers')) === before.trs && !W.cal.some(c => c.method !== 'GET') && !W.attach.length && rowsOf(W, 'STR_Changes').length === 0);
  // preview outside the send window shows the hold
  clock = at(E, '2026-10-20', '22:30');
  const p2 = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('outside 8am-9pm the preview says the texts are HELD until 8 AM', p2.window_open === false && p2.recipients.every(r => r.timing.mode === 'hold' && /8:00 AM/.test(r.timing.label) && r.timing.not_before === new Date(at(E, '2026-10-21', '08:00')).toISOString()), p2.recipients.map(r => r.timing));
  clock = at(E, '2026-10-20', '05:00');
  const p3 = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('before 8am the hold is until 8am the same morning', p3.recipients[0].timing.not_before === new Date(at(E, '2026-10-20', '08:00')).toISOString());
  // request validation
  t('unknown action / no cleaner / no dates / too many are refused with plain errors', (await preview(E, { action: 'nope', cleaner_id: '1' })).error === 'bad_action' && (await preview(E, { action: 'swap', task_keys: [K25] })).error === 'cleaner_required' && (await preview(E, { action: 'swap', cleaner_id: '1', task_keys: [] })).error === 'no_dates' && (await preview(E, { action: 'swap', cleaner_id: '1', task_keys: Array.from({ length: 41 }, (_, i) => 'k' + i) })).error === 'too_many');
  t('an unknown cleaner is refused', (await preview(E, { action: 'swap', cleaner_id: '99', task_keys: [K25] })).error === 'cleaner_not_found');
}

// ═══ 2. apply: happy path, edited text, calendar, audit, idempotency ═══
{
  const { W, E } = await setup();
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  const edited = "Kayla, Gina is covering Oct 25 so you are free. Could you be our backup that day? Thanks!";
  const r = await sendIt(E, p, body, { 'back:2': { send: true, body: '  ' + edited + '\n' } });
  t('apply ok, status done', r.ok === true && r.status === 'done' && r.counts.done === 1 && !r.errors.length, r);
  const row = tr(W, K25);
  t('turnover is now covered by Gina via admin_swap (re-read from the sheet)', row.Status === 'covered' && row.Assigned_Cleaner_ID === '1' && row.Assigned_Via === 'admin_swap', row);
  t('Kayla is marked Available-as-backup for Oct 25, source admin_swap', markOf(W, '2', '2026-10-25') === 'can' && rowsOf(W, 'STR_Availability').some(a => a.Cleaner_ID === '2' && a.Source === 'admin_swap'));
  t('Gina got the stock text, Kayla got EXACTLY the edited text', W.sms.length === 2 && W.sms.some(s => s.to === 'Regina Seville' && s.type === 'str_assigned') && W.sms.some(s => s.to === 'Kayla' && s.text === edited), W.sms);
  t('texts went through the gated path with the quiet-hours bypass the other cleaner texts use', W.gated.length === 2 && W.gated.every(g => g.bypassQuietHours === true && g.recipient_type === 'vendor'));
  t('Gina got the invite email with a calendar file', W.attach.length === 1 && W.attach[0].to === 'gina@x.test' && /BEGIN:VEVENT/.test(Buffer.from(W.attach[0].attachment.base64Data, 'base64').toString()), W.attach.length);
  const live = W.calEvents;
  t('calendar: the hand-typed "Kayla Cleaning" is gone', !live.some(e => e.summary === 'Kayla Cleaning'), live.map(e => e.summary));
  const gc = live.filter(e => e.summary === 'Gina Cleaning' && e.start.date === '2026-10-25');
  t('calendar: exactly one all-day "Gina Cleaning" on Oct 25 carrying ridgecoStr properties', gc.length === 1 && gc[0].extendedProperties.private.ridgecoStr === '1' && gc[0].extendedProperties.private.ridgecoStrKey === K25 && gc[0].extendedProperties.private.ridgecoStrKind === 'cover' && !gc[0].start.dateTime, gc);
  t('calendar: other hand-typed entries untouched', live.some(e => e.id === 'h1') && live.some(e => e.id === 'h3'));
  t('result says the calendar was changed and verified', r.calendar.status === 'done' && r.calendar.items[K25].status === 'done', r.calendar);
  const log = rowsOf(W, 'STR_Log');
  t('audit rows: admin_swap for the date + admin_change for the plan', log.some(l => l.Event === 'admin_swap' && l.Task_Key === K25 && /Kayla \(calendar entry\) -> Gina/.test(l.Detail)) && log.some(l => l.Event === 'admin_change' && /done/.test(l.Detail)) && log.some(l => l.Event === 'swap_text_sent'), log.map(l => l.Event));
  const ch = rowsOf(W, 'STR_Changes');
  t('plan record saved as done with the result', ch.length === 1 && ch[0].Status === 'done' && /"status":"done"/.test(ch[0].Result), ch);
  // Send twice: nothing happens a second time
  const smsN = W.sms.length, calN = W.cal.length, logN = rowsOf(W, 'STR_Log').length;
  const r2 = await sendIt(E, p, body, { 'back:2': { send: true, body: edited } });
  t('second Send of the same preview is a no-op that says so', r2.ok && r2.duplicate === true && /already applied/.test(r2.message) && r2.result && r2.result.status === 'done', r2);
  t('second Send: no new text, no calendar call, no log row, no new plan row', W.sms.length === smsN && W.cal.length === calN && rowsOf(W, 'STR_Log').length === logN && rowsOf(W, 'STR_Changes').length === 1);
  // the scheduler does not undo it or re-offer, and does not duplicate calendar events
  clock += 15 * 60000; const tk = await E.strTick({}, {});
  t('next scheduler tick leaves it alone (still Gina, no offers, no new calendar writes for it)', tr(W, K25).Assigned_Cleaner_ID === '1' && tr(W, K25).Status === 'covered' && !rowsOf(W, 'STR_Offers').some(o => o.Task_Key === K25) && W.calEvents.filter(e => e.summary === 'Gina Cleaning' && e.start.date === '2026-10-25').length === 1, tk.errors);
  // preview again now: already hers
  const p4 = await preview(E, body);
  t('previewing the same swap again shows "already has this one" and no texts', p4.items[0].outcome === 'skip' && /already has/.test(p4.items[0].reason) && p4.recipients.length === 0 && p4.counts.change === 0);
}

// ═══ 3. stale preview, bad texts, missing preview ═══
{
  const { W, E } = await setup();
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  // someone else changes the same turnover after the preview (Brett assigns Rachel with the old assign button)
  const a = await J(E.strAdminAssign({}, { task_key: K25, cleaner_id: '3' })); t('setup: old assign still works (Rachel takes Oct 25)', a.ok, a);
  W.sms.length = 0; W.cal.length = 0;
  const r = await sendIt(E, p, body);
  t('stale preview: refused with a plain message, nothing changed or sent', r.ok === false && r.error === 'stale_preview' && /Press Preview again/.test(r.message) && tr(W, K25).Assigned_Cleaner_ID === '3' && !W.sms.length && !W.cal.some(c => c.method !== 'GET'), r);
  const p2 = await preview(E, body);
  const miss = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: p2.sig })));
  t('apply without the texts object is refused (the page must say what to do with each text)', miss.ok === false && miss.error === 'texts_missing');
  const texts = Object.fromEntries(p2.recipients.map(x => [x.key, { send: true, body: x.text }]));
  const noprev = await J(E.strChangeApply({}, Object.assign({}, body, { texts })));
  t('apply without a plan id is refused', noprev.ok === false && noprev.error === 'bad_plan');
  const bad = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: 'deadbeef', texts })));
  t('apply with a wrong signature is refused as stale', bad.error === 'stale_preview');
  const unk = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: p2.sig, texts: Object.assign({ 'new:9': { send: true, body: 'x' } }, texts) })));
  t('a text for someone not in the plan is refused', unk.error === 'texts_unknown');
  const k = Object.keys(texts)[0];
  const empty = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: p2.sig, texts: Object.assign({}, texts, { [k]: { send: true, body: '   ' } }) })));
  t('an empty text that is ticked to send is refused', empty.error === 'text_empty');
  const long = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: p2.sig, texts: Object.assign({}, texts, { [k]: { send: true, body: 'x'.repeat(E.STR_TEXT_MAX + 1) } }) })));
  t('an over-long text is refused', long.error === 'text_too_long');
  t('none of those refusals claimed the plan or changed anything', rowsOf(W, 'STR_Changes').length === 0 && tr(W, K25).Assigned_Cleaner_ID === '3' && !W.sms.length);
  // control characters in an edited text are cleaned, not sent raw
  const ok = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p2.plan_id, sig: p2.sig, texts: Object.assign({}, texts, { [k]: { send: true, body: 'Hi\u0000 there\n\nfriend\u0007' } }) })));
  const okf = await finish(E, ok, p2.plan_id);
  t('control characters are stripped before sending', ok.ok && okf.status === 'done' && W.sms.some(s => s.text === 'Hi there friend'), W.sms.map(s => s.text));
/*@@C4@@*/
/*@@C5@@*/
/*@@C6@@*/
/*@@C7@@*/