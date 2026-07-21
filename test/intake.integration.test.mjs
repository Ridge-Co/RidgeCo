// End-to-end tests for handleIntake (B-103 Phase A) against an IN-MEMORY fake of
// the Google Sheets API. Run: node test/intake.integration.test.mjs
//
// This exercises the part that unit tests can't reach — the orchestration:
// dedupe → resolve → createWorkOrder → notify, and (most importantly) which
// writes are allowed to happen. No network: every outbound fetch is stubbed and
// any unexpected host is a hard failure, which is itself the assertion that this
// path can't quietly reach the live sheet, Drive, or Twilio.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const tmp  = join(mkdtempSync(join(tmpdir(), 'ridgeco-intake-int-')), 'worker.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'worker.js')));
const mod = await import(pathToFileURL(tmp).href);
const { handleIntake } = mod;
const workerFetch = mod.default.fetch;

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

// A REAL key — importPrivateKey/signRS256 actually run, so the JWT path is
// exercised rather than mocked away. Only the token endpoint is faked.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

const WO_HEADERS = ['Vendor_Needs_Access','ID','Property_ID','Unit_ID','Tenant_ID','Vendor_ID','Type','Trade',
  'Description','Priority','Status','Owner_WO_Ref','WO_Contact_Name','WO_Contact_Phone','Created_By','Created_Date',
  'Notes','Source','Intake_Message_ID','Drive_Folder_URL','Drive_Folder_ID'];

function freshSheets() {
  return {
    Work_Orders: [WO_HEADERS, ['auto','WO-1050','10','','','','manual','Plumbing','old job','normal','New','111111-1','','','admin','2026-07-01','','','','','']],
    Properties: [['ID','Address','City','State','Zip','Owner_ID','Active'],
      ['10','1110 N Dukeland St','Baltimore','MD','21216','1','TRUE'],
      ['11','151 W Lanvale St','Baltimore','MD','21217','1','TRUE'],
      ['12','1110 N Dukeland Ave','Baltimore','MD','21216','1','TRUE']],
    Owners:  [['ID','Company','First_Name','Last_Name','Phone','Active'], ['1','Phoenix Estate Rentals, LLC','','','','TRUE']],
    Units:   [['ID','Property_ID','Unit_Label','Active'], ['5','10','1','TRUE']],
    Tenants: [['ID','Property_ID','Unit_ID','First_Name','Last_Name','Phone','Email','PIN','Active'],
      ['7','10','5','Ian','Rogers','+12402880886','ianrogers933@gmail.com','0886','TRUE']],
    WO_Tenants:  [['ID','WO_ID','Tenant_ID','Tenant_Name','Tenant_Phone','Added_By','Added_Date','Active']],
    Attachments: [['ID','WO_ID','File_Name','File_Type','Drive_File_ID','Drive_URL','Mime_Type','Created_Date','Active']],
    Config:      [['admin_phone','+14105551234']],
  };
}

let SHEETS, sms, unexpected;

// Fake Sheets API. Deliberately strict: an unrecognized host throws, so the test
// fails loudly if the code ever tries to reach something real.
function installFetchStub() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, headers: { get: () => null } });

    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'fake-token' });

    if (u.includes('api.twilio.com')) { sms.push(opts.body); return ok({ sid: 'SM_fake' }); }

    if (u.includes('sheets.googleapis.com')) {
      const m = u.match(/spreadsheets\/([^/]+)(\/.*)?$/);
      const sheetId = m[1];
      if (sheetId !== 'STAGING_SHEET') { unexpected.push(`WRONG SHEET: ${sheetId}`); throw new Error('wrong sheet id'); }
      const rest = decodeURIComponent(m[2] || '');

      if (opts.method === 'GET' || !opts.method) {
        const tab = (rest.match(/\/values\/([^:?!]+)/) || [])[1];
        return ok({ values: SHEETS[tab] ? JSON.parse(JSON.stringify(SHEETS[tab])) : undefined });
      }
      const appendTab = (rest.match(/\/values\/([^:]+):append/) || [])[1];
      if (appendTab) { (SHEETS[appendTab] ||= [[]]).push(JSON.parse(opts.body).values[0]); return ok({}); }
      if (rest.includes('values:batchUpdate')) {
        for (const d of JSON.parse(opts.body).data) {
          const [tab, cell] = d.range.split('!');
          const colLetters = cell.match(/^([A-Z]+)/)[1];
          let ci = 0; for (const ch of colLetters) ci = ci * 26 + (ch.charCodeAt(0) - 64);
          const row = parseInt(cell.match(/(\d+)$/)[1], 10) - 1;
          if (SHEETS[tab] && SHEETS[tab][row]) SHEETS[tab][row][ci - 1] = d.values[0][0];
        }
        return ok({});
      }
      if (opts.method === 'PUT') return ok({});
      return ok({});
    }
    unexpected.push(u);
    throw new Error(`UNEXPECTED NETWORK CALL: ${u}`);
  };
}

