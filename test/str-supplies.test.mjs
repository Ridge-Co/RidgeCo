// STR SUPPLY REQUESTS (Nov 3 2026, Brett): cleaners tell Brett what is running low; he marks it ordered; asking again shows how long it has waited. Harness reused from str-pending.test.mjs.
// The STR block is sliced out of worker.js and run against an in-memory Sheets store; every outside call (SMS, email, calendar) is stubbed and recorded; the clock is pinned.
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
    fetchConfig: async () => Object.assign({}, W.cfg), fetchTab: async (env, tab) => (W.sheetCalls++, W.reads++, objs(tab)), fetchTabs: async (env, ts) => (W.sheetCalls++, W.reads++, (W.warm = W.warm || new Set(), ts.forEach(x => W.warm.add(x))), ts.map(x => objs(x))), /* real addRow / updateRow / ensureColumns each make 1-2 Sheets calls; the fakes below charge the same */
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
    ensureColumns: async (env, tab, cols) => { if (!(W.warm && W.warm.has(tab))) { W.sheetCalls++; W.reads++; } /* Oct 22 2026: after strEnsureTabs' one batched read the real ensureColumns is a tab-cache hit (no Google call) */ if (!tabs.has(tab)) tabs.set(tab, []); const rows = tabs.get(tab); if (!rows.length) rows.push([]); for (const c of cols) if (!rows[0].includes(c)) { rows[0].push(c); for (let i = 1; i < rows.length; i++) rows[i].push(''); } },
    addRow: async (env, tab, body) => { W.sheetCalls += 2; W.reads++; const h = hdr(tab), idc = h.indexOf('ID'); const next = tabs.get(tab).slice(1).reduce((m, r) => Math.max(m, parseInt(r[idc]) || 0), 0) + 1; tabs.get(tab).push(h.map(k => k === 'ID' ? String(next) : (body[k] != null ? String(body[k]) : ''))); return json({ success: true, id: String(next) }); },
    updateRow: async (env, tab, id, fields) => { W.sheetCalls += 2; W.reads++; const h = hdr(tab), idc = Math.max(0, h.indexOf('ID')), row = tabs.get(tab).slice(1).find(r => String(r[idc]) === String(id)); if (!row) return json({ error: 'Row not found' }, 404); for (const [k, v] of Object.entries(fields)) { const ci = h.indexOf(k); if (ci >= 0) row[ci] = String(v); } return json({ success: true }); },
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
const exportsList = ['strTick', 'strAdminState', 'strCleanerPage', 'inspEtWallToMs', 'inspEtDate', 'inspAddDays', 'strSupplyRequest', 'strAdminSupplyOrdered', 'strSupBlock', 'STR_COMING_SOON'];
let CUR = null; Object.defineProperty(globalThis, '__sheetsFetchCount', { get: () => (CUR ? CUR.sheetCalls : 0), configurable: true });
function build(W) { CUR = W; const F = new Function(...names, realFns + '\n' + realConsts + '\n' + block + '\nreturn {' + exportsList.join(',') + ', __cold: () => { __strTabsReady = false; }};'); const E = F(...names.map(n => W.stubs[n])); E.W = W; { const c0 = E.__cold; E.__cold = () => { c0(); if (W.warm) W.warm.clear(); }; } return E; }
let clock = 0; Date.now = () => clock;
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

