// Offline harness for DeliveryIntake.gs - pure helpers plus the main loop against minimal fakes of
// GmailApp / UrlFetchApp / CalendarApp / PropertiesService / LockService / ScriptApp / MailApp / Session.
// Run: node apps-script/delivery-intake/test/delivery-intake.test.mjs
// (Apps Script itself cannot run here; this proves the logic, not Google's permission screens.)
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

const TOKEN = 'tok_abcdef0123456789abcdef0123456789SECRET';
const MIN = 60000, HOUR = 3600 * 1000;

function world(opts) {
  opts = opts || {};
  const w = {
    clock: Date.parse('2026-10-23T15:00:00Z'), props: {}, logs: [], mails: [], fetches: [], triggers: [], newTriggerCalls: [],
    labels: {}, threads: [], hub: null, lockBusy: false, mailFails: false, calFail: null, calendars: { primary: true, 'brett@bmoremanagement.com': true },
    searches: [], getEventsCalls: [], sleeps: [], activeEmail: opts.email === undefined ? 'info@bmoremanagement.com' : opts.email,
  };
  const store = opts.cal || { events: [], evSeq: 0 };        // a shared store = one calendar seen by several mailbox copies
  Object.defineProperty(w, 'events', { get: () => store.events });
  w.store = store;
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
  const evObj = (e) => ({
    getId: () => e.id, deleteEvent: () => { if (w.calFail === 'delete') throw new Error('Calendar delete denied'); w.events.splice(w.events.indexOf(e), 1); e.deleted = true; },
    setTitle: (t) => { e.title = t; }, setTime: (s, en) => { e.start = s; e.end = en; e.allDay = false; },
    setAllDayDate: (d) => { e.start = d; e.end = null; e.allDay = true; }, setLocation: (l) => { e.location = l; }, setDescription: (d) => { e.description = d; },
    setTag: (k, v) => { e.tags[k] = v; }, getTag: (k) => e.tags[k] || null, getDescription: () => e.description || '',
  });
  const calObj = () => ({
    createEvent: (title, s, en, o) => { if (w.calFail === 'create') throw new Error('Calendar permission denied'); if (w.onBeforeCreate) { const h = w.onBeforeCreate; w.onBeforeCreate = null; h(); } const e = { id: 'ev' + (++store.evSeq), title, start: s, end: en, allDay: false, location: o && o.location, description: o && o.description, tags: {} }; w.events.push(e); return evObj(e); },
    createAllDayEvent: (title, d, o) => { if (w.calFail === 'create') throw new Error('Calendar permission denied'); if (w.onBeforeCreate) { const h = w.onBeforeCreate; w.onBeforeCreate = null; h(); } const e = { id: 'ev' + (++store.evSeq), title, start: d, end: null, allDay: true, location: o && o.location, description: o && o.description, tags: {} }; w.events.push(e); return evObj(e); },
    getEventById: (id) => { const e = w.events.find(x => x.id === id); return e ? evObj(e) : null; },
    getEvents: (a, b, o) => {
      w.getEventsCalls.push({ a, b, o });
      if (o && o.search && w.searchBroken) return [];
      return w.events.filter(e => e.start >= a && e.start <= b && (!(o && o.search) || (String(e.title) + ' ' + String(e.description || '') + ' ' + String(e.location || '')).includes(o.search))).map(evObj);
    },
  });
  const ctx = {
    console, JSON, Math, String, Number, Array, Object, Date, RegExp, parseInt, isNaN, Error,
    Logger: { log: (m) => w.logs.push(String(m)) },
    Utilities: { sleep: (ms) => { w.sleeps.push(ms); } },
    Session: { getActiveUser: () => ({ getEmail: () => w.activeEmail }), getEffectiveUser: () => ({ getEmail: () => w.activeEmail }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in w.props ? w.props[k] : null), setProperty: (k, v) => { if (Buffer.byteLength(String(v), 'utf8') > 9216) throw new Error('Argument too large: value (Script Properties allow 9 KB per value)'); w.props[k] = String(v); w.propSets = (w.propSets || 0) + 1; }, deleteProperty: (k) => { delete w.props[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => !w.lockBusy, releaseLock: () => { w.lockReleased = (w.lockReleased || 0) + 1; } }) },
    MailApp: { sendEmail: (to, subj, body) => { if (w.mailFails) throw new Error('Mail quota'); w.mails.push({ to, subj, body }); } },
    ScriptApp: {
      getProjectTriggers: () => w.triggers.slice(),
      deleteTrigger: (t) => { const i = w.triggers.indexOf(t); if (i >= 0) w.triggers.splice(i, 1); },
      newTrigger: (fn) => { const t = { fn, getHandlerFunction() { return fn; } }; const b = { timeBased: () => { b.tb = true; return b; }, everyMinutes: (n) => { b.mins = n; return b; }, create: () => { w.newTriggerCalls.push({ fn, tb: b.tb, mins: b.mins }); w.triggers.push(t); return t; } }; return b; },
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
    CalendarApp: {
      getDefaultCalendar: () => calObj(),
      getCalendarById: (id) => (w.calendars[id] ? calObj() : null),
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
  // Date.now() follows the fake clock
  vm.runInContext('(function(){ var RealDate = Date; })()', ctx);
  w.ctx = ctx; w.X = ctx.module.exports;
  w.run = (fn) => vm.runInContext(fn + '()', ctx);
  w.tick = (ms) => { w.clock += ms; };
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
const hubOk = (over) => Object.assign({ success: true, kind: 'order_confirmation', delivery_id: 'DL-1', created: true, updated: false, duplicate: false, parked: false, order_number: 'H1234-567890', item_type: 'refrigerator', make_model: 'Whirlpool WRF535', expected_date: '2026-10-28', expected_window: '9a-1p', delivery_address: '1109 Battery Ave', property_matched: true, wo_id: 'WO-1300', wo_created: true, brett_sms_sent: true, sms_status: 'sent', tenant_sms: 'off', telemetry_ok: true,
  calendar: { action: 'create', key: 'H1234-567890', title: 'Delivery: refrigerator (H1234-567890)', start_iso: '2026-10-28T09:00:00-04:00', end_iso: '2026-10-28T13:00:00-04:00', all_day: false, location: '1109 Battery Ave, Baltimore, MD 21230', description: 'old wording from hub' } }, over || {});
function ready(w, opts) {   // set up(): token + cutoff + clock
  withClock(w);
  w.props.INTAKE_TOKEN = TOKEN;
  w.props.ALERT_EMAIL = 'brett@bmoremanagement.com';
  w.props.CUTOFF_MS = String(Date.parse('2026-10-23T14:00:00Z'));
  return w;
}

// ── 1. senderOk_ / eligible_ ────────────────────────────────────────────────────────────────────────────────────
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

// ── 2. buildPayload_ ─────────────────────────────────────────────────────────────────────────────────────────
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

// ── 3. handleResponse_ ────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X; const H = (code, body) => J(X.handleResponse_(code, typeof body === 'string' ? body : JSON.stringify(body), TOKEN));
  let r = H(200, hubOk());
  ok(r.ok && !r.attention && !r.ignored && !r.duplicate && r.calendar && r.calendar.action === 'create', 'normal success: no attention, calendar passed through');
  ok(/Order H1234-567890/.test(r.summary) && /WO-1300/.test(r.summary), 'summary mentions order and WO', r.summary);
  r = H(200, hubOk({ parked: true, kind: 'unknown', reason: 'unreadable', detail: 'no order #', calendar: { action: 'none' } }));
  ok(r.ok && r.attention && /Needs Review/.test(r.attentionText) && /unreadable/.test(r.attentionText) && r.calendar === null, 'parked => attention, no calendar');
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
  r = H(200, hubOk({ kind: 'not_delivery', created: false, parked: false, calendar: { action: 'none' } }));
  ok(r.ok && r.ignored && !r.attention, 'not_delivery => ignored, no alert');
  r = H(200, hubOk({ kind: 'not_delivery', brett_sms_sent: false, property_matched: false }));
  ok(r.ignored && !r.attention, 'not_delivery never alerts even with odd flags');
  r = H(200, hubOk({ duplicate: true, created: false, brett_sms_sent: null }));
  ok(r.ok && r.duplicate && !r.attention, 'duplicate => quiet, no attention');
  r = H(200, hubOk({ calendar: { action: 'none' } }));
  ok(r.calendar === null, 'calendar none => null');
  r = H(500, 'boom'); ok(!r.ok && r.transient && !r.authProblem, '500 is transient');
  r = H(401, '{"error":"unauthorized"}'); ok(!r.ok && r.transient && r.authProblem && /rejected the token/.test(r.raw), '401 => auth problem');
  r = H(403, 'no'); ok(!r.ok && r.authProblem, '403 => auth problem');
  r = H(400, '{"error":"sender_not_allowed"}'); ok(!r.ok && !r.transient, '400 is a per-email failure');
  r = H(200, '<html>gateway</html>'); ok(!r.ok && !r.transient, '200 non-JSON is a failure');
  r = H(200, { success: false, error: 'x' }); ok(!r.ok, 'success:false is a failure');
  r = H(429, 'slow down'); ok(!r.ok && r.transient, '429 transient');
  r = J(X.handleResponse_(500, 'echo ' + TOKEN + ' echo', TOKEN)); ok(!/SECRET/.test(r.raw) && /\[token\]/.test(r.raw), 'token redacted from failure text', r.raw);
}

// ── 4. calendarPlan_ ──────────────────────────────────────────────────────────────────────────────────────────
{
  const w = world(); const X = w.X; const P = (c, e) => X.calendarPlan_(c, e);
  const base = { action: 'create', key: 'K1', title: 'T', location: 'L' };
  ok(P(null).op === 'none' && P({ action: 'none' }).op === 'none' && P({}).op === 'none', 'none cases');
  let p = P(Object.assign({}, base, { start_iso: '2026-10-28T09:00:00-04:00', end_iso: '2026-10-28T13:00:00-04:00', all_day: false }), { order_number: 'H1-2', wo_id: 'WO-9' });
  ok(p.op === 'upsert' && p.allDay === false && p.start.toISOString() === '2026-10-28T13:00:00.000Z' && p.end.toISOString() === '2026-10-28T17:00:00.000Z', 'window => timed event', p);
  ok(p.description === 'Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett. Order H1-2, WO WO-9.\n[delivery-key:K1]', 'description wording + key marker', p.description);
  ok(p.location === 'L' && p.title === 'T' && p.key === 'K1', 'title/location/key carried');
  p = P(Object.assign({}, base, { start_iso: '2026-10-28', all_day: true }), {});
  ok(p.op === 'upsert' && p.allDay === true && p.start.getFullYear() === 2026 && p.start.getMonth() === 9 && p.start.getDate() === 28, 'date only => all-day', p);
  ok(p.description === 'Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett.\n[delivery-key:K1]', 'description without refs');
  p = P(Object.assign({}, base, { action: 'update', start_iso: '2026-10-28T09:00:00-04:00', all_day: true }));
  ok(p.allDay === true && p.start.getDate() === 28, 'all_day true with a datetime still all-day on that date');
  p = P(Object.assign({}, base, { start_iso: '2026-10-28', all_day: false }));
  ok(p.allDay === true, 'date-only start can never be timed');
  p = P(Object.assign({}, base, { start_iso: '2026-10-28T09:00:00-04:00', all_day: false }));
  ok(p.allDay === false && p.end.getTime() - p.start.getTime() === HOUR, 'timed without end => 1 hour');
  p = P(Object.assign({}, base, { start_iso: '2026-10-28T09:00:00-04:00', end_iso: '2026-10-28T08:00:00-04:00' }));
  ok(p.end.getTime() - p.start.getTime() === HOUR, 'end before start => 1 hour');
  p = P({ action: 'cancel', key: 'K1', start_iso: '2026-10-28' });
  ok(p.op === 'delete' && p.key === 'K1', 'cancel => delete');
  ok(P({ action: 'create', title: 'T', start_iso: '2026-10-28' }).op === 'invalid', 'missing key invalid');
  ok(P({ action: 'create', key: 'k', start_iso: '2026-10-28' }).op === 'invalid', 'missing title invalid');
  ok(P({ action: 'create', key: 'k', title: 't' }).op === 'invalid', 'missing start invalid');
  ok(P({ action: 'create', key: 'k', title: 't', start_iso: 'garbage' }).op === 'invalid', 'garbage start invalid');
  ok(P({ action: 'create', key: 'k', title: 't', start_iso: '2026-10-28T99:99:00' }).op === 'invalid', 'impossible time invalid');
  ok(P({ action: 'explode', key: 'k' }).op === 'invalid', 'unknown action invalid');
  ok(P({ action: 'cancel' }).op === 'invalid', 'cancel without key invalid');
}

// ── 5. trimIds_ / trimMap_ / searchQueries_ ───────────────────────────────────────────────────────────────────────
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

// ── 6. manifest ───────────────────────────────────────────────────────────────────────────────────────
{
  const need = ['https://mail.google.com/', 'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/calendar'];
  ok(need.every(s => MANIFEST.oauthScopes.includes(s)), 'manifest has all required scopes');
  ok(MANIFEST.runtimeVersion === 'V8' && MANIFEST.timeZone === 'America/New_York', 'manifest V8 + ET');
  ok(!/\bcron\b|ScriptApp\.newTrigger\([^)]*\)\.(forSpreadsheet|forForm|forUserCalendarEvents|onOpen)/.test(SRC), 'no non-time triggers in source');
  ok(!/(^|\n)\s*(var|const|let)\s+\w*(TOKEN|SECRET)\w*\s*=\s*['"][A-Za-z0-9_-]{16,}/.test(SRC), 'no hard-coded token');
}

// ── 7. setup / setToken / showToken / status ──────────────────────────────────────────────────────────────────────
{
  const w = withClock(world());
  w.run('setup');
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
  ok(w.logs.some(l => /INTAKE_TOKEN is not set yet/.test(l)), 'setup says the token is missing');
  ok(!w.logs.join('\n').includes('SECRET'), 'no token in setup logs');
  // setToken
  let threw = false; try { w.ctx.setToken('short'); } catch (e) { threw = true; }
  ok(threw && !w.props.INTAKE_TOKEN, 'setToken rejects junk');
  threw = false; try { w.ctx.setToken('has space ' + 'x'.repeat(30)); } catch (e) { threw = true; }
  ok(threw, 'setToken rejects spaces');
  w.ctx.setToken('  ' + TOKEN + '\n');
  ok(w.props.INTAKE_TOKEN === TOKEN, 'setToken stores trimmed token');
  ok(!w.logs.join('\n').includes(TOKEN) && !w.logs.join('\n').includes('tok_abc'), 'setToken does not log the token');
  w.run('showToken');
  ok(w.logs.some(l => /INTAKE_TOKEN is set: ends with \.\.\.CRET/.test(l)) && !w.logs.join('\n').includes(TOKEN), 'showToken masks the token');
  w.props.INTAKE_TOKEN = ''; w.logs.length = 0; w.run('showToken'); ok(w.logs.some(l => /NOT set/.test(l)), 'showToken says when missing');
  w.props.INTAKE_TOKEN = TOKEN;
  const s = J(w.ctx.status());
  ok(s.trigger_count === 1 && s.token_present && s.cutoff && s.mailbox === 'info@bmoremanagement.com' && s.alerts_waiting === 0, 'status reports health', s);
  w.triggers.length = 0; w.logs.length = 0; w.ctx.status();
  ok(w.logs.some(l => /PROBLEM|0 installed/.test(l)), 'status flags a missing trigger');
  w.run('setup'); w.run('removeTrigger'); ok(w.triggers.length === 0, 'removeTrigger removes it');
  // mailbox fallback
  const w2 = withClock(world({ email: '' })); w2.props.INTAKE_TOKEN = TOKEN; w2.run('setup');
  ok(w2.ctx.status().mailbox === 'unknown', 'no mailbox email => "unknown", still works');
}

// ── 8. token / setup missing => throttled alert, never silent ───────────────────────────────────────────────────────────────
{
  const w = withClock(world());
  w.hub = () => { throw new Error('should not be called'); };
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Order confirmation')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /not set up/.test(w.mails[0].subj) && /INTAKE_TOKEN is missing/.test(w.mails[0].body) && /Setup has not been run/.test(w.mails[0].body), 'missing token + setup => alert email', w.mails);
  ok(w.mails[0].to === 'info@bmoremanagement.com', 'with ALERT_EMAIL unset the alert goes to this very mailbox, never nowhere', w.mails[0].to);
  w.tick(10 * MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 1, 'throttled: no second email within the hour');
  w.tick(HOUR); w.run('processDeliveryEmails');
  ok(w.mails.length === 2, 'reminder after the hour');
  ok(w.fetches.length === 0, 'Hub never called without a token');
  ok(J(w.ctx.status().last_run).result === 'not_set_up', 'last run recorded as not_set_up');
  w.props.INTAKE_TOKEN = TOKEN; w.props.CUTOFF_MS = ''; w.tick(HOUR); w.run('processDeliveryEmails');
  ok(w.mails.length === 3 && !/INTAKE_TOKEN is missing/.test(w.mails[2].body) && /Setup has not been run/.test(w.mails[2].body), 'cutoff missing alone also alerts');
  ok(w.lockReleased >= 4, 'lock released every time');
}

// ── 9. main loop branches ───────────────────────────────────────────────────────────────────────────────────────
{ // success + calendar create + payload contract
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk() });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Thank you for your order')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && w.fetches[0].url === 'https://maintenance-hub.brett-2f8.workers.dev/intake/delivery-email', 'posted to the delivery endpoint');
  ok(w.fetches[0].o.headers['X-Auth-Token'] === TOKEN && w.fetches[0].o.method === 'post', 'token header + POST');
  const b = w.fetches[0].body;
  ok(b.message_id === '<rfc-m1@homedepot.com>' && b.mailbox === 'info@bmoremanagement.com' && b.dry_run === false && b.html === '<p>hi</p>', 'payload contract', b);
  ok(t.labels.has('Delivery/Sent to Hub') && t.labels.size === 1, 'labelled Sent to Hub', [...t.labels]);
  ok(w.events.length === 1 && w.events[0].title === 'Delivery: refrigerator (H1234-567890)' && w.events[0].allDay === false && w.events[0].location.startsWith('1109 Battery'), 'calendar event created (timed)', w.events);
  ok(w.events[0].description === 'Tenant asked to be present if able; otherwise Brett receives. Driver calls Brett. Order H1234-567890, WO WO-1300.\n[delivery-key:H1234-567890]', 'event description is the agreed wording + searchable key marker', w.events[0].description);
  ok(w.events[0].tags.deliveryKey === 'H1234-567890', 'event tagged with the key');
  ok(w.mails.length === 0, 'no email on success (Hub sends the SMS)');
  ok(JSON.parse(w.props.DELIVERY_EVENTS)['H1234-567890'].id === w.events[0].id, 'key -> event id stored');
  // second run: already done, nothing posted
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 1, 'done email is not sent again');
  // same order, new email moves the SAME event (reschedule)
  w.addThread([hdMsg('m2', '2026-10-23T16:00:00Z', 'Delivery rescheduled')]);
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'reschedule', created: false, updated: true, calendar: { action: 'update', key: 'H1234-567890', title: 'Delivery: refrigerator (H1234-567890)', start_iso: '2026-10-30', end_iso: '2026-10-30', all_day: true, location: '1109 Battery Ave' } }) });
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.events.length === 1 && w.events[0].allDay === true && w.events[0].start.getDate() === 30, 'reschedule updates the one event (timed -> all-day)', w.events.length);
  // cancel deletes it
  w.addThread([hdMsg('m3', '2026-10-23T17:00:00Z', 'Your order was cancelled')]);
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'cancel', calendar: { action: 'cancel', key: 'H1234-567890', title: 'x', start_iso: '2026-10-30', all_day: true } }) });
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.events.length === 0 && !JSON.parse(w.props.DELIVERY_EVENTS)['H1234-567890'], 'cancel deletes event and forgets the key');
  // cancel again: nothing to delete, no error
  w.addThread([hdMsg('m4', '2026-10-23T18:00:00Z', 'Cancelled again')]);
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 0, 'cancel of an unknown event is a quiet no-op');
  ok(J(w.ctx.status().counts).sent >= 4, 'counts accumulate', w.props.COUNTS);
}
{ // two different orders => two events; same key twice => one event
  const w = ready(world());
  w.hub = (b) => ({ code: 200, body: hubOk({ calendar: Object.assign(hubOk().calendar, { key: b.message_id.includes('m2') ? 'W123456789' : 'H1234-567890' }) }) });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]); w.addThread([hdMsg('m3', '2026-10-23T15:32:00Z', 'c')]);
  w.run('processDeliveryEmails');
  ok(w.events.length === 2, 'one event per calendar.key, not per email', w.events.length);
}
{ // parked => Needs Attention + email
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'unknown', parked: true, reason: 'unparseable', detail: 'no order number', created: false, calendar: { action: 'none' }, delivery_id: 'DL-77' }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Something about your order')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Needs Attention') && !t.labels.has('Delivery/Sent to Hub'), 'parked => Needs Attention only');
  ok(w.mails.length === 1 && /needs your attention/.test(w.mails[0].subj) && /DL-77/.test(w.mails[0].body) && /Needs Review/.test(w.mails[0].body), 'parked email says what happened and what to do', w.mails);
  ok(w.events.length === 0, 'no calendar for parked');
  w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1 && w.mails.length === 1, 'parked is done (no re-post, no second alert)');
}
{ // sms false / property false
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ brett_sms_sent: false, sms_status: 'twilio_off', property_matched: false }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Needs Attention') && w.mails.length === 1 && /did NOT go out/.test(w.mails[0].body) && /match the delivery address/.test(w.mails[0].body), 'sms+property problems => one email listing both');
  ok(w.events.length === 1, 'calendar still written when only SMS/property are the problem');
}
{ // not_delivery quietly ignored
  const w = ready(world());
  w.hub = () => ({ code: 200, body: { success: true, kind: 'not_delivery', created: false, duplicate: false, parked: false, calendar: { action: 'none' } } });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Fall savings on your order of mulch')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Ignored') && t.labels.size === 1 && w.mails.length === 0 && w.events.length === 0, 'not_delivery => Ignored label, no email, no event');
  w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1, 'ignored is done');
}
{ // duplicate (same email in the other mailbox, or hub already has it)
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && w.mails.length === 0 && w.events.length === 0, 'duplicate => Sent label, no alert, no calendar event');
  ok(J(w.ctx.status().counts).duplicate === 1, 'duplicate counted');
}
{ // Hub down: retry every minute, alert first time then hourly, stop hammering, then recover
  const w = ready(world());
  let down = true;
  w.hub = () => { if (down) throw new Error('DNS error ' + TOKEN); return { code: 200, body: hubOk() }; };
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 1, 'network failure stops the rest of the run (no hammering)', w.fetches.length);
  ok(w.mails.length === 1 && /NOT imported/.test(w.mails[0].subj) && /network error/.test(w.mails[0].body) && !/SECRET/.test(w.mails[0].body), 'first failure emails, token redacted', w.mails[0] && w.mails[0].body);
  ok(t.labels.has('Delivery/Needs Attention'), 'failed thread labelled Needs Attention');
  for (let i = 0; i < 30; i++) { w.tick(MIN); w.run('processDeliveryEmails'); }
  ok(w.mails.length === 1, 'no repeat email within the hour', w.mails.length);
  w.tick(35 * MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 2 && /attempt 32|attempt 3\d/.test(w.mails[1].body), 'hourly reminder', w.mails[1] && w.mails[1].body);
  ok(w.ctx.status().failing === 1, 'failing count visible in status', w.ctx.status().failing);
  down = false; w.tick(MIN); w.run('processDeliveryEmails'); w.tick(MIN); w.run('processDeliveryEmails');
  ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention'), 'recovery: Sent label, stale Needs Attention label removed');
  ok(J(w.ctx.status()).failing === 0 && w.events.length === 1, 'recovered, failing cleared, event created once');
  ok(w.fetches.filter(f => f.body.message_id === '<rfc-m1@homedepot.com>').length > 30, 'retries re-send the same RFC message id (Hub dedupes)');
}
{ // 401 token rejected
  const w = ready(world());
  w.hub = () => ({ code: 401, body: '{"error":"unauthorized"}' });
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /HTTP 401/.test(w.mails[0].body) && /token is wrong/.test(w.mails[0].body), '401 explains the token problem');
}
{ // 400 for one email does not block the next
  const w = ready(world());
  w.hub = (b) => b.message_id.includes('m1') ? { code: 400, body: '{"error":"sender_not_allowed"}' } : { code: 200, body: hubOk() };
  const t1 = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); const t2 = w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'b')]);
  w.run('processDeliveryEmails');
  ok(w.fetches.length === 2 && t2.labels.has('Delivery/Sent to Hub') && t1.labels.has('Delivery/Needs Attention'), 'a 400 on one email does not block the next');
  ok(w.mails.length === 1 && /sender_not_allowed/.test(w.mails[0].body), 'and Brett is told');
}
{ // calendar failure: email Brett, keep done, no retry, no Hub re-post
  const w = ready(world());
  w.calFail = 'create';
  w.hub = () => ({ code: 200, body: hubOk() });
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /NOT added to the calendar/.test(w.mails[0].subj) && /Calendar permission denied/.test(w.mails[0].body) && /Delivery: refrigerator/.test(w.mails[0].body) && /1109 Battery/.test(w.mails[0].body), 'calendar failure emails the event details', w.mails);
  ok(t.labels.has('Delivery/Needs Attention'), 'labelled Needs Attention');
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.fetches.length === 1 && w.mails.length === 1, 'still marked done: not re-posted, not re-alerted');
  ok(J(w.ctx.status().counts).cal_fail === 1, 'cal_fail counted');
  // invalid calendar object from the Hub
  const w2 = ready(world());
  w2.hub = () => ({ code: 200, body: hubOk({ calendar: { action: 'create', key: 'K', title: 'T', start_iso: 'junk' } }) });
  w2.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w2.run('processDeliveryEmails');
  ok(w2.mails.length === 1 && /valid start date/.test(w2.mails[0].body), 'invalid calendar data is reported, not swallowed');
  // calendar not found
  const w3 = ready(world()); w3.props.CALENDAR_ID = 'nobody@x.com';
  w3.hub = () => ({ code: 200, body: hubOk() }); w3.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w3.run('processDeliveryEmails');
  ok(w3.mails.length === 1 && /not found or this mailbox cannot edit/.test(w3.mails[0].body), 'wrong CALENDAR_ID is explained');
  // CALENDAR_ID honoured
  const w4 = ready(world()); w4.props.CALENDAR_ID = 'brett@bmoremanagement.com';
  w4.hub = () => ({ code: 200, body: hubOk() }); w4.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w4.run('processDeliveryEmails');
  ok(w4.events.length === 1 && w4.mails.length === 0, 'CALENDAR_ID calendar used');
}
{ // delete failure on cancel is reported
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk() }); w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  w.calFail = 'delete';
  w.hub = () => ({ code: 200, body: hubOk({ calendar: { action: 'cancel', key: 'H1234-567890', start_iso: '2026-10-28' } }) });
  w.addThread([hdMsg('m2', '2026-10-23T16:00:00Z', 'cancel')]); w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && /delete denied/.test(w.mails[0].body) && w.events.length === 1, 'failed calendar delete is reported and the event is kept');
}
{ // calendar duplicates after retry: Hub took it, our run died / response lost => retry must still do the calendar exactly once
  const w = ready(world());
  let n = 0;
  w.hub = () => { n++; if (n === 1) return { code: 200, body: 'timeout page' }; return { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) }; };
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.run('processDeliveryEmails');
  ok(w.events.length === 0 && w.mails.length === 1, 'attempt 1 failed (garbled answer)');
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.events.length === 1, 'retry gets "duplicate" from the Hub but still creates the calendar event (our earlier attempt owed it)', w.events.length);
  ok(t.labels.has('Delivery/Sent to Hub') && !t.labels.has('Delivery/Needs Attention'), 'then clean');
  // and now map lost: a further update for same key must not create a second event (tag lookup)
  w.props.DELIVERY_EVENTS = '{}';
  w.addThread([hdMsg('m2', '2026-10-23T16:00:00Z', 'b')]);
  w.hub = () => ({ code: 200, body: hubOk({ kind: 'window_set', created: false, updated: true, calendar: Object.assign(hubOk().calendar, { action: 'update' }) }) });
  w.tick(MIN); w.run('processDeliveryEmails');
  ok(w.events.length === 1, 'lost key map => found by tag, no duplicate event', w.events.length);
}
{ // crash after Hub success but before done saved: in-flight marker makes the retry do the calendar
  const w = ready(world());
  const t = w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  w.props.FAILS = JSON.stringify({ m1: { n: 0, inflight: true } });   // what a killed run leaves behind
  w.hub = () => ({ code: 200, body: hubOk({ duplicate: true, created: false }) });
  w.run('processDeliveryEmails');
  ok(w.events.length === 1, 'in-flight leftover => calendar done on retry');
}
{ // mailbox A and B install: same email, different Message-ID? same RFC id sent from both
  const a = ready(world({ email: 'info@bmoremanagement.com' })), b = ready(world({ email: 'brett@bmoremanagement.com' }));
  const seen = {};
  const hub = (body) => { if (seen[body.message_id]) return { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) }; seen[body.message_id] = 1; return { code: 200, body: hubOk() }; };
  a.hub = hub; b.hub = hub;
  a.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x', { rfc: '<same@homedepot.com>' })]); b.addThread([hdMsg('gb', '2026-10-23T15:30:05Z', 'x', { rfc: '<same@homedepot.com>' })]);
  a.run('processDeliveryEmails'); b.run('processDeliveryEmails');
  ok(a.fetches[0].body.message_id === b.fetches[0].body.message_id, 'both mailboxes send the same RFC Message-ID');
  ok(a.fetches[0].body.mailbox === 'info@bmoremanagement.com' && b.fetches[0].body.mailbox === 'brett@bmoremanagement.com', 'mailbox field differs');
  ok(a.events.length === 1 && b.events.length === 0, 'one calendar event total across the two mailboxes');
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
  const w2 = ready(world()); w2.hub = (b) => ({ code: 200, body: hubOk({ calendar: { action: 'none' } }) });
  for (let i = 0; i < 14; i++) w2.addThread([hdMsg('n' + String(i).padStart(2, '0'), new Date(Date.parse('2026-10-23T15:00:00Z') + (13 - i) * MIN).toISOString(), 's' + i)]);
  w2.run('processDeliveryEmails');
  ok(w2.fetches.length === 10, 'at most 10 per run', w2.fetches.length);
  ok(w2.fetches[0].body.message_id.includes('n13') && w2.fetches[9].body.message_id.includes('n04'), 'processed oldest first', w2.fetches.map(f => f.body.message_id.slice(5, 9)));
  w2.tick(MIN); w2.run('processDeliveryEmails'); ok(w2.fetches.length === 14, 'rest next run');
  // DONE_IDS cap
  const w3 = ready(world()); w3.props.DONE_IDS = JSON.stringify(Array.from({ length: 405 }, (_, i) => 'old' + i));
  w3.hub = () => ({ code: 200, body: hubOk({ calendar: { action: 'none' } }) }); w3.addThread([hdMsg('new1', '2026-10-23T15:30:00Z', 's')]); w3.run('processDeliveryEmails');
  const ids = JSON.parse(w3.props.DONE_IDS); ok(ids.length === 400 && ids[399] === 'new1', 'DONE_IDS capped at 400, newest kept', ids.length);
}
{ // stuck failing email cannot starve new mail
  const w = ready(world());
  w.hub = (b) => b.message_id.includes('bad') ? { code: 400, body: 'bad' } : { code: 200, body: hubOk({ calendar: { action: 'none' } }) };
  for (let i = 0; i < 5; i++) w.addThread([hdMsg('bad' + i, '2026-10-23T15:0' + i + ':00Z', 'bad' + i)]);
  w.run('processDeliveryEmails'); w.tick(MIN);
  w.addThread([hdMsg('good', '2026-10-23T15:20:00Z', 'good')]);
  w.run('processDeliveryEmails');
  const tried = w.fetches.slice(5).map(f => f.body.message_id);
  ok(tried.filter(x => x.includes('bad')).length === 3 && tried.some(x => x.includes('good')), 'retries capped at 3 per run, new mail still goes through', tried);
}
{ // alert email cannot be sent: kept for next run, execution fails loudly
  const w = ready(world());
  w.hub = () => ({ code: 200, body: hubOk({ parked: true, reason: 'x', calendar: { action: 'none' } }) });
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

// ── 10. dryRunLatest / testCalendar ─────────────────────────────────────────────────────────────────────────────
{
  const w = ready(world());
  w.hub = (b) => ({ code: 200, body: { success: true, kind: 'scheduled', dry_run: true } });
  w.addThread([hdMsg('d1', '2026-10-10T15:30:00Z', 'older')]); w.addThread([hdMsg('d2', '2026-10-22T15:30:00Z', 'newest')]);
  w.addThread([hdMsg('d3', '2026-10-23T15:30:00Z', 'spoof', { from: '"a@homedepot.com" <x@evil.io>' })]);
  w.run('dryRunLatest');
  ok(w.fetches.length === 1 && w.fetches[0].body.dry_run === true && w.fetches[0].body.message_id === 'DRYRUN-<rfc-d2@homedepot.com>', 'dry run sends the newest store email with dry_run true', w.fetches.map(f => f.body.message_id));
  ok(w.logs.some(l => /Hub says: .*"kind":"scheduled"/.test(l)) && w.logs.some(l => /Nothing was created/.test(l)), 'dry run logs the Hub answer');
  ok(w.events.length === 0 && w.mails.length === 0 && !w.props.DONE_IDS && !Object.keys(w.labels).length, 'dry run creates no event, email, label or done-id');
  const w2 = ready(world()); w2.props.INTAKE_TOKEN = ''; w2.run('dryRunLatest'); ok(w2.logs.some(l => /not set/.test(l)) && w2.fetches.length === 0, 'dry run without token explains');
  const w3 = ready(world()); w3.run('dryRunLatest'); ok(w3.logs.some(l => /No store email found/.test(l)), 'dry run with nothing to test says so');
  const w4 = ready(world()); w4.hub = () => ({ code: 500, body: 'x' }); w4.addThread([hdMsg('d1', '2026-10-22T15:30:00Z', 's')]); w4.run('dryRunLatest');
  ok(w4.logs.some(l => /FAILED HTTP 500/.test(l)), 'dry run shows failure');
  const c = ready(world()); ok(c.ctx.testCalendar() === true && c.events.length === 0 && c.logs.some(l => /CALENDAR OK/.test(l)), 'testCalendar creates then deletes a throwaway event');
  const c2 = ready(world()); c2.calFail = 'create'; ok(c2.ctx.testCalendar() === false && c2.logs.some(l => /CALENDAR FAILED: .*permission denied/.test(l)), 'testCalendar reports failure');
  const c3 = ready(world()); c3.props.CALENDAR_ID = 'nope'; ok(c3.ctx.testCalendar() === false, 'testCalendar: bad calendar id fails clearly');
}


// ── 11. MIRROR: one identical file in every mailbox ─────────────────────────────────────────────────────────────────────────────
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
}
// 11b. Identical behaviour in any mailbox, including an unknown third one; mailbox only comes from Session
{
  const results = {};
  for (const email of ['info@bmoremanagement.com', 'brett@bmoremanagement.com', 'Someone.New@Example-Co.org', 'ridgeco.ops@gmail.com']) {
    const w = ready(world({ email })); w.props.CALENDAR_ID = 'primary';
    w.hub = () => ({ code: 200, body: hubOk() });
    w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Thank you for your order')]);
    w.run('processDeliveryEmails');
    results[email] = { mailbox: w.fetches[0].body.mailbox, events: w.events.length, mails: w.mails.length, st: w.ctx.status(), logs: w.logs };
  }
  ok(results['info@bmoremanagement.com'].mailbox === 'info@bmoremanagement.com' && results['brett@bmoremanagement.com'].mailbox === 'brett@bmoremanagement.com', 'mailbox sent = whoever runs it');
  ok(results['Someone.New@Example-Co.org'].mailbox === 'someone.new@example-co.org', 'a third, unknown mailbox string is sent (lower-cased) and works', results['Someone.New@Example-Co.org'].mailbox);
  ok(Object.values(results).every(r => r.events === 1 && r.mails === 0), 'every mailbox: one event, no alert');
  const fps = Object.values(results).map(r => J(r.st).config_fingerprint);
  ok(new Set(fps).size === 1 && /^[0-9a-f]{8}$/.test(fps[0]), 'config fingerprint identical across mailboxes with the same Script Properties', fps);
  const w2 = ready(world()); w2.props.CALENDAR_ID = 'other'; ok(J(w2.ctx.status()).config_fingerprint !== fps[0], 'fingerprint differs when a shared setting differs');
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
}
// 11d. manifest scopes are exactly what the doc promises (a change means every mailbox must re-authorize)
{
  const expected = ['https://mail.google.com/', 'https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/script.scriptapp', 'https://www.googleapis.com/auth/script.send_mail', 'https://www.googleapis.com/auth/userinfo.email'];
  ok(JSON.stringify([...MANIFEST.oauthScopes].sort()) === JSON.stringify(expected), 'oauth scopes unchanged from v1.0 (no re-authorization needed when upgrading); userinfo.email is what Session.getActiveUser needs', MANIFEST.oauthScopes);
}

