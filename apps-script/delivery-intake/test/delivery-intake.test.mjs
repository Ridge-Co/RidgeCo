// Offline harness for DeliveryIntake.gs - pure helpers plus the main loop against minimal fakes of
// GmailApp / UrlFetchApp / PropertiesService / LockService / ScriptApp (incl. getIdentityToken) / MailApp / Session.
// There is deliberately NO CalendarApp in the fake: v1.2.0 never touches Google Calendar (the Hub writes it), so any use would throw.
// Run: node apps-script/delivery-intake/test/delivery-intake.test.mjs
// (Apps Script itself cannot run here; this proves the logic, not Google's permission screens or what getIdentityToken returns inside a trigger.)
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'DeliveryIntake.gs'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(here, '..', 'appsscript.json'), 'utf8'));
let pass = 0, fail = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { fail++; console.log('  FAIL:', msg, extra === undefined ? '' : JSON.stringify(extra)); } };
const J = (x) => JSON.parse(JSON.stringify(x));

const TOKEN = 'tok_abcdef0123456789abcdef0123456789SECRET';   // the OPTIONAL legacy INTAKE_TOKEN, only ever set by a test
const SIG = 'SIGNATURE_SECRET_PART_0123456789abcdef';          // the signature segment of the fake Google identity token
const MIN = 60000, HOUR = 3600 * 1000;

// A fake Google OpenID identity token (header.payload.signature, base64url). The script only decodes the payload; the Hub verifies the signature.
const b64u = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (email, exp, extra) => b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })) + '.' +
  b64u(JSON.stringify(Object.assign({ iss: 'https://accounts.google.com', aud: '1234.apps.googleusercontent.com', sub: '987654321', email, email_verified: true, iat: exp - 3600, exp }, extra || {}))) + '.' + b64u(SIG);

function world(opts) {
  opts = opts || {};
  const w = {
    clock: Date.parse('2026-10-23T15:00:00Z'), props: {}, logs: [], mails: [], fetches: [], triggers: [], newTriggerCalls: [],
    labels: {}, threads: [], hub: null, lockBusy: false, mailFails: false,
    searches: [], activeEmail: opts.email === undefined ? 'info@bmoremanagement.com' : opts.email,
    idMode: 'ok', idCalls: 0, idEmail: undefined, idExpSec: 3600, idRaw: undefined, idExtra: undefined, lastToken: null, tokensIssued: [],
  };
  const labelObj = (n) => ({ n });
  const threadObj = (t) => ({
    _t: t,
    getMessages: () => t.messages.map(msgObj),
    addLabel: (l) => { t.labels.add(l.n); },
    removeLabel: (l) => { t.labels.delete(l.n); },
  });
  const msgObj = (m) => ({
    getId: () => m.id, getFrom: () => m.from, getSubject: () => m.subject, getDate: () => m.date,
    getPlainBody: () => m.text || '', getBody: () => m.html || '',
    getHeader: (h) => { if (m.headerThrows) throw new Error('no header'); return h === 'Message-ID' ? (m.rfc || '') : ''; },
    getRawContent: () => { if (m.rawThrows) throw new Error('no raw'); return m.raw || ''; },
  });
  w.addThread = (msgs) => { const t = { id: 't' + (w.threads.length + 1), messages: msgs, labels: new Set() }; w.threads.push(t); return t; };
  const ctx = {
    console, JSON, Math, String, Number, Array, Object, Date, RegExp, parseInt, isNaN, Error, decodeURIComponent,
    Logger: { log: (m) => w.logs.push(String(m)) },
    Utilities: { sleep: () => {} },
    Session: { getActiveUser: () => ({ getEmail: () => w.activeEmail }), getEffectiveUser: () => ({ getEmail: () => w.activeEmail }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in w.props ? w.props[k] : null), setProperty: (k, v) => { if (Buffer.byteLength(String(v), 'utf8') > 9216) throw new Error('Argument too large: value (Script Properties allow 9 KB per value)'); w.props[k] = String(v); w.propSets = (w.propSets || 0) + 1; }, deleteProperty: (k) => { delete w.props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !w.lockBusy, releaseLock: () => { w.lockReleased = (w.lockReleased || 0) + 1; } }) },
    MailApp: { sendEmail: (to, subj, body) => { if (w.mailFails) throw new Error('Mail quota'); w.mails.push({ to, subj, body }); } },
    ScriptApp: {
      getProjectTriggers: () => w.triggers.slice(),
      deleteTrigger: (t) => { const i = w.triggers.indexOf(t); if (i >= 0) w.triggers.splice(i, 1); },
      newTrigger: (fn) => { const t = { fn, getHandlerFunction() { return fn; } }; const b = { timeBased: () => { b.tb = true; return b; }, everyMinutes: (n) => { b.mins = n; return b; }, create: () => { w.newTriggerCalls.push({ fn, tb: b.tb, mins: b.mins }); w.triggers.push(t); return t; } }; return b; },
      getIdentityToken: () => {
        w.idCalls++;
        if (w.idMode === 'throw') throw new Error('Authorization is required to perform that action.');
        if (w.idMode === 'null') return null;
        const t = w.idRaw !== undefined ? w.idRaw : jwt(w.idEmail !== undefined ? w.idEmail : w.activeEmail, Math.floor(w.clock / 1000) + w.idExpSec, w.idExtra);
        w.lastToken = t; w.tokensIssued.push(t);
        return t;
      },
    },
    GmailApp: {
      getUserLabelByName: (n) => (w.labels[n] ? labelObj(n) : null),
      createLabel: (n) => { w.labels[n] = true; return labelObj(n); },
      search: (q) => {
        w.searches.push(q);
        const after = Number((/after:(\d+)/.exec(q) || [])[1] || 0) * 1000;
        const excludesPromo = /-category:promotions/.test(q), rescue = /(^|\s)category:promotions/.test(q);
        return w.threads.filter(t => t.messages.some(m => m.date.getTime() >= after && (excludesPromo ? !m.promo : rescue ? m.promo : true))).map(threadObj);
      },
    },
    UrlFetchApp: {
      fetch: (url, o) => {
        w.fetches.push({ url, o, body: JSON.parse(o.payload) });
        if (!w.hub) throw new Error('no hub scripted');
        const r = w.hub(JSON.parse(o.payload), o);   // may throw (network) or return {code, body}
        return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      },
    },
  };
  ctx.module = { exports: {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  w.ctx = ctx; w.X = ctx.module.exports;
  w.run = (fn) => vm.runInContext(fn + '()', ctx);
  w.tick = (ms) => { w.clock += ms; };
  w.everything = () => { const p = Object.assign({}, w.props); delete p.INTAKE_TOKEN; return JSON.stringify({ logs: w.logs, mails: w.mails, props: p }); };   // every place a secret could leak to (fetch headers excepted: that is where the token belongs)
  return w;
}
// Fake clock: install a Date in the vm whose now() reads world.clock.
function withClock(w) {
  w.ctx.__clock = () => w.clock;
  vm.runInContext(`(function(){ var R = Date; function D(a,b,c,d,e,f,g){ if (!(this instanceof D)) return new R(__clock()).toString(); var n = arguments.length; if (n===0) return new R(__clock()); if (n===1) return new R(a); return new R(a,b,c||1,d||0,e||0,f||0,g||0); } D.prototype = R.prototype; D.now = function(){ return __clock(); }; D.parse = R.parse; D.UTC = R.UTC; Date = D; })()`, w.ctx);
  return w;
}
const D = (s) => new Date(s);
const hdMsg = (id, date, subject, extra) => Object.assign({ id, from: 'The Home Depot <HomeDepot@order.homedepot.com>', subject, date: D(date), text: 'Order H1234-567890 refrigerator', html: '<p>hi</p>', rfc: '<rfc-' + id + '@homedepot.com>' }, extra || {});
// What the Hub answers (v1.2: no `calendar` instruction any more, only `calendar_status`: the Hub writes the calendar itself).
const hubOk = (over) => Object.assign({ success: true, kind: 'order_confirmation', delivery_id: 'DL-1', created: true, updated: false, duplicate: false, parked: false, order_number: 'H1234-567890', item_type: 'refrigerator', make_model: 'Whirlpool WRF535', expected_date: '2026-10-28', expected_window: '9a-1p', delivery_address: '1109 Battery Ave', property_matched: true, wo_id: 'WO-1300', wo_created: true, brett_sms_sent: true, sms_status: 'sent', tenant_sms: 'off', telemetry_ok: true, calendar_status: 'created' }, over || {});
function ready(w) {   // what setup() leaves behind: cutoff + clock. No token, no calendar: zero secrets. ALERT_EMAIL is optional; tests that need it set it.
  withClock(w);
  w.props.ALERT_EMAIL = 'brett@bmoremanagement.com';
  w.props.CUTOFF_MS = String(Date.parse('2026-10-23T14:00:00Z'));
  return w;
}

// ── 1. senderOk_ / eligible_ ────────────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X;
  ok(X.senderOk_('The Home Depot <HomeDepot@order.homedepot.com>'), 'order.homedepot.com passes');
  ok(X.senderOk_('x@mg.homedepot.com') && X.senderOk_('x@homedepot.com') && X.senderOk_('Lowes <do-not-reply@notifications.lowes.com>'), 'homedepot/mg/lowes pass');
  ok(X.senderOk_('A <a@acehardware.com>') && X.senderOk_('w@walmart.com'), 'ace and walmart pass');
  ok(!X.senderOk_('"Home Depot orders@homedepot.com" <x@evil.io>'), 'display name containing homedepot.com fails');
  ok(!X.senderOk_('"orders@homedepot.com" <x@evil.io>'), 'quoted address as display name fails');
  ok(!X.senderOk_('x@homedepot.com.evil.io') && !X.senderOk_('x@nothomedepot.com') && !X.senderOk_('x@evil.io'), 'look-alike domains fail');
  ok(!X.senderOk_('') && !X.senderOk_(null) && !X.senderOk_(undefined), 'empty fails');
  ok(!X.senderOk_('Name homedepot.com'), 'no address at all fails');
  ok(!X.senderOk_('Brett <brett@bmoremanagement.com>'), 'own mailbox is not a store');
  ok(X.senderOk_('x@shop.example.com', ['example.com']) && !X.senderOk_('x@homedepot.com', ['example.com']), 'custom domain list replaces the default');
  ok(!X.senderOk_('x@homedepot.com', ['not a domain', '']), 'invalid-only custom list fails closed (invalid entries skipped)');
  const m = (from, d) => ({ getFrom: () => from, getDate: () => D(d) });
  const cutoff = Date.parse('2026-10-23T14:00:00Z');
  ok(X.eligible_(m('x@homedepot.com', '2026-10-23T14:00:01Z'), cutoff), 'eligible: store + after cutoff');
  ok(!X.eligible_(m('x@homedepot.com', '2026-10-23T13:59:59Z'), cutoff), 'cutoff blocks older mail (no backfill)');
  ok(!X.eligible_(m('x@evil.io', '2026-10-24T00:00:00Z'), cutoff), 'non-store sender not eligible');
}

