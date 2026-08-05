// Logging time recorded hours and stopped there. Everything downstream — pricing, approve,
// send — is gated on a Vendor_Bills row, so when Brett is the vendor there was nobody left
// to submit one and the hours never reached an invoice.
//
// The danger in fixing it is the opposite error: the same hour billed twice, once as the
// bill's labour and once on top as supervision. These assertions run the real functions out
// of worker.js and index.html so neither half can drift from what ships.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');
const hsrc = fs.readFileSync('index.html', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// ── parseIdList: the ids arrive as an array from the Hub, a string from anything else ──
const { parseIdList } = new Function(grab(wsrc, 'function parseIdList(') + '\nreturn { parseIdList };')();
t('accepts an array', JSON.stringify(parseIdList(['1', '2'])) === '["1","2"]');
t('accepts a comma string', JSON.stringify(parseIdList('1, 2')) === '["1","2"]');
t('coerces numbers', JSON.stringify(parseIdList([1, 2])) === '["1","2"]');
t('drops blanks', JSON.stringify(parseIdList(',,3,')) === '["3"]');
t('de-duplicates — linking one entry twice must not double-count it',
  JSON.stringify(parseIdList(['4', '4'])) === '["4"]');
t('empty in, empty out', parseIdList(undefined).length === 0 && parseIdList(null).length === 0);

// ── linkTimeEntriesToBill: the guards are the whole point ──
const linkSrc = grab(wsrc, 'async function linkTimeEntriesToBill(');
t('creates the column before writing it — a missing header stores nothing silently',
  /ensureColumns\(env, 'Time_Entries', \['Bill_ID'\]\)/.test(linkSrc));
t('refuses to move an entry that is already inside a bill',
  /if \(String\(row\.Bill_ID \|\| ''\)\.trim\(\)\) continue/.test(linkSrc));
t('refuses an entry belonging to a different work order',
  /String\(row\.WO_ID\) !== String\(woId\)/.test(linkSrc));
t('skips ids that match no row rather than throwing', /if \(!row\) continue/.test(linkSrc));

// ── addVendorBill: the ordering is what makes a failure recoverable ──
const addSrc = grab(wsrc, 'async function addVendorBill(');
t('time_entry_ids is stripped before the row is written', /delete body\.time_entry_ids/.test(addSrc));
t('the bill is created BEFORE the hours are marked spent',
  addSrc.indexOf("addRow(env, 'Vendor_Bills'") < addSrc.indexOf('linkTimeEntriesToBill(env, timeIds'));
t('a failed link never takes the saved bill down with it',
  /catch \(e\) \{ \/\* the bill is saved; the link is not worth losing it over \*\/ \}/.test(addSrc));
t('the response is cloned before being read — reading it would consume the body',
  /res\.clone\(\)\.json\(\)/.test(addSrc));
t('a re-submit links its hours to the bill that already exists',
  /linkTimeEntriesToBill\(env, body\.time_entry_ids, String\(dupe\.ID/.test(addSrc));

// ── listTimeEntries: "don't know" must not read as "safe to charge again" ──
const listSrc = grab(wsrc, 'async function listTimeEntries(');
t('only LIVE bills consume an entry — voiding one releases its hours',
  /bills\.filter\(b => b\.Active !== 'FALSE'\)/.test(listSrc));
t('an unreadable bill list reports null, not empty',
  /live === null \? null :/.test(listSrc));
t('the annotation rides on a copy, not on the sheet row', /Object\.assign\(\{\}, r, \{/.test(listSrc));

// ── The Hub side: the picker must not offer hours that are already inside a bill ──
const loadTime = grab(hsrc, 'function loadInvoiceTime(');
t('entries inside a bill are split out of the billable list',
  /var billable = live\.filter\(function\(e\) \{ return !e\.Billed_Bill_ID; \}\)/.test(loadTime));
t('they are kept for display rather than dropped', /_invTimeInBill\[k\] = live\.filter/.test(loadTime));
t('nothing is ticked for you when the bill state could not be read',
  /var billedUnknown = live\.some\(function\(e\) \{ return e\.Billed_Bill_ID === null; \}\)/.test(loadTime) &&
  /panelsOnThisWO < 2 && !billedUnknown/.test(loadTime));

// The two totals the invoice is built from must only ever see the unbilled list.
const timeTotal = grab(hsrc, 'function invTimeTotal(');
t('the invoice total reads _invTime, which excludes billed hours',
  /safeArray\(_invTime\[k\]\)/.test(timeTotal) && !/_invTimeInBill/.test(timeTotal));

// ── The dead end that started this ──
const noBill = grab(hsrc, 'function invNoBillHtml(');
t('says what having no bill blocks, not just that there isn\'t one',
  /Nothing can be priced, approved or invoiced until there is one/.test(noBill));
t('offers the logged hours as a bill when there are any', /hubBillUseLoggedTime/.test(noBill));
t('offers hand entry as well — not every bill comes from logged time',
  /hubBillOpen/.test(noBill));
t('only offers either where the bill panel actually exists',
  /document\.getElementById\('hubbill-form-' \+ k\)/.test(noBill));
t('both no-bill states route through it',
  (hsrc.match(/invNoBillHtml\(k, '/g) || []).length === 2);

// ── Pulling the hours in ──
const useTime = grab(hsrc, 'function hubBillUseLoggedTime(');
t('mixed rates bill flat rather than inventing a blended rate',
  /Object\.keys\(rates\)\.length === 1/.test(useTime) && /hubBillType\(k, 'flat'\)/.test(useTime));
t('one rate bills as hours × rate so it reconciles against the log',
  /hubBillType\(k, 'hourly'\)/.test(useTime));
t('the ids are remembered for the save', /st\.timeIds = free\.map/.test(useTime));
t('it fills the form instead of saving silently — the price is still his to change',
  !/\/vendor-bill\/add/.test(useTime));
t('the prefilled rate is marked hand-set so the vendor default cannot overwrite it',
  /rEl\.dataset\.auto = '0'/.test(useTime));

const submit = grab(hsrc, 'function hubBillSubmit(');
t('the ids are sent with the bill', /time_entry_ids: safeArray\(st\.timeIds\)/.test(submit));
t('saving re-reads the time picker so the hours leave it', /invRefreshTimeForWO\(woId\)/.test(submit));
t('and re-reads the time log so the entries show which bill took them',
  /loadHubTimeTracking\(woId, null\)/.test(submit));

// ── Where he actually is when he logs time ──
const nextStep = grab(hsrc, 'function hubTimeNextStep(');
t('says plainly that hours with no bill reach no invoice',
  /there is no bill on this job — so none of it reaches an invoice yet/.test(nextStep));
t('with a bill already present it points at supervision instead of a second bill',
  /if \(_invBill\[woId\]\)/.test(nextStep));
t('stays silent when every billable hour is already in a bill',
  /if \(!free\.length\) return ''/.test(nextStep));
t('the badge distinguishes billable from billed',
  /ON BILL #/.test(hsrc) && /e\.Billed_Bill_ID\n?\s*\? '<span style="background:#1e3a5f/.test(hsrc));


// ── Run it for real ──────────────────────────────────────────
// The assertions above prove the guards are written. These prove they work: a fake sheet,
// the real linkTimeEntriesToBill and listTimeEntries, and the two states that cost money.
const sheet = {
  Time_Entries: [
    { ID: '1', WO_ID: 'WO-1', Duration_Minutes: '60', Billable: 'TRUE', Hourly_Rate: '75', Billable_Amount: '75.00', Active: 'TRUE', Bill_ID: '' },
    { ID: '2', WO_ID: 'WO-1', Duration_Minutes: '30', Billable: 'TRUE', Hourly_Rate: '75', Billable_Amount: '37.50', Active: 'TRUE', Bill_ID: '' },
    { ID: '3', WO_ID: 'WO-2', Duration_Minutes: '60', Billable: 'TRUE', Hourly_Rate: '75', Billable_Amount: '75.00', Active: 'TRUE', Bill_ID: '' },
    { ID: '4', WO_ID: 'WO-1', Duration_Minutes: '60', Billable: 'TRUE', Hourly_Rate: '75', Billable_Amount: '75.00', Active: 'TRUE', Bill_ID: '9' },
  ],
  Vendor_Bills: [{ ID: '9', WO_ID: 'WO-1', Active: 'TRUE' }],
};
let ensured = [];
const env = {};
const harness = new Function('sheet', 'ensured', `
  const fetchTab = async (env, tab) => JSON.parse(JSON.stringify(sheet[tab] || []));
  const ensureColumns = async (env, tab, cols) => { ensured.push(tab + ':' + cols.join(',')); };
  const updateRow = async (env, tab, id, fields) => {
    const r = sheet[tab].find(x => String(x.ID) === String(id));
    if (r) Object.assign(r, fields);
    return { success: true };
  };
  const json = (body) => ({ body });
  ${grab(wsrc, 'function parseIdList(')}
  ${grab(wsrc, 'async function linkTimeEntriesToBill(')}
  ${grab(wsrc, 'async function listTimeEntries(')}
  return { linkTimeEntriesToBill, listTimeEntries };
`)(sheet, ensured);

const listFor = async (wo) => (await harness.listTimeEntries(env, { searchParams: new URLSearchParams({ wo_id: wo }) })).body;

const linked = await harness.linkTimeEntriesToBill(env, ['1', '2', '3', '4', '999'], '10', 'WO-1');
t('links only the two free entries on this job', linked === 2);
t('the column is created first', ensured.some(x => x === 'Time_Entries:Bill_ID'));
t('entry 1 now carries the bill', sheet.Time_Entries[0].Bill_ID === '10');
t('another job\'s hours are untouched', sheet.Time_Entries[2].Bill_ID === '');
t('an entry already on bill 9 is not moved to bill 10', sheet.Time_Entries[3].Bill_ID === '9');

const rows1 = await listFor('WO-1');
t('only the entry on a LIVE bill comes back annotated', rows1.filter(r => r.Billed_Bill_ID).length === 1);
t('and the annotation names the right bill', rows1.find(r => r.ID === '4').Billed_Bill_ID === '9');

// THE case that costs money: bill 10 doesn't exist as a live row, so hours pointed at it
// must NOT read as consumed — otherwise a bill that failed to save eats the time silently.
t('hours pointing at a bill that is not live are free again',
  rows1.filter(r => r.ID === '1' || r.ID === '2').every(r => r.Billed_Bill_ID === ''));

// Void bill 9 and its hours come back.
sheet.Vendor_Bills[0].Active = 'FALSE';
const rows2 = await listFor('WO-1');
t('voiding a bill releases its hours rather than stranding them',
  rows2.find(r => r.ID === '4').Billed_Bill_ID === '');


console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