// ── 12. RFC Message-ID extraction ───────────────────────────────────────────────────────────────────────────
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

// ── 13. Hub duplicate:true is "handled": mark done, no alert, no re-post ─────────────────────────────────────────────────────────────────
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
    ok(w.events.length === 0, 'duplicate => no calendar write (the first copy did it)');
    w.tick(MIN); w.run('processDeliveryEmails'); ok(w.fetches.length === 1, 'duplicate => never re-posted');
  }
  // a forwarded/re-sent copy with a different Message-ID that the Hub recognises semantically: same handling
  const w = ready(world());
  w.hub = (b) => b.rfc_message_id.includes('first') ? { code: 200, body: hubOk() } : { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null, reason: 'same order, same values' }) };
  w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'Scheduled', { rfc: '<first@homedepot.com>' })]);
  w.addThread([hdMsg('m2', '2026-10-23T15:31:00Z', 'Scheduled (resent)', { rfc: '<resent@homedepot.com>' })]);
  w.run('processDeliveryEmails');
  ok(w.events.length === 1 && w.mails.length === 0 && J(w.ctx.status().counts).duplicate === 1 && J(w.ctx.status().counts).sent === 1, 'resent copy with new Message-ID: one event, no alert, counted as duplicate', w.ctx.status().counts);
}

