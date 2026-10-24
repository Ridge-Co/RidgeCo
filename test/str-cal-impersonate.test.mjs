// STR cleaning calendar: "act as Brett" (Google domain-wide delegation), Oct 21 2026.
// Brett's Google Workspace cannot give the service account edit access to the cleaning calendar, so the same service account signs in as Brett
// (JWT `sub`), who owns the calendar. Opt-in per Config STR_CAL_IMPERSONATE (blank = the old behaviour exactly, which the inspection calendar and
// the inspection guard keep using). The STR block, the real token function and the real classifier are sliced out of worker.js and run against an
// in-memory Sheets store with Google (token endpoint + Calendar API) stubbed and recorded.
import fs from 'fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = fs.readFileSync(root + 'worker.js', 'utf8'), html = fs.readFileSync(root + 'str-cleaning.html', 'utf8');
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

const SA = 'maintenance-hub-sheets@maintenance-hub-498819.iam.gserviceaccount.com', CAL = 'c_a60e5e1a2653b05d5402530f07ea77b6fe48fb7da9e196cdd0f03c673f82174b@group.calendar.google.com';
const FULL = 'https://www.googleapis.com/auth/calendar', EVENTS = 'https://www.googleapis.com/auth/calendar.events';
const realFns = ['nyOffsetMinutes', 'inspParseHHMM', 'inspEtWallToMs', 'inspEtDate', 'inspEtMinutes', 'inspAddDays', 'inspStrCleaningKind', 'inspStrEvDay', 'inspStrEventDays', 'inspStrStays', 'inspStrFromApi', 'inspIcsEsc', 'renderTemplate', 'idColIndex', 'inspErr', 'inspStrMask', 'inspStrConfig', 'inspClassifyCalError', 'appendedRowNumber', 'mintNextNumericId', 'col', 'b64url', 'calJwtClaim', 'calDelegationHelp', 'calBadUserHelp', 'sheetsQuotaBusyError'].map(n => grab(n)).join('\n') + '\n' + ['guardAppendedIds', 'getCalendarAccessToken', 'inspCalendarId', 'inspCalFetch', 'inspCalendarTest'].map(n => grab(n, 'async')).join('\n') + '\nlet __calTokens = {};\n' + grab('INSP_TZ', 'const');

