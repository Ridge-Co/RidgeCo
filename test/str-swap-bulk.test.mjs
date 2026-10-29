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
const realFns = ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspAddDays', 'inspStrCleaningKind', 'inspStrEvDay', 'inspStrEventDays', 'inspStrStays', 'inspStrFromApi', 'inspIcsEsc', 'renderTemplate', 'idColIndex', 'inspErr', 'inspStrMask', 'inspStrConfig', 'inspClassifyCalError', 'appendedRowNumber', 'mintNextNumericId', 'col', 'sheetsQuotaBusyError'].map(n => grab(n)).join('\n') + '\n' + grab('guardAppendedIds', 'async');
const realConsts = ['INSP_TZ'].map(n => grab(n, 'const')).join('\n');

const colIdx = L => { let n = 0; for (const ch of L) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
function makeWorld(opts) {
  opts = opts || {};
  const tabs = new Map(), W = { tabs, sms: [], brett: [], emails: [], attach: [], cal: [], telemetry: [], gated: [], failSms: false, failEmail: false, queue: 0, calMode: 'ok', calEvents: [], evSeq: 0, stays: [], sheetCalls: 0, reads: 0, failBatchTab: null, failAppendTab: null, failMarkRows: false };
  const hdr = tab => tabs.get(tab)[0];
  const objs = tab => { if (!tabs.has(tab)) throw new Error('Unable to parse range: ' + tab); const [h, ...rows] = tabs.get(tab); return rows.map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i] == null ? '' : r[i]); return o; }); };
  const json = (b, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => b });
  const stubs = {
    fetchConfig: async () => Object.assign({}, W.cfg), fetchTab: async (env, tab) => { const f = W.rfault; if (f && f.tab === tab && f.armed && f.times > 0) { f.times--; f.hits = (f.hits || 0) + 1; if (!f.sticky) f.armed = false; throw new Error(f.msg || ('Sheets API error on GET /values/' + tab + ': 429 Quota exceeded for quota metric \'Read requests\' and limit \'Read requests per minute per user\'')); } return (W.sheetCalls++, W.reads++, objs(tab)); }, fetchTabs: async (env, ts) => (W.sheetCalls++, W.reads++, (W.warm = W.warm || new Set(), ts.forEach(x => W.warm.add(x))), ts.map(x => objs(x))), /* real addRow / updateRow / ensureColumns each make 1-2 Sheets calls; the fakes below charge the same */
    invalidateTabCache: () => {}, json,
    sheetsRequest: async (env, method, path, body) => {
      W.sheetCalls++; let m; if (method === 'GET') W.reads++;
      if (method === 'GET' && path.startsWith('?fields=')) return { sheets: [...tabs.keys()].map(title => ({ properties: { title } })) };
      if (method === 'POST' && path === ':batchUpdate') { for (const r of body.requests || []) if (r.addSheet) tabs.set(r.addSheet.properties.title, []); return {}; }
      if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) { if (!tabs.has(m[1])) throw new Error('Unable to parse range'); return { values: tabs.get(m[1]).map(r => r.slice()) }; }
      if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) { const first = tabs.get(m[1]).length + 1; if (W.failAppendTab !== m[1]) for (const r of body.values) tabs.get(m[1]).push(r.slice()); if (W.rfault && W.rfault.tab === m[1]) W.rfault.armed = true; return { updates: { updatedRange: m[1] + '!A' + first } }; }
      if (method === 'POST' && path === '/values:batchUpdate') {
        if (W.throwOnceBatch) { W.throwOnceBatch = false; throw new Error('Sheets hiccup'); }
        for (const d of body.data) { const mm = /^([^!]+)!([A-Z]+)(\d+)$/.exec(d.range); if (!mm) throw new Error('bad range ' + d.range); if (W.failBatchTab === mm[1]) continue; /* accepted but never lands */ const rows = tabs.get(mm[1]); const row = rows[parseInt(mm[3], 10) - 1]; row[colIdx(mm[2])] = d.values[0][0]; }
        return { totalUpdatedCells: body.data.length };
      }
      throw new Error('fake sheets: unsupported ' + method + ' ' + path);
    },
    ensureColumns: async (env, tab, cols) => { if (!(W.warm && W.warm.has(tab))) { W.sheetCalls++; W.reads++; } /* Oct 22 2026: after strEnsureTabs' one batched read the real ensureColumns is a tab-cache hit (no Google call) */ if (!tabs.has(tab)) tabs.set(tab, []); const rows = tabs.get(tab); if (!rows.length) rows.push([]); for (const c of cols) if (!rows[0].includes(c)) { rows[0].push(c); for (let i = 1; i < rows.length; i++) rows[i].push(''); } },
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
function build(W) { CUR = W; const F = new Function(...names, realFns + '\n' + realConsts + '\n' + block + '\nreturn {' + exportsList.join(',') + ', __cold: () => { __strTabsReady = false; }};'); const E = F(...names.map(n => W.stubs[n])); E.W = W; { const c0 = E.__cold; E.__cold = () => { c0(); if (W.warm) W.warm.clear(); }; } return E; }
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
}

