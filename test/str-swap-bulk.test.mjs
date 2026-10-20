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
//@@T1@@