const decodeClaim = body => { const jwt = /assertion=([^&]+)/.exec(String(body))[1], [h, c] = jwt.split('.'); return JSON.parse(Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); };
function makeWorld(opts) {
  opts = opts || {};
  const tabs = new Map(), W = { tabs, cfg: {}, brett: [], emails: [], cal: [], tokenCalls: [], telemetry: [], staged: !!opts.staged, tokenReply: null, calReply: null, sms: [] };
  const hdr = tab => tabs.get(tab)[0];
  const objs = tab => { if (!tabs.has(tab)) throw new Error('Unable to parse range: ' + tab); const [h, ...rows] = tabs.get(tab); return rows.map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i] == null ? '' : r[i]); return o; }); };
  const json = (b, s) => ({ ok: !s || s < 400, status: s || 200, json: async () => b });
  const stubs = {
    fetchConfig: async () => Object.assign({}, W.cfg), fetchTab: async (env, tab) => objs(tab), fetchTabs: async (env, ts) => ts.map(x => objs(x)), invalidateTabCache: () => {}, json,
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
    updateRow: async (env, tab, id, fields) => { const h = hdr(tab), idc = h.indexOf('ID'), row = tabs.get(tab).slice(1).find(r => String(r[idc]) === String(id)); if (!row) return json({ error: 'Row not found' }, 404); for (const [k, v] of Object.entries(fields)) { const ci = h.indexOf(k); if (ci >= 0) row[ci] = String(v); } return json({ success: true }); },
    setConfigKey: async (env, b) => { W.cfg[b.key] = b.value; return json({ success: true }); },
    logTelemetry: async (env, rec) => { W.telemetry.push(rec); }, getMessageTemplate: async () => null,
    smsGatedSend: async () => ({ send_ok: true, sent: true, queued_id: 'q', test_mode: true }),
    sendSMS: async (env, to, text) => { W.brett.push({ to, text }); return { sid: 'x' }; },
    gmailSendEmail: async (env, e) => { W.emails.push(e); return { staged: true }; }, gmailSendEmailWithAttachment: async () => ({ staged: true }),
    inspCalStaged: () => W.staged,
    inspStrReadIcs: async () => (W.stays || []), inspStrReadGoogle: async () => [],
    schedStep: async (name, fn, errors) => { try { return await fn(); } catch (e) { errors.push({ step: name, error: String(e.message) }); } }, schedErrText: e => String((e && e.message) || e), isStaging: () => W.staged,
    normalizePhone: p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 10 ? '+1' + d : (d.length === 11 && d[0] === '1' ? '+' + d : ''); },
    inspRandToken: () => 'tok' + 'x'.repeat(30), _utf8B64url: s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    BUILD_VERSION: 'test', PORTAL_BASE: 'https://portal.test', CORS: {},
    importPrivateKey: async () => 'key', signRS256: async () => 'SIG', inspGeocode: async () => ({ formatted: '1111 East 43rd St', lat: 39.3, lng: -76.6 }), inspRouteMatrix: async () => [{ condition: 'ROUTE_EXISTS', duration: '600s' }],
    inspCalListEvents: async () => ({ items: [] }),
    fetch: async (url, init) => {
      const method = (init && init.method) || 'GET', body = init && init.body;
      if (url === 'https://oauth2.googleapis.com/token') {
        const claim = decodeClaim(body); W.tokenCalls.push(claim);
        const r = W.tokenReply ? W.tokenReply(claim) : null;
        if (r) return new Response(JSON.stringify(r.body), { status: r.status || 400 });
        return new Response(JSON.stringify({ access_token: 'tok-' + (claim.sub || 'own') + '-' + claim.scope.split('/').pop() }), { status: 200 });
      }
      const rec = { method, url, body: body && typeof body === 'string' && body[0] === '{' ? JSON.parse(body) : null, auth: init && init.headers && init.headers.Authorization }; W.cal.push(rec);
      const r = W.calReply ? W.calReply(rec) : null;
      if (r) return new Response(r.body == null ? null : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)), { status: r.status });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'GET') return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response(JSON.stringify({ id: 'ev' + W.cal.length }), { status: 200 });
    },
  };
  W.stubs = stubs; return W;
}
const names = ['fetchConfig', 'fetchTab', 'fetchTabs', 'invalidateTabCache', 'json', 'sheetsRequest', 'ensureColumns', 'addRow', 'updateRow', 'setConfigKey', 'logTelemetry', 'getMessageTemplate', 'smsGatedSend', 'sendSMS', 'gmailSendEmail', 'gmailSendEmailWithAttachment', 'inspCalStaged', 'inspStrReadIcs', 'inspStrReadGoogle', 'schedStep', 'schedErrText', 'isStaging', 'normalizePhone', 'inspRandToken', '_utf8B64url', 'BUILD_VERSION', 'PORTAL_BASE', 'CORS', 'importPrivateKey', 'signRS256', 'inspGeocode', 'inspRouteMatrix', 'inspCalListEvents', 'fetch'];
const exportsList = ['strCalAs', 'strSettings', 'strSettingsOut', 'strCalFetch', 'strCalClassify', 'strCalCheck', 'strAdminCalendarCheck', 'strAdminConfig', 'strTick', 'strReconcileCalendar', 'strErrText', 'getCalendarAccessToken', 'calJwtClaim', 'inspCalFetch', 'inspCalendarTest', 'inspClassifyCalError', 'STR_CAL_FATAL', 'STR_CAL_SCOPE_EVENTS', 'STR_CAL_SCOPE_SHARED', 'inspEtWallToMs', 'inspEtDate'];
function build(W) {
  const F = new Function(...names, realFns + '\n' + block + '\nreturn {' + exportsList.join(',') + '};');
  return F(...names.map(n => W.stubs[n]));
}
let clock = Date.UTC(2026, 9, 21, 15, 0, 0); const realNow = Date.now; Date.now = () => clock;
const ENV = { GOOGLE_SA_EMAIL: SA, GOOGLE_SA_KEY: 'k' };
const rowsOf = (W, tab) => { const [h, ...r] = W.tabs.get(tab); return r.map(x => Object.fromEntries(h.map((k, i) => [k, x[i] || '']))); };
const J = async r => (await r).json();
const REAL = { cfg: { STR_GUARD_CLEANING_CAL: CAL } };
const denied = () => ({ status: 400, body: { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.' } });

// ═══ 1. the JWT claim: blank = the original shape, set = sub + calendar.events ═══
{
  const W = makeWorld(), E = build(W);
  const blank = E.calJwtClaim(ENV, 1000, undefined), blank2 = E.calJwtClaim(ENV, 1000, { sub: '', scope: undefined });
  t('blank claim: exactly the original shape and key order (no sub, scope calendar)', JSON.stringify(blank) === JSON.stringify({ iss: SA, scope: FULL, aud: 'https://oauth2.googleapis.com/token', exp: 4600, iat: 1000 }), blank);
  t('blank claim with an empty sub is the same original shape', JSON.stringify(blank2) === JSON.stringify(blank), blank2);
  const set = E.calJwtClaim(ENV, 1000, { sub: 'brett@bmoremanagement.com', scope: EVENTS });
  t('set claim: sub present and the narrow calendar.events scope', set.sub === 'brett@bmoremanagement.com' && set.scope === EVENTS && set.iss === SA && set.exp === 4600, set);
  t('the narrow scope is exactly the string Brett pastes into the Google admin page', E.STR_CAL_SCOPE_EVENTS === EVENTS && E.STR_CAL_SCOPE_SHARED === FULL);
  // real token function: what actually goes to Google
  await E.getCalendarAccessToken(ENV);
  t('token request without options: no sub, scope calendar (old behaviour)', W.tokenCalls.length === 1 && W.tokenCalls[0].sub === undefined && W.tokenCalls[0].scope === FULL, W.tokenCalls);
  const own = await E.getCalendarAccessToken(ENV), dele = await E.getCalendarAccessToken(ENV, { sub: 'brett@bmoremanagement.com', scope: EVENTS });
  t('shared token is cached; the delegated one is a separate request with sub + calendar.events', W.tokenCalls.length === 2 && W.tokenCalls[1].sub === 'brett@bmoremanagement.com' && W.tokenCalls[1].scope === EVENTS, W.tokenCalls.length);
  t('the two tokens are distinct and never mixed', own === 'tok-own-calendar' && dele === 'tok-brett@bmoremanagement.com-calendar.events' && own !== dele, { own, dele });
  const again = await E.getCalendarAccessToken(ENV, { sub: 'brett@bmoremanagement.com', scope: EVENTS }), again2 = await E.getCalendarAccessToken(ENV);
  t('each mode keeps being served from its own cache entry', W.tokenCalls.length === 2 && again === dele && again2 === own, W.tokenCalls.length);
  const other = await E.getCalendarAccessToken(ENV, { sub: 'someone@bmoremanagement.com', scope: EVENTS }), wide = await E.getCalendarAccessToken(ENV, { sub: 'brett@bmoremanagement.com', scope: FULL });
  t('a different sub, or the same sub with another scope, never reuses a cached token', W.tokenCalls.length === 4 && other !== dele && wide !== dele && other !== wide, W.tokenCalls.map(c => c.sub + '|' + c.scope));
}

// ═══ 2. Google says "not authorized yet": loud, plain English, exact steps ═══
for (const code of ['unauthorized_client', 'access_denied']) {
  const W = makeWorld(), E = build(W); W.tokenReply = () => ({ status: 400, body: { error: code } });
  let err = null; try { await E.getCalendarAccessToken(ENV, { sub: 'brett@bmoremanagement.com', scope: EVENTS }); } catch (e) { err = e; }
  const m = err ? err.message : '';
  t(code + ': throws the coded delegation error (503)', !!err && err.code === 'calendar_delegation_not_authorized' && err.status === 503, err && err.code);
  t(code + ': says delegation is not authorized yet and who it would act as', /not approved the Hub to act as brett@bmoremanagement\.com/.test(m) && /domain-wide delegation is not authorized/.test(m), m);
  t(code + ': says exactly where: admin.google.com > Security > Access and data control > API controls > Domain-wide delegation', /admin\.google\.com/.test(m) && /Security > Access and data control > API controls > Domain-wide delegation/.test(m), m);
  t(code + ': says where to find the Client ID (the service account Unique ID in Google Cloud console) and names the account', /Unique ID/.test(m) && /Google Cloud console > IAM & Admin > Service Accounts/.test(m) && m.includes(SA), m);
  t(code + ': gives the exact scope to paste', m.includes('OAuth scope (copy exactly): ' + EVENTS), m);
  t(code + ': tells him what to press afterwards', /Check calendar access/.test(m));
  t(code + ': one Google request, nothing cached from the failure', W.tokenCalls.length === 1);
}
{
  // without a sub the same Google answer is the old generic error (nothing about delegation)
  const W = makeWorld(), E = build(W); W.tokenReply = () => ({ status: 400, body: { error: 'unauthorized_client' } });
  let err = null; try { await E.getCalendarAccessToken(ENV); } catch (e) { err = e; }
  t('blank mode: unauthorized_client stays the old calendar_auth error', !!err && err.code === 'calendar_auth' && /Google Calendar auth failed/.test(err.message) && !/delegation/i.test(err.message), err && err.message);
  const W2 = makeWorld(), E2 = build(W2); W2.tokenReply = () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'Invalid email or User ID' } });
  let e2 = null; try { await E2.getCalendarAccessToken(ENV, { sub: 'brett@nope.test', scope: EVENTS }); } catch (e) { e2 = e; }
  t('a sub Google does not know: coded plain-English error naming the setting', !!e2 && e2.code === 'calendar_impersonate_bad_user' && /brett@nope\.test/.test(e2.message) && /STR_CAL_IMPERSONATE/.test(e2.message), e2 && e2.message);
}