// ── 2. buildPayload_ ────────────────────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X;
  const mk = (o) => ({ getId: () => 'gid1', getFrom: () => 'a <a@homedepot.com>', getSubject: () => 'S', getDate: () => D('2026-10-23T15:00:00Z'), getPlainBody: () => 'plain', getBody: () => o.html, getHeader: () => o.rfc });
  let p = J(X.buildPayload_(mk({ html: '<b>x</b>', rfc: ' <abc@mail.homedepot.com> ' }), 'info@bmoremanagement.com', false));
  ok(p.message_id === '<abc@mail.homedepot.com>' && p.rfc_message_id === '<abc@mail.homedepot.com>' && p.gmail_id === 'gid1', 'RFC Message-ID preferred (trimmed); rfc_message_id and gmail_id sent separately', p);
  ok(p.mailbox === 'info@bmoremanagement.com' && p.dry_run === false && p.subject === 'S' && p.body === 'plain' && p.from === 'a <a@homedepot.com>' && p.received_at === '2026-10-23T15:00:00.000Z' && p.html === '<b>x</b>', 'contract fields present', p);
  p = J(X.buildPayload_(mk({ html: '', rfc: '' }), 'info@x', false));
  ok(p.message_id === 'gid1' && p.gmail_id === 'gid1' && !('rfc_message_id' in p) && !('html' in p), 'falls back to Gmail id; no rfc_message_id; empty html omitted', p);
  p = J(X.buildPayload_(mk({ html: 'x'.repeat(300000), rfc: '<a>' }), 'm', true));
  ok(p.html.length === 200000, 'html trimmed to 200KB', p.html.length);
  ok(p.message_id === 'DRYRUN-<a>' && p.rfc_message_id === 'DRYRUN-<a>' && p.dry_run === true, 'dry run ids prefixed so they can never poison real dedupe', p);
  const throwing = { getId: () => 'g2', getFrom: () => 'f', getSubject: () => 's', getDate: () => D('2026-10-23T15:00:00Z'), getPlainBody: () => 'b', getBody: () => '', getHeader: () => { throw new Error('x'); } };
  ok(J(X.buildPayload_(throwing, 'm', false)).message_id === 'g2', 'getHeader throwing falls back to Gmail id');
}

// ── 3. handleResponse_ ──────────────────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X; const H = (code, body) => J(X.handleResponse_(code, typeof body === 'string' ? body : JSON.stringify(body), TOKEN));
  let r = H(200, hubOk());
  ok(r.ok && !r.attention && !r.ignored && !r.duplicate && !('calendar' in r), 'normal success: no attention; nothing about the calendar is passed on (the Hub writes it)');
  ok(/Order H1234-567890/.test(r.summary) && /WO-1300/.test(r.summary), 'summary mentions order and WO', r.summary);
  r = H(200, hubOk({ parked: true, kind: 'unknown', reason: 'unreadable', detail: 'no order #' }));
  ok(r.ok && r.attention && /Needs Review/.test(r.attentionText) && /unreadable/.test(r.attentionText), 'parked => attention');
  r = H(200, hubOk({ brett_sms_sent: false, sms_status: 'twilio_off' }));
  ok(r.attention && /did NOT go out/.test(r.attentionText) && /twilio_off/.test(r.attentionText), 'sms false => attention');
  r = H(200, hubOk({ brett_sms_sent: null }));
  ok(!r.attention, 'sms null (none intended) is not attention');
  r = H(200, hubOk({ property_matched: false }));
  ok(r.attention && /match the delivery address/.test(r.attentionText), 'property unmatched => attention');
  r = H(200, hubOk({ telemetry_ok: false }));
  ok(r.attention && /log row/.test(r.attentionText), 'telemetry false => attention');
  r = H(200, hubOk({ parked: true, brett_sms_sent: false, property_matched: false }));
  ok((r.attentionText.match(/\n\n/g) || []).length === 2, 'several problems are all listed');
  r = H(200, hubOk({ kind: 'not_delivery', created: false, parked: false }));
  ok(r.ok && r.ignored && !r.attention, 'not_delivery => ignored, no alert');
  r = H(200, hubOk({ kind: 'not_delivery', brett_sms_sent: false, property_matched: false }));
  ok(r.ignored && !r.attention, 'not_delivery never alerts even with odd flags');
  r = H(200, hubOk({ duplicate: true, created: false, brett_sms_sent: null }));
  ok(r.ok && r.duplicate && !r.attention, 'duplicate => quiet, no attention');
  r = H(500, 'boom'); ok(!r.ok && r.transient && !r.authProblem, '500 is transient');
  r = H(401, '{"error":"unauthorized"}'); ok(!r.ok && r.transient && r.authProblem && /Delivery_Mailboxes/.test(r.raw) && !/token is wrong/.test(r.raw), '401 => auth problem pointing at Delivery_Mailboxes');
  r = H(403, 'no'); ok(!r.ok && r.authProblem && /Delivery_Mailboxes/.test(r.raw), '403 => auth problem pointing at Delivery_Mailboxes');
  r = H(400, '{"error":"sender_not_allowed"}'); ok(!r.ok && !r.transient, '400 is a per-email failure');
  r = H(200, '<html>gateway</html>'); ok(!r.ok && !r.transient, '200 non-JSON is a failure');
  r = H(200, { success: false, error: 'x' }); ok(!r.ok, 'success:false is a failure');
  r = H(429, 'slow down'); ok(!r.ok && r.transient, '429 transient');
  r = J(X.handleResponse_(500, 'echo ' + TOKEN + ' echo', TOKEN)); ok(!/SECRET/.test(r.raw) && /\[token\]/.test(r.raw), 'legacy token redacted from failure text', r.raw);
  const idt = jwt('a@b.co', 1893456000); r = J(X.handleResponse_(401, 'seen ' + idt, [idt, TOKEN])); ok(!r.raw.includes('eyJ') && !r.raw.includes(SIG), 'identity token redacted from failure text (list of secrets)', r.raw);
  r = J(X.handleResponse_(401, 'seen ' + idt, [])); ok(!r.raw.includes(SIG), 'identity token redacted even when not passed in (JWT-shaped text)', r.raw);
  r = H(200, hubOk({ calendar_status: 'failed', calendar_error: 'no delegation' }));
  ok(r.ok && r.attention && /Google Calendar/.test(r.attentionText) && /no delegation/.test(r.attentionText), 'calendar_status failed => attention with the reason');
  r = H(200, hubOk({ calendar_status: 'failed', duplicate: true })); ok(r.duplicate && !r.attention, 'duplicate stays quiet even if calendar_status failed');
  r = H(200, hubOk({ calendar_status: 'failed', kind: 'not_delivery' })); ok(r.ignored && !r.attention, 'not_delivery stays quiet even if calendar_status failed');
  r = H(200, hubOk({ calendar_status: 'updated' })); ok(!r.attention, 'calendar_status updated => quiet');
  r = H(200, hubOk({ calendar: { action: 'create', key: 'x' } })); ok(r.ok && !r.attention && !('calendar' in r), 'an old-style calendar object from the Hub is ignored');
}