// ── 14. Calendar is idempotent ACROSS scripts (find by key on the calendar itself) ──────────
const shared = () => ({ events: [], evSeq: 0 });
const mkPair = () => {
  const cal = shared();
  const A = ready(world({ email: 'info@bmoremanagement.com', cal })), B = ready(world({ email: 'brett@bmoremanagement.com', cal }));
  return { A, B, cal };
};
const calObj = (over) => Object.assign(hubOk().calendar, over || {});
{ // A creates; B (empty DELIVERY_EVENTS, never saw the event) must UPDATE it, not create a second
  const { A, B } = mkPair();
  A.hub = () => ({ code: 200, body: hubOk() });
  A.addThread([hdMsg('a1', '2026-10-23T15:30:00Z', 'Order confirmed')]); A.run('processDeliveryEmails');
  ok(A.events.length === 1 && B.events.length === 1, 'both mailboxes see the same calendar');
  B.hub = () => ({ code: 200, body: hubOk({ kind: 'window_set', created: false, updated: true, calendar: calObj({ action: 'update', start_iso: '2026-10-28T10:00:00-04:00', end_iso: '2026-10-28T14:00:00-04:00' }) }) });
  const bMapBefore = B.props.DELIVERY_EVENTS;   // B has never seen this order
  B.addThread([hdMsg('b2', '2026-10-23T16:00:00Z', 'Window set')]); B.tick(MIN * 30); B.run('processDeliveryEmails');
  ok(B.events.length === 1 && B.events[0].start.toISOString() === '2026-10-28T14:00:00.000Z', 'second mailbox updated the first mailbox\'s event instead of creating another', B.events.map(e => e.start));
  ok(bMapBefore === undefined, 'B had no per-script record of the order and did not need one');
  // reschedule far away (outside the +-3 day scan window): still the same event
  B.hub = () => ({ code: 200, body: hubOk({ kind: 'reschedule', created: false, updated: true, calendar: calObj({ action: 'update', start_iso: '2026-12-20', end_iso: '2026-12-20', all_day: true }) }) });
  B.addThread([hdMsg('b3', '2026-10-23T17:00:00Z', 'Rescheduled')]); B.tick(MIN); B.run('processDeliveryEmails');
  ok(B.events.length === 1 && B.events[0].allDay && B.events[0].start.getMonth() === 11, 'far reschedule moves the same event (found by key search, not by date)');
  // A (whose own hint is stale) cancels: removes the event B moved
  A.hub = () => ({ code: 200, body: hubOk({ kind: 'cancel', calendar: { action: 'cancel', key: 'H1234-567890', start_iso: '2026-10-28' } }) });
  A.addThread([hdMsg('a4', '2026-10-23T18:00:00Z', 'Cancelled')]); A.tick(HOUR); A.run('processDeliveryEmails');
  ok(A.events.length === 0, 'cancel from the other mailbox deletes the event wherever it now is');
  ok(A.mails.length === 0 && B.mails.length === 0, 'no alerts in this whole sequence');
}
{ // the same email in both mailboxes: Hub says duplicate to the second; still one event
  const { A, B } = mkPair(); const seen = {};
  const hub = (b) => { if (seen[b.rfc_message_id]) return { code: 200, body: hubOk({ duplicate: true, created: false, brett_sms_sent: null }) }; seen[b.rfc_message_id] = 1; return { code: 200, body: hubOk() }; };
  A.hub = hub; B.hub = hub;
  A.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x', { rfc: '<same@homedepot.com>' })]); B.addThread([hdMsg('gb', '2026-10-23T15:30:04Z', 'x', { rfc: '<same@homedepot.com>' })]);
  A.run('processDeliveryEmails'); B.run('processDeliveryEmails');
  ok(A.store.events.length === 1 && A.mails.length + B.mails.length === 0, 'S: same email in two mailboxes => one calendar event, no alerts');
  ok(A.fetches[0].body.gmail_id === 'ga' && B.fetches[0].body.gmail_id === 'gb' && A.fetches[0].body.rfc_message_id === B.fetches[0].body.rfc_message_id, 'S: different gmail_id, same rfc_message_id');
}
{ // the Hub (racing) hands BOTH scripts a non-duplicate answer: both upsert the same key => still one event
  const { A, B } = mkPair();
  A.hub = () => ({ code: 200, body: hubOk() }); B.hub = () => ({ code: 200, body: hubOk() });
  A.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x')]); B.addThread([hdMsg('gb', '2026-10-23T15:30:00Z', 'x')]);
  A.run('processDeliveryEmails'); B.run('processDeliveryEmails');
  ok(A.store.events.length === 1, 'two non-duplicate answers for one key => B finds A\'s event and updates it', A.store.events.length);
}
{ // true race: B creates between A's lookup and A's create. A re-checks after a pause and removes its extra copy
  const { A, B } = mkPair();
  A.hub = () => ({ code: 200, body: hubOk() }); B.hub = () => ({ code: 200, body: hubOk() });
  A.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x')]); B.addThread([hdMsg('gb', '2026-10-23T15:30:00Z', 'x')]);
  A.onBeforeCreate = () => B.run('processDeliveryEmails');
  A.run('processDeliveryEmails');
  ok(A.store.events.length === 1, 'race: exactly one event left on the calendar', A.store.events.map(e => e.id));
  ok(A.sleeps.length >= 1 && A.sleeps[0] === 1500, 'a short pause happens after a create so a simultaneous copy is visible', A.sleeps);
  ok(A.mails.length === 0 && B.mails.length === 0, 'race resolved without alerts');
  ok(A.store.events[0].id === 'ev1', 'survivor is the lowest event id (every copy picks the same one)', A.store.events[0].id);
  // both created before either looked (worst case): whoever re-checks next merges them
  const { A: A2, B: B2 } = mkPair();
  const mk = (title, id) => ({ id, title, start: new Date(2026, 9, 28, 9), end: new Date(2026, 9, 28, 13), allDay: false, location: 'x', description: 'd\n[delivery-key:H1234-567890]', tags: {} });
  A2.store.events.push(mk('Delivery: refrigerator (H1234-567890)', 'evZ'), mk('Delivery: refrigerator (H1234-567890)', 'evA'));
  A2.hub = () => ({ code: 200, body: hubOk({ kind: 'window_set', created: false, updated: true, calendar: calObj({ action: 'update' }) }) });
  A2.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x')]); A2.run('processDeliveryEmails');
  ok(A2.store.events.length === 1 && A2.store.events[0].id === 'evA', 'existing duplicates are merged on the next update (lowest id survives)', A2.store.events.map(e => e.id));
}
{ // calendar search misses (index lag): falls back to scanning around the date; and the tag alone is enough
  const { A, B } = mkPair();
  A.hub = () => ({ code: 200, body: hubOk() }); A.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x')]); A.run('processDeliveryEmails');
  B.searchBroken = true;
  B.hub = () => ({ code: 200, body: hubOk({ kind: 'window_set', created: false, updated: true, calendar: calObj({ action: 'update', title: 'Delivery: refrigerator (H1234-567890) NEW' }) }) });
  B.addThread([hdMsg('gb', '2026-10-23T16:00:00Z', 'y')]); B.run('processDeliveryEmails');
  ok(B.store.events.length === 1 && /NEW/.test(B.store.events[0].title), 'search returns nothing => scan near the date still finds it, no duplicate', B.store.events.length);
  // description marker alone (tag lost, e.g. someone edited the event in Google Calendar)
  A.store.events[0].tags = {};
  B.hub = () => ({ code: 200, body: hubOk({ kind: 'window_set', created: false, updated: true, calendar: calObj({ action: 'update', title: 'Delivery: refrigerator (H1234-567890) AGAIN' }) }) });
  B.addThread([hdMsg('gb2', '2026-10-23T16:30:00Z', 'z')]); B.run('processDeliveryEmails');
  ok(B.store.events.length === 1 && /AGAIN/.test(B.store.events[0].title), 'tag lost => description key marker still identifies the event');
  // key prefixes must not collide: H1-2 vs H1-23
  const C = ready(world({ cal: A.store }));
  C.hub = () => ({ code: 200, body: hubOk({ calendar: calObj({ key: 'H1234-5678', title: 'Delivery: other (H1234-5678)' }) }) });
  C.addThread([hdMsg('gc', '2026-10-23T16:40:00Z', 'w')]); C.run('processDeliveryEmails');
  ok(A.store.events.length === 2, 'a key that is only a prefix of another key is a different event', A.store.events.map(e => e.title));
}
{ // cancel removes only events that carry the key; unrelated events are never touched
  const { A } = mkPair();
  A.store.events.push({ id: 'evOTHER', title: 'Dentist', start: new Date(2026, 9, 28, 9), end: new Date(2026, 9, 28, 10), allDay: false, description: 'order H1234-567890 mentioned but no marker', tags: {} });
  A.hub = () => ({ code: 200, body: hubOk() }); A.addThread([hdMsg('ga', '2026-10-23T15:30:00Z', 'x')]); A.run('processDeliveryEmails');
  A.hub = () => ({ code: 200, body: hubOk({ kind: 'cancel', calendar: { action: 'cancel', key: 'H1234-567890', start_iso: '2026-10-28' } }) });
  A.addThread([hdMsg('ga2', '2026-10-23T16:30:00Z', 'x')]); A.tick(MIN); A.run('processDeliveryEmails');
  ok(A.store.events.length === 1 && A.store.events[0].id === 'evOTHER', 'cancel removes only events carrying the key marker/tag');
}