// ═══ 3. strCalFetch uses the right sign-in per Config; error text never says "share" ═══
{
  const calls = []; const W = makeWorld(), E = build(W);
  W.cfg = Object.assign({}, REAL.cfg); E.strSettings(W.cfg);
  await E.strCalFetch(ENV, CAL, 'GET', '/events?maxResults=1');
  t('blank config: the cleaning calendar call signs in the old way (no sub, scope calendar)', W.tokenCalls.length === 1 && W.tokenCalls[0].sub === undefined && W.tokenCalls[0].scope === FULL && W.cal[0].auth === 'Bearer tok-own-calendar', W.tokenCalls);
  W.cfg.STR_CAL_IMPERSONATE = 'brett@bmoremanagement.com'; E.strSettings(W.cfg);
  await E.strCalFetch(ENV, CAL, 'GET', '/events?maxResults=1');
  t('set: the cleaning calendar call signs in as Brett with calendar.events and uses THAT token', W.tokenCalls.length === 2 && W.tokenCalls[1].sub === 'brett@bmoremanagement.com' && W.tokenCalls[1].scope === EVENTS && W.cal[1].auth === 'Bearer tok-brett@bmoremanagement.com-calendar.events', { t: W.tokenCalls, a: W.cal.map(c => c.auth) });
  W.cfg.STR_CAL_IMPERSONATE = ''; E.strSettings(W.cfg);
  await E.strCalFetch(ENV, CAL, 'GET', '/events?maxResults=1');
  t('blank again: back to the old sign-in (cache hit, still the shared token)', W.cal[2].auth === 'Bearer tok-own-calendar' && W.tokenCalls.length === 2, W.cal.map(c => c.auth));
  t('strSettingsOut reports the mode for the board (shared / acting as)', E.strSettingsOut({ STR_CAL_IMPERSONATE: '' }).cal_mode === 'shared' && E.strSettingsOut({ STR_CAL_IMPERSONATE: '' }).cal_as === '' && E.strSettingsOut({ STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }).cal_mode === 'acting_as' && E.strSettingsOut({ STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }).cal_as === 'brett@bmoremanagement.com');
}
{
  // 403 / 404 / 401 on the CLEANING calendar, in both modes
  const mk = async (status, text, as) => { const W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg, as ? { STR_CAL_IMPERSONATE: as } : {}); E.strSettings(W.cfg); W.calReply = () => ({ status, body: text }); try { await E.strCalFetch(ENV, CAL, 'PATCH', '/events/x', { a: 1 }); } catch (e) { return e; } return null; };
  const e403 = await mk(403, '{"error":{"code":403,"message":"Forbidden"}}'), e404 = await mk(404, 'Not Found'), e401 = await mk(401, 'x');
  t('shared 403: coded calendar_no_write_permission, starts "Cleaning calendar:", names the act-as setting', !!e403 && e403.code === 'calendar_no_write_permission' && /^Cleaning calendar: /.test(e403.message) && /STR_CAL_IMPERSONATE/.test(e403.message) && e403.httpStatus === 403, e403 && e403.message);
  t('shared 403: NEVER tells him to share the calendar or to give "Make changes to events"', !/shar/i.test(e403.message) && !/Make changes to events/i.test(e403.message), e403.message);
  t('shared 404: no "share" wording, mentions the act-as setting and the calendar id config', !!e404 && e404.code === 'calendar_not_shared' && !/shar/i.test(e404.message) && /STR_CAL_IMPERSONATE/.test(e404.message) && /STR_GUARD_CLEANING_CAL|calendar id|its id/.test(e404.message), e404 && e404.message);
  t('shared 401: no "share" wording either', !!e401 && e401.code === 'calendar_auth' && !/shar/i.test(e401.message), e401 && e401.message);
  const d403 = await mk(403, 'Forbidden', 'brett@bmoremanagement.com'), d404 = await mk(404, 'Not Found', 'brett@bmoremanagement.com');
  t('acting as 403: names who it is acting as and what to check, no "share"', !!d403 && d403.code === 'calendar_no_write_permission' && /acting as brett@bmoremanagement\.com/.test(d403.message) && /owns the cleaning calendar or can edit it/.test(d403.message) && !/shar/i.test(d403.message), d403 && d403.message);
  t('acting as 404: same, no "share"', !!d404 && /acting as brett@bmoremanagement\.com/.test(d404.message) && !/shar/i.test(d404.message), d404 && d404.message);
  const sc = await mk(403, '{"error":{"code":403,"message":"Request had insufficient authentication scopes.","status":"PERMISSION_DENIED"}}', 'brett@bmoremanagement.com');
  t('403 "insufficient scopes": a loud coded error that says the narrow scope was not enough and must not be widened silently', !!sc && sc.code === 'calendar_scope_too_narrow' && /not enough/.test(sc.message) && /widened/.test(sc.message), sc && sc.message);
  const rl = await mk(403, '{"error":{"errors":[{"reason":"rateLimitExceeded"}],"code":403,"message":"Rate Limit Exceeded"}}');
  t('a 403 rate limit is not mistaken for a permission problem (not fatal, retried next run)', !!rl && rl.code === 'calendar_error' && !E_FATAL(rl.code), rl && rl.code);
  const api = await mk(403, 'Google Calendar API has not been used in project 123 before or it is disabled');
  t('API-not-enabled still falls through to the original explanation', !!api && api.code === 'calendar_api_disabled', api && api.code);
  const w = makeWorld(), e = build(w);
  t('every new access-failure code stops the swap/bulk calendar loop (STR_CAL_FATAL)', ['calendar_delegation_not_authorized', 'calendar_impersonate_bad_user', 'calendar_impersonate_invalid', 'calendar_scope_too_narrow', 'calendar_no_write_permission', 'calendar_not_shared', 'calendar_auth', 'calendar_api_disabled'].every(c => e.STR_CAL_FATAL.includes(c)) && !e.STR_CAL_FATAL.includes('calendar_error'), e.STR_CAL_FATAL);
  const W2 = makeWorld(), E2 = build(W2); W2.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'not an email' }); E2.strSettings(W2.cfg);
  let bad = null; try { await E2.strCalFetch(ENV, CAL, 'GET', '/events'); } catch (er) { bad = er; }
  t('a malformed STR_CAL_IMPERSONATE is a loud coded error BEFORE any Google call (never a silent fallback to the old login)', !!bad && bad.code === 'calendar_impersonate_invalid' && W2.tokenCalls.length === 0 && W2.cal.length === 0, bad && bad.message);
  const long = Object.assign(new Error('x'.repeat(700)), { code: 'calendar_delegation_not_authorized' }), plain = new Error('y'.repeat(700));
  t('calendar-access error text is not cut at 300 characters (the fix steps survive), other errors still are', e.strErrText(long).length === 700 && e.strErrText(plain).length === 300);
}
function E_FATAL(c) { return ['calendar_no_write_permission', 'calendar_not_shared', 'calendar_auth', 'calendar_api_disabled', 'calendar_delegation_not_authorized', 'calendar_impersonate_bad_user', 'calendar_impersonate_invalid', 'calendar_scope_too_narrow'].includes(c); }