// ── 4. calendarFailure_ (the Hub writes the calendar; we only report when it says it failed) / decodeJwtPayload_ ───────────
{
  const w = world(); const X = w.X; const F = (j) => X.calendarFailure_(j);
  ok(F({ calendar_status: 'failed' }) === 'no reason given', 'plain "failed" => failure, no reason given', F({ calendar_status: 'failed' }));
  ok(F({ calendar_status: 'failed', calendar_error: 'delegation not authorised' }) === 'delegation not authorised', 'reason from calendar_error');
  ok(F({ calendar_status: 'failed: no permission on shared calendar' }) === 'no permission on shared calendar', '"failed: reason" => reason');
  ok(F({ calendar_status: 'FAILED', calendar_reason: 'quota' }) === 'quota', 'case-insensitive, calendar_reason');
  ok(F({ calendar_status: { status: 'failed', reason: 'bad key' } }) === 'bad key', 'object form with reason');
  ok(F({ calendar_status: { ok: false, error: 'Google 403' } }) === 'Google 403', 'object form ok:false');
  ok(F({ calendar_status: { success: false } }) === 'no reason given', 'object form success:false');
  ok(F({ calendar_status: 'error: boom' }) === 'boom', '"error" counts as failed');
  for (const good of ['created', 'updated', 'deleted', 'ok', 'skipped', 'none', 'not_configured', '', null, undefined, { status: 'ok' }, { ok: true }, {}, 0]) ok(F({ calendar_status: good }) === '', 'not a failure: ' + JSON.stringify(good));
  ok(F({}) === '' && F(null) === '' && F(undefined) === '', 'no calendar_status at all => nothing to report');
  ok(F({ calendar_status: 'failed', calendar_error: 'x'.repeat(1000) }).length === 300, 'reason is shortened');
  // JWT payload decoding (local, unverified: the Hub verifies the signature)
  const exp = 1893456000;
  const t = jwt('Info@Example.org', exp, { name: 'José Ñandú ✓' });
  const p = X.decodeJwtPayload_(t);
  ok(p && p.email === 'Info@Example.org' && p.exp === exp && p.name === 'José Ñandú ✓', 'decodes the payload, UTF-8 safe', p);
  ok(X.decodeJwtPayload_('a.b') === null && X.decodeJwtPayload_('') === null && X.decodeJwtPayload_(null) === null && X.decodeJwtPayload_(undefined) === null, 'not a 3-part token => null');
  ok(X.decodeJwtPayload_('a.!!!.c') === null && X.decodeJwtPayload_('a.' + b64u('not json') + '.c') === null && X.decodeJwtPayload_('a.' + b64u('"str"') + '.c') === null, 'garbage payload => null, never throws');
  ok(X.decodeJwtPayload_('a.' + b64u('{"email":"x@y.zz"}').replace(/=+$/, '') + '.c').email === 'x@y.zz', 'missing base64 padding is fine');
  ok(X.decodeJwtPayload_('a.' + Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url') + '.c') === null, 'invalid UTF-8 => null');
}

// ── 5. trimIds_ / trimMap_ / searchQueries_ ─────────────────────────────────────────────────
{
  const w = world(); const X = w.X;
  const ids = Array.from({ length: 450 }, (_, i) => 'id' + i);
  const t = X.trimIds_(ids, 400);
  ok(t.length === 400 && t[0] === 'id50' && t[399] === 'id449', 'trimIds_ keeps the newest 400');
  ok(X.trimIds_(['a'], 400).length === 1 && X.trimIds_(null, 5).length === 0, 'trimIds_ small/null');
  const map = {}; for (let i = 0; i < 250; i++) map['k' + i] = { id: 'e' + i, t: i };
  const tm = J(X.trimMap_(map, 200, 't'));
  ok(Object.keys(tm).length === 200 && tm.k249 && !tm.k0 && tm.k50, 'trimMap_ keeps the 200 newest', Object.keys(tm).length);
  const qs = X.searchQueries_(['homedepot.com', 'lowes.com'], 1700000000);
  ok(qs.length === 2, 'two searches');
  ok(/from:\(homedepot\.com OR lowes\.com\)/.test(qs[0]) && /-category:promotions/.test(qs[0]) && /after:1700000000/.test(qs[0]), 'main query: domains, excludes promotions, after', qs[0]);
  for (const k of ['order', 'delivery', 'schedule', 'arrive', 'reschedule', 'cancel', 'tracking', '"stops away"']) ok(qs[0].includes(k), 'main query has keyword ' + k);
  ok(/(^|\s)category:promotions/.test(qs[1]) && !/-category:promotions/.test(qs[1]) && /after:1700000000/.test(qs[1]), 'rescue query only for unmistakable promos-tab order mail');
  ok(J(X.domains_()).join() === 'homedepot.com,lowes.com,acehardware.com,walmart.com', 'default domain list');
  w.props.SENDER_DOMAINS = ' Foo.com, bad domain ,bar.co.uk ';
  ok(J(w.X.domains_()).join() === 'foo.com,bar.co.uk', 'SENDER_DOMAINS override cleaned', J(w.X.domains_()));
}

// ── 6. manifest ─────────────────────────────────────────────────────────────────────────────
{
  const expected = ['https://mail.google.com/', 'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/userinfo.email', 'openid'];
  ok(JSON.stringify([...MANIFEST.oauthScopes].sort()) === JSON.stringify([...expected].sort()), 'manifest scopes are exactly: Gmail, UrlFetch, triggers, send mail, userinfo.email, openid (no calendar)', MANIFEST.oauthScopes);
  ok(MANIFEST.oauthScopes.includes('openid') && MANIFEST.oauthScopes.includes('https://www.googleapis.com/auth/userinfo.email'), 'openid + userinfo.email present: ScriptApp.getIdentityToken() needs them for the email claim');
  ok(!MANIFEST.oauthScopes.some(s => /calendar/i.test(s)), 'no calendar scope');
  ok(MANIFEST.runtimeVersion === 'V8' && MANIFEST.timeZone === 'America/New_York', 'manifest V8 + ET');
  ok(!/\bcron\b|ScriptApp\.newTrigger\([^)]*\)\.(forSpreadsheet|forForm|forUserCalendarEvents|onOpen)/.test(SRC), 'no non-time triggers in source');
  ok(!/(^|\n)\s*(var|const|let)\s+\w*(TOKEN|SECRET)\w*\s*=\s*['"][A-Za-z0-9_-]{16,}/.test(SRC), 'no hard-coded token');
  ok(/ScriptApp\.getIdentityToken\(\)/.test(SRC) && /Authorization: 'Bearer '/.test(SRC), 'script signs in with the Google identity token');
}

// ── 7. setup / status (no token, no calendar) ───────────────────────────────────────────────
{
  const w = withClock(world());
  w.run('setup');                                          // ZERO Script Properties set beforehand
  ok(Object.keys(w.props).join() === 'CUTOFF_MS', 'setup works with zero Script Properties and writes only the cutoff', Object.keys(w.props));
  ok(w.triggers.length === 1 && w.triggers[0].fn === 'processDeliveryEmails', 'setup installs one trigger');
  ok(w.newTriggerCalls.length === 1 && w.newTriggerCalls[0].tb === true && w.newTriggerCalls[0].mins === 1, 'time-driven, every 1 minute');
  w.run('setup');
  ok(w.triggers.length === 1 && w.newTriggerCalls.length === 2, 'setup twice still leaves exactly one trigger');
  w.triggers.push({ fn: 'somethingElse', getHandlerFunction() { return 'somethingElse'; } });
  w.run('setup');
  ok(w.triggers.filter(t => t.fn === 'processDeliveryEmails').length === 1 && w.triggers.length === 2, 'setup leaves unrelated triggers alone');
  ok(['Delivery/Sent to Hub', 'Delivery/Needs Attention', 'Delivery/Ignored'].every(l => w.labels[l]), 'all three labels created');
  const c1 = w.props.CUTOFF_MS; ok(Number(c1) === w.clock, 'cutoff = now at first setup');
  w.tick(5 * HOUR); w.run('setup');
  ok(w.props.CUTOFF_MS === c1, 'rerunning setup does not move the cutoff');
  const L = w.logs.join('\n');
  ok(/Hub sign-in OK: Google vouches for info@bmoremanagement\.com \(token valid until/.test(L) && /Delivery_Mailboxes/.test(L), 'setup says the sign-in works, for which address, and that the Hub must list it');
  ok(!/INTAKE_TOKEN|calendar/i.test(L), 'setup never mentions a token or the calendar');
  ok(!L.includes('eyJ') && !L.includes(SIG), 'no identity token in setup logs');
  ok(w.idCalls >= 1, 'setup asked Google for an identity token (this is what forces the openid consent screen)');
  ok(typeof w.ctx.setToken === 'undefined' && typeof w.ctx.showToken === 'undefined' && typeof w.ctx.testCalendar === 'undefined', 'setToken / showToken / testCalendar are gone');
  // status
  let s = J(w.ctx.status());
  ok(s.trigger_count === 1 && s.identity_ok === true && s.identity_email === 'info@bmoremanagement.com' && s.cutoff && s.mailbox === 'info@bmoremanagement.com' && s.alerts_waiting === 0 && s.identity_expires, 'status reports health + identity email + expiry', s);
  const SL = w.logs.join('\n');
  ok(/Hub sign-in: OK\. Google identity token obtained for info@bmoremanagement\.com, valid until /.test(SL), 'status prints the email claim and the expiry');
  ok(!JSON.stringify(s).includes('eyJ') && !JSON.stringify(s).includes(SIG) && !w.logs.some(l => l.includes('eyJ') || l.includes(SIG)), 'status never prints or returns the token');
  ok(!('token_present' in s) && !('calendar_id' in s) && !('events_tracked' in s), 'status has no token/calendar fields');
  w.triggers.length = 0; w.logs.length = 0; w.ctx.status();
  ok(w.logs.some(l => /PROBLEM|0 installed/.test(l)), 'status flags a missing trigger');
  w.run('setup'); w.run('removeTrigger'); ok(w.triggers.length === 0, 'removeTrigger removes it');
  // identity problems are visible in setup AND status, in plain words
  for (const [name, set, re] of [
    ['null', (x) => { x.idMode = 'null'; }, /Google returned nothing.*openid/],
    ['throws', (x) => { x.idMode = 'throw'; }, /identity token unavailable \(.*Authorization is required/],
    ['garbage', (x) => { x.idRaw = 'definitely-not-a-jwt'; }, /not a readable token/],
    ['no email claim', (x) => { x.idRaw = jwt('', Math.floor(x.clock / 1000) + 3600); }, /no email claim/],
    ['expired', (x) => { x.idRaw = jwt('a@b.co', Math.floor(x.clock / 1000) - 5); }, /already expired/],
  ]) {
    const b = withClock(world()); set(b);
    let threw = false; try { b.run('setup'); } catch (e) { threw = true; }
    ok(!threw && b.triggers.length === 1 && b.logs.some(l => /HUB SIGN-IN PROBLEM/.test(l) && re.test(l) && /openid/.test(l)), 'setup (' + name + '): still installs the trigger, says what is wrong and what to do', b.logs.filter(l => /SIGN-IN/.test(l)));
    b.logs.length = 0; const st = J(b.ctx.status());
    ok(st.identity_ok === false && re.test(st.identity_error) && b.logs.some(l => /Hub sign-in: PROBLEM/.test(l)), 'status (' + name + '): identity_ok false with the reason', st.identity_error);
  }
  // Session and token disagree: the token is what the Hub trusts
  const m = withClock(world()); m.idEmail = 'other@example.org'; m.ctx.status();
  ok(m.logs.some(l => /NOTE: the script reports its mailbox as info@bmoremanagement\.com but the token says other@example\.org/.test(l)), 'status notes a Session/token mismatch');
  // mailbox fallback: Session cannot say, the token can
  const w2 = withClock(world({ email: '' })); w2.idEmail = 'tok.owner@example.org'; w2.run('setup');
  const s2 = J(w2.ctx.status());
  ok(s2.mailbox === 'tok.owner@example.org' && s2.identity_ok && s2.identity_email === 'tok.owner@example.org', 'no Session address => the identity token\'s email is the mailbox', s2);
  // optional legacy token is only reported as present, never shown
  const w3 = withClock(world()); w3.props.INTAKE_TOKEN = TOKEN; w3.ctx.status();
  ok(w3.logs.some(l => /optional INTAKE_TOKEN is set \(not needed/.test(l)) && !w3.logs.join('\n').includes('SECRET') && !w3.logs.join('\n').includes('tok_abc'), 'status mentions an optional INTAKE_TOKEN without printing it');
}

// ── 8. setup missing / identity token unavailable => throttled alert, never silent ──────────
{
  const w = withClock(world());
  w.hub = () => { throw new Error('should not be called'); };
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Order confirmation')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /not set up/.test(w.mails[0].subj) && /Setup has not been run/.test(w.mails[0].body) && !/INTAKE_TOKEN/.test(w.mails[0].body), 'setup not run => alert email (and no talk of a token)', w.mails);
  ok(w.mails[0].to === 'info@bmoremanagement.com', 'with ALERT_EMAIL unset the alert goes to this very mailbox, never nowhere', w.mails[0].to);
  w.tick(10 * MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 1, 'throttled: no second email within the hour');
  w.tick(HOUR); w.run('processDeliveryEmails');
  ok(w.mails.length === 2, 'reminder after the hour');
  ok(w.fetches.length === 0 && w.idCalls === 0, 'Hub never called, and no sign-in attempted, before setup');
  ok(J(w.ctx.status().last_run).result === 'not_set_up', 'last run recorded as not_set_up');
  ok(w.lockReleased >= 3, 'lock released every time');
}
for (const [name, set, re] of [
  ['null', (x) => { x.idMode = 'null'; }, /Google returned nothing/],
  ['throws', (x) => { x.idMode = 'throw'; }, /Authorization is required/],
  ['garbage', (x) => { x.idRaw = 'not-a-jwt'; }, /not a readable token/],
  ['no email claim', (x) => { x.idRaw = jwt('', Math.floor(x.clock / 1000) + 3600); }, /no email claim/],
  ['expired', (x) => { x.idRaw = jwt('a@b.co', Math.floor(x.clock / 1000) - 5); }, /already expired/],
  ['about to expire', (x) => { x.idRaw = jwt('a@b.co', Math.floor(x.clock / 1000) + 10); }, /already expired/],
]) {
  const w = ready(world()); set(w);
  w.hub = () => ({ code: 200, body: hubOk() });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Order confirmation')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /cannot sign in to the Hub/.test(w.mails[0].subj) && /identity token unavailable|identity token is already expired|identity token has no email/.test(w.mails[0].body) && re.test(w.mails[0].body), 'identity (' + name + '): loud alert saying what is wrong', w.mails[0] && w.mails[0].body);
  ok(/Run it again/.test(w.mails[0].body) && /openid/.test(w.mails[0].body) && /re-run setup|setup/.test(w.mails[0].body), 'identity (' + name + '): alert says to re-run setup and approve openid');
  ok(w.mails[0].to === 'brett@bmoremanagement.com', 'identity (' + name + '): goes to ALERT_EMAIL');
  ok(w.fetches.length === 0 && t.labels.size === 0 && !w.props.DONE_IDS, 'identity (' + name + '): nothing sent, nothing marked done, nothing labelled (the email is not lost)');
  ok(J(w.ctx.status().last_run).result === 'no_identity', 'identity (' + name + '): last run recorded as no_identity');
  w.tick(10 * MIN); w.run('processDeliveryEmails'); w.tick(10 * MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 1, 'identity (' + name + '): throttled to one email an hour');
  w.tick(HOUR); w.run('processDeliveryEmails');
  ok(w.mails.length === 2, 'identity (' + name + '): reminder after the hour');
  w.idMode = 'ok'; w.idRaw = undefined; w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && t.labels.has('Delivery/Sent to Hub') && w.mails.length === 2, 'identity (' + name + '): once fixed the waiting email goes through, no extra alert');
  ok(!w.everything().includes('eyJ'), 'identity (' + name + '): no token-shaped text anywhere in logs/mails/properties');
}

// ── 9. main loop branches ───────────────────────────────────────────────────────────────────
{ // success + payload contract + auth header
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk() });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Thank you for your order')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && w.fetches[0].url === 'https://maintenance-hub.brett-2f8.workers.dev/intake/delivery-email', 'posted to the delivery endpoint');
  const hd = w.fetches[0].o.headers;
  ok(hd.Authorization === 'Bearer ' + w.lastToken && /^Bearer eyJ/.test(hd.Authorization) && w.fetches[0].o.method === 'post', 'Authorization: Bearer <Google identity token> + POST', hd);
  ok(!('X-Auth-Token' in hd) && Object.keys(hd).join() === 'Authorization', 'no shared secret header when no INTAKE_TOKEN is set (none needed)', hd);
  ok(w.fetches[0].o.contentType === 'application/json', 'JSON body');
  const b = w.fetches[0].body;
  ok(b.message_id === '<rfc-m1@homedepot.com>' && b.mailbox === 'info@bmoremanagement.com' && b.dry_run === false && b.html === '<p>hi</p>', 'payload contract', b);
  ok(t.labels.has('Delivery/Sent to Hub') && t.labels.size === 1, 'labelled Sent to Hub', [...t.labels]);
  ok(w.mails.length === 0, 'no email on success (Hub sends the SMS)');
  ok(!('DELIVERY_EVENTS' in w.props), 'no calendar bookkeeping is stored any more');
  // second run: already done, nothing posted
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 1, 'done email is not sent again');
  // a later email about the same order is just posted: the Hub decides what it means (and moves the calendar itself)
  w.addThread([hdMsg('m2', '2026-10-23T16:00:00Z', 'Delivery rescheduled')]);
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'reschedule', created: false, updated: true, calendar_status: 'updated' }) });
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 2 && w.mails.length === 0 && J(w.ctx.status().counts).sent === 2, 'reschedule email posted, no alert');
  w.addThread([hdMsg('m3', '2026-10-23T17:00:00Z', 'Your order was cancelled')]);
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'cancel', calendar_status: 'deleted' }) });
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 3 && w.mails.length === 0, 'cancel email posted, no alert');
}
{ // parked => Needs Attention + email
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'unknown', parked: true, reason: 'unparseable', detail: 'no order number', created: false, calendar_status: 'skipped', delivery_id: 'DL-77' }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Something about your order')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Needs Attention') && !t.labels.has('Delivery/Sent to Hub'), 'parked => Needs Attention only');
  ok(w.mails.length === 1 && /needs your attention/.test(w.mails[0].subj) && /DL-77/.test(w.mails[0].body) && /Needs Review/.test(w.mails[0].body), 'parked email says what happened and what to do', w.mails);
  w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1 && w.mails.length === 1, 'parked is done (no re-post, no second alert)');
}
{ // sms false / property false
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ brett_sms_sent: false, sms_status: 'twilio_off', property_matched: false }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Needs Attention') && w.mails.length === 1 && /did NOT go out/.test(w.mails[0].body) && /match the delivery address/.test(w.mails[0].body), 'sms+property problems => one email listing both');
}
{ // Hub says the calendar write failed (belt and braces: the Hub alerts too)
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ calendar_status: 'failed', calendar_error: 'delegation not authorised for the calendar user' }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /needs your attention/.test(w.mails[0].subj) && /Google Calendar/.test(w.mails[0].body) && /delegation not authorised for the calendar user/.test(w.mails[0].body) && /Order H1234-567890/.test(w.mails[0].body), 'calendar_status failed => alert email with the reason and the delivery details', w.mails);
  ok(t.labels.has('Delivery/Needs Attention') && !t.labels.has('Delivery/Sent to Hub'), 'and the thread is labelled Needs Attention');
  ok(J(w.ctx.status().counts).attention === 1, 'counted as attention');
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && w.mails.length === 1, 'the Hub already has it: not re-posted, not re-alerted');
  // a failed calendar combined with another problem is one email listing both
  const w2 = ready(world());
  w2.hub = () => ({ code: 200, body: hubOk({ calendar_status: { status: 'failed', reason: 'quota' }, property_matched: false }) });
  w2.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w2.run('processDeliveryEmails');
  ok(w2.mails.length === 1 && /quota/.test(w2.mails[0].body) && /match the delivery address/.test(w2.mails[0].body), 'calendar failure + property problem => one email, both listed');
  // healthy statuses stay quiet
  for (const cs of ['created', 'updated', 'deleted', 'skipped', 'ok', undefined]) {
    const q = ready(world()); q.hub = () => ({ code: 200, body: hubOk({ calendar_status: cs }) }); const tq = q.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); q.run('processDeliveryEmails');
    ok(q.mails.length === 0 && tq.labels.has('Delivery/Sent to Hub'), 'calendar_status ' + cs + ' => quiet');
  }
  // a failed calendar on a duplicate / ignored answer is the Hub\'s business (it alerted when it happened)
  for (const body of [hubOk({ duplicate: true, calendar_status: 'failed' }), hubOk({ kind: 'not_delivery', calendar_status: 'failed' })]) {
    const q = ready(world()); q.hub = () => ({ code: 200, body }); q.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); q.run('processDeliveryEmails');
    ok(q.mails.length === 0, 'duplicate / not_delivery with calendar_status failed => no alert here');
  }
}
{ // not_delivery quietly ignored
  const w = ready(world());
  w.hub = () => ({ code: 200, body: { success: true, kind: 'not_delivery', created: false, duplicate: false, parked: false } });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Fall savings on your order of mulch')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Ignored') && t.labels.size === 1 && w.mails.length === 0, 'not_delivery => Ignored label, no email');
  w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1, 'ignored is done');
}
{ // duplicate (same email in the other mailbox, or hub already has it)
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && w.mails.length === 0, 'duplicate => Sent label, no alert');
  ok(J(w.ctx.status().counts).duplicate === 1, 'duplicate counted');
}
{ // Hub down: retry every minute, alert first time then hourly, stop hammering, then recover
  const w = ready(world());
  let down = true;
  w.hub = (b, o) => { if (down) throw new Error('DNS error ' + o.headers.Authorization); return { code: 200, body: hubOk() }; };
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1, 'network failure stops the rest of the run (no hammering)', w.fetches.length);
  ok(w.mails.length === 1 && /NOT imported/.test(w.mails[0].subj) && /network error/.test(w.mails[0].body) && !w.mails[0].body.includes('eyJ') && !w.mails[0].body.includes(SIG), 'first failure emails, identity token redacted', w.mails[0] && w.mails[0].body);
  ok(!/Delivery_Mailboxes/.test(w.mails[0].body), 'a plain network failure does not blame the mailbox list');
  ok(t.labels.has('Delivery/Needs Attention'), 'failed thread labelled Needs Attention');
  for (let i = 0; i < 30; i++) { w.tick(MIN); w.run('processDeliveryEmails'); }
  ok(w.mails.length === 1, 'no repeat email within the hour', w.mails.length);
  w.tick(35 * MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 2 && /attempt 32|attempt 3\d/.test(w.mails[1].body), 'hourly reminder', w.mails[1] && w.mails[1].body);
  ok(w.ctx.status().failing === 1, 'failing count visible in status', w.ctx.status().failing);
  down = false; w.tick(MIN); w.run('processDeliveryEmails'); w.tick(MIN); w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention'), 'recovery: Sent label, stale Needs Attention label removed');
  ok(J(w.ctx.status()).failing === 0, 'recovered, failing cleared');
  ok(w.fetches.filter(f => f.body.message_id === '<rfc-m1@homedepot.com>').length > 30, 'retries re-send the same RFC message id (Hub dedupes)');
  ok(!w.everything().includes('eyJ'), 'no identity token anywhere in logs/mails/properties');
}
for (const code of [401, 403]) { // sign-in refused: most likely the mailbox is not on the Hub's list
  const w = ready(world({ email: 'new.mailbox@example.org' }));
  let allowed = false;
  w.hub = () => allowed ? { code: 200, body: hubOk() } : { code, body: '{"error":"unauthorized"}' };
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1, code + ': stops after the first refusal (no hammering)');
  ok(w.mails.length === 1 && new RegExp('HTTP ' + code).test(w.mails[0].body) && /Delivery_Mailboxes/.test(w.mails[0].body) && /new\.mailbox@example\.org/.test(w.mails[0].body), code + ' tells the user this mailbox\'s email may not be in the Hub\'s Delivery_Mailboxes list, and which address', w.mails[0] && w.mails[0].body);
  ok(!/token is wrong|INTAKE_TOKEN|showToken/.test(w.mails[0].body), code + ': no stale advice about copying a token');
  ok(t.labels.has('Delivery/Needs Attention'), code + ': thread labelled Needs Attention');
  allowed = true; w.tick(MIN); w.run('processDeliveryEmails'); w.tick(MIN); w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention') && w.ctx.status().failing === 0, code + ': once the address is added, the waiting emails go through by themselves');
}
{ // 400 for one email does not block the next
  const w = ready(world());
  w.hub = (b) => b.message_id.includes('m1') ? { code: 400, body: '{"error":"sender_not_allowed"}' } : { code: 200, body: hubOk() };
  const t1 = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); const t2 = w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 2 && t2.labels.has('Delivery/Sent to Hub') && t1.labels.has('Delivery/Needs Attention'), 'a 400 on one email does not block the next');
  ok(w.mails.length === 1 && /sender_not_allowed/.test(w.mails[0].body) && !/Delivery_Mailboxes/.test(w.mails[0].body), 'and Brett is told (without blaming the mailbox list)');
}
{ // garbled answer, then the Hub reports "duplicate" for our own earlier attempt: handled quietly
  const w = ready(world());
  let n = 0;
  w.hub = () => { n++; if (n === 1) return { code: 200, body: 'timeout page' }; return { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) }; };
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && t.labels.has('Delivery/Needs Attention'), 'attempt 1 failed (garbled answer): alerted');
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention') && w.mails.length === 1, 'retry gets "duplicate": handled, labels cleaned, no further alert');
}
{ // a killed run from an older version may have left an "inflight" marker in FAILS: harmless
  const w = ready(world());
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.props.FAILS = JSON.stringify({ m1: { n: 0, inflight: true } });
  w.hub = () => ({ code: 200, body: hubOk({ duplicate: true, created: false }) });
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && w.ctx.status().failing === 0 && w.mails.length === 0, 'leftover marker => handled, cleared');
}
{ // mailbox A and B install: same email, same RFC id sent from both
  const a = ready(world({ email: 'info@bmoremanagement.com' })), b = ready(world({ email: 'brett@bmoremanagement.com' }));
  const seen = {};
  const hub = (body) => { if (seen[body.message_id]) return { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) }; seen[body.message_id] = 1; return { code: 200, body: hubOk() }; };
  a.hub = hub; b.hub = hub;
  a.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x', { rfc: '<same@homedepot.com>' })]); b.addThread([hdMsg('gb', '2026-10-23T15:30:05Z', 'x', { rfc: '<same@homedepot.com>' })]);
  a.run('processDeliveryEmails'); b.run('processDeliveryEmails');
  ok(a.fetches[0].body.message_id === b.fetches[0].body.message_id, 'both mailboxes send the same RFC Message-ID');
  ok(a.fetches[0].body.mailbox === 'info@bmoremanagement.com' && b.fetches[0].body.mailbox === 'brett@bmoremanagement.com', 'mailbox field differs');
  ok(a.fetches[0].o.headers.Authorization !== b.fetches[0].o.headers.Authorization, 'each mailbox signs with ITS OWN identity token');
  ok(a.mails.length + b.mails.length === 0, 'second copy is a quiet duplicate');
}
{ // cutoff / no backfill, sender spoofing, non-store, order, caps, promos tab
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk() });
  w.addThread([hdMsg('old', '2026-10-23T13:00:00Z', 'Order confirmation')]);                                  // before cutoff
  w.addThread([hdMsg('spoof', '2026-10-23T15:30:00Z', 'Order confirmation', { from: '"orders@homedepot.com" <x@evil.io>' })]);
  w.addThread([hdMsg('own', '2026-10-23T15:30:00Z', 'Order confirmation', { from: 'Brett <brett@bmoremanagement.com>' })]);
  const tp = w.addThread([hdMsg('promoTab', '2026-10-23T15:40:00Z', 'Your order is on its way', { promo: true })]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && w.fetches[0].body.message_id.includes('promoTab'), 'only the post-cutoff store email is sent; old, spoofed, own mail ignored; rescue search finds the Promotions-tab one', w.fetches.map(f => f.body.message_id));
  ok(w.searches.length === 2, 'two Gmail searches per run');
  const since = Number(/after:(\d+)/.exec(w.searches[0])[1]);
  ok(since * 1000 === Number(w.props.CUTOFF_MS), 'search is bounded by the cutoff', since);
  // oldest first + cap
  const w2 = ready(world()); w2.hub = () => ({ code: 200, body: hubOk() });
  for (let i = 0; i < 14; i++) w2.addThread([hdMsg('n' + String(i).padStart(2, '0'), new Date(Date.parse('2026-10-23T15:00:00Z') + (13 - i) * MIN).toISOString(), 's' + i)]);
  w2.run('processDeliveryEmails');
  ok(w2.fetches.length === 10, 'at most 10 per run', w2.fetches.length);
  ok(w2.fetches[0].body.message_id.includes('n13') && w2.fetches[9].body.message_id.includes('n04'), 'processed oldest first', w2.fetches.map(f => f.body.message_id.slice(5, 9)));
  ok(w2.idCalls === 1, 'one identity token per run, reused for every email in it', w2.idCalls);
  w2.tick(MIN); w2.run('processDeliveryEmails'); ok(w2.fetches.length === 14, 'rest next run');
  // DONE_IDS cap
  const w3 = ready(world()); w3.props.DONE_IDS = JSON.stringify(Array.from({ length: 405 }, (_, i) => 'old' + i));
  w3.hub = () => ({ code: 200, body: hubOk() }); w3.addThread([hdMsg('new1', '2026-10-23T15:30:00Z', 's')]); w3.run('processDeliveryEmails');
  const ids = JSON.parse(w3.props.DONE_IDS); ok(ids.length === 400 && ids[399] === 'new1', 'DONE_IDS capped at 400, newest kept', ids.length);
}
{ // stuck failing email cannot starve new mail
  const w = ready(world());
  w.hub = (b) => b.message_id.includes('bad') ? { code: 400, body: 'bad' } : { code: 200, body: hubOk() };
  for (let i = 0; i < 5; i++) w.addThread([hdMsg('bad' + i, '2026-10-23T15:0' + i + ':00Z', 'bad' + i)]);
  w.run('processDeliveryEmails'); w.tick(MIN);
  w.addThread([hdMsg('good', '2026-10-23T15:20:00Z', 'good')]);
  w.run('processDeliveryEmails');
  const tried = w.fetches.slice(5).map(f => f.body.message_id);
  ok(tried.filter(x => x.includes('bad')).length === 3 && tried.some(x => x.includes('good')), 'retries capped at 3 per run, new mail still goes through', tried);
}
{ // alert email cannot be sent: kept for next run, execution fails loudly
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ parked: true, reason: 'x' }) });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.mailFails = true; let threw = false;
  try { w.run('processDeliveryEmails'); } catch (e) { threw = true; }
  ok(threw, 'failure to email is surfaced as an execution error (Google also emails the owner)');
  ok(JSON.parse(w.props.ALERT_QUEUE).length === 1 && w.ctx.status().alerts_waiting === 1, 'exactly one alert kept in the queue');
  ok(w.props.DONE_IDS && JSON.parse(w.props.DONE_IDS).includes('m1'), 'state was saved before the alert failed');
  w.mailFails = false; w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /needs your attention/.test(w.mails[0].subj) && !w.props.ALERT_QUEUE, 'queued alert delivered next run, once');
  ok(w.fetches.length === 1, 'and the email was not re-posted');
}
{ // exception inside run => throttled alert
  const w = ready(world());
  w.ctx.GmailApp.search = () => { throw new Error('Service invoked too many times for one day: gmail'); };
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /script error/.test(w.mails[0].subj) && /too many times/.test(w.mails[0].body), 'unexpected exception => email');
  w.tick(MIN); w.run('processDeliveryEmails'); ok(w.mails.length === 1, 'exception alert throttled');
  ok(w.lockReleased === 2, 'lock released after exceptions');
}
{ // lock busy => skip quietly
  const w = ready(world()); w.lockBusy = true; w.hub = () => { throw new Error('no'); };
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.fetches.length === 0 && w.mails.length === 0, 'busy lock => skip this minute');
}