// ── 15. Script Property size limits (9 KB per value) ─────────────────────────────────────────────────────────────────
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
  // DONE_IDS with long-ish ids and DELIVERY_EVENTS with many orders
  const d = ready(world()); d.props.DONE_IDS = JSON.stringify(Array.from({ length: 399 }, (_, i) => '18c3f5a2b4d6e8' + String(i).padStart(4, '0') + 'ffff'));
  d.hub = (b) => ({ code: 200, body: hubOk({ calendar: calObj({ key: 'H' + b.gmail_id.padEnd(30, 'k') }) }) });
  for (let i = 0; i < 70; i++) d.addThread([hdMsg('n' + String(i).padStart(3, '0') + 'x'.repeat(30), new Date(Date.parse('2026-10-23T15:00:00Z') + i * 1000).toISOString(), 's' + i)]);
  for (let run = 0; run < 8; run++) { d.tick(MIN); d.run('processDeliveryEmails'); }
  ok(Buffer.byteLength(d.props.DONE_IDS) <= 8500 && Buffer.byteLength(d.props.DELIVERY_EVENTS) <= 8500, 'DONE_IDS and DELIVERY_EVENTS stay under the limit', [Buffer.byteLength(d.props.DONE_IDS), Buffer.byteLength(d.props.DELIVERY_EVENTS)]);
  ok(!d.mails.some(m => /script error/.test(m.subj)), 'no storage exception along the way', d.mails.map(m => m.subj));
  ok(Object.keys(JSON.parse(d.props.DELIVERY_EVENTS)).length <= 40, 'event hints capped (the calendar itself is the source of truth)');
  ok(w.X.utf8Len_('aé€😀') === 1 + 2 + 3 + 4, 'utf8Len_ counts bytes');
}