// ═══ 4. nothing else changed: the inspection calendar and the inspection guard keep the shared login ═══
{
  const W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com', INSP_CALENDAR_ID: 'brett@bmoremanagement.com' }); E.strSettings(W.cfg);
  await E.strCalFetch(ENV, CAL, 'GET', '/events');
  const r = await E.inspCalFetch(ENV, W.cfg, 'GET', '/events?maxResults=1');
  const last = W.tokenCalls[W.tokenCalls.length - 1];
  t('inspection calendar call with STR_CAL_IMPERSONATE set: still the shared login (no sub, scope calendar)', W.tokenCalls.length === 2 && last.sub === undefined && last.scope === FULL && W.cal[1].auth === 'Bearer tok-own-calendar', { t: W.tokenCalls, a: W.cal.map(c => c.auth) });
  t('the delegated token was used only for the cleaning calendar call', W.cal[0].auth === 'Bearer tok-brett@bmoremanagement.com-calendar.events' && /calendars\/c_a60e/.test(W.cal[0].url) && /calendars\/brett%40bmoremanagement\.com/.test(W.cal[1].url), W.cal.map(c => c.url));
  const fnSrc = n => grab(n, 'async');
  t('source: inspCalFetch and the inspection guard reader call getCalendarAccessToken(env) with NO options', /getCalendarAccessToken\(env\)/.test(fnSrc('inspCalFetch')) && /getCalendarAccessToken\(env\)/.test(fnSrc('inspStrReadGoogle')) && !/STR_CAL_IMPERSONATE|strCalAs|__strCalAs/.test(fnSrc('inspCalFetch') + fnSrc('inspStrReadGoogle') + fnSrc('inspCalListEvents')));
  t('source: the cleaning calendar call passes the act-as sign-in', /getCalendarAccessToken\(env, \{ sub: as\.sub, scope: as\.scope \}\)/.test(grab('strCalFetch', 'async')));
}

