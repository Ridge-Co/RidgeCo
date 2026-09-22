// Offline harness for ReceiptMailToHub.gs — fakes GmailApp / Gmail API / DriveApp / SpreadsheetApp
// etc. closely enough to run setup(), processQueue(), weeklyDiscovery(), weeklyDigest() end to end
// across TWO mailboxes (brett@, info@) sharing one sheet and one Drive folder.
// Run: node test/receipt-mail-to-hub.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(here, '..', 'ReceiptMailToHub.gs'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; } else { fail++; console.log('  FAIL:', msg); } };

// ── Shared world: Drive + Sheets are shared between mailboxes; Gmail is per mailbox ──────────
const FOLDER_ID = '1-sf6pQN2DD3qj5cPZavy1k0DOfH4U20n';
function makeWorld() {
  return { files: [], sheets: {}, sheetShares: [], mailSent: [], now: new Date('2026-09-22T18:00:00Z') };
}
function blob(name, type, size, content = 'x') {
  return {
    _name: name, _type: type, _size: size, _content: content,
    getName() { return this._name; }, setName(n) { this._name = n; return this; },
    getContentType() { return this._type; }, getSize() { return this._size; },
    copyBlob() { return blob(this._name, this._type, this._size, this._content); },
    getAs(t) { return blob(this._name, t, this._size, 'PDF(' + this._content + ')'); },
  };
}
// Minimal Gmail search evaluator for the query shapes the script builds.
function evalQuery(q, msg, labelsOf, now) {
  let rest = q;
  const take = (re) => { const out = []; rest = rest.replace(re, (...m) => { out.push(m); return ' '; }); return out; };
  for (const m of take(/-label:([\w-]+)/g)) if (labelsOf(msg).some(l => l.toLowerCase().replace(/[\/\s]+/g, '-') === m[1])) return false;
  for (const m of take(/from:\(([^)]*)\)/g)) { if (!msg.fromAddr.toLowerCase().endsWith(m[1].toLowerCase())) return false; }
  for (const m of take(/after:(\d{4})\/(\d{2})\/(\d{2})/g)) if (msg.date < new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00-04:00`)) return false;
  for (const m of take(/newer_than:(\d+)d/g)) if (now - msg.date > Number(m[1]) * 86400000) return false;
  const orGroup = take(/\(filename:pdf OR subject:\(([^)]*)\)\)/g);
  for (const m of orGroup) {
    const kws = m[1].match(/"[^"]+"|\S+/g).filter(w => w !== 'OR').map(w => w.replace(/"/g, '').toLowerCase());
    const hasPdf = msg.attachments.some(a => /pdf/.test(a._type));
    if (!hasPdf && !kws.some(k => msg.subject.toLowerCase().includes(k))) return false;
  }
  for (const m of take(/subject:\(([^)]*)\)/g)) {
    const words = m[1].toLowerCase().split(/\s+/).filter(Boolean);
    const subj = msg.subject.toLowerCase();
    if (!words.every(w => subj.includes(w))) return false;
  }
  if (/-label:newsletters/.test(q) && msg.promo) return false;
  return true;
}

function makeMailbox(world, email, fixtures) {
  const labels = {};        // name -> Set(threadId)
  const threads = {};       // id -> {id, messages:[]}
  const filters = [];
  let filterSeq = 0;
  for (const f of fixtures) {
    const t = threads[f.threadId] || (threads[f.threadId] = { id: f.threadId, messages: [] });
    t.messages.push(f);
  }
  const labelsOfThread = (t) => Object.keys(labels).filter(n => labels[n].has(t.id));
  const labelObj = (name) => ({
    getName: () => name,
    getThreads: (s, n) => Object.values(threads).filter(t => labels[name].has(t.id)).slice(s, s + n).map(threadObj),
    addToThreads: (arr) => arr.forEach(t => labels[name].add(t._t.id)),
  });
  const msgObj = (m) => ({
    _m: m,
    getId: () => m.id, getFrom: () => m.from, getSubject: () => m.subject, getDate: () => m.date,
    getBody: () => m.html || '', getPlainBody: () => m.text || '',
    getHeader: (h) => h === 'Message-ID' ? m.rfc : '',
    getAttachments: (opts) => m.attachments.filter(a => !(opts && opts.includeInlineImages === false && a.inline)),
  });
  const threadObj = (t) => ({
    _t: t,
    getMessages: () => t.messages.map(msgObj),
    removeLabel: (l) => labels[l.getName()].delete(t.id),
    addLabel: (l) => labels[l.getName()].add(t.id),
  });
  // Filters apply to newly "arriving" mail
  const deliver = (m) => {
    const t = threads[m.threadId] || (threads[m.threadId] = { id: m.threadId, messages: [] });
    t.messages.push(m);
    for (const f of filters) {
      const fromOk = m.fromAddr.toLowerCase().endsWith(f.criteria.from.toLowerCase());
      const subjOk = !f.criteria.subject || f.criteria.subject.toLowerCase().split(/\s+/).every(w => m.subject.toLowerCase().includes(w));
      if (fromOk && subjOk) for (const id of f.action.addLabelIds) labels[id.replace(/^LBL:/, '')].add(t.id);
    }
  };
  const props = {};
  const triggers = [];
  const ctx = {
    console, Date, JSON, Math, Object, String, Number, Array, RegExp, Error, encodeURIComponent,
    Session: { getActiveUser: () => ({ getEmail: () => email }) },
    Logger: { log: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
    Utilities: {
      formatDate: (d, tz, f) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).reduce((a, x) => (a[x.type] = x.value, a), {});
        return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
      newBlob: (content, type, name) => blob(name, type, content.length, content),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(), deleteTrigger: t => triggers.splice(triggers.indexOf(t), 1),
      WeekDay: { MONDAY: 'MON' },
      newTrigger: (fn) => { const t = { fn }; const b = { timeBased: () => b, everyMinutes: () => b, onWeekDay: () => b, atHour: () => b, create: () => { triggers.push(t); return t; } }; return b; },
    },
    MailApp: { sendEmail: (o) => world.mailSent.push({ from: email, ...o }) },
    GmailApp: {
      getUserLabelByName: (n) => labels[n] ? labelObj(n) : null,
      createLabel: (n) => { labels[n] = labels[n] || new Set(); return labelObj(n); },
      search: (q, s, n) => Object.values(threads)
        .filter(t => t.messages.some(m => evalQuery(q, m, () => labelsOfThread(t), world.now)))
        .slice(s, s + n).map(threadObj),
    },
    Gmail: { Users: {
      Labels: { list: () => ({ labels: Object.keys(labels).map(n => ({ name: n, id: 'LBL:' + n })) }) },
      Settings: { Filters: {
        list: () => ({ filter: filters.slice() }),
        create: (f) => { const r = { id: 'F' + (++filterSeq), ...f }; filters.push(r); return r; },
        remove: (_me, id) => { const i = filters.findIndex(f => f.id === id); if (i >= 0) filters.splice(i, 1); },
      } } } },
    DriveApp: {
      getFolderById: (id) => {
        if (id !== FOLDER_ID) throw new Error('no access');
        return {
          getName: () => 'Receipts and Invoices',
          getFilesByName: (n) => { const hits = world.files.filter(f => f.name === n); let i = 0; return { hasNext: () => i < hits.length, next: () => ({ getId: () => hits[i++].id }) }; },
          createFile: (b) => {
            if (world.failCreate && world.failCreate > 0) { world.failCreate--; throw new Error('Drive hiccup'); }
            const f = { id: 'D' + (world.files.length + 1), name: b.getName(), type: b.getContentType(), content: b._content, by: email };
            world.files.push(f);
            return { getId: () => f.id, setDescription: (d) => { f.desc = d; } };
          },
        };
      },
      searchFiles: () => { const ids = Object.keys(world.sheets); let i = 0; return { hasNext: () => i < ids.length, next: () => ({ getId: () => ids[i++] }) }; },
      getFileById: (id) => ({ addEditor: (e) => world.sheetShares.push(e) }),
    },
    SpreadsheetApp: {
      create: (name) => { const id = 'S1'; world.sheets[id] = makeSpreadsheet(id, name); return world.sheets[id]; },
      openById: (id) => { if (!world.sheets[id]) throw new Error('nope'); return world.sheets[id]; },
      newDataValidation: () => { const b = { requireValueInList: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; },
    },
  };
  ctx.module = { exports: {} };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return { ctx, labels, threads, filters, triggers, props, deliver, labelsOfThread, email };
}

function makeSpreadsheet(id, name) {
  const tabs = {};
  const mkTab = (n) => {
    const rows = [];
    const tab = {
      _rows: rows,
      setName: (nn) => { delete tabs[n]; tabs[nn] = tab; n = nn; return tab; },
      getRange: (a, b, c, d) => {
        if (typeof a === 'string') return { setNumberFormat: () => {} };
        return {
          setValues: (v) => { for (let i = 0; i < v.length; i++) { rows[a - 1 + i] = rows[a - 1 + i] || []; for (let j = 0; j < v[i].length; j++) rows[a - 1 + i][b - 1 + j] = v[i][j]; } return { setFontWeight: () => {} }; },
          setValue: (v) => { rows[a - 1] = rows[a - 1] || []; rows[a - 1][b - 1] = v; },
          setDataValidation: () => {},
          setFontWeight: () => {},
        };
      },
      setFrozenRows: () => {},
      appendRow: (r) => rows.push(r.slice()),
      getLastRow: () => rows.length,
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
    };
    return tab;
  };
  tabs['Sheet1'] = mkTab('Sheet1');
  return {
    _tabs: tabs, getId: () => id, getUrl: () => 'https://docs.google.com/spreadsheets/d/' + id,
    getSheets: () => Object.values(tabs),
    insertSheet: (n) => (tabs[n] = mkTab(n)),
    getSheetByName: (n) => tabs[n],
  };
}

// ── Fixtures (shapes mirror the real emails seen in brett@ on Sep 22 2026) ───────────────────
const D = (s) => new Date(s);
const pdf = (n = 'eReceipt.pdf') => blob(n, 'application/pdf', 90000);
function hd(id, date, rfc, to = 'brett') { return { id, threadId: 't' + id, from: 'The Home Depot <HomeDepot@order.homedepot.com>', fromAddr: 'HomeDepot@order.homedepot.com', subject: 'Your Electronic Receipt', date: D(date), rfc, attachments: [pdf()], html: '<p>HD</p>' }; }
const lowesReady = (id, date, n) => ({ id, threadId: 't' + id, from: "Lowe's <do-not-reply@notifications.lowes.com>", fromAddr: 'do-not-reply@notifications.lowes.com', subject: `Your Order is Ready for Pick Up at Catonsville Lowe's! (#${n})`, date: D(date), rfc: '<' + id + '@lowes>', attachments: [blob('logo.png', 'image/png', 4000)], html: '<p>Order ' + n + ' smoke detectors QTY 5</p>' });
const amazonOrdered = (id, date, subj) => ({ id, threadId: 't' + id, from: 'Amazon.com <auto-confirm@amazon.com>', fromAddr: 'auto-confirm@amazon.com', subject: subj, date: D(date), rfc: '<' + id + '@amazon>', attachments: [], html: '<p>Order total $54.10</p>' });
const promo = { id: 'p1', threadId: 'tp1', from: 'HD <homedepotcustomercare@mg.homedepot.com>', fromAddr: 'homedepotcustomercare@mg.homedepot.com', subject: 'Your order of savings: Super Savings', date: D('2026-09-20'), rfc: '<p1>', attachments: [], promo: true };

const brettFixtures = [
  hd('hdJun30', '2026-06-30T23:07:00Z', '<hd-jun30@hd>'),           // before Backfill_Since → not pulled
  hd('hdAug05', '2026-08-05T15:00:00Z', '<hd-aug05@hd>'),           // pulled by backfill
  lowesReady('lw1', '2026-09-17T17:58:06Z', '300901260260205481'),
  lowesReady('lw2', '2026-09-17T15:01:53Z', '300901260260138631'),
  amazonOrdered('am1', '2026-07-19T15:19:17Z', 'Ordered: ⁦1⁩ Automotive item'),
  amazonOrdered('am2', '2026-07-08T00:55:47Z', 'Ordered: "Mobil 1 High Mileage Full..." and ⁦2⁩ more items'),
  promo,
];
const infoFixtures = [
  hd('iHdAug05', '2026-08-05T15:00:00Z', '<hd-aug05@hd>'),          // SAME email delivered to info@ too
  hd('iHdSep10', '2026-09-10T13:00:00Z', '<hd-sep10@hd>'),          // only in info@
];

// ── 1. Pure helpers ────────────────────────────────────────────────────────────────────────────────
{
  const world = makeWorld(); const mb = makeMailbox(world, 'brett@bmoremanagement.com', []);
  const X = mb.ctx.module.exports;
  const rules = [
    { Rule_ID: 'R1', Status: 'Approved', From: 'HomeDepot@order.homedepot.com', Subject_Contains: 'Electronic Receipt' },
    { Rule_ID: 'R2', Status: 'Pending', From: 'lowes.com', Subject_Contains: 'order confirmation' },
    { Rule_ID: 'R3', Status: 'Approved', From: '@amazon.com', Subject_Contains: '' },
  ];
  ok(X.matchRule_(rules, 'The Home Depot <homedepot@ORDER.homedepot.com>', 'Your Electronic Receipt')?.Rule_ID === 'R1', 'HD matches case-insensitively');
  ok(!X.matchRule_(rules, 'The Home Depot <HomeDepot@order.homedepot.com>', 'Your order has shipped'), 'HD non-receipt subject does not match');
  ok(!X.matchRule_(rules, 'x <a@notifications.lowes.com>', "Lowe's Order Confirmation"), 'Pending rule ignored for sending');
  ok(X.matchRule_(rules, 'x <a@notifications.lowes.com>', "Lowe's Order Confirmation", true)?.Rule_ID === 'R2', 'Pending rule counts for discovery suppression (subdomain match)');
  ok(!X.matchRule_(rules, 'x <a@notlowes.com>', 'Order Confirmation', true), 'domain rule does not match a look-alike domain');
  ok(X.matchRule_(rules, 'Amazon <shipment-tracking@amazon.com>', 'anything')?.Rule_ID === 'R3', 'domain rule with blank subject matches any subject');
  ok(X.subjectPattern_('Ordered: ⁦1⁩ Automotive item') === 'Ordered: Automotive item', 'Amazon count stripped: ' + X.subjectPattern_('Ordered: ⁦1⁩ Automotive item'));
  ok(X.subjectPattern_('Ordered: "Mobil 1 High Mileage Full..." and ⁦2⁩ more items') === 'Ordered:', 'Amazon product name stripped: ' + X.subjectPattern_('Ordered: "Mobil 1 High Mileage Full..." and ⁦2⁩ more items'));
  ok(X.subjectPattern_("Your Order is Ready for Pick Up at Catonsville Lowe's! (#300901260260205481)") === "Your Order is Ready for Pick Up at Catonsville Lowe's!", 'Lowes order # stripped');
  ok(X.subjectPattern_('You’ve been assigned to pick up Lowe’s order # 300901260260205481 ') === 'You’ve been assigned to pick up Lowe’s order', 'Lowes assigned pattern: ' + X.subjectPattern_('You’ve been assigned to pick up Lowe’s order # 300901260260205481 '));
  ok(X.subjectPattern_("Brett's order at Lowe's is ready") === "Brett's order at Lowe's is ready", 'apostrophes are not treated as quotes');
  ok(X.storeFromSender_('x <HomeDepot@order.homedepot.com>') === 'HomeDepot' && X.storeFromSender_('a@notifications.lowes.com') === 'Lowes' && X.storeFromSender_('a@ferguson.com') === 'Ferguson', 'store names');
  ok(X.labelQ_('Receipts/Sent to Hub') === 'label:receipts-sent-to-hub', 'label query form');
  ok(X.normStatus_(' approved ') === 'Approved' && X.normStatus_('') === 'Pending' && X.normStatus_('DENIED') === 'Denied', 'status normalization');
}

// ── 2. brett@ setup: sheet, seed rules, filters, backfill, discovery ─────────────────────────
const world = makeWorld();
const brett = makeMailbox(world, 'brett@bmoremanagement.com', brettFixtures);
const msg1 = brett.ctx.setup();
const ss = world.sheets.S1;
const ruleRows = () => ss._tabs.Rules._rows.slice(1).map(r => Object.fromEntries(ss._tabs.Rules._rows[0].map((h, i) => [h, r[i]])));
const logRows = () => ss._tabs.Log._rows.slice(1).map(r => Object.fromEntries(ss._tabs.Log._rows[0].map((h, i) => [h, r[i]])));
ok(!!ss && ss._tabs.Rules && ss._tabs.Config && ss._tabs.Log, 'sheet created with Rules/Config/Log');
ok(world.sheetShares.includes('info@bmoremanagement.com'), 'sheet shared with info@');
ok(brett.filters.length === 2 && brett.filters.every(f => f.action.addLabelIds[0] === 'LBL:Receipts/To Hub'), 'two HD Gmail filters created → To Hub label');
ok(brett.labels['Receipts/To Hub'].has('thdAug05') && !brett.labels['Receipts/To Hub'].has('thdJun30'), 'backfill labeled Aug 5, not Jun 30 (before Backfill_Since)');
ok(brett.triggers.map(t => t.fn).sort().join() === 'processQueue,weeklyDigest,weeklyDiscovery', 'brett@ triggers incl. digest');
const pend = ruleRows().filter(r => r.Status === 'Pending');
ok(pend.length === 3, 'discovery: 3 pending patterns (Lowes ready ×1 pattern, Amazon Ordered: ×2 patterns) — got ' + pend.map(r => r.From + '|' + r.Subject_Contains).join(' ; '));
ok(pend.some(r => r.From === 'do-not-reply@notifications.lowes.com' && Number(r.Count_Seen) === 2), 'two Lowes pickup emails grouped into one candidate');
ok(!ruleRows().some(r => /mg\.homedepot/.test(r.From)), 'promo/newsletter not proposed');
ok(!ruleRows().some(r => r.From === 'HomeDepot@order.homedepot.com' && r.Status === 'Pending'), 'already-approved HD not re-proposed');
ok(/past emails queued \(since 2026\/07\/01\): 1/.test(msg1), 'setup summary: ' + msg1.split('\n')[2]);

// ── 3. processQueue moves the HD receipt to Drive, once ──────────────────────────────────────
let r = brett.ctx.processQueue();
ok(r.saved === 1 && world.files.length === 1, 'one file saved');
ok(world.files[0].name === '2026-08-05_HomeDepot_hdAug05.pdf' && /pdf/.test(world.files[0].type), 'file name/type: ' + world.files[0].name);
ok(/Mailbox: brett@/.test(world.files[0].desc) && /#all\/hdAug05/.test(world.files[0].desc), 'Drive description links back to the email');
ok(brett.labels['Receipts/Sent to Hub'].has('thdAug05') && !brett.labels['Receipts/To Hub'].has('thdAug05'), 'thread moved To Hub → Sent to Hub');
ok(logRows().length === 1 && logRows()[0].Result === 'saved' && logRows()[0].Rule_ID === 'R1', 'log row written');
r = brett.ctx.processQueue();
ok(world.files.length === 1 && logRows().length === 1, 're-run is a no-op');

// ── 4. new HD email arriving later → filter labels it → next run saves it ────────────────────
brett.deliver(hd('hdSep21', '2026-09-21T20:00:00Z', '<hd-sep21@hd>'));
ok(brett.labels['Receipts/To Hub'].has('thdSep21'), 'live filter labeled the new arrival');
brett.ctx.processQueue();
ok(world.files.length === 2 && world.files[1].name === '2026-09-21_HomeDepot_hdSep21.pdf', 'new arrival saved');

// ── 5. info@ install: reuses sheet, skips the email brett@ already sent (same Message-ID) ────
const info = makeMailbox(world, 'info@bmoremanagement.com', infoFixtures);
info.ctx.setup();
ok(Object.keys(world.sheets).length === 1, 'info@ found the shared sheet, did not create a second');
ok(info.triggers.map(t => t.fn).sort().join() === 'processQueue,weeklyDiscovery', 'info@ has no digest trigger (one email a week, from brett@ only)');
ok(info.filters.length === 2, 'info@ got its own HD filters');
info.ctx.processQueue();
const infoFiles = world.files.filter(f => f.by === 'info@bmoremanagement.com');
ok(infoFiles.length === 1 && infoFiles[0].name === '2026-09-10_HomeDepot_iHdSep10.pdf', 'info@ saved only the Sep 10 receipt, not the Aug 5 duplicate: ' + infoFiles.map(f => f.name));
ok(info.labels['Receipts/Sent to Hub'].has('tiHdAug05'), 'duplicate still cleared out of the queue label');

// ── 6. Approve the Lowes candidate → filter + backfill + HTML→PDF (logo skipped) ─────────────
const lowesRow = ss._tabs.Rules._rows.findIndex(row => row[2] === 'do-not-reply@notifications.lowes.com');
ss._tabs.Rules._rows[lowesRow][1] = 'Approved';
ss._tabs.Rules._rows[lowesRow][3] = 'Ready for Pick Up';          // Brett shortens the subject before approving
brett.ctx.processQueue();
ok(brett.filters.some(f => f.criteria.from === 'do-not-reply@notifications.lowes.com' && f.criteria.subject === 'Ready for Pick Up'), 'Lowes filter created on approval');
const lowesFiles = world.files.filter(f => /Lowes/.test(f.name));
ok(lowesFiles.length === 2 && lowesFiles.every(f => /pdf/.test(f.type) && /PDF\(<html>/.test(f.content)), 'both Lowes emails rendered to PDF (4KB logo ignored)');
ok(lowesFiles.every(f => /From: Lowe/.test(f.content) && /Subject: Your Order is Ready/.test(f.content)), 'rendered PDF carries the From/Subject header');

// ── 7. Deny Amazon → filter never made; turning an approved rule off removes its filter ──────
ss._tabs.Rules._rows.forEach(row => { if (row[2] === 'auto-confirm@amazon.com') row[1] = 'Denied'; });
ss._tabs.Rules._rows[lowesRow][1] = 'Denied';
brett.ctx.processQueue();
ok(!brett.filters.some(f => /amazon|lowes/.test(f.criteria.from)), 'denied/unapproved rules have no Gmail filter');
const before = ruleRows().length;
brett.ctx.weeklyDiscovery();
ok(ruleRows().length === before, 'weekly discovery does not re-propose denied senders');

// ── 8. Manual tag (vendor forwarding an HD order screenshot, then a reply) ───────────────────
const phoenix = [
  { id: 'ph1', threadId: 'tph', from: 'Mark <phoenixestatesmaryland@gmail.com>', fromAddr: 'phoenixestatesmaryland@gmail.com', subject: '1599 Ingleside tub drain kit', date: D('2026-09-03T01:33:42Z'), rfc: '<ph1>', attachments: [blob('Screenshot.png', 'image/png', 300000)] },
  { id: 'ph2', threadId: 'tph', from: 'Brett <brett@bmoremanagement.com>', fromAddr: 'brett@bmoremanagement.com', subject: 'Re: 1599 Ingleside tub drain kit', date: D('2026-09-03T12:00:00Z'), rfc: '<ph2>', attachments: [], html: '<p>thanks</p>' },
];
phoenix.forEach(m => brett.deliver(m));
brett.labels['Receipts/To Hub'].add('tph');                      // Brett applies the label by hand
brett.ctx.processQueue();
const phFiles = world.files.filter(f => /ph1|ph2/.test(f.name));
ok(phFiles.length === 1 && /\.png$/.test(phFiles[0].name) && /_Manual_ph1/.test(phFiles[0].name), 'manual tag: only the email with the screenshot saved: ' + phFiles.map(f => f.name));
ok(logRows().some(l => l.Gmail_Message_ID === 'ph2' && l.Result === 'skipped'), 'the plain reply logged as skipped');

// ── 9. Drive error: retried, then parked under Hub Error after 3 tries ───────────────────────
brett.deliver(hd('hdErr', '2026-09-22T10:00:00Z', '<hd-err@hd>'));
world.failCreate = 1;
brett.ctx.processQueue();
ok(brett.labels['Receipts/To Hub'].has('thdErr') && !world.files.some(f => /hdErr/.test(f.name)), 'first failure: stays queued for retry');
brett.ctx.processQueue();
ok(world.files.some(f => /hdErr/.test(f.name)) && brett.labels['Receipts/Sent to Hub'].has('thdErr'), 'retry succeeds and clears');
brett.deliver(hd('hdErr2', '2026-09-22T11:00:00Z', '<hd-err2@hd>'));
world.failCreate = 3;
brett.ctx.processQueue(); brett.ctx.processQueue(); brett.ctx.processQueue();
ok(brett.labels['Receipts/Hub Error'].has('thdErr2') && !brett.labels['Receipts/To Hub'].has('thdErr2'), 'after 3 failures: moved to Hub Error, stops retrying');
const errCount = logRows().filter(l => l.Gmail_Message_ID === 'hdErr2').length;
brett.ctx.processQueue();
ok(logRows().filter(l => l.Gmail_Message_ID === 'hdErr2').length === errCount, 'no 4th attempt');

// ── 10. Monday digest ────────────────────────────────────────────────────────────────────────────────────
ss._tabs.Rules._rows.push(['', 'Pending', 'orders@ferguson.com', 'Invoice', '', 'manual', '', '', '', '', '']);   // hand-typed row, no ID
brett.ctx.weeklyDigest();
const mail = world.mailSent.at(-1);
ok(mail && mail.to === 'brett@bmoremanagement.com' && /Receipt senders to approve \(\d+\)/.test(mail.subject), 'digest emailed to brett@');
ok(/orders@ferguson\.com/.test(mail.htmlBody) && /R\d+/.test(ss._tabs.Rules._rows.at(-1)[0]), 'hand-typed row got an ID and shows in the digest');
ok(/error/.test(mail.htmlBody), 'digest mentions the week\'s errors');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