// ── 10. dryRunLatest ────────────────────────────────────────────────────────────────────────
{
  const w = ready(world());
  w.hub = () => ({ code: 200, body: { success: true, kind: 'scheduled', dry_run: true } });
  w.addThread([hdMsg('d1', '2026-10-10T15:30:00Z', 'older')]); w.addThread([hdMsg('d2', '2026-10-22T15:30:00Z', 'newest')]);
  w.addThread([hdMsg('d3', '2026-10-23T15:30:00Z', 'spoof', { from: '"a@homedepot.com" <x@evil.io>' })]);
  w.run('dryRunLatest');
  ok(w.fetches.length === 1 && w.fetches[0].body.dry_run === true && w.fetches[0].body.message_id === 'DRYRUN-<rfc-d2@homedepot.com>', 'dry run sends the newest store email with dry_run true', w.fetches.map(f => f.body.message_id));
  ok(w.fetches[0].o.headers.Authorization === 'Bearer ' + w.lastToken, 'dry run signs in with the identity token too');
  ok(w.logs.some(l => /Hub says: .*"kind":"scheduled"/.test(l)) && w.logs.some(l => /Nothing was created/.test(l)), 'dry run logs the Hub answer');
  ok(w.mails.length === 0 && !w.props.DONE_IDS && !Object.keys(w.labels).length, 'dry run creates no email, label or done-id');
  const w2 = ready(world()); w2.idMode = 'null'; w2.run('dryRunLatest'); ok(w2.logs.some(l => /Cannot sign in to the Hub: identity token unavailable/.test(l)) && w2.fetches.length === 0, 'dry run without an identity token explains');
  const w3 = ready(world()); w3.run('dryRunLatest'); ok(w3.logs.some(l => /No store email found/.test(l)), 'dry run with nothing to test says so');
  const w4 = ready(world()); w4.hub = () => ({ code: 500, body: 'x' }); w4.addThread([hdMsg('d1', '2026-10-22T15:30:00Z', 's')]); w4.run('dryRunLatest');
  ok(w4.logs.some(l => /FAILED HTTP 500/.test(l)), 'dry run shows failure');
  const w5 = ready(world()); w5.hub = () => ({ code: 403, body: 'no' }); w5.addThread([hdMsg('d1', '2026-10-22T15:30:00Z', 's')]); w5.run('dryRunLatest');
  ok(w5.logs.some(l => /FAILED HTTP 403.*Delivery_Mailboxes/.test(l)), 'dry run 403 mentions Delivery_Mailboxes');
}