const ENV = () => ({
  STAGING: '1', SHEET_ID: 'STAGING_SHEET',
  GOOGLE_SA_EMAIL: 'brett-os-sheets@brettos-502323.iam.gserviceaccount.com', GOOGLE_SA_KEY: PEM,
  TWILIO_SID: 'AC_fake', TWILIO_AUTH: 'fake', TWILIO_FROM: '+15550000000',
});

const BUILDIUM_SUBJECT = 'Phoenix Estate Rentals, LLC: Work order 838106';
const buildEmail = (over = {}) => ({
  sender: 'Buildium <donotreply@managebuilding.com>',
  subject: BUILDIUM_SUBJECT,
  message_id: 'msg-abc-123',
  html: `<p>Work order #838106-1: Leaking toilet</p>
    <p>Job description</p><p>Water pooling on the floor.</p>
    <p>Location</p><p>1110 North Dukeland Street - 1</p><p>Baltimore, MD 21216</p>
    <p>Entry contacts</p><p>Ian Rogers</p><p>(240) 288-0886</p><p>ianrogers933@gmail.com</p>
    <p>Entry details</p><p>Pets: Yes - Cat</p>`,
  plaintext: '',
  ...over,
});

const reset = () => { SHEETS = freshSheets(); sms = []; unexpected = []; installFetchStub(); };
const run   = async (email) => (await handleIntake(ENV(), email)).json();
const woRows = () => SHEETS.Work_Orders.slice(1);
const cell   = (row, name) => row[WO_HEADERS.indexOf(name)];

// ── happy path ───────────────────────────────────────────────────────────────
section('created — known property, known tenant');
reset();
let r = await run(buildEmail());
eq(r.status, 'created', 'status is created');
eq(r.property_id, '10', 'reused the existing property (no duplicate)');
eq(r.unit_id, '5', 'reused the existing unit');
eq(r.tenant_id, '7', 'matched the existing tenant by phone');
eq(r.wo_id, 'WO-1051', 'WO number continues from the ID column, not from 1001');
eq(r.trade_guess, 'Plumbing', 'trade guessed');
eq(SHEETS.Properties.length, 4, 'no property row added');
eq(SHEETS.Units.length, 2, 'no unit row added');
eq(SHEETS.Tenants.length, 2, 'no tenant row added');
eq(woRows().length, 2, 'exactly one work order added');
const newWO = woRows()[1];
eq(cell(newWO, 'ID'), 'WO-1051', 'ID written to the ID column (index 1), not index 0');
eq(cell(newWO, 'Status'), 'New', 'status New');
eq(cell(newWO, 'Owner_WO_Ref'), '838106-1', 'customer ref stamped for two-way tracking');
eq(cell(newWO, 'Source'), 'email-buildium', 'Source column written');
eq(cell(newWO, 'Intake_Message_ID'), 'msg-abc-123', 'message id written');
eq(cell(newWO, 'Trade'), 'Plumbing', 'trade written to the WO');
eq(r.notified, true, 'admin notified');
eq(sms.length, 0, 'STAGING: no real Twilio call was made');
eq(unexpected, [], 'no unexpected network calls');

// ── idempotency ──────────────────────────────────────────────────────────────
section('duplicate — the same email twice');
r = await run(buildEmail());
eq(r.status, 'duplicate', 'second delivery is a duplicate');
eq(r.wo_id, 'WO-1051', 'points at the original WO');
eq(woRows().length, 2, 'no second work order created');

section('duplicate — same ref, different Gmail message id (re-forward)');
r = await run(buildEmail({ message_id: 'different-msg-id' }));
eq(r.status, 'duplicate', 'Owner_WO_Ref catches it even with a new message id');
eq(woRows().length, 2, 'still no second work order');

// ── the safety case that matters most ────────────────────────────────────────
section('needs_review — partial address match must NOT create anything');
reset();
r = await run(buildEmail({
  html: buildEmail().html.replace('1110 North Dukeland Street - 1', '1110 N Dukeland Boulevard'),
}));
eq(r.status, 'needs_review', 'ambiguous address goes to review');
eq(woRows().length, 1, 'NO work order created');
eq(SHEETS.Properties.length, 4, 'NO duplicate property created');
eq(SHEETS.Tenants.length, 2, 'NO tenant created');

section('needs_review — new address whose owner cannot be matched');
reset();
r = await run(buildEmail({
  subject: 'Someone Unknown LLC: Work order 999999',
  html: buildEmail().html.replace('1110 North Dukeland Street - 1', '900 Brand New Road'),
}));
eq(r.status, 'needs_review', 'unmatched owner blocks property creation');
eq(SHEETS.Properties.length, 4, 'no property created for an unknown owner');