// ═══ 4. calendar faults: loud, the swap still completes ═══
{
  // 4a. Google refuses writes (service account lacks "Make changes to events")
  const { W, E } = await setup(); W.calMode = 'perm';
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('permission denied: the Hub-side swap still completed', tr(W, K25).Assigned_Cleaner_ID === '1' && markOf(W, '2', '2026-10-25') === 'can' && r.counts.done === 1, r);
  t('permission denied: status partial, calendar failed with the plain-English fix and exact by-hand steps', r.ok === false && r.status === 'partial' && r.calendar.status === 'failed' && r.calendar.code === 'calendar_failed' && /STR_CAL_IMPERSONATE/.test(r.calendar.message) && !/shar/i.test(r.calendar.message) && r.calendar.manual.some(m => /delete "Kayla Cleaning"/.test(m) && /add an all-day "Gina Cleaning"/.test(m)) && r.errors.some(e => e.step === 'calendar_failed' && /Do this by hand/.test(e.error)), r.calendar);
  t('permission denied: texts were still sent', W.sms.length === 2);
  t('permission denied: telemetry failure row + Brett alerted', W.telemetry.some(x => x.Success === 'FALSE' && /calendar/i.test(x.Notes)) && (W.brett.length > 0 || W.emails.length > 0), { tel: W.telemetry.length, b: W.brett.length });
  t('permission denied: it did not hammer Google (stopped after the first refusal)', W.cal.filter(c => c.method !== 'GET').length === 1, W.cal.map(c => c.method));
  t('permission denied: the hand-typed Kayla entry is still there (never half-edited)', W.calEvents.some(e => e.id === 'h2'));
  t('permission denied: audit log shows swap done', rowsOf(W, 'STR_Log').some(l => l.Event === 'admin_swap'));
}
{
  // 4b. Google says OK but the change is not visible when re-read
  const { W, E } = await setup(); W.calMode = 'ghost';
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('write accepted but not visible: caught by the re-read, reported as failed, not success', r.calendar.status === 'failed' && /Re-read check failed/.test(r.calendar.items[K25].message) && r.status === 'partial' && r.ok === false, r.calendar);
}
{
  // 4c. calendar switch OFF: Hub-side done, loud warning with exact steps, no Google writes
  const { W, E } = await setup({ STR_CAL_WRITE_ENABLED: 'FALSE' });
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  t('switch OFF: the preview says so up front', p.calendar.mode === 'off' && /NOT allowed to change the cleaning calendar/.test(p.calendar.note) && p.calendar.manual.length === 1, p.calendar);
  const r = await sendIt(E, p, body);
  t('switch OFF: assignment + texts done, calendar NOT changed, by-hand steps given, no Google writes', r.status === 'done' && r.calendar.status === 'not_changed' && r.warnings.some(w => /calendar was NOT changed/i.test(w) && /delete "Kayla Cleaning"/.test(w)) && !W.cal.some(c => c.method !== 'GET') && W.calEvents.some(e => e.id === 'h2'), r);
}
{
  // 4d. the calendar cannot be read at all: refuse BEFORE changing anything
  const { W, E } = await setup(); W.calMode = 'down';
  const p = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('calendar unreadable: preview refuses plainly (nothing is guessed)', p.ok === false && p.error === 'feed_unreadable' && /nothing can be changed safely/.test(p.message), p);
}
{
  // 4e. calendar shapes the Hub must not touch / must handle
  const { W, E } = await setup();
  W.calEvents.push(W.ev('m1', 'Michele Cleaning', '2026-11-03'));
  W.calEvents.find(e => e.id === 'h2').summary = 'Kayla Cleaning';
  W.calEvents.push({ id: 'multi', summary: 'Kayla Cleaning', start: { date: '2026-10-25' }, end: { date: '2026-10-27' } }); // 2-day entry: not positively "that date"
  const p = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' }), it = p.items[0];
  t('a multi-day "Kayla Cleaning" is never deleted: listed for Brett to fix by hand', it.cal.hand.length === 1 && it.cal.hand[0].id === 'h2' && it.notes.some(n => /not a plain one-day/.test(n)), it);
  const r = await sendIt(E, p, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('the multi-day entry survived the swap', W.calEvents.some(e => e.id === 'multi') && !W.calEvents.some(e => e.id === 'h2'));
}
{
  // 4f. a Hub-written entry for a hub-assigned task is renamed, not duplicated; an unknown hand-typed name is replaced without texting anyone
  const { W, E } = await setup();
  const a = await J(E.strAdminAssign({}, { task_key: K108, cleaner_id: '2' })); // Kayla takes Nov 8 the old way
  clock += 15 * 60000; await E.strTick({}, {}); // tick writes "Kayla Cleaning" (Hub-owned) for it
  const hubEv = W.calEvents.filter(e => e.extendedProperties && e.extendedProperties.private.ridgecoStrKey === K108);
  t('setup: Hub wrote one "Kayla Cleaning" for Nov 8', a.ok && hubEv.length === 1 && hubEv[0].summary === 'Kayla Cleaning', hubEv);
  W.cal.length = 0;
  const body = { action: 'swap', task_keys: [K108], cleaner_id: '1' }, p = await preview(E, body);
  t('hub-assigned holder: Kayla displaced (source hub), Hub entry will be RENAMED', p.items[0].displaced[0].source === 'hub' && p.items[0].cal.hub_patch === hubEv[0].id && !p.items[0].cal.hub_create && p.items[0].cal.hand.length === 0, p.items[0].cal);
  const r = await sendIt(E, p, body);
  const now = W.calEvents.filter(e => e.extendedProperties && e.extendedProperties.private.ridgecoStrKey === K108);
  t('renamed in place to "Gina Cleaning" (one event, same id)', r.ok && now.length === 1 && now[0].summary === 'Gina Cleaning' && now[0].id === hubEv[0].id && W.cal.filter(c => c.method === 'PATCH').length === 1 && !W.cal.some(c => c.method === 'POST'), { r: r.status, now });
  t('Kayla (hub holder) marked backup and told', markOf(W, '2', '2026-11-08') === 'can' && W.sms.some(s => s.to === 'Kayla' && /Gina's going to cover the Sun, Nov 8/.test(s.text)));
  // unknown name on the calendar
  const b2 = { action: 'swap', task_keys: ['milam-ridge|checkout|2026-11-12'], cleaner_id: '1' };
  W.calEvents.push(W.ev('mm', 'Michele Cleaning', '2026-11-12')); W.sms.length = 0;
  const p2 = await preview(E, b2);
  t('an unknown calendar name (Michele) is shown as replaced with no text and no mark', p2.items[0].unmatched.join() === 'Michele' && p2.items[0].displaced.length === 0 && p2.recipients.length === 1 && p2.recipients[0].key === 'new:1' && /not one of your cleaners/.test(p2.items[0].sentence), p2.items[0]);
  const r2 = await sendIt(E, p2, b2);
  t('...and applying removes her entry and texts only Gina', r2.ok && !W.calEvents.some(e => e.id === 'mm') && W.sms.length === 1 && W.sms[0].to === 'Regina Seville', r2);
}
{
  // 4g. the red "not covered" block is removed when an uncovered turnover is assigned
  const { W, E } = await setup({}, w => { w.stays.push({ start: '2026-11-13', end: '2026-11-15', guest: 'Q' }); });
  const K = 'milam-ridge|checkout|2026-11-12';
  // make it uncovered and inside the 14-day red-block window by moving "today" next to it
  clock = at(E, '2026-10-31', '10:00'); await E.strTick({}, {});
  const reds = W.calEvents.filter(e => e.summary === 'BOOKING NOT COVERED FOR CLEANING' && e.extendedProperties.private.ridgecoStrKey === K);
  t('setup: the Hub put a red block on Nov 12', reds.length === 1, W.calEvents.map(e => e.summary));
  const body = { action: 'swap', task_keys: [K], cleaner_id: '1' }, p = await preview(E, body);
  t('open turnover: preview plans to remove the red block and add Gina Cleaning', p.items[0].cal.hub_delete.length === 1 && p.items[0].cal.hub_create === true && p.items[0].displaced.length === 0, p.items[0].cal);
  const r = await sendIt(E, p, body);
  t('after applying: red block gone, one Gina Cleaning, no "backup" text (nobody displaced)', r.ok && !W.calEvents.some(e => e.summary === 'BOOKING NOT COVERED FOR CLEANING' && e.extendedProperties.private.ridgecoStrKey === K) && W.calEvents.filter(e => e.summary === 'Gina Cleaning' && e.start.date === '2026-11-12').length === 1 && r.texts.length === 1, r);
}

// ═══ 5. text faults ═══
{
  const { W, E } = await setup(); W.failSms = true;
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('text failure: the swap itself stands (state + calendar done)', tr(W, K25).Assigned_Cleaner_ID === '1' && r.calendar.status === 'done' && r.counts.done === 1);
  t('text failure: shown as FAILED with "tell them yourself", status partial, not ok', r.ok === false && r.status === 'partial' && r.texts.every(x => x.status === 'failed') && r.errors.some(e => e.step === 'text_failed' && /Tell them yourself/.test(e.error)) && /FAILED for Gina, Kayla/.test(r.summary), r);
  t('text failure: telemetry + Brett alerted + audit row', W.telemetry.some(x => x.Success === 'FALSE' && /text/i.test(x.Skill_Or_Endpoint + x.Notes)) && rowsOf(W, 'STR_Log').some(l => l.Event === 'swap_text_failed'), W.telemetry.map(x => x.Skill_Or_Endpoint));
}
{
  // Twilio globally off / STR texts off: preview warns, apply does the work and says nobody was texted
  for (const [over, mode, rx] of [[{ TWILIO_ENABLED: 'FALSE' }, 'twilio_off', /switched off for the whole Hub/], [{ STR_SMS_ENABLED: 'FALSE' }, 'off', /switched OFF/]]) {
    const { W, E } = await setup(over); const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
    t(mode + ': preview shows nobody can be texted and why', p.send_mode === mode && p.recipients.every(r => !r.can_send && rx.test(r.reason)) && p.warnings.length >= 0, p.recipients.map(r => r.reason));
    const r = await sendIt(E, p, body);
    t(mode + ': changes applied, nobody texted, loud warnings (not a silent skip)', tr(W, K25).Assigned_Cleaner_ID === '1' && !W.sms.length && r.texts.every(x => x.status === 'not_sent') && r.warnings.filter(w => /was NOT texted/.test(w)).length === 2, r);
  }
}
{
  // a cleaner who cannot be texted (no phone / opted out) - the rest still works
  const { W, E } = await setup({}, w => { w.tabs.get('Vendors')[2][2] = ''; }); // Kayla's phone removed
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  const kay = p.recipients.find(r => r.key === 'back:2');
  t('no phone: Kayla shown as "no text possible" (reason), Gina still texted', !kay.can_send && /no phone number/.test(kay.reason) && p.recipients.find(r => r.key === 'new:1').can_send, kay);
  const r = await sendIt(E, p, body);
  t('...and she is still marked backup, with a warning to tell her yourself', markOf(W, '2', '2026-10-25') === 'can' && W.sms.length === 1 && r.warnings.some(w => /Kayla was NOT texted/.test(w)));
  const emailOff = await setup({}, w => { w.tabs.get('Vendors')[1][3] = ''; });
  const pe = await preview(emailOff.E, body); t('no email on file: preview says no invite goes out', pe.email && /no email on file/.test(pe.email.skipped), pe.email);
}

// ═══ 6. Sheets writes that do not land ═══
{
  const { W, E } = await setup(); W.failBatchTab = 'STR_Turnovers';
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('turnover write does not land: item FAILED (not success), reason says it did not save', r.counts.failed === 1 && r.counts.done === 0 && r.status === 'failed' && r.ok === false && /did not save/.test(r.items[0].reason), r.items);
  t('...and NOTHING downstream fired: no text, no calendar change, no backup mark, no email', !W.sms.length && !W.cal.some(c => c.method !== 'GET') && !markOf(W, '2', '2026-10-25') && !W.attach.length && W.calEvents.some(e => e.id === 'h2') && !W.calEvents.some(e => e.summary === 'Gina Cleaning' && e.start.date === '2026-10-25'));
  t('...and Brett was told (telemetry + alert), audit row says failed', W.telemetry.some(x => x.Success === 'FALSE') && (W.brett.length || W.emails.length) && rowsOf(W, 'STR_Log').some(l => l.Event === 'admin_swap_failed'));
  t('the record of the attempt says failed', rowsOf(W, 'STR_Changes')[0].Status === 'failed');
}
{
  const { W, E } = await setup(); W.failAppendTab = 'STR_Availability';
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('backup mark does not land: the assignment stands but the result is partial + names the problem', tr(W, K25).Assigned_Cleaner_ID === '1' && r.status === 'partial' && r.errors.some(e => e.step === 'backup_mark') && !markOf(W, '2', '2026-10-25') && r.errors.some(e => e.step === 'backup_mark') && W.telemetry.length > 0, r);
}

// ═══ 7. out-marked cleaner needs an explicit OK ═══
{
  const { W, E } = await setup();
  await J(E.strCleanerMark({}, { k: GINA, marks: [{ date: '2026-10-25', mark: 'out' }] })); W.sms.length = 0; W.brett.length = 0;
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  t('Gina marked OUT: preview blocks the item and shows a visible confirm box', p.items[0].outcome === 'blocked' && p.items[0].needs_confirm && p.confirm && p.confirm.kind === 'out_marked' && /explicit OK/.test(p.confirm.message), p.confirm);
  const r = await sendIt(E, p, body);
  t('apply without the OK: skipped, nothing changed, nobody texted', r.counts.skipped === 1 && r.counts.done === 0 && tr(W, K25).Status === 'ext_covered' && !W.sms.length && !W.cal.some(c => c.method !== 'GET'), r);
  const b2 = Object.assign({}, body, { confirm_out: true }), p2 = await preview(E, b2);
  t('with the OK the item is allowed and her Out mark will be cleared (shown)', p2.items[0].outcome === 'change' && p2.items[0].notes.some(n => /Out mark for this date is cleared/.test(n)), p2.items[0]);
  const r2 = await sendIt(E, p2, b2);
  t('assigned anyway; her Out mark cleared; Kayla backup', r2.ok && tr(W, K25).Assigned_Cleaner_ID === '1' && markOf(W, '1', '2026-10-25') === '' && markOf(W, '2', '2026-10-25') === 'can', r2);
}

// ═══ 8. bulk: swap many dates, one grouped text per person, partial failure, cap ═══
{
  const { W, E } = await setup();
  const keys = [K20, K25, K30, 'milam-ridge|checkout|2026-12-31', K108];
  const body = { action: 'swap', task_keys: keys, cleaner_id: '3' }, p = await preview(E, body);
  t('bulk preview: 4 dates will change, 1 not found (reported per item, others not aborted)', p.counts.change === 4 && p.counts.not_found === 1 && p.items.find(i => i.task_key.endsWith('2026-12-31')).outcome === 'not_found', p.counts);
  t('ONE grouped text per person: Rachel (new), Gina (Oct 20 + Oct 30 + ... multi), Kayla (single date)', p.recipients.length === 3 && p.recipients.find(r => r.key === 'new:3').dates.length === 4 && p.recipients.find(r => r.key === 'back:1').dates.length === 2 && p.recipients.find(r => r.key === 'back:2').dates.length === 1, p.recipients.map(r => [r.key, r.dates.length]));
  const rach = p.recipients.find(r => r.key === 'new:3'), gin = p.recipients.find(r => r.key === 'back:1');
  t('grouped wording lists the dates in one text', /you're set for these turnovers at Milam Ridge: Tue, Oct 20; Sun, Oct 25; Fri, Oct 30; Sun, Nov 8/.test(rach.text) && /Rachel's going to cover these turnovers at Milam Ridge: Tue, Oct 20; Fri, Oct 30/.test(gin.text), [rach.text, gin.text]);
  t('Rachel has no email, so the preview says no invite goes out', p.email && /no email on file/.test(p.email.skipped));
  const r = await sendIt(E, p, body);
  t('apply: 4 done, 1 failed(not found) -> partial, never silently dropped, summary says exactly what happened', r.status === 'partial' && r.counts.done === 4 && r.counts.failed === 1 && r.items.find(i => i.task_key.endsWith('12-31')).status === 'failed' && /4 of 5/.test(r.summary) && /1 FAILED/.test(r.summary), r.summary);
  t('exactly 3 texts total (one per person), not one per date', W.sms.length === 3 && W.sms.filter(s => s.to === 'Rachel Twigg').length === 1, W.sms.map(s => s.to));
  t('all four turnovers are Rachel\'s; Gina backup on 2 dates, Kayla on 1; Nov 8 (hub-open) had no displaced', [K20, K25, K30, K108].every(k => tr(W, k).Assigned_Cleaner_ID === '3' && tr(W, k).Status === 'covered') && markOf(W, '1', '2026-10-20') === 'can' && markOf(W, '1', '2026-10-30') === 'can' && markOf(W, '2', '2026-10-25') === 'can');
  t('Nov 8 had Gina\'s pending offer: closed quietly (superseded), and NO slot-filled text went out', rowsOf(W, 'STR_Offers').filter(o => o.Task_Key === K108).every(o => o.Status !== 'pending') && rowsOf(W, 'STR_Offers').some(o => o.Task_Key === K108 && o.Status === 'superseded' && /admin swap/.test(o.Note)) && !W.sms.some(s => s.type === 'str_filled_backup'));
  t('calendar: Gina/Kayla hand entries replaced by Rachel entries on 4 dates', W.calEvents.filter(e => e.summary === 'Rachel Cleaning').length === 4 && !W.calEvents.some(e => ['h1', 'h2', 'h3'].includes(e.id)));
  t('per-date audit rows', rowsOf(W, 'STR_Log').filter(l => l.Event === 'admin_swap').length === 4 && rowsOf(W, 'STR_Log').filter(l => l.Event === 'admin_swap_failed').length === 1);
  t('batching: a 5-date change used a bounded number of Sheets calls, each HTTP call under the limit (quota-safe)', W.sheetCalls < 200 && W.maxCall <= 48, { calls: W.sheetCalls, maxCall: W.maxCall });
}
{
  // a cancelled / past task and a pre-existing "already hers" are skipped, not errors
  const { W, E } = await setup();
  await J(E.strAdminAssign({}, { task_key: K30, cleaner_id: '3' }));
  const p = await preview(E, { action: 'swap', cleaner_id: '3', task_keys: [K30, K25] });
  t('already hers -> skipped (no text for it)', p.items.find(i => i.task_key === K30).outcome === 'skip' && p.counts.change === 1 && p.recipients.find(r => r.key === 'new:3').dates.length === 1);
  const rows = rowsOf(W, 'STR_Turnovers'); const idx = rows.findIndex(r => r.Task_Key === K20) + 1;
  const h = W.tabs.get('STR_Turnovers')[0]; W.tabs.get('STR_Turnovers')[idx][h.indexOf('Status')] = 'cancelled';
  const p2 = await preview(E, { action: 'swap', cleaner_id: '3', task_keys: [K20] });
  t('cancelled booking -> skipped with the reason', p2.items[0].outcome === 'skip' && /cancelled/.test(p2.items[0].reason));
  clock = at(E, '2026-10-26', '10:00');
  const p3 = await preview(E, { action: 'swap', cleaner_id: '3', task_keys: [K25] });
  t('a date that has already passed is skipped', p3.items[0].outcome === 'skip' && /passed/.test(p3.items[0].reason));
}
{
  // an unstored ("new") turnover is materialised the way the engine does, then assigned
  const { W, E } = await setup();
  W.stays.push({ start: '2026-11-20', end: '2026-11-23', guest: 'New Guest' });
  const KN = 'milam-ridge|checkout|2026-11-23';
  t('setup: the new booking is not stored yet', !tr(W, KN));
  const body = { action: 'swap', task_keys: [KN], cleaner_id: '1' }, p = await preview(E, body);
  t('preview knows it (status new) and offers to assign it', p.items[0].is_new === true && p.items[0].outcome === 'change');
  const r = await sendIt(E, p, body);
  const row = tr(W, KN);
  t('materialised as a real row, covered by Gina, with the same fields the engine writes', r.ok && row && row.Status === 'covered' && row.Assigned_Cleaner_ID === '1' && row.Kind === 'checkout' && row.Date === '2026-11-23' && row.Property_Key === 'milam-ridge' && row.Win_End && row.Missing_Count === '0', row);
  clock += 15 * 60000; await E.strTick({}, {});
  t('the next tick does not create a duplicate row for it', rowsOf(W, 'STR_Turnovers').filter(x => x.Task_Key === KN).length === 1);
}
{
  // assign a date range
  const { W, E } = await setup();
  const body = { action: 'assign_range', cleaner_id: '2', from: '2026-10-21', to: '2026-11-15' }, p = await preview(E, body);
  t('range preview: every turnover from Oct 21 to Nov 15 listed', p.items.map(i => i.date).join() === '2026-10-25,2026-10-30,2026-11-08,2026-11-12', p.items.map(i => i.date));
  t('range: Kayla already holds Oct 25? no - calendar says Kayla there: she is not displaced from her own date (skipped as nothing to change is NOT assumed)', p.items.find(i => i.date === '2026-10-25').displaced.length === 0, p.items[0]);
  const r = await sendIt(E, p, body);
  t('range applied: all dates Kayla\'s; Gina (hand entry Oct 30) becomes backup and is told once', r.ok && p.items.every(i => tr(W, i.task_key).Assigned_Cleaner_ID === '2') && markOf(W, '1', '2026-10-30') === 'can' && W.sms.filter(s => s.to === 'Regina Seville').length === 1, r.summary);
  const toolong = await preview(E, { action: 'assign_range', cleaner_id: '2', from: '2026-10-01', to: '2027-06-01' });
  t('a range longer than 120 days is refused', toolong.error === 'bad_range');
  const none = await preview(E, { action: 'assign_range', cleaner_id: '2', from: '2027-01-01', to: '2027-01-10' });
  t('a range with no turnovers says so', none.error === 'no_dates' && /no turnovers/i.test(none.message));
  const rev = await preview(E, { action: 'assign_range', cleaner_id: '2', from: '2026-11-10', to: '2026-11-01' });
  t('an end date before the start date is refused', rev.error === 'bad_range');
}
{
  // 40 dates at once stays inside the limits (cap + batching)
  const W = makeWorld(); seed(W); const stays = []; for (let i = 0; i < 40; i++) { const d0 = new Date(Date.UTC(2026, 9, 21 + i * 2)), d1 = new Date(Date.UTC(2026, 9, 22 + i * 2)); stays.push({ start: d0.toISOString().slice(0, 10), end: d1.toISOString().slice(0, 10), guest: 'G' + i }); }
  W.stays = stays; W.cfg.STR_LOOKAHEAD_DAYS = '90'; W.calEvents = [];
  const E = build(W); clock = at(E, '2026-10-20', '10:00'); await E.strTick({}, {});
  const keys = rowsOf(W, 'STR_Turnovers').map(r => r.Task_Key).slice(0, 40); W.sms.length = 0; W.sheetCalls = 0;
  t('setup: 40 turnovers exist', keys.length === 40, keys.length);
  const body = { action: 'swap', task_keys: keys, cleaner_id: '3' }, p = await preview(E, body);
  const r = await sendIt(E, p, body);
  t('40-date swap: all done, ONE text to the new cleaner listing all dates', r.ok && r.counts.done === 40 && W.sms.length >= 1 && W.sms.filter(s => s.to === 'Rachel Twigg').length === 1, { c: r.counts, e: r.errors.slice(0, 2) });
  t('40-date swap: Sheets calls stay far under the per-minute quota (batched, not per-date)', W.sheetCalls < 200 && W.maxCall <= 48, { calls: W.sheetCalls, maxCall: W.maxCall });
  t('41 dates are refused outright', (await preview(E, { action: 'swap', cleaner_id: '3', task_keys: keys.concat(['x']) })).error === 'too_many');
}

// ═══ 9. mark action (admin-set availability) ═══
{
  const { W, E } = await setup();
  const body = { action: 'mark', cleaner_id: '3', mark: 'out', dates: ['2026-10-27', '2026-10-28', '2026-11-02', '2026-10-01'] }, p = await preview(E, body);
  t('mark preview: 3 change, the past date is skipped with a reason', p.counts.change === 3 && p.items.find(i => i.date === '2026-10-01').outcome === 'skip' && /passed/.test(p.items.find(i => i.date === '2026-10-01').reason), p.items);
  t('mark preview: one optional acknowledgement text, NOT ticked by default', p.recipients.length === 1 && p.recipients[0].key === 'mark:3' && p.recipients[0].send_default === false && /marked you out for Tue, Oct 27; Wed, Oct 28; Mon, Nov 2/.test(p.recipients[0].text), p.recipients);
  const r = await sendIt(E, p, body);
  t('mark applied: three Out marks, source admin, audit rows, nobody texted (ack not ticked)', r.ok && ['2026-10-27', '2026-10-28', '2026-11-02'].every(d => markOf(W, '3', d) === 'out') && rowsOf(W, 'STR_Availability').filter(a => a.Source === 'admin').length === 3 && rowsOf(W, 'STR_Log').filter(l => l.Event === 'admin_mark').length === 3 && !W.sms.length && r.texts[0].status === 'not_sent', r);
  // idempotent: marking the same again is a no-op preview
  const p2 = await preview(E, body); t('same marks again: nothing to change', p2.counts.change === 0 && p2.items.filter(i => i.outcome === 'skip').length === 4);
  // tick afterwards: Rachel is skipped as a candidate on those dates (the existing engine honours admin marks)
  t('an admin Out mark is honoured by the queue (strNextCleaner reads it like a cleaner mark)', rowsOf(W, 'STR_Availability').some(a => a.Cleaner_ID === '3' && a.Mark === 'out'));
  // tick the ack with the text ticked
  const b2 = { action: 'mark', cleaner_id: '3', mark: 'can', dates: ['2026-10-27'] }, p3 = await preview(E, b2);
  const r3 = await sendIt(E, p3, b2, { 'mark:3': { send: true, body: 'Rachel - you are now backup for Oct 27.' } });
  t('mark can + ack ticked: sent exactly as typed; Out replaced by backup', r3.ok && markOf(W, '3', '2026-10-27') === 'can' && W.sms.length === 1 && W.sms[0].text === 'Rachel - you are now backup for Oct 27.', r3);
  const b3 = { action: 'mark', cleaner_id: '3', mark: '', dates: ['2026-10-28', '2026-10-29'] }, p4 = await preview(E, b3), r4 = await sendIt(E, p4, b3);
  t('clearing: removes the mark, no text offered for a clear', r4.ok && markOf(W, '3', '2026-10-28') === '' && p4.recipients.length === 0 && p4.items.find(i => i.date === '2026-10-29').outcome === 'skip');
}
{
  // you cannot mark the person who is cleaning that day out (calendar or hub holder) - never let a mark drop a turnover to uncovered
  const { W, E } = await setup();
  const p = await preview(E, { action: 'mark', cleaner_id: '2', mark: 'out', dates: ['2026-10-25', '2026-10-26'] });
  t('Kayla is on the calendar for Oct 25: marking her Out is blocked (swap first), Oct 26 is fine', p.items.find(i => i.date === '2026-10-25').outcome === 'blocked' && /Swap her out first/.test(p.items.find(i => i.date === '2026-10-25').reason) && p.items.find(i => i.date === '2026-10-26').outcome === 'change', p.items);
  const body = { action: 'mark', cleaner_id: '2', mark: 'out', dates: ['2026-10-25', '2026-10-26'] };
  const r = await sendIt(E, p, body);
  t('apply: the blocked date is skipped, the other done, reported per item', r.counts.done === 1 && r.counts.skipped === 1 && !markOf(W, '2', '2026-10-25') && markOf(W, '2', '2026-10-26') === 'out' && r.status === 'done', r);
  const pc = await preview(E, { action: 'mark', cleaner_id: '2', mark: 'can', dates: ['2026-10-25'] });
  t('"available as backup" for the same day she is cleaning is blocked too', pc.items[0].outcome === 'blocked');
}
{
  // marking out a cleaner with a waiting offer closes it; the scheduler then asks the next cleaner
  const { W, E } = await setup();
  const o = rowsOf(W, 'STR_Offers').find(x => x.Task_Key === K108 && x.Status === 'pending'); t('setup: Gina has a waiting offer for Nov 8', !!o && o.Cleaner_ID === '1');
  const body = { action: 'mark', cleaner_id: '1', mark: 'out', dates: ['2026-11-08'] }, p = await preview(E, body);
  t('preview says the waiting offer will be closed', p.items[0].offers_declined.length === 1 && p.items[0].notes.some(n => /waiting offer.*closed/.test(n)));
  const r = await sendIt(E, p, body);
  t('offer declined (note: marked out by Brett)', r.ok && rowsOf(W, 'STR_Offers').find(x => x.ID === o.ID).Status === 'declined' && /marked out by Brett/.test(rowsOf(W, 'STR_Offers').find(x => x.ID === o.ID).Note));
  clock += 15 * 60000; await E.strTick({}, {});
  t('the next tick asks the next cleaner (Kayla), skipping Gina', rowsOf(W, 'STR_Offers').some(x => x.Task_Key === K108 && x.Cleaner_ID === '2' && x.Status === 'pending'), rowsOf(W, 'STR_Offers').filter(x => x.Task_Key === K108));
}

// ═══ 10. held until 8 AM: parked in the Outbox, sent by the scheduler tick, never twice, never when stale ═══
{
  const { W, E } = await setup(); clock = at(E, '2026-10-20', '22:30');
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body), r = await sendIt(E, p, body);
  t('10:30pm: assignment + calendar happen now, texts are HELD (none sent)', r.status === 'done' && !W.sms.length && r.texts.every(x => x.status === 'held' && /8:00 AM/.test(x.detail)) && tr(W, K25).Assigned_Cleaner_ID === '1', r.texts);
  const ob = rowsOf(W, 'STR_Outbox');
  t('two parked rows with the exact text, expected state, and 8 AM release time', ob.length === 2 && ob.every(o => o.Status === 'parked' && o.Not_Before === new Date(at(E, '2026-10-21', '08:00')).toISOString() && o.Body && o.Expect.includes(K25)), ob);
  const st = await J(E.strAdminState({})); t('the admin board lists the parked texts', st.ok && st.parked_texts.length === 2 && st.parked_texts[0].dates.join() === '2026-10-25', st.parked_texts);
  clock = at(E, '2026-10-20', '23:30'); await E.strTick({}, {}); t('11:30pm tick: still held', !held(W).length);
  clock = at(E, '2026-10-21', '07:50'); await E.strTick({}, {}); t('7:50am tick: still held', !held(W).length);
  clock = at(E, '2026-10-21', '08:05'); const tk = await E.strTick({}, {});
  t('8:05am tick sends both held texts, marks them sent', held(W).length === 2 && rowsOf(W, 'STR_Outbox').every(o => o.Status === 'sent' && o.Sent_At) && tk.detail.held_texts.sent === 2, { sms: W.sms.length, d: tk.detail.held_texts });
  clock += 15 * 60000; await E.strTick({}, {}); t('a later tick never sends them again', held(W).length === 2);
}
{
  // held text goes stale if the schedule changes while it waits: not sent, Brett told
  const { W, E } = await setup(); clock = at(E, '2026-10-20', '22:30');
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body); await sendIt(E, p, body);
  await J(E.strAdminAssign({}, { task_key: K25, cleaner_id: '3' })); W.sms.length = 0; W.brett.length = 0; W.emails.length = 0; W.telemetry.length = 0;
  clock = at(E, '2026-10-21', '08:05'); const tk = await E.strTick({}, {});
  t('stale held texts are NOT sent, marked stale, loud', !W.sms.some(s => /you're set|off the hook/.test(s.text)) && rowsOf(W, 'STR_Outbox').every(o => o.Status === 'stale') && tk.errors.some(e => e.step === 'held_text_stale') && W.telemetry.some(x => x.Success === 'FALSE'), tk.errors);
}
{
  // a held text whose send fails after 8am is loud
  const { W, E } = await setup(); clock = at(E, '2026-10-20', '22:30');
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body); await sendIt(E, p, body);
  W.failSms = true; clock = at(E, '2026-10-21', '08:05'); const tk = await E.strTick({}, {});
  t('held text send failure: row failed, error + alert, not retried blindly', rowsOf(W, 'STR_Outbox').every(o => o.Status === 'failed') && tk.errors.some(e => e.step === 'held_text_failed') && W.telemetry.some(x => x.Success === 'FALSE'), tk.errors);
  W.failSms = false; clock += 15 * 60000; await E.strTick({}, {}); t('...and a failed held text is not auto-resent', !held(W).length);
}
{
  const { W, E } = await setup({ STR_ENGINE_ENABLED: 'FALSE' }); clock = at(E, '2026-10-20', '22:30');
  const p = await preview(E, { action: 'swap', task_keys: [K25], cleaner_id: '1' });
  t('scheduler OFF + outside the window: preview warns held texts will not go until it is switched on', p.recipients.every(r => /scheduler is OFF/.test(r.timing.label)), p.recipients.map(r => r.timing.label));
}

// ═══ 11. concurrency: two Sends of the same plan at once ═══
{
  const { W, E } = await setup();
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  const texts = Object.fromEntries(p.recipients.map(x => [x.key, { send: true, body: x.text }])), payload = Object.assign({}, body, { plan_id: p.plan_id, sig: p.sig, texts });
  const [a, b] = await Promise.all([J(E.strChangeApply({}, payload)), J(E.strChangeApply({}, payload))]);
  const real = [a, b].filter(x => x && x.duplicate !== true && x.status);
  for (const x of real) await finish(E, x, p.plan_id);
  t('double-tap race: at most ONE request actually applied; the other did nothing', real.length <= 1 && W.sms.filter(s => s.to === 'Regina Seville').length === 1 && W.sms.filter(s => s.to === 'Kayla').length === 1, { a: a.status || a.error || a.duplicate, b: b.status || b.error || b.duplicate });
  t('only one live "Gina Cleaning" calendar entry and one assignment row', W.calEvents.filter(e => e.summary === 'Gina Cleaning' && e.start.date === '2026-10-25').length === 1 && rowsOf(W, 'STR_Log').filter(l => l.Event === 'admin_swap').length === 1);
  t('exactly one plan row is "done", the loser (if any) is marked duplicate', rowsOf(W, 'STR_Changes').filter(r => r.Status === 'done').length === 1);
}

// ═══ 11b. resumable job: stop halfway, carry on, hiccups, nothing doubled ═══
{
  const { W, E } = await setup();
  const body = { action: 'swap', task_keys: [K20, K25, K30], cleaner_id: '3' }, p = await preview(E, body);
  const texts = Object.fromEntries(p.recipients.map(x => [x.key, { send: x.send_default, body: x.text }]));
  E.__cold(); const first = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p.plan_id, sig: p.sig, texts })));
  t('a big change can stop halfway: first call says "applying", not "done"', first.status === 'applying' && !first.duplicate, first.status);
  const st1 = await J(E.strAdminState({})); t('the board lists the half-finished change (unfinished_changes)', st1.ok && st1.unfinished_changes.length === 1 && st1.unfinished_changes[0].plan_id === p.plan_id, st1.unfinished_changes);
  const smsBefore = W.sms.length;
  const dup = await J(E.strChangeApply({}, Object.assign({}, body, { plan_id: p.plan_id, sig: p.sig, texts })));
  t('pressing Send again (no resume flag) does nothing but report it is in progress', dup.duplicate === true && W.sms.length === smsBefore, dup.message);
  clock += 12 * 60000; const tk = await E.strTick({}, {});
  t('a scheduler tick 12 minutes later flags the half-finished change loudly', tk.errors.some(e => e.step === 'change_unfinished' && /Continue/.test(e.error)), tk.errors);
  const res = await finish(E, first, p.plan_id);
  t('Continue finishes it: done, all 3 dates assigned to Rachel', res.status === 'done' && [K20, K25, K30].every(k => tr(W, k).Assigned_Cleaner_ID === '3'), res.status);
  t('each person texted exactly once across all the calls', W.sms.filter(s => s.to === 'Rachel Twigg').length === 1 && W.sms.filter(s => s.to === 'Regina Seville').length === 1 && W.sms.filter(s => s.to === 'Kayla').length <= 1 + (W.sms.filter(s => s.type === 'str_offer').length), W.sms.map(s => s.to + ':' + s.type));
  const st2 = await J(E.strAdminState({})); t('nothing left unfinished afterwards', st2.unfinished_changes.length === 0);
  const smsAfter = W.sms.length, again = await J(E.strChangeApply({}, { plan_id: p.plan_id, resume: true }));
  t('another Continue after done only replays the result (no second text, no second calendar write)', again.duplicate === true && W.sms.length === smsAfter, again.message);
  const unk = await J(E.strChangeApply({}, { plan_id: 'abcdef0123456789', resume: true }));
  t('Continue for an unknown plan is refused plainly', unk.ok === false && unk.error === 'plan_not_found');
}
{
  // one Sheets hiccup on the main write: the date is reported FAILED, loudly; nothing is half-done or texted; a second try works
  const { W, E } = await setup();
  const body = { action: 'swap', task_keys: [K25], cleaner_id: '1' }, p = await preview(E, body);
  W.throwOnceBatch = true;
  const r = await sendIt(E, p, body);
  t('a Sheets error on the write: reported as FAILED with the reason, never "done"', r.status === 'failed' && r.counts.failed === 1 && r.items[0].status === 'failed' && /Sheets hiccup/.test(r.items[0].reason + JSON.stringify(r.errors)), { s: r.status, e: (r.errors || []).slice(0, 2) });
  t('...the date is unchanged, nobody was told it changed, the calendar was not touched', tr(W, K25).Assigned_Cleaner_ID !== '1' && !W.cal.some(c => c.method !== 'GET'), tr(W, K25));
  t('...and no "you are set" text went out for a change that did not happen', !W.sms.some(s => s.to === 'Regina Seville'), W.sms.map(s => s.to + ':' + s.type));
  const p2 = await preview(E, body), r2 = await sendIt(E, p2, body);
  t('pressing Preview + Send again works', r2.status === 'done' && tr(W, K25).Assigned_Cleaner_ID === '1' && W.sms.filter(s => s.to === 'Regina Seville').length === 1, r2.status);
}
{
  // cold-start budget: even the biggest allowed change never needs more than ~48 outgoing calls in ONE request
  const { W, E } = await setup();
  const keys = []; for (let i = 0; i < 40; i++) keys.push('milam-ridge|checkout|2027-01-' + String(i + 1).padStart(2, '0')); // not-found dates: worst case for per-item work
  const body = { action: 'swap', task_keys: keys, cleaner_id: '3' }, p = await preview(E, body);
  t('40 unknown dates: preview still answers inside the limit', p && p.ok !== undefined);
  W.maxCall = 0; const r = await sendIt(E, p, body);
  t('40 dates: every single request stayed under 48 outgoing calls', W.maxCall <= 48, W.maxCall);
}

// ═══ 12. state + load: the old flows still work ═══
{
  const { W, E } = await setup();
  const st = await J(E.strAdminState({}));
  t('admin state still shows the Oct 25 task as on_calendar / Kayla (what the page reads)', st.ok && st.tasks.find(x => x.key === K25).status === 'on_calendar' && st.tasks.find(x => x.key === K25).assigned_name === 'Kayla' && Array.isArray(st.parked_texts));
  const a = await J(E.strAdminAssign({}, { task_key: K25, cleaner_id: '1' }));
  t('the old assign endpoint still works unchanged', a.ok && tr(W, K25).Assigned_Cleaner_ID === '1');
}

console.log(`str-swap-bulk: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