const tok = (W, id) => rowsOf(W, 'STR_Cleaners').find(c => c.ID === id).Link_Token;
const SUP_H = ['Request_ID', 'Created_At', 'Property_Key', 'Item_ID', 'Item_Text', 'Qty', 'Requested_By_Cleaner_ID', 'Turnover_Task_Key', 'Status', 'Resolved_At', 'Resolved_By', 'Order_Ref', 'Source', 'Note'];
function seedSupplies(W) {
  W.tabs.set('Supply_Requests', [SUP_H.slice()]);
  W.tabs.set('Supply_Items', [['Item_ID', 'Item_Name', 'Category', 'Stored_Box_No', 'Stored_Location_ID', 'Unit', 'Par_Level', 'Reorder_At', 'Preferred_Source', 'Auto_Order', 'Guest_Facing', 'Source', 'Active', 'Notes'],
    ['SUP-004', 'Windex', 'Cleaning', '', 'LOC-01', '', '', '', '', 'FALSE', 'FALSE', 'x', 'TRUE', ''],
    ['SUP-010', 'Coffee filters', 'Coffee', '7', 'LOC-08', '', '', '', '', 'FALSE', 'TRUE', 'x', 'TRUE', ''],
    ['SUP-056', 'AA batteries', 'Cabin', '', '', '', '', '10', '', 'FALSE', 'FALSE', 'x', 'TRUE', ''],
    ['SUP-099', 'Retired thing', 'Cabin', '', '', '', '', '', '', 'FALSE', 'FALSE', 'x', 'FALSE', '']]);
  W.tabs.set('Cabin_Locations', [['Location_ID', 'Property_Key', 'Name', 'Where', 'Lock_Type', 'Combination', 'Combo_Status', 'Function', 'Contents', 'Freeze_Safe', 'Cleaner_Visible', 'Last_Changed', 'Active', 'Notes'],
    ['LOC-01', 'milam-ridge', 'Cleaning closet', 'Main bathroom', 'Padlock', '1287', 'KNOWN', 'Cleaning supplies', '', '', 'TRUE', '', 'TRUE', ''],
    ['LOC-08', 'milam-ridge', 'Numbered supply boxes 1-11', 'Kitchen', 'None', '', 'N/A', 'Guest consumables', 'See Cabin_Boxes', '', 'TRUE', '', 'TRUE', ''],
    ['LOC-03', 'milam-ridge', 'Internet cabinet', '', 'Padlock', '9999', 'CHANGED', 'Router', '', '', 'FALSE', '', 'TRUE', '']]);
  W.tabs.set('Cabin_Boxes', [['Box_No', 'Property_Key', 'Location_ID', 'Room', 'Contents', 'Lock_Code', 'Lock_Code_Status', 'Guest_Accessible', 'Last_Changed', 'Notes'],
    ['6', 'milam-ridge', 'LOC-08', 'Kitchen', 'Emergency guest supplies', '1864', 'KNOWN', 'TRUE', '', ''],
    ['7', 'milam-ridge', 'LOC-08', 'Kitchen', 'Decaf Coffee, Coffee Filters', '', '', '', '', '']]);
}
async function world(mut) {
  const W = makeWorld(); seed(W, {}); seedSupplies(W); if (mut) mut(W);
  const E = build(W); clock = E.inspEtWallToMs('2026-11-03', '10:00'); CUR = W;
  return { W, E };
}
const reqs = W => rowsOf(W, 'Supply_Requests');
const post = (E, k, b) => J(E.strSupplyRequest({}, Object.assign({ k }, b)));

// ═══ 1. The catalog and "where it is kept" reach the cleaner page; no lock codes, no inactive items ═══
{
  const { W, E } = await world();
  const b = await E.strSupBlock({}, clock, false);
  t('catalog lists the three active items, not the retired one', !!b.catalog && b.catalog.map(c => c.name).join('|') === 'AA batteries|Windex|Coffee filters', b.catalog);
  t('retired item is not offered', !b.catalog.some(c => c.item_id === 'SUP-099'));
  t('Windex is kept in the cleaning closet (Main bathroom)', b.catalog.find(c => c.item_id === 'SUP-004').where === 'Cleaning closet - Main bathroom', b.catalog);
  t('a box item says which box and room', b.catalog.find(c => c.item_id === 'SUP-010').where === 'Box 7 (Kitchen)', b.catalog);
  t('item with no stored place has an empty where (not an invented one)', b.catalog.find(c => c.item_id === 'SUP-056').where === '');
  const wire = JSON.stringify(b);
  t('no combination or lock code anywhere in what the page receives', !/1287|1864|9999/.test(wire), wire.match(/.{20}(1287|1864|9999).{20}/));
  t('a location Brett has not cleared for cleaners is not listed', !b.places.some(p => /Internet/.test(p.name)));
  const page = await J(E.strCleanerPage({}, new URL('https://x.test/str/c/page?k=' + tok(W, '1'))));
  t('the cleaner page carries the supplies block', page.ok && page.supplies && Array.isArray(page.supplies.catalog), Object.keys(page));
  t('"Supplies requests" is no longer a coming-soon tile', !E.STR_COMING_SOON.includes('Supplies requests'));
}