// ═══ 5. every cleaning-calendar call only needs the events endpoints (so calendar.events is enough) ═══
{
  const sites = [...src.matchAll(/strCalFetch\(([^;\n]*)/g)].map(m => m[1]).filter(x => !/^env, calId, method, pathAndQuery/.test(x));
  const paths = sites.map(x => { const parts = x.split(/,\s*/); return parts.slice(0, 4).join(',').split(/,\s*/)[3] || ''; });
  t('found the cleaning-calendar call sites', sites.length >= 12, sites.length);
  t('every strCalFetch call targets /events... (list, get, insert, patch, delete) and nothing else (no acl, calendarList, settings or calendar-level calls)', paths.every(p => /^'\/events|^q$/.test(p.trim().replace(/\)+$/, ''))), paths);
  t('the list call that uses q builds an /events? URL', /const q = `\/events\?/.test(src.slice(src.indexOf('async function strReadCleaningCal'), src.indexOf('async function strReadCleaningCal') + 900)));
  t('the check only uses events endpoints too', [...grab('strCalCheck', 'async').matchAll(/strCalFetch\(env, calId, '([A-Z]+)', ('[^']*'|`[^`]*`)/g)].every(m => /^['`]\/events/.test(m[2])));
}

// ═══ 6. "Check calendar access" ═══
{
  // shared mode: reading works (old login) but it does NOT prove writes
  const W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg);
  const r = await E.strCalCheck(ENV, W.cfg, {});
  t('shared + read-only: passes the read, says plainly it is the old login and that reading is not changing', r.passed && r.mode === 'shared' && r.as === '' && !r.wrote && r.steps.some(s => /signs in/.test(s.step) && /own Google login/.test(s.detail) && /cannot change it/.test(s.detail)) && r.steps.some(s => /Read the cleaning calendar/.test(s.step) && s.ok), r);
  t('read-only check wrote nothing to Google (only GET)', W.cal.length === 1 && W.cal[0].method === 'GET' && /\/events\?/.test(W.cal[0].url));
  const rw = await E.strCalCheck(ENV, W.cfg, { write: true });
  t('with write: adds one transparent 1-minute test event then deletes that same event', rw.passed && rw.wrote && W.cal.filter(c => c.method === 'POST').length === 1 && W.cal.filter(c => c.method === 'DELETE').length === 1 && W.cal.find(c => c.method === 'POST').body.transparency === 'transparent' && /ev\d+/.test(W.cal.find(c => c.method === 'DELETE').url), W.cal.map(c => c.method + ' ' + c.url));
}
{
  // acting as: delegation not set up yet -> failed check with the exact steps, logged to telemetry, no Calendar call
  const W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }); W.tokenReply = denied;
  const r = await E.strCalCheck(ENV, W.cfg, { write: true });
  t('acting as + not authorized: failed, summary carries the admin steps', !r.passed && r.mode === 'acting_as' && /admin\.google\.com/.test(r.summary) && r.summary.includes(EVENTS) && /Unique ID/.test(r.summary), r.summary);
  t('it stopped at the sign-in (no calendar call, no write attempted)', W.cal.length === 0 && r.steps.length === 2, r.steps.map(s => s.step));
  t('the failure is in Ops_Telemetry (failure ledger) with Success=FALSE', W.telemetry.some(x => x.Success === 'FALSE' && x.Job_Type === 'str_cleaning' && /calendar_check/.test(x.Skill_Or_Endpoint) && /admin\.google\.com/.test(x.Notes)), W.telemetry);
  W.tokenReply = null; W.cal.length = 0; W.telemetry.length = 0;
  const ok = await E.strCalCheck(ENV, W.cfg, { write: true });
  t('acting as + approved: signs in with sub + calendar.events, reads, writes and deletes', ok.passed && ok.mode === 'acting_as' && W.tokenCalls[W.tokenCalls.length - 1].sub === 'brett@bmoremanagement.com' && W.cal.every(c => c.auth === 'Bearer tok-brett@bmoremanagement.com-calendar.events') && W.cal.length === 3 && !W.telemetry.length, { c: W.cal.map(c => c.method), tel: W.telemetry });
}
{
  const W = makeWorld({ staged: true }), E = build(W); W.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' });
  const r = await E.strCalCheck(ENV, W.cfg, { write: true });
  t('staging: says it was NOT really tested, makes no Google call', r.passed && r.stubbed && /NOT really tested/.test(r.steps[r.steps.length - 1].detail) && W.cal.length === 0 && W.tokenCalls.length === 0, r);
  const W2 = makeWorld(), E2 = build(W2); W2.cfg = {};
  const r2 = await E2.strCalCheck(ENV, W2.cfg, {});
  t('no cleaning calendar id set: fails with where to set it', !r2.passed && /No cleaning calendar id/.test(r2.summary) && /Inspection Scheduler/.test(r2.summary) && W2.cal.length === 0, r2.summary);
  const W3 = makeWorld(), E3 = build(W3); W3.cfg = Object.assign({}, REAL.cfg); W3.calReply = rec => rec.method === 'POST' ? { status: 403, body: 'Forbidden' } : null;
  const r3 = await E3.strCalCheck(ENV, W3.cfg, { write: true });
  t('read works but writing is refused (the real shared-mode situation): FAILED, explains the act-as setting, no "share"', !r3.passed && /Cleaning calendar: Google will not let the Hub change/.test(r3.summary) && /STR_CAL_IMPERSONATE/.test(r3.summary) && !/shar/i.test(r3.summary) && r3.steps.some(s => /Read/.test(s.step) && s.ok), r3.summary);
  const W4 = makeWorld(), E4 = build(W4); W4.cfg = Object.assign({}, REAL.cfg); W4.calReply = rec => rec.method === 'DELETE' ? { status: 500, body: 'boom' } : null;
  const r4 = await E4.strCalCheck(ENV, W4.cfg, { write: true });
  t('test event added but could not be removed: says so with the event id so he can delete it by hand', !r4.passed && /test event may still be on the calendar \(id ev\d+\)/.test(r4.summary), r4.summary);
}
{
  // the HTTP handler: shape, banner clearing on a passing write
  const W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' });
  const hdrs = ['ID', 'Alert_Key', 'Kind', 'Severity', 'Task_Key', 'Message', 'Sms_Text', 'Send_Count', 'Last_Sent_At', 'Next_Send_At', 'Resolved_At', 'Acked_At', 'Created_At'];
  W.tabs.set('STR_Alerts', [hdrs, ['1', 'cal|access', 'calendar', 'high', '', 'old', 'old', '1', '', '', '', '', '2026-10-20T00:00:00Z']]);
  const j = await J(E.strAdminCalendarCheck(ENV, { write: false }));
  t('read-only pass leaves the board banner alone (reading does not prove writing)', j.ok === true && j.passed === true && j.wrote === false && !rowsOf(W, 'STR_Alerts')[0].Resolved_At, j);
  const j2 = await J(E.strAdminCalendarCheck(ENV, { write: true }));
  t('a passing write test clears the calendar warning banner', j2.ok === true && j2.passed === true && j2.wrote === true && !!rowsOf(W, 'STR_Alerts')[0].Resolved_At, j2);
  const W3 = makeWorld(), E3 = build(W3); W3.cfg = Object.assign({}, REAL.cfg, { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }); W3.tokenReply = denied; const j3 = await J(E3.strAdminCalendarCheck(ENV, { write: true }));
  t('a failing check is still an answer the board can show (ok:true, passed:false, plain summary, steps)', j3.ok === true && j3.passed === false && /admin\.google\.com/.test(j3.summary) && Array.isArray(j3.steps), j3);
}

// ═══ 7. saving the setting: validated, and proven with Google BEFORE it is saved ═══
{
  const save = async (W, E, v) => { const r = await E.strAdminConfig(ENV, { values: { STR_CAL_IMPERSONATE: v } }); return { status: r.status, j: await r.json() }; };
  let W = makeWorld(), E = build(W); W.cfg = Object.assign({}, REAL.cfg);
  let r = await save(W, E, 'not-an-email');
  t('a value that is not an email is refused (400) and nothing is saved', r.status === 400 && r.j.error === 'bad_value' && W.cfg.STR_CAL_IMPERSONATE === undefined && W.tokenCalls.length === 0, r);
  W = makeWorld(); E = build(W); W.cfg = Object.assign({}, REAL.cfg); W.tokenReply = denied;
  r = await save(W, E, 'brett@bmoremanagement.com');
  t('Google not authorized yet: NOT saved (409) with the exact admin steps, so the tick can never be broken by flipping it early', r.status === 409 && r.j.ok === false && /^NOT saved\./.test(r.j.message) && /admin\.google\.com/.test(r.j.message) && r.j.message.includes(EVENTS) && W.cfg.STR_CAL_IMPERSONATE === undefined, r);
  t('the refused save is in the failure ledger', W.telemetry.some(x => x.Success === 'FALSE' && /calendar_check_save/.test(x.Skill_Or_Endpoint)), W.telemetry);
  W = makeWorld(); E = build(W); W.cfg = Object.assign({}, REAL.cfg);
  r = await save(W, E, ' brett@bmoremanagement.com ');
  t('Google approves: saved (trimmed), read back, board settings show acting as', r.status === 200 && r.j.ok && W.cfg.STR_CAL_IMPERSONATE === 'brett@bmoremanagement.com' && r.j.settings.cal_as === 'brett@bmoremanagement.com' && r.j.settings.cal_mode === 'acting_as' && W.tokenCalls[0].sub === 'brett@bmoremanagement.com' && W.tokenCalls[0].scope === EVENTS, r);
  const n = W.tokenCalls.length; r = await save(W, E, '');
  t('blank saves without asking Google and goes back to the old login', r.status === 200 && r.j.settings.cal_as === '' && r.j.settings.cal_mode === 'shared' && W.tokenCalls.length === n, r);
  W = makeWorld({ staged: true }); E = build(W); W.cfg = Object.assign({}, REAL.cfg);
  r = await save(W, E, 'brett@bmoremanagement.com');
  t('staging: saves without a Google call (calendar is stubbed there)', r.status === 200 && W.tokenCalls.length === 0 && r.j.settings.cal_as === 'brett@bmoremanagement.com', r);
  const R = await E.strAdminConfig(ENV, { values: { STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com', STR_NOT_A_KEY: 'x' } });
  t('the allow-list still refuses other keys', R.status === 400 && (await R.json()).error === 'not_allowed');
}

// ═══ 8. the scheduler tick: access problems stay on the board and are never silent ═══
const STAYS = [{ summary: 'Guest A', start: { date: '2026-10-10' }, end: { date: '2026-10-24' } }, { summary: 'Guest B', start: { date: '2026-10-26' }, end: { date: '2026-10-30' } }];
function tickWorld(over) {
  const W = makeWorld(); W.stays = STAYS;
  W.cfg = Object.assign({ admin_phone: '+15555550100', STR_ENGINE_ENABLED: 'TRUE', STR_SMS_ENABLED: 'FALSE', STR_CAL_WRITE_ENABLED: 'TRUE', STR_GUARD_CLEANING_CAL: CAL, STR_GUARD_BOOKING_SOURCES: 'https://feed.test/x.ics', STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com', TWILIO_ENABLED: 'TRUE' }, over || {});
  W.tabs.set('Vendors', [['ID', 'Name', 'Phone', 'Email', 'Trade', 'Active', 'Service_Area', 'Language', 'SMS_Enabled', 'SMS_OptOut'], ['101', 'Regina Seville', '+15403364284', 'gina@x.test', 'Short-Term Rental Cleaner', 'TRUE', 'Milam Ridge', 'en', '', '']]);
  W.tabs.set('STR_Cleaners', [['ID', 'Vendor_ID', 'Name', 'Nickname', 'Language', 'Link_Token', 'Active', 'Digest', 'Created_Date'], ['1', '101', 'Regina Seville', 'Gina', 'en', 'TOKGINA' + 'a'.repeat(30), 'TRUE', 'TRUE', '']]);
  W.tabs.set('STR_Cleaner_Pool', [['ID', 'Property_Key', 'Cleaner_ID', 'Priority', 'Active'], ['1', 'milam-ridge', '1', '1', 'TRUE']]);
  return W;
}
{
  const W = tickWorld(), E = build(W); clock = E.inspEtWallToMs('2026-10-21', '10:00');
  W.calReply = rec => (rec.method === 'POST' || rec.method === 'PATCH' || rec.method === 'DELETE') ? { status: 403, body: 'Forbidden' } : null; // reads work, writes refused
  const r = await E.strTick(ENV, {});
  t('writes refused: the tick is not ok and says why (calendar step errors)', !r.ok && r.errors.some(e => /^calendar_/.test(e.step)), r.errors);
  const al = W.tabs.has('STR_Alerts') ? rowsOf(W, 'STR_Alerts').filter(a => a.Alert_Key === 'cal|access') : [];
  t('a persistent STR_Alerts row (cal|access, kind calendar) is on the board, unresolved', al.length === 1 && al[0].Kind === 'calendar' && !al[0].Resolved_At && /The cleaning calendar cannot be changed/.test(al[0].Message), al);
  t('the alert text names the act-as fix when acting as Brett it names who, and never says share', /acting as brett@bmoremanagement\.com/.test(al[0].Message) && !/shar/i.test(al[0].Message), al[0] && al[0].Message);
  t('it was already told by the usual alert (telemetry row + SMS + email), and the new row is created as already-told so he is not texted twice', W.telemetry.some(x => x.Success === 'FALSE' && /calendar_write/.test(x.Skill_Or_Endpoint)) && W.brett.filter(b => /Cleaning scheduler problem \(calendar_write\)/.test(b.text)).length === 1 && !W.brett.some(b => /Cleaning calendar blocked/.test(b.text)) && al[0].Send_Count === '1', { tel: W.telemetry.map(x => x.Skill_Or_Endpoint), b: W.brett.length, sc: al[0] && al[0].Send_Count });
  clock += 15 * 60000; await E.strTick(ENV, {});
  t('a second failing tick does not stack duplicate banners', rowsOf(W, 'STR_Alerts').filter(a => a.Alert_Key === 'cal|access').length === 1);
  W.calReply = null; clock += 15 * 60000; const ok = await E.strTick(ENV, {});
  const al2 = rowsOf(W, 'STR_Alerts').filter(a => a.Alert_Key === 'cal|access');
  t('once a real calendar write works again the banner clears itself', ok.ok && al2.length === 1 && !!al2[0].Resolved_At, { ok: ok.ok, err: ok.errors, al2 });
  const board = E.strSettingsOut(W.cfg);
  t('board settings carry the mode', board.cal_mode === 'acting_as' && board.cal_as === 'brett@bmoremanagement.com');
}
{
  // delegation not approved yet while the setting is on (e.g. edited straight in the sheet): the feed read fails loudly with the full steps
  const W = tickWorld(), E = build(W); clock = E.inspEtWallToMs('2026-10-21', '10:00'); W.tokenReply = denied;
  const r = await E.strTick(ENV, {});
  const fe = r.errors.find(e => e.step === 'feed');
  t('feed read cannot sign in: reported as the feed error, with the complete fix steps (not cut short)', !r.ok && !!fe && /admin\.google\.com/.test(fe.error) && fe.error.includes(EVENTS) && /Unique ID/.test(fe.error), r.errors);
  t('and Brett is told (telemetry row Success=FALSE + SMS/email), not just a log line', W.telemetry.some(x => x.Success === 'FALSE' && /str\//.test(x.Skill_Or_Endpoint) && /admin\.google\.com/.test(x.Notes)) && (W.brett.length > 0 || W.emails.length > 0), { tel: W.telemetry.map(x => x.Skill_Or_Endpoint), b: W.brett.length, e: W.emails.length });
}

// ═══ 9. the existing "Google sign-in" diagnostic reports the mode ═══
{
  const url = new URL('https://x.test/insp/calendar-test');
  const run = async (cfg, tokenReply, staged) => { const W = makeWorld({ staged: !!staged }); W.cfg = Object.assign({ admin_phone: '+1555' }, cfg); W.tokenReply = tokenReply || null; const E = build(W); E.strSettings(W.cfg); const r = await E.inspCalendarTest(ENV, url); return { W, j: await r.json() }; };
  let { W, j } = await run({});
  const modeStep = j.steps.find(s => /Cleaning calendar: who the Hub acts as/.test(s.step));
  t('diagnostic, blank: reports the shared (own login) mode for the cleaning calendar', !!modeStep && /own login/.test(modeStep.detail) && /STR_CAL_IMPERSONATE is blank/.test(modeStep.detail), modeStep);
  t('diagnostic, blank: the inspection sign-in step is unchanged (shared token, no sub)', j.steps.some(s => s.step === 'Google sign-in (service account)' && s.ok) && W.tokenCalls.length === 1 && W.tokenCalls[0].sub === undefined && W.tokenCalls[0].scope === FULL, W.tokenCalls);
  ({ W, j } = await run({ STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }));
  t('diagnostic, set: reports acting as Brett and proves the delegated sign-in', j.steps.some(s => /Cleaning calendar: who the Hub acts as/.test(s.step) && /Acting as brett@bmoremanagement\.com/.test(s.detail)) && j.steps.some(s => /acting as brett@bmoremanagement\.com/.test(s.step) && s.ok) && W.tokenCalls.some(c => c.sub === 'brett@bmoremanagement.com' && c.scope === EVENTS) && W.tokenCalls.some(c => c.sub === undefined && c.scope === FULL), { steps: j.steps.map(s => s.step), tc: W.tokenCalls });
  ({ W, j } = await run({ STR_CAL_IMPERSONATE: 'brett@bmoremanagement.com' }, c => c.sub ? denied() : null));
  const bad = j.steps.find(s => /acting as brett@bmoremanagement\.com/.test(s.step));
  t('diagnostic, set but not approved: that step FAILS with the admin steps, and the inspection steps still pass', j.ok === false && !!bad && !bad.ok && /admin\.google\.com/.test(bad.detail) && j.steps.some(s => s.step === 'Google sign-in (service account)' && s.ok), j.steps);
}

// ═══ 10. the board page and the routes ═══
{
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let syntax = ''; try { new vm.Script(scripts.join('\n')); } catch (e) { syntax = e.message; }
  t('str-cleaning.html: inline script still parses', scripts.length >= 1 && !syntax, syntax);
  t('board: "Check calendar access" and "Check and test a write" buttons wired to /str/admin/calendar-check', /data-act="cal-check"/.test(html) && /data-act="cal-check-write"/.test(html) && /\/str\/admin\/calendar-check/.test(html) && /Check calendar access/.test(html) && /a === 'cal-check'/.test(html));
  t('board: the Switches section shows the mode and has the act-as control', /Cleaning calendar sign-in/.test(html) && /ACTING AS /.test(html) && /data-act="cal-as"/.test(html) && /STR_CAL_IMPERSONATE/.test(html) && /s\.cal_as/.test(html));
  t('board: nothing on the page tells him to share the calendar or to give "Make changes to events"', !/Make changes to events/.test(html) && !/share the (cleaning )?calendar/i.test(html));
  t('board: pass/fail renderer says Passed / Failed in plain words', /Passed: the Hub can read and change the cleaning calendar/.test(html) && /'Failed: '/.test(html));
  t('route: POST /str/admin/calendar-check is wired and allowed for the staging test token', /path === '\/str\/admin\/calendar-check'\)\s+return await strAdminCalendarCheck\(env, body\)/.test(src) && /path === '\/str\/admin\/calendar-check' \|\| path === '\/str\/admin\/offer-now'/.test(src));
  t('the swap preview note no longer tells him to give the service account "Make changes to events"', !/needs "Make changes to events"/.test(src));
  t('build version bumped', /const BUILD_VERSION = '2026-10-2[34]\.\d+-[a-z-]+';/.test(src));
  t('no cron added', !/crons\s*=\s*\[\s*"/.test(fs.readFileSync(root + 'wrangler.toml', 'utf8')));
}

Date.now = realNow;
console.log(`str-cal-impersonate: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