// ── 16. Shared settings: ALERT_EMAIL, setConfig, status ───────────────────────────────────────────────────────────────────────────
{
  const w = ready(world({ email: 'info@bmoremanagement.com' })); w.props.ALERT_EMAIL = 'Boss@Example.org';
  w.hub = () => ({ code: 500, body: 'down' }); w.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); w.run('processDeliveryEmails');
  ok(w.mails.length === 1 && w.mails[0].to === 'boss@example.org', 'alerts go to ALERT_EMAIL', w.mails[0] && w.mails[0].to);
  ok(/\(info@bmoremanagement\.com\)$/.test(w.mails[0].subj) && /running in info@bmoremanagement\.com/.test(w.mails[0].body), 'subject/footer say which mailbox copy sent it');
  const b = ready(world({ email: 'brett@bmoremanagement.com' })); b.props.ALERT_EMAIL = 'not an email';
  b.hub = () => ({ code: 500, body: 'down' }); b.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]); b.run('processDeliveryEmails');
  ok(b.mails.length === 2 && b.mails.every(m => m.to === 'brett@bmoremanagement.com') && /ALERT_EMAIL is not set/.test(b.mails[0].subj), 'invalid ALERT_EMAIL => warned, alerts fall back to this mailbox (never nowhere)', b.mails.map(m => m.subj));
  const u = ready(world({ email: '' })); u.props.ALERT_EMAIL = ''; u.hub = () => ({ code: 500, body: 'down' }); u.addThread([hdMsg('m1', '2026-10-23T15:30:00Z', 'a')]);
  let threw = false; try { u.run('processDeliveryEmails'); } catch (e) { threw = true; }
  ok(threw, 'no ALERT_EMAIL and no mailbox address: fails loudly (execution error) instead of silently');
  // setConfig
  const c = withClock(world());
  c.ctx.setConfig('# comment\nINTAKE_TOKEN=' + TOKEN + '\nCALENDAR_ID = shared-cal@group.calendar.google.com\n\nALERT_EMAIL="Alerts@Example.org"\nSENDER_DOMAINS=homedepot.com, lowes.com');
  ok(c.props.INTAKE_TOKEN === TOKEN && c.props.CALENDAR_ID === 'shared-cal@group.calendar.google.com' && c.props.ALERT_EMAIL === 'alerts@example.org' && c.props.SENDER_DOMAINS === 'homedepot.com, lowes.com', 'setConfig saves the block', c.props);
  ok(!c.logs.join('\n').includes(TOKEN) && c.logs.some(l => /Saved INTAKE_TOKEN \(\d+ characters/.test(l)), 'setConfig never prints the token');
  const c2 = withClock(world()); let msg = '';
  try { c2.ctx.setConfig('INTAKE_TOKEN=short\nCALENDAR_ID=x\nFOO=bar\nALERT_EMAIL=nope\nnonsense'); } catch (e) { msg = String(e.message); }
  ok(/Nothing was saved/.test(msg) && /INTAKE_TOKEN/.test(msg) && /unknown setting FOO/.test(msg) && /ALERT_EMAIL is not an email/.test(msg) && /expected KEY=VALUE/.test(msg) && Object.keys(c2.props).length === 0, 'setConfig is all-or-nothing and says what is wrong', msg);
  let m2 = ''; try { c2.ctx.setConfig(''); } catch (e) { m2 = String(e.message); } ok(/no KEY=VALUE/.test(m2), 'empty block rejected');
  const pc = c2.X.parseConfig_('ALERT_EMAIL=a@b.co\nCALENDAR_ID=primary');
  ok(J(pc).errors.length === 0 && pc.values.CALENDAR_ID === 'primary', 'parseConfig_ is pure and exported');
  // status shows where alerts go
  c.run('setup'); const st = J(c.ctx.status()); ok(st.alert_email === 'alerts@example.org' && c.logs.some(l => /Alert emails go to: alerts@example\.org/.test(l)), 'status shows the alert address');
  const nw = withClock(world()); nw.ctx.status(); ok(nw.logs.some(l => /NOT SET/.test(l)), 'status warns when ALERT_EMAIL is missing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