// ═══ 2. Request, shown as "<name> requested <item> <date>", Brett is emailed ═══
{
  const { W, E } = await world();
  const r = await post(E, tok(W, '1'), { item_id: 'SUP-056' });
  t('request is accepted', r.ok && r.result === 'requested', r);
  const row = reqs(W)[0];
  t('one row saved with item, name, status requested, date', reqs(W).length === 1 && row.Item_Text === 'AA batteries' && row.Requested_By_Name === 'Gina' && row.Status === 'requested' && row.Item_ID === 'SUP-056' && row.Created_At.startsWith('2026-11-03'), row);
  t('Brett is emailed, and not texted', W.emails.length === 1 && /AA batteries/.test(W.emails[0].subject) && /Gina requested AA batteries/.test(W.emails[0].html) && W.brett.length === 0, { e: W.emails.length, b: W.brett.length });
  const open = r.supplies.open[0];
  t('the returned list shows who, what and when', open && open.by === 'Gina' && open.text === 'AA batteries' && open.date === '2026-11-03' && open.times === 1, r.supplies.open);
  const r2 = await post(E, tok(W, '2'), { item_id: 'SUP-056' });
  t('a second cleaner asking the same day does not make a duplicate and is told it is already on the list', r2.ok && r2.result === 'already_today' && reqs(W).length === 1, r2);
  t('no extra email for the duplicate', W.emails.length === 1);
}

// ═══ 3. Ask again on a later visit: same row, counts up, Brett is emailed again ═══
{
  const { W, E } = await world();
  await post(E, tok(W, '1'), { item_id: 'SUP-056' });
  clock = E.inspEtWallToMs('2026-11-12', '09:00');
  const pg = await E.strSupBlock({}, clock, false);
  t('on a later day the request offers "ask again"', pg.open[0].can_again === true, pg.open[0]);
  const rid = pg.open[0].id;
  const r = await post(E, tok(W, '2'), { request_id: rid });
  t('asking again works', r.ok && r.result === 're_requested', r);
  t('still ONE row, asked 2 times, last asked by Kayla on Nov 12, original date kept', reqs(W).length === 1 && reqs(W)[0].Times_Requested === '2' && reqs(W)[0].Last_Requested_By_Name === 'Kayla' && reqs(W)[0].Created_At.startsWith('2026-11-03') && reqs(W)[0].Last_Requested_At.startsWith('2026-11-12'), reqs(W));
  t('Brett is emailed that she still needs it', W.emails.length === 2 && /still needs/.test(W.emails[1].subject) && /asked 2 times/.test(W.emails[1].html), W.emails.map(e => e.subject));
  const r2 = await post(E, tok(W, '1'), { request_id: rid });
  t('a second ask the same day is refused politely', r2.result === 'already_today' && reqs(W)[0].Times_Requested === '2', r2);
}

// ═══ 4. Brett marks it ordered; it leaves the list; asking after that starts a fresh, flagged request ═══
{
  const { W, E } = await world();
  await post(E, tok(W, '1'), { item_id: 'SUP-056' });
  const o = await J(E.strAdminSupplyOrdered({}, { request_id: '1', order_ref: 'Amazon' }));
  t('mark ordered works', o.ok && o.result === 'ordered', o);
  t('row is ordered with date, who and reference', reqs(W)[0].Status === 'ordered' && reqs(W)[0].Resolved_By === 'Brett' && reqs(W)[0].Order_Ref === 'Amazon' && reqs(W)[0].Resolved_At.startsWith('2026-11-03'), reqs(W));
  t('the open list is empty and the item shows as recently ordered', o.supplies.open.length === 0 && o.supplies.ordered.length === 1 && o.supplies.ordered[0].ordered_date === '2026-11-03', o.supplies);
  const o2 = await J(E.strAdminSupplyOrdered({}, { request_id: '1' }));
  t('marking it ordered twice is harmless and says so', o2.ok && o2.result === 'already', o2);
  clock = E.inspEtWallToMs('2026-11-20', '09:00');
  const r = await post(E, tok(W, '1'), { request_id: '1' });
  t('"still don\'t have it" after it was ordered makes a NEW request', r.ok && r.result === 'requested' && reqs(W).length === 2 && reqs(W)[1].Status === 'requested', r);
  t('the new request says it was requested again after being ordered Nov 3', /ordered on 2026-11-03/.test(reqs(W)[1].Note), reqs(W)[1]);
  const o3 = await J(E.strAdminSupplyOrdered({}, { request_id: '99' }));
  t('unknown request id is a clear 404-style answer, not a silent success', o3.ok === false && o3.error === 'not_found', o3);
  clock = E.inspEtWallToMs('2026-12-30', '09:00');
  const b = await E.strSupBlock({}, clock, true);
  t('ordered items drop off the recently-ordered list after 14 days', b.ordered.length === 0, b.ordered);
}