// ── 11. MIRROR: one identical file in every mailbox ─────────────────────────────────────────
// 11a. Guard: the .gs must contain nothing specific to one mailbox. (Exported so the guard itself is tested below.)
const ALLOWED_ADDR_DOMAINS = ['homedepot.com', 'lowes.com', 'acehardware.com', 'walmart.com'];   // the configurable default store domains
function mailboxLiterals(src) {
  const bad = [];
  for (const m of src.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
    const dom = m[0].split('@')[1].toLowerCase();
    if (!ALLOWED_ADDR_DOMAINS.some(d => dom === d || dom.endsWith('.' + d))) bad.push(m[0]);
    else if (/^(info|brett)@/i.test(m[0])) bad.push(m[0]);
  }
  for (const m of src.matchAll(/\b(info|brett|ridgeco|admin|office)@/gi)) bad.push(m[0]);
  for (const m of src.matchAll(/bmoremanagement|gmail\.com|googlemail|ridgeco\.app|ridge-co\.github/gi)) bad.push(m[0]);
  return [...new Set(bad)];
}
{
  ok(mailboxLiterals(SRC).length === 0, 'DeliveryIntake.gs has no mailbox-specific addresses or domains', mailboxLiterals(SRC));
  // the guard really catches what it is for
  ok(mailboxLiterals("var NOTIFY = 'brett@bmoremanagement.com';").length >= 1, 'guard flags a brett@ literal');
  ok(mailboxLiterals("var x = 'info@bmoremanagement.com'").length >= 1, 'guard flags an info@ literal');
  ok(mailboxLiterals("MailApp.sendEmail('someone@gmail.com')").length >= 1, 'guard flags any other address');
  ok(mailboxLiterals("var d = 'office@bmoremanagement.com'").length >= 1 && mailboxLiterals("a ridgeco.app link").length >= 1, 'guard flags other company addresses/domains');
  ok(mailboxLiterals("from:(homedepot.com OR lowes.com) x@mg.homedepot.com").length === 0, 'guard allows the configurable store-domain defaults');
  // no sender/recipient address anywhere in the setup helpers' defaults
  ok(!/Session\.getActiveUser\(\)\.getEmail\(\) *===? *['"]/.test(SRC), 'code never compares the mailbox to a literal');
  ok(!/(email|mailbox|ALLOW\w*|LIST)\s*(===?|!==?)\s*['"][^'"]*@/i.test(SRC) && !/indexOf\(\s*['"][^'"]*@/.test(SRC), 'no allow-list of mailboxes in the script (that lives in the Hub: Delivery_Mailboxes)');
  ok(!/idt?\.email\s*(===?|!==?)\s*['"]/.test(SRC), 'identity email is never compared to a literal');
}
// 11b. Identical behaviour in any mailbox, including an unknown third one; mailbox only comes from Session / the token
{
  const results = {};
  for (const email of ['info@bmoremanagement.com', 'brett@bmoremanagement.com', 'Someone.New@Example-Co.org', 'ridgeco.ops@gmail.com']) {
    const w = ready(world({ email }));
    w.hub = () => ({ code: 200, body: hubOk() });
    w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Thank you for your order')]);
    w.run('processDeliveryEmails');
    results[email] = { mailbox: w.fetches[0].body.mailbox, tokenEmail: w.X.decodeJwtPayload_(w.fetches[0].o.headers.Authorization.slice(7)).email, mails: w.mails.length, st: w.ctx.status(), logs: w.logs };
  }
  ok(results['info@bmoremanagement.com'].mailbox === 'info@bmoremanagement.com' && results['brett@bmoremanagement.com'].mailbox === 'brett@bmoremanagement.com', 'mailbox sent = whoever runs it');
  ok(results['Someone.New@Example-Co.org'].mailbox === 'someone.new@example-co.org', 'a third, unknown mailbox string is sent (lower-cased) and works', results['Someone.New@Example-Co.org'].mailbox);
  ok(Object.entries(results).every(([e, r]) => r.mails === 0 && r.tokenEmail.toLowerCase() === e.toLowerCase()), 'every mailbox: no alert, and the Bearer token names that very mailbox');
  const fps = Object.values(results).map(r => J(r.st).config_fingerprint);
  ok(new Set(fps).size === 1 && /^[0-9a-f]{8}$/.test(fps[0]), 'config fingerprint identical across mailboxes with the same Script Properties', fps);
  const w2 = ready(world()); w2.props.SENDER_DOMAINS = 'other.com'; ok(J(w2.ctx.status()).config_fingerprint !== fps[0], 'fingerprint differs when SENDER_DOMAINS differs');
  const w3 = ready(world()); w3.props.ALERT_EMAIL = 'someone.else@example.org'; ok(J(w3.ctx.status()).config_fingerprint !== fps[0], 'fingerprint differs when ALERT_EMAIL differs');
  const w4 = ready(world()); w4.props.CALENDAR_ID = 'other'; w4.props.INTAKE_TOKEN = TOKEN; ok(J(w4.ctx.status()).config_fingerprint === fps[0], 'fingerprint ignores CALENDAR_ID and INTAKE_TOKEN (not shared settings any more; and a secret must never feed it)');
}
// 11c. SCRIPT_VERSION
{
  const w = ready(world()); const st = J(w.ctx.status());
  ok(/^\d+\.\d+\.\d+$/.test(w.X.SCRIPT_VERSION) && st.script_version === w.X.SCRIPT_VERSION, 'status() returns SCRIPT_VERSION', st.script_version);
  ok(w.logs.some(l => l.includes('Script version: ' + w.X.SCRIPT_VERSION)), 'status() prints SCRIPT_VERSION');
  w.hub = () => ({ code: 200, body: hubOk() }); w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.fetches[0].body.script_version === w.X.SCRIPT_VERSION, 'version also sent to the Hub (it can log which copy sent what)');
  const w2 = withClock(world()); w2.run('setup'); ok(w2.logs.some(l => l.includes(w2.X.SCRIPT_VERSION)), 'setup logs the version');
  const DOC = fs.readFileSync(path.join(here, '..', '..', '..', 'context', 'DELIVERY_INTAKE_SETUP_v1.0.md'), 'utf8');
  ok(DOC.includes(w.X.SCRIPT_VERSION), 'setup doc names the same SCRIPT_VERSION as the script (they must move together)');
  ok(w.X.SCRIPT_VERSION === '1.2.0', 'this is the 1.2.0 script (no token, no calendar)');
}
// 11d. manifest scopes are exactly what the doc promises (a change means every mailbox must re-authorize)
{
  const DOC = fs.readFileSync(path.join(here, '..', '..', '..', 'context', 'DELIVERY_INTAKE_SETUP_v1.0.md'), 'utf8');
  ok(/openid/.test(DOC) && !/INTAKE_TOKEN is required|share (the|your) calendar/i.test(DOC), 'setup doc mentions openid and asks for no token / calendar sharing');
  ok(!/Make changes to events|CALENDAR_ID/.test(DOC), 'setup doc has no calendar-sharing steps');
  ok(/Delivery_Mailboxes/.test(DOC), 'setup doc explains the Hub Delivery_Mailboxes list');
}

// ── 12. RFC Message-ID extraction ───────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X;
  const M = (o) => msgObjLike(o);
  function msgObjLike(o) { return { getHeader: (h) => { if (o.throws) throw new Error('x'); return (o.headers || {})[h] || ''; }, getRawContent: () => { if (o.rawThrows) throw new Error('raw'); return o.raw || ''; } }; }
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': '<abc@x.com>' } })) === '<abc@x.com>', 'plain header');
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': '  \r\n <abc@x.com> \r\n' } })) === '<abc@x.com>', 'whitespace and line breaks trimmed');
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': '<abc@x.com> (comment)' } })) === '<abc@x.com>', 'trailing comment dropped');
  ok(X.extractRfcId_(M({ headers: { 'Message-Id': '<mixed@x.com>' } })) === '<mixed@x.com>', 'other capitalisation of the header name');
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': 'bare-id@x.com' } })) === 'bare-id@x.com', 'bare id without angle brackets kept');
  ok(X.extractRfcId_(M({ headers: {} })) === '', 'no header, no raw => empty (caller falls back to Gmail id)');
  ok(X.extractRfcId_(M({ throws: true, rawThrows: true })) === '', 'getHeader and raw both throw => empty, never throws');
  const raw1 = 'Received: from a\r\nMessage-ID:\r\n <folded@mail.x.com>\r\nIn-Reply-To: <other@x.com>\r\nSubject: s\r\n\r\nbody Message-ID: <fake@body.com>';
  ok(X.extractRfcId_(M({ throws: true, raw: raw1 })) === '<folded@mail.x.com>', 'getHeader fails => parsed from raw headers (folded line unfolded)');
  ok(X.extractRfcId_(M({ headers: {}, raw: raw1 })) === '<folded@mail.x.com>', 'getHeader empty => raw fallback');
  ok(X.extractRfcId_(M({ raw: 'In-Reply-To: <reply@x.com>\nReferences: <ref@x.com>\nSubject: s\n\nMessage-ID: <body@x.com>' })) === '', 'never takes In-Reply-To/References or text from the body');
  ok(X.extractRfcId_(M({ raw: 'message-id: <lower@x.com>\nSubject: s\n\n' })) === '<lower@x.com>', 'raw header name is case-insensitive');
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': '<' + 'a'.repeat(400) + '@x.com>' } })) === '', 'absurdly long id rejected');
  ok(X.extractRfcId_(M({ headers: { 'Message-ID': 'two words' } })) === '', 'id with spaces rejected');
  const big = 'Subject: s\n\n' + 'x'.repeat(5e6);
  ok(X.extractRfcId_(M({ raw: big })) === '', 'huge raw message does not hurt (headers only)');
  // same email in two mailboxes => identical id from different Gmail ids
  const a = J(X.buildPayload_({ getId: () => 'gA', getFrom: () => 'x', getSubject: () => 's', getDate: () => D('2026-10-23T15:00:00Z'), getPlainBody: () => 'b', getBody: () => '', getHeader: () => '<same@homedepot.com>' }, 'info@x.test', false));
  const b = J(X.buildPayload_({ getId: () => 'gB', getFrom: () => 'x', getSubject: () => 's', getDate: () => D('2026-10-23T15:00:03Z'), getPlainBody: () => 'b', getBody: () => '', getHeader: () => '<same@homedepot.com>' }, 'brett@x.test', false));
  ok(a.rfc_message_id === b.rfc_message_id && a.message_id === b.message_id && a.gmail_id !== b.gmail_id, 'same email: same rfc_message_id/message_id, different gmail_id', [a, b]);
}

// ── 13. Hub duplicate:true is "handled": mark done, no alert, no re-post ─────────────────────
{
  for (const dupBody of [
    hubOk({ duplicate: true, created: false, brett_sms_sent: null }),
    hubOk({ duplicate: true, created: false, parked: true, brett_sms_sent: false, property_matched: false, telemetry_ok: false, tenant_sms: 'failed' }),   // even odd flags on a duplicate stay quiet
    { success: true, duplicate: true, delivery_id: 'DL-1' },                                                                                      // minimal duplicate answer
  ]) {
    const w = ready(world());
    w.hub = () => ({ code: 200, body: dupBody });
    const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
    w.run('processDeliveryEmails');
    ok(w.mails.length === 0, 'duplicate => no alert email', w.mails);
    ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention') && t.labels.size === 1, 'duplicate => Sent to Hub label only');
    ok(JSON.parse(w.props.DONE_IDS).includes('m1') && !w.props.FAILS.includes('m1'), 'duplicate => marked done, not failing');
    w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1, 'duplicate => never re-posted');
  }
  // a forwarded/re-sent copy with a different Message-ID that the Hub recognises semantically: same handling
  const w = ready(world());
  w.hub = (b) => b.rfc_message_id.includes('first') ? { code: 200, body: hubOk() } : { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null, reason: 'same order, same values' }) };
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Scheduled', { rfc: '<first@homedepot.com>' })]);
  w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'Scheduled (resent)', { rfc: '<resent@homedepot.com>' })]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 0 && J(w.ctx.status().counts).duplicate === 1 && J(w.ctx.status().counts).sent === 1, 'resent copy with new Message-ID: no alert, counted as duplicate', w.ctx.status().counts);
}