section('created — genuinely new address with a matched owner');
reset();
r = await run(buildEmail({
  html: buildEmail().html
    .replace('1110 North Dukeland Street - 1', '900 Brand New Road - 2')
    .replace('Ian Rogers', 'Dana Fields')
    .replace('(240) 288-0886', '(410) 555-7788')
    .replace('ianrogers933@gmail.com', 'dana@example.com'),
}));
eq(r.status, 'created', 'new address + known owner creates');
eq(SHEETS.Properties.length, 5, 'property created');
eq(SHEETS.Properties[4][1], '900 Brand New Road', 'address stored without the unit suffix');
eq(SHEETS.Properties[4][5], '1', 'new property linked to the matched owner');
eq(SHEETS.Units.length, 3, 'unit created for the new property');
eq(SHEETS.Tenants.length, 3, 'new tenant created');

// ── routing ──────────────────────────────────────────────────────────────────
section('source routing');
reset();
eq((await run(buildEmail({ sender: 'stranger@example.com' }))).status, 'unsupported', 'unknown sender rejected');
eq((await run(buildEmail({ sender: 'phoenixestatesmaryland@gmail.com' }))).status, 'needs_review', 'manual list → review (Phase C)');
eq(woRows().length, 1, 'neither wrote a work order');

section('kill switch');
reset();
SHEETS.Config.push(['intake_enabled', 'FALSE']);
eq((await run(buildEmail())).status, 'skipped', 'intake_enabled=FALSE disables intake');
eq(woRows().length, 1, 'nothing written while disabled');

// ── routing-level guards (exercise fetch(), not just handleIntake) ───────────
const PROD  = 'https://maintenance-hub.brett-2f8.workers.dev';
const STAGE = 'https://staging-maintenance-hub.brett-2f8.workers.dev';
const call = async (url, { token, env = {}, method = 'POST', body = {} } = {}) => {
  const req = new Request(url, {
    method,
    headers: token ? { 'X-Auth-Token': token, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
  const res = await workerFetch(req, env);
  return { status: res.status, body: await res.json() };
};
const BASE_ENV = { WORKER_SECRET: 'prod-secret', INTAKE_TOKEN: 'intake-secret' };

section('staging guard — fails closed');
reset();
let c = await call(`${STAGE}/intake`, { token: 'intake-secret', env: { ...BASE_ENV, SHEET_ID: 'LIVE_SHEET' } });
eq(c.status, 503, 'staging hostname with no STAGING_SHEET_ID → 503');
eq(/refusing to fall back/.test(c.body.error), true, 'refuses to use the live sheet');
eq(unexpected, [], 'never touched the live sheet');

section('staging guard — QuickBooks is blocked (would rotate the PROD refresh token)');
const STAGE_ENV = { ...BASE_ENV, SHEET_ID: 'LIVE_SHEET', STAGING_SHEET_ID: 'STAGING_SHEET' };
c = await call(`${STAGE}/qb/test`, { method: 'GET', env: STAGE_ENV });
eq(c.status, 503, '/qb/test blocked in staging even though it is a PUBLIC_PATH');
c = await call(`${STAGE}/qb/send-invoice`, { token: 'prod-secret', env: STAGE_ENV });
eq(c.status, 503, '/qb/send-invoice blocked in staging (would create a REAL invoice)');
eq(unexpected, [], 'no call reached Intuit');
// Production must be unaffected: not blocked, just missing QB env in this test.
c = await call(`${PROD}/qb/test`, { method: 'GET', env: BASE_ENV });
eq(c.status !== 503, true, 'production /qb/* is NOT blocked by the staging guard');
unexpected = [];

section('auth gate — INTAKE_TOKEN is scoped to /intake only');
c = await call(`${PROD}/intake`, { token: 'wrong-token', env: BASE_ENV });
eq(c.status, 401, 'a bad token is rejected');
c = await call(`${PROD}/workorder`, { token: 'intake-secret', env: BASE_ENV });
eq(c.status, 401, 'INTAKE_TOKEN cannot reach /workorder');
c = await call(`${PROD}/workorders`, { method: 'GET', token: 'intake-secret', env: BASE_ENV });
eq(c.status, 401, 'INTAKE_TOKEN cannot read the work order list (PII)');
// And it DOES work on its own route (401 would mean the gate rejected it).
reset();
c = await call(`${STAGE}/intake`, { token: 'intake-secret', env: { ...STAGE_ENV, ...ENV() }, body: buildEmail() });
eq(c.status, 200, 'INTAKE_TOKEN is accepted on /intake');
eq(c.body.status, 'created', 'and the request completes end to end through fetch()');
c = await call(`${STAGE}/intake`, { token: 'prod-secret', env: { ...STAGE_ENV, ...ENV() }, body: buildEmail() });
eq(c.body.status, 'duplicate', 'WORKER_SECRET also works on /intake (Hub can call it)');

section('needs_review — an email with no parseable ref must not auto-create');
reset();
r = await run(buildEmail({ subject: 'Phoenix Estate Rentals, LLC: maintenance', html: buildEmail().html.replace('Work order #838106-1:', 'Job:') }));
eq(r.status, 'needs_review', 'no ref → review (it would be undedupable)');
eq(woRows().length, 1, 'nothing created');

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
if (fail) process.exit(1);