// ═══ 5. Something else (free text) ═══
{
  const { W, E } = await world();
  const r = await post(E, tok(W, '1'), { text: '  Dale  chain   bar ' });
  t('free-text request is saved tidy with no item id', r.ok && reqs(W)[0].Item_Text === 'Dale chain bar' && reqs(W)[0].Item_ID === '', reqs(W));
  const r2 = await post(E, tok(W, '2'), { text: 'dale CHAIN bar' });
  t('same words in another case are the same request', r2.result === 'already_today' && reqs(W).length === 1, r2);
  const r3 = await post(E, tok(W, '1'), { text: 'windex' });
  t('typing the name of a listed item links to that item', r3.ok && reqs(W)[1].Item_ID === 'SUP-004' && reqs(W)[1].Item_Text === 'Windex', reqs(W));
  t('one letter is refused', (await post(E, tok(W, '1'), { text: 'a' })).error === 'bad_text');
  t('a very long text is refused', (await post(E, tok(W, '1'), { text: 'x'.repeat(81) })).error === 'bad_text');
  t('an inactive or unknown item id is refused with a clear message', (await post(E, tok(W, '1'), { item_id: 'SUP-099' })).error === 'item_not_found');
}

// ═══ 6. Access control ═══
{
  const { W, E } = await world();
  const bad = await E.strSupplyRequest({}, { k: 'nope-nope-nope-nope-nope-nope', item_id: 'SUP-056' });
  t('a wrong link is refused and nothing is written', bad.status === 404 && reqs(W).length === 0, bad.status);
  W.tabs.get('STR_Cleaners').find(r => r[0] === '3')[6] = 'FALSE';
  const off = await E.strSupplyRequest({}, { k: tok(W, '3'), item_id: 'SUP-056' });
  t('a deactivated cleaner cannot request', off.status === 404 && reqs(W).length === 0, off.status);
  t('an empty request is refused', (await post(E, tok(W, '1'), {})).error === 'bad_text');
}

// ═══ 7. Failures are loud ═══
{
  const { W: W2 } = await world();
  W2.stubs.gmailSendEmail = async () => { throw new Error('gmail down'); };
  const E3 = build(W2); CUR = W2; clock = E3.inspEtWallToMs('2026-11-03', '10:00');
  const r = await post(E3, tok(W2, '1'), { item_id: 'SUP-056' });
  t('request is still saved when Brett\'s email fails', r.ok && reqs(W2).length === 1, r);
  t('the cleaner is told Brett\'s email did not go out', (r.warnings || []).some(x => /email did not go out/.test(x)), r.warnings);
  t('the failure is recorded for Brett (telemetry)', W2.telemetry.some(x => x.Success === 'FALSE' && /supply_notify/.test(x.Skill_Or_Endpoint)), W2.telemetry);
}
{
  const { W, E } = await world(w => { const real = w.stubs.updateRow; w.stubs.updateRow = async (...a) => w.noLand ? w.stubs.json({ success: true }) : real(...a); });
  await post(E, tok(W, '1'), { item_id: 'SUP-056' });
  clock = E.inspEtWallToMs('2026-11-12', '09:00'); W.noLand = true;
  const r = await post(E, tok(W, '2'), { request_id: '1' });
  t('an update that is accepted but does not land is reported as a failure, never as success', r.ok === false && r.error === 'write_not_landed', r);
  t('Brett gets the problem alert (not a normal "still needs it" email) because the save failed', W.emails.length === 2 && /scheduler problem/i.test(W.emails[1].subject) && !/still needs/.test(W.emails[1].subject), W.emails.map(e => e.subject));
}
{
  const { W, E } = await world(w => { w.tabs.delete('Supply_Items'); });
  const b = await E.strSupBlock({}, clock, false);
  t('a missing/empty supply list is an error on the page, not an empty form', !!b.error && !b.catalog, b);
  t('and Brett is told', W.telemetry.some(x => x.Success === 'FALSE' && /supplies_block/.test(x.Skill_Or_Endpoint)), W.telemetry);
}

// ═══ 8. Brett's side ═══
{
  const { W, E } = await world();
  await post(E, tok(W, '1'), { item_id: 'SUP-056' }); await post(E, tok(W, '2'), { text: 'Leaf blower battery' });
  const st = await J(E.strAdminState({}));
  t('the admin state lists both open requests for Brett', st.ok && st.supplies && st.supplies.open.length === 2 && st.supplies.open[0].by === 'Gina' && st.supplies.open[1].by === 'Kayla', st.supplies);
  t('admin supplies carry no catalog or places (not needed there)', !st.supplies.catalog);
}

// ═══ 9. Self-created tab ═══
{
  const { W, E } = await world(w => { w.tabs.delete('Supply_Requests'); });
  const r = await post(E, tok(W, '1'), { item_id: 'SUP-056' });
  t('if the Supply_Requests tab does not exist yet it is created and the request still lands', r.ok && reqs(W).length === 1, r);
}

console.log(`str-supplies: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