// ── 14. Identity-token sign-in: header, secrets never leak, no calendar code ────────────────
{ // the header
  const w = ready(world()); w.hub = () => ({ code: 200, body: hubOk() });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  const tok = w.fetches[0].o.headers.Authorization.replace(/^Bearer /, '');
  const pl = w.X.decodeJwtPayload_(tok);
  ok(pl.email === 'info@bmoremanagement.com' && pl.exp * 1000 > w.clock, 'the Bearer value is the mailbox owner\'s identity token (email claim, not expired)', pl);
  // optional legacy secret: sent in addition, never required
  const l = ready(world()); l.props.INTAKE_TOKEN = TOKEN; l.hub = () => ({ code: 200, body: hubOk() });
  l.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); l.run('processDeliveryEmails');
  ok(l.fetches[0].o.headers['X-Auth-Token'] === TOKEN && l.fetches[0].o.headers.Authorization === 'Bearer ' + l.lastToken, 'if INTAKE_TOKEN happens to be set it is ALSO sent as X-Auth-Token, next to the Bearer token');
  ok(!l.everything().includes('SECRET') && !l.everything().includes('tok_abc') && !l.everything().includes('eyJ'), 'neither secret appears in logs, alert mails or Script Properties (the INTAKE_TOKEN property the person set themselves is excluded)', l.everything().slice(0, 200));
  const e = ready(world()); e.props.INTAKE_TOKEN = '   '; e.hub = () => ({ code: 200, body: hubOk() });
  e.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); e.run('processDeliveryEmails');
  ok(!('X-Auth-Token' in e.fetches[0].o.headers), 'a blank INTAKE_TOKEN sends no X-Auth-Token');
  // the token is never persisted: a fresh one is requested every run
  w.tick(MIN); w.addThread([hdMsg('m2', '2026-10-23T15:40:00Z', 'b')]); w.run('processDeliveryEmails');
  ok(w.idCalls === 2 && !JSON.stringify(w.props).includes('eyJ') && !JSON.stringify(w.props).includes(SIG), 'a fresh token every run; none stored in Script Properties');
}
{ // redaction when the Hub or the network echoes the token back, and when something unexpected throws
  const w = ready(world());
  w.hub = (b, o) => ({ code: 500, body: 'upstream saw ' + o.headers.Authorization + ' and ' + o.headers.Authorization.replace('Bearer ', '') });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /HTTP 500/.test(w.mails[0].body) && !w.everything().includes('eyJ') && !w.everything().includes(SIG) && /\[token\]/.test(w.mails[0].body), 'Hub echoing the token in an error: redacted everywhere', w.mails[0] && w.mails[0].body);
  // a secret that straddles the 600-character cut of the Hub's answer must be redacted BEFORE cutting, or half of it would survive
  const y = ready(world()); y.props.INTAKE_TOKEN = TOKEN; y.hub = () => ({ code: 500, body: 'x'.repeat(590) + TOKEN });
  y.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); y.run('processDeliveryEmails');
  ok(y.mails.length === 1 && !y.everything().includes('tok_abc') && !y.everything().includes('SECRET'), 'token cut in half by the 600-character limit: no fragment survives', y.mails[0] && y.mails[0].body.slice(-120));
  const x = ready(world());
  x.ctx.GmailApp.search = () => { throw new Error('boom while holding ' + x.lastToken); };
  x.run('processDeliveryEmails');   // first run: nothing issued yet, so the throw has no token in it; second run has one
  x.ctx.GmailApp.search = () => { throw new Error('boom while holding ' + x.lastToken); };
  x.tick(2 * HOUR); x.run('processDeliveryEmails');
  ok(x.mails.length === 2 && x.mails.every(m => /script error/.test(m.subj)) && !x.everything().includes('eyJ') && !x.everything().includes(SIG), 'unexpected exception that contains the token: redacted in the alert mail', x.mails.map(m => m.body));
  const t = ready(world()); t.props.INTAKE_TOKEN = TOKEN;
  t.hub = (b, o) => { throw new Error('connect failed ' + o.headers['X-Auth-Token'] + ' ' + o.headers.Authorization); };
  t.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); t.run('processDeliveryEmails');
  ok(t.mails.length === 1 && !t.everything().includes('SECRET') && !t.everything().includes('eyJ') && !t.everything().includes(SIG), 'network error text with BOTH secrets: both redacted');
  ok(String(w.X.redact_('x eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InhAeS56eiJ9.c2ln y', [])) === 'x [token] y', 'anything shaped like a JWT is redacted even if we never saw it', w.X.redact_('x eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6InhAeS56eiJ9.c2ln y', []));
  ok(w.X.redact_('plain text', null) === 'plain text' && w.X.redact_(undefined, []) === '' && w.X.redact_('aaa', ['aaa']) === 'aaa', 'redact_ ignores empty/short secrets and odd input');
  ok(w.X.redact_('s ' + TOKEN + ' e', [TOKEN, '']) === 's [token] e' && w.X.redact_('s ' + TOKEN + ' e', TOKEN) === 's [token] e', 'redact_ takes a string or a list');
}
{ // the mailbox sent is the Session address; the token's address is what the Hub trusts; fallback to the token's address
  const w = ready(world({ email: 'Info@BMoreManagement.com' })); w.hub = () => ({ code: 200, body: hubOk() });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.fetches[0].body.mailbox === 'info@bmoremanagement.com', 'mailbox lower-cased');
  const u = ready(world({ email: '' })); u.idEmail = 'Tok.Owner@Example.org'; u.hub = () => ({ code: 200, body: hubOk() });
  u.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); u.run('processDeliveryEmails');
  ok(u.fetches.length === 1 && u.fetches[0].body.mailbox === 'tok.owner@example.org', 'Session cannot say who runs the trigger => the mailbox sent is the identity token\'s email', u.fetches.map(f => f.body.mailbox));
}
{ // ALERT_EMAIL optional
  const w = ready(world()); delete w.props.ALERT_EMAIL; w.hub = () => ({ code: 500, body: 'down' });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && w.mails[0].to === 'info@bmoremanagement.com' && !/ALERT_EMAIL/.test(w.mails[0].subj), 'no ALERT_EMAIL: no nagging, alerts go to the mailbox itself');
}
{ // no Calendar code at all
  ok(!/CalendarApp|getCalendarById|getDefaultCalendar|createAllDayEvent|createEvent|getEvents\(|CALENDAR_ID|DELIVERY_EVENTS|testCalendar|applyCalendar_|calendarPlan_/.test(SRC), 'no Calendar code or settings left in the script');
  ok(!/auth\/calendar/.test(JSON.stringify(MANIFEST)), 'no calendar scope in the manifest');
  const w = ready(world()); ok(!('CalendarApp' in w.ctx), 'harness has no CalendarApp: a stray use would throw and fail every run test above');
}

// ── 15. Script Property size limits (9 KB per value) ────────────────────────────────────────
{
  // many failing emails at once: FAILS must stay storable (the old code stored 600 chars per failure and would have thrown)
  const w = ready(world());
  w.hub = () => ({ code: 400, body: 'x'.repeat(2000) });
  for (let i = 0; i < 60; i++) w.addThread([hdMsg('f' + String(i).padStart(2, '0'), new Date(Date.parse('2026-10-23T15:00:00Z') + i * 1000).toISOString(), 's' + i)]);
  for (let run = 0; run < 25; run++) { w.tick(MIN); w.run('processDeliveryEmails'); }
  ok(Buffer.byteLength(w.props.FAILS) <= 8500, 'FAILS stays under the Script Property limit', Buffer.byteLength(w.props.FAILS));
  ok(w.mails.length >= 1 && !w.logs.some(l => /Argument too large/.test(l)), 'no storage error, Brett was told');
  // big alert bodies: queue shortens and counts what it dropped
  const q = ready(world()); q.mailFails = true;
  for (let i = 0; i < 12; i++) { try { vm.runInContext(`queueAlert_('S${i}', ${JSON.stringify('B'.repeat(5000))})`, q.ctx); } catch (e) { ok(false, 'queueAlert_ threw', String(e)); } }
  ok(Buffer.byteLength(q.props.ALERT_QUEUE) <= 8500 && J(JSON.parse(q.props.ALERT_QUEUE)).length >= 1, 'ALERT_QUEUE under the limit', Buffer.byteLength(q.props.ALERT_QUEUE));
  ok(Number(q.props.ALERT_DROPPED) > 0, 'dropped notices are counted');
  q.mailFails = false; vm.runInContext('flushAlerts_()', q.ctx);
  ok(q.mails.length === 1 && /older notices were shortened away/.test(q.mails[0].body) && !q.props.ALERT_QUEUE && !q.props.ALERT_DROPPED, 'next email says how many were dropped, then clears');
  // DONE_IDS with long-ish ids
  const d = ready(world()); d.props.DONE_IDS = JSON.stringify(Array.from({ length: 399 }, (_, i) => '18c3f5a2b4d6e8' + String(i).padStart(4, '0') + 'ffff'));
  d.hub = () => ({ code: 200, body: hubOk() });
  for (let i = 0; i < 70; i++) d.addThread([hdMsg('n' + String(i).padStart(3, '0') + 'x'.repeat(30), new Date(Date.parse('2026-10-23T15:00:00Z') + i * 1000).toISOString(), 's' + i)]);
  for (let run = 0; run < 8; run++) { d.tick(MIN); d.run('processDeliveryEmails'); }
  ok(Buffer.byteLength(d.props.DONE_IDS) <= 8500, 'DONE_IDS stays under the limit', Buffer.byteLength(d.props.DONE_IDS));
  ok(!d.mails.some(m => /script error/.test(m.subj)), 'no storage exception along the way', d.mails.map(m => m.subj));
  ok(w.X.utf8Len_('aé€😀') === 1 + 2 + 3 + 4, 'utf8Len_ counts bytes');
}

// ── 16. Shared settings: ALERT_EMAIL, SENDER_DOMAINS, setConfig, status ─────────────────────
{
  const w = ready(world({ email: 'info@bmoremanagement.com' })); w.props.ALERT_EMAIL = 'Boss@Example.org';
  w.hub = () => ({ code: 500, body: 'down' }); w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && w.mails[0].to === 'boss@example.org', 'alerts go to ALERT_EMAIL', w.mails[0] && w.mails[0].to);
  ok(/\(info@bmoremanagement\.com\)$/.test(w.mails[0].subj) && /running in info@bmoremanagement\.com/.test(w.mails[0].body), 'subject/footer say which mailbox copy sent it');
  const b = ready(world({ email: 'brett@bmoremanagement.com' })); b.props.ALERT_EMAIL = 'not an email';
  b.hub = () => ({ code: 500, body: 'down' }); b.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); b.run('processDeliveryEmails');
  ok(b.mails.length === 2 && b.mails.every(m => m.to === 'brett@bmoremanagement.com') && /ALERT_EMAIL is not a valid address/.test(b.mails[0].subj), 'invalid ALERT_EMAIL => warned, alerts fall back to this mailbox (never nowhere)', b.mails.map(m => m.subj));
  const u = withClock(world({ email: '' })); u.props.ALERT_EMAIL = ''; u.hub = () => ({ code: 500, body: 'down' }); u.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  let threw = false; try { u.run('processDeliveryEmails'); } catch (e) { threw = true; }
  ok(threw && u.mails.length === 0, 'not set up, no ALERT_EMAIL and no mailbox address: fails loudly (execution error) instead of silently');
  // setConfig: only the two optional settings
  const c = withClock(world());
  c.ctx.setConfig('# comment\n\nALERT_EMAIL="Alerts@Example.org"\nSENDER_DOMAINS=homedepot.com, lowes.com');
  ok(c.props.ALERT_EMAIL === 'alerts@example.org' && c.props.SENDER_DOMAINS === 'homedepot.com, lowes.com' && Object.keys(c.props).length === 2, 'setConfig saves the block', c.props);
  const c0 = withClock(world()); c0.ctx.setConfig('ALERT_EMAIL=a@b.co');
  ok(c0.props.ALERT_EMAIL === 'a@b.co', 'setConfig works with just one setting and no token');
  const c2 = withClock(world()); let msg = '';
  try { c2.ctx.setConfig('INTAKE_TOKEN=' + TOKEN + '\nCALENDAR_ID=x\nFOO=bar\nALERT_EMAIL=nope\nnonsense'); } catch (e) { msg = String(e.message); }
  ok(/Nothing was saved/.test(msg) && /unknown setting INTAKE_TOKEN/.test(msg) && /unknown setting CALENDAR_ID/.test(msg) && /unknown setting FOO/.test(msg) && /ALERT_EMAIL is not an email/.test(msg) && /expected KEY=VALUE/.test(msg) && Object.keys(c2.props).length === 0, 'setConfig is all-or-nothing, refuses INTAKE_TOKEN / CALENDAR_ID, says what is wrong', msg);
  ok(!msg.includes('SECRET') && !c2.logs.join('\n').includes('SECRET'), 'a pasted token is never echoed back');
  let m2 = ''; try { c2.ctx.setConfig(''); } catch (e) { m2 = String(e.message); } ok(/no KEY=VALUE/.test(m2), 'empty block rejected');
  let m3 = ''; try { c2.ctx.setConfig('SENDER_DOMAINS=not a domain'); } catch (e) { m3 = String(e.message); } ok(/no valid domain/.test(m3), 'bad SENDER_DOMAINS rejected');
  const pc = c2.X.parseConfig_('ALERT_EMAIL=a@b.co\nSENDER_DOMAINS=x.com');
  ok(J(pc).errors.length === 0 && pc.values.SENDER_DOMAINS === 'x.com', 'parseConfig_ is pure and exported');
  // status shows where alerts go
  c.run('setup'); const st = J(c.ctx.status()); ok(st.alert_email === 'alerts@example.org' && c.logs.some(l => /Alert emails go to: alerts@example\.org/.test(l)), 'status shows the alert address');
  const nw = withClock(world()); nw.ctx.status(); ok(nw.logs.some(l => /Alert emails go to: this mailbox \(info@bmoremanagement\.com\)/.test(l)), 'status says alerts go to the mailbox when ALERT_EMAIL is unset');
  // SENDER_DOMAINS changes what is searched
  const sd = ready(world()); sd.props.SENDER_DOMAINS = 'example.com'; sd.hub = () => ({ code: 200, body: hubOk() });
  sd.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Order a', { from: 'x@homedepot.com' })]); sd.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'Order b', { from: 'x@example.com' })]);
  sd.run('processDeliveryEmails');
  ok(sd.fetches.length === 1 && sd.fetches[0].body.message_id.includes('m2') && /from:\(example\.com\)/.test(sd.searches[0]), 'SENDER_DOMAINS replaces the default store list');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
