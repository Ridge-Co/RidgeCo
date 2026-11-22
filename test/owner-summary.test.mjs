// Queue #122 (Phase 1): the monthly owner summary email. Pure builders + the send/skip/save flow with stubbed storage.
// Run: node test/owner-summary.test.mjs
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || new URL('../worker.js', import.meta.url), 'utf8');
function grab(name, isAsync) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return (isAsync ? 'async ' : '') + src.slice(i, j + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const names = ['ownerSummaryDay', 'ownerSummaryNiceDate', 'ownerSummaryPrevMonth', 'ownerSummaryMonthLabel', 'ownerSummaryCollect', 'ownerSummaryHtml', 'ownerSummaryScrub', 'ownerSummaryBuildDraft', 'ownerSummaryOn', 'isHiddenBidCopy', 'woJobLabel', '_escHtml', 'schedErrText', 'ownerSummaryView'];
const asyncNames = ['ownerSummaryTabRows', 'ownerSummaryAddVerified', 'ownerSummaryBuild', 'ownerSummaryList', 'ownerSummaryRowOrError', 'ownerSummarySave', 'ownerSummarySkip', 'ownerSummaryTestSend', 'ownerSummarySend'];
const consts = ["const OWNER_SUMMARY_TAB = 'Owner_Summaries';", src.match(/const OWNER_SUMMARY_COLS = [^;]*;/)[0], "const OWNER_SUMMARY_SLICE = 20;", "const OWNER_SUMMARY_PORTAL_URL = 'https://ridge-co.github.io/RidgeCo/owner.html';",
  src.slice(src.indexOf('const OWNER_SUMMARY_STATUS_WORDS'), src.indexOf('// PURE.', src.indexOf('const OWNER_SUMMARY_STATUS_WORDS')))];
const woStatus = 'const WOStatus = { sets: { DEAD: ["Cancelled","Declined"], OPEN_WORK: ["New","Estimate Requested","Assigned","Accepted","In Progress","On Hold"] } };';
const make = new Function('S', 'const { json, etTodayISO, ensureColumns, fetchTabs, fetchTab, ensureTab, invalidateTabCache, addRow, updateRowVerified, fetchConfig, gmailSendEmail, logTelemetry, reportFailure, isStaging } = S;\n' + woStatus + '\n' + consts.join('\n') + '\n' +
  names.map(n => grab(n)).join('\n') + '\n' + asyncNames.map(n => grab(n, true)).join('\n') + '\n' +
  'return { ownerSummaryDay, ownerSummaryPrevMonth, ownerSummaryCollect, ownerSummaryHtml, ownerSummaryScrub, ownerSummaryBuildDraft, ownerSummaryBuild, ownerSummaryList, ownerSummarySave, ownerSummarySkip, ownerSummaryTestSend, ownerSummarySend, ownerSummaryNiceDate };');

const baseStubs = () => ({ json: (o, s) => ({ __json: o, status: s || 200, clone() { return this; }, async json() { return o; } }) });
const P = [{ ID: 'p1', Owner_ID: 'o1', Address: '12 Elm St', City: 'Baltimore' }, { ID: 'p2', Owner_ID: 'o2', Address: '9 Oak Ave', City: 'Baltimore' }];
const W = (o) => Object.assign({ ID: '1', WO_ID: 'WO-101', Property_ID: 'p1', Status: 'New', Trade: 'Plumbing', Description: 'Leaky faucet' }, o);
const S0 = make(baseStubs());

// --- month boundaries (Eastern) ---
t('prev month of Jan is Dec of last year', S0.ownerSummaryPrevMonth('2027-01-03') === '2026-12');
t('prev month of Nov 22', S0.ownerSummaryPrevMonth('2026-11-22') === '2026-10');
t('plain date kept', S0.ownerSummaryDay('2026-10-31') === '2026-10-31');
t('ISO 03:00Z on Nov 1 is still Oct 31 in Eastern', S0.ownerSummaryDay('2026-11-01T03:00:00.000Z') === '2026-10-31');
t('ISO 05:00Z on Nov 1 is Nov 1 in Eastern (after the clocks go back at 2am)', S0.ownerSummaryDay('2026-11-01T06:00:00.000Z') === '2026-11-01');
t('blank / garbage day is empty', S0.ownerSummaryDay('') === '' && S0.ownerSummaryDay('soon') === '');
t('friendly date', S0.ownerSummaryNiceDate('2026-11-12') === 'Thu, Nov 12');

// --- collect ---
{
  const wos = [
    W({ ID: '1', WO_ID: 'WO-101', Status: 'Complete', Completed_Date: '2026-10-05' }),
    W({ ID: '2', WO_ID: 'WO-102', Status: 'Complete', Completed_Date: '2026-09-30' }),          // last month: not counted
    W({ ID: '3', WO_ID: 'WO-103', Status: 'In Progress', Scheduled_Date: '2026-11-25' }),        // open + scheduled
    W({ ID: '4', WO_ID: 'WO-104', Status: 'Assigned', Scheduled_Date: '2026-11-01' }),           // open, scheduled in the past
    W({ ID: '5', WO_ID: 'WO-105', Status: 'New', Voided: 'TRUE' }),                              // voided
    W({ ID: '6', WO_ID: 'WO-106', Status: 'New', Type: 'addon' }),                               // add-on child
    W({ ID: '7', WO_ID: 'WO-107', Status: 'New', Duplicated_From: '3', Bid_Group_ID: 'BG-1' }),  // hidden bid copy
    W({ ID: '8', WO_ID: 'WO-108', Status: 'Cancelled', Completed_Date: '2026-10-07' }),          // dead
    W({ ID: '9', WO_ID: 'WO-109', Property_ID: 'p2', Status: 'New' }),                           // another owner
  ];
  const c = S0.ownerSummaryCollect({ ID: 'o1' }, P, wos, '2026-10', '2026-11-22');
  t('one completed in October', c.counts.completed === 1 && c.completed[0].wo === 'WO-101');
  t('open = 2 (in progress + assigned), excludes voided / add-on / bid copy / dead / other owner', c.counts.open === 2 && c.open.map(r => r.wo).sort().join() === 'WO-103,WO-104');
  t('scheduled only today or later', c.counts.scheduled === 1 && c.scheduled[0].wo === 'WO-103' && c.scheduled[0].date === '2026-11-25');
  t('status in owner wording', c.completed[0].status === 'Completed' && c.open.find(r => r.wo === 'WO-104').status === 'Vendor assigned');
  const nothing = S0.ownerSummaryBuildDraft({ ID: 'o9' }, P, wos, '2026-10', '2026-11-22');
  t('an owner with no activity gets an empty draft (no email)', nothing.empty === true);
}

// --- template + scrub ---
{
  const wos = [W({ Status: 'Complete', Completed_Date: '2026-10-05' }), W({ ID: '3', WO_ID: 'WO-103', Status: 'In Progress', Scheduled_Date: '2026-11-25' })];
  const d = S0.ownerSummaryBuildDraft({ ID: 'o1', First_Name: 'Jane', Last_Name: 'Smith' }, P, wos, '2026-10', '2026-11-22');
  t('draft passes the scrub', d.scrub.ok === true && !d.empty);
  t('every line carries its work order number', (d.html.match(/work order WO-10\d/g) || []).length >= 3);
  t('sections present; names the month', /Completed this month/.test(d.html) && /Open now/.test(d.html) && /Scheduled/.test(d.html) && /October 2026/.test(d.html));
  t('no dollar sign, no raw ISO date', !/\$/.test(d.html) && !/\d{4}-\d{2}-\d{2}/.test(d.html));
  const noSched = S0.ownerSummaryBuildDraft({ ID: 'o1', First_Name: 'Jane' }, P, [W({ Status: 'Complete', Completed_Date: '2026-10-05' })], '2026-10', '2026-11-22');
  t('empty sections say "Nothing this month"', /Nothing this month/.test(noSched.html));
  t('the escape works on a hostile name', !/<script/.test(S0.ownerSummaryHtml({ ownerName: '<script>x</script>', monthLabel: 'X', completed: [], open: [], scheduled: [] })));
  // A description that trips the scrub falls back to the trade only for that line, so the draft still builds
  const bad = S0.ownerSummaryBuildDraft({ ID: 'o1', First_Name: 'Jane' }, P, [W({ Status: 'Complete', Completed_Date: '2026-10-05', Description: 'Replace valve, total cost $450' })], '2026-10', '2026-11-22');
  t('a costly description is replaced by the trade', bad.scrub.ok === true && /Plumbing job/.test(bad.html) && !/450/.test(bad.html));
}
for (const [label, html, hit] of [
  ['dollar sign', '<p>Fee $50</p>', true], ['spend word', '<p>Your spend this year</p>', true], ['total word', '<p>Total for the month</p>', true], ['cost word', '<p>The cost was low</p>', true],
  ['average word', '<p>average visit</p>', true], ['YTD', '<p>YTD summary</p>', true], ['time to complete', '<p>took 3 days to complete</p>', true], ['lockbox', '<p>lockbox 1234</p>', true],
  ['door code', '<p>door code 55</p>', true], ['Admin_Notes', '<p>Admin_Notes: x</p>', true],
  ['clean text', '<div style="margin:0"><p>Hi Jane, work order WO-1 was completed.</p></div>', false]]) {
  t('scrub: ' + label, S0.ownerSummaryScrub(html).ok === !hit);
}
t('no cost column or Max_Price is read by the summary code', !/Max_Price|max_price|Customer_Charge|Estimate_Revised|Vendor_Cost/.test(src.slice(src.indexOf('// ── OWNER SUMMARY'), src.indexOf('// ── VENDOR ONBOARDING — Phase 1')).replace(/^\s*\/\/.*$/gm, '')));

// --- build / send flow with an in-memory sheet ---
function rig(over) {
  over = over || {};
  const db = { rows: [], nextId: 1, sent: [], tel: [], failures: [], owners: over.owners || [
    { ID: 'o1', First_Name: 'Jane', Last_Name: 'Smith', Email: 'jane@example.com', Monthly_Summary: 'TRUE', Active: 'TRUE' },
    { ID: 'o2', First_Name: 'Off', Email: 'off@example.com', Monthly_Summary: '', Active: 'TRUE' },
    { ID: 'o3', First_Name: 'NoMail', Email: '', Monthly_Summary: 'TRUE', Active: 'TRUE' },
    { ID: 'o4', First_Name: 'Quiet', Email: 'q@example.com', Monthly_Summary: 'TRUE', Active: 'TRUE' }] };
  const wos = [W({ Status: 'Complete', Completed_Date: '2026-10-05' }), W({ ID: '3', WO_ID: 'WO-103', Status: 'In Progress', Scheduled_Date: '2026-11-25' }), W({ ID: '5', WO_ID: 'WO-205', Property_ID: 'p2', Status: 'New' })];
  const props = [{ ID: 'p1', Owner_ID: 'o1', Address: '12 Elm St' }, { ID: 'p2', Owner_ID: 'o3', Address: '9 Oak Ave' }, { ID: 'p4', Owner_ID: 'o4', Address: '1 Quiet Ln' }];
  const base = baseStubs();
  const S = Object.assign(base, {
    etTodayISO: () => '2026-11-22', ensureColumns: async () => {}, ensureTab: async () => {}, invalidateTabCache: () => {},
    fetchTabs: async () => [db.owners, props, wos],
    fetchTab: async (tab) => tab === 'Owners' ? db.owners : db.rows.map(r => Object.assign({}, r)),
    addRow: async (_e, _tab, body) => { if (over.addFails) return base.json({ success: false, error: 'sheet down' }, 500); const id = String(db.nextId++); db.rows.push(Object.assign({ ID: id }, body)); return base.json({ success: true, id }); },
    updateRowVerified: async (_e, _tab, id, fields) => { if (over.updateFails && over.updateFails(fields)) throw new Error('row ' + id + ' did not keep'); const r = db.rows.find(x => x.ID === String(id)); Object.assign(r, fields); db.log = (db.log || []).concat([Object.assign({ id }, fields)]); return r; },
    fetchConfig: async () => ({ STR_CAL_IMPERSONATE: 'me@example.com' }),
    gmailSendEmail: async (_e, m) => { db.sent.push(m); if (over.sendThrows) throw new Error('gmail down'); if (over.staged) return { staged: true, sent: false, note: 'STAGING' }; return { sent: true, message_id: 'm' + db.sent.length }; },
    logTelemetry: async (_e, r) => { db.tel.push(r); }, reportFailure: async (_e, f) => { db.failures.push(f); }, isStaging: () => false,
  });
  return { M: make(S), db };
}
{
  const { M, db } = rig();
  const r = (await M.ownerSummaryBuild({}, { month: '2026-10' })).__json;
  t('builds exactly one draft (the owner who is on, has an email and has activity)', r.built.length === 1 && db.rows.length === 1 && db.rows[0].Owner_ID === 'o1' && db.rows[0].Status === 'Draft');
  const why = Object.fromEntries(r.skipped.map(s => [s.owner_id, s.reason]));
  t('switch off / no email / nothing to report are listed, not silent', why.o2 === 'summary switch is off' && why.o3 === 'no email on file' && why.o4 === 'nothing to report');
  t('building never sends', db.sent.length === 0);
  t('one telemetry row per run', db.tel.length === 1 && db.tel[0].Job_Type === 'owner_summary_build');
  const again = (await M.ownerSummaryBuild({}, { month: '2026-10' })).__json;
  t('a second build does not duplicate or overwrite the draft', db.rows.length === 1 && again.built.length === 0 && again.skipped.some(s => s.owner_id === 'o1' && /draft/.test(s.reason)));
  const id = db.rows[0].ID;
  // edit
  const bad = await M.ownerSummarySave({}, { id, html: '<p>Your total spend $5</p>' });
  t('an edit with spend wording is refused and nothing is saved', bad.status === 422 && !/spend/.test(db.rows[0].Body_Html));
  const ok = await M.ownerSummarySave({}, { id, subject: 'New subject', html: '<p>Hi, work order WO-101 done.</p>' });
  t('a clean edit saves', ok.status === 200 && db.rows[0].Subject === 'New subject' && db.rows[0].Edited_At);
  // test send
  const ts = await M.ownerSummaryTestSend({}, { id });
  t('test send goes to Brett only and leaves the draft a Draft', ts.__json.ok && db.sent[0].to === 'me@example.com' && /^\[TEST\]/.test(db.sent[0].subject) && db.rows[0].Status === 'Draft');
  // send
  const s1 = await M.ownerSummarySend({}, { id });
  t('send: Sent mark written first, then one email to the owner', s1.__json.ok && db.rows[0].Status === 'Sent' && db.sent.length === 2 && db.sent[1].to === 'jane@example.com' && db.sent[1].recipientType === 'owner');
  t('Sent_At recorded', !!db.rows[0].Sent_At);
  const s2 = await M.ownerSummarySend({}, { id });
  t('sending twice is refused and sends nothing', s2.status === 409 && db.sent.length === 2);
  const sk = await M.ownerSummarySkip({}, { id });
  t('a sent draft cannot be skipped', sk.status === 409);
  const rebuild = (await M.ownerSummaryBuild({}, { month: '2026-10' })).__json;
  t('a sent draft is never rebuilt', rebuild.built.length === 0 && db.rows.length === 1);
}
{
  const { M, db } = rig(); await M.ownerSummaryBuild({}, { month: '2026-10' });
  const id = db.rows[0].ID;
  const sk = await M.ownerSummarySkip({}, { id });
  t('skip works and sends nothing', sk.__json.ok && db.rows[0].Status === 'Skipped' && db.sent.length === 0);
  const s = await M.ownerSummarySend({}, { id });
  t('a skipped draft cannot be sent', s.status === 409 && db.sent.length === 0);
  const e = await M.ownerSummarySave({}, { id, subject: 'x' });
  t('only a Draft can be edited', e.status === 409);
}
{
  const { M, db } = rig({ sendThrows: true }); await M.ownerSummaryBuild({}, { month: '2026-10' });
  const id = db.rows[0].ID;
  const s = await M.ownerSummarySend({}, { id });
  t('a send that throws turns the row Failed, with the reason, and tells Brett', s.status === 502 && db.rows[0].Status === 'Failed' && /gmail down/.test(db.rows[0].Send_Result) && db.failures.length === 1 && db.tel.some(x => x.Job_Type === 'owner_summary_send' && x.Success === 'FALSE'));
  t('Sent_At is cleared on failure', db.rows[0].Sent_At === '');
}
{
  const { M, db } = rig({ staged: true }); await M.ownerSummaryBuild({}, { month: '2026-10' });
  const s = await M.ownerSummarySend({}, { id: db.rows[0].ID });
  t('a held email (staging stub / demo guard) is Failed, never "Sent"', s.status === 502 && db.rows[0].Status === 'Failed');
}
{
  const { M, db } = rig({ updateFails: (f) => f.Status === 'Sent' }); await M.ownerSummaryBuild({}, { month: '2026-10' });
  let threw = false; try { await M.ownerSummarySend({}, { id: db.rows[0].ID }); } catch (e) { threw = true; }
  t('if the Sent mark does not save, nothing is emailed', threw && db.sent.length === 0);
}
{
  const { M, db } = rig({ addFails: true });
  const r = (await M.ownerSummaryBuild({}, { month: '2026-10' })).__json;
  t('a failed row write is reported, not shown as built', r.built.length === 0 && r.failed.length === 1 && r.errors.length >= 1 && db.tel[0].Success === 'FALSE');
}
{
  const { M, db } = rig(); await M.ownerSummaryBuild({}, { month: '2026-10' });
  db.rows[0].Body_Html = '<p>total $9</p>';
  const s = await M.ownerSummarySend({}, { id: db.rows[0].ID });
  t('a stored draft that now fails the scrub is marked Failed and not sent', s.status === 422 && db.rows[0].Status === 'Failed' && db.sent.length === 0);
}
{
  const owners = Array.from({ length: 25 }, (_, i) => ({ ID: 'q' + i, First_Name: 'N' + i, Email: 'n' + i + '@x.com', Monthly_Summary: 'TRUE', Active: 'TRUE' }));
  const { M, db } = rig({ owners });
  const r = (await M.ownerSummaryBuild({}, { month: '2026-10' })).__json;
  t('slices of 20 owners: partial + remaining', r.partial === true && r.remaining === 5 && r.skipped.length === 20);   // none of these owners has properties: 20 are looked at, 5 wait for the next call
}
// --- wiring guards ---
t('routes are registered', ['build', 'save', 'send', 'skip', 'test-send'].every(k => src.includes("path === '/owner-summary/" + k + "'")) && src.includes("path === '/owner-summary/list'"));
t('no owner-session path allows /owner-summary', !/OWNER_[A-Z_]*PATHS[^;]*owner-summary/.test(src));
t('owner update ensures the Monthly_Summary column', /path === '\/owner\/update'[^\n]*Monthly_Summary/.test(src));
console.log(`owner-summary: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
