// B-104 v2.0 — visibility matrix enforcement. Run: node test/visibility.test.mjs
//
// The matrix is a HARD CONTRACT: a private note reaching an owner or tenant is a
// defect, not a cosmetic bug. These tests drive the real fetch() handler against
// an in-memory Sheets fake and assert on the ACTUAL JSON that would be sent to
// the browser — not on internal helpers — because the payload is what leaks.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const tmp  = join(mkdtempSync(join(tmpdir(), 'ridgeco-vis-')), 'worker.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'worker.js')));
const mod = await import(pathToFileURL(tmp).href);
const workerFetch = mod.default.fetch;

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`); }
};
const section = (t) => console.log(`\n── ${t} ──`);

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

// Distinctive sentinels: if any of these strings appears in a payload it must
// not be in, the assertion names exactly which note leaked.
const S = {
  entry:  'ENTRYSENTINEL-lockbox-is-red',
  owner:  'OWNERSENTINEL-please-use-my-guy',
  thread: 'THREADSENTINEL-do-not-quote-price',
  admin:  'ADMINSENTINEL-markup-40-percent',
  legacy: 'LEGACYSENTINEL-old-mixed-notes',
  hold:   'HOLDSENTINEL-waiting-on-a-part',
};

const WO_HEADERS = ['Vendor_Needs_Access','ID','Property_ID','Unit_ID','Tenant_ID','Vendor_ID','Type','Trade',
  'Description','Priority','Status','Scheduled_Date','Completed_Date','Invoice_ID','Owner_WO_Ref',
  'WO_Contact_Name','WO_Contact_Phone','Tenant_Visible','Created_By','Created_Date',
  'Notes','Entry_Notes','Owner_Notes','Vendor_Admin_Notes','Admin_Notes','Hold_Reason'];

const WO_ROW = ['auto','WO-3001','10','5','7','V-1','manual','Plumbing',
  'Leaking toilet','normal','On Hold','2026-07-22','','INV-9','ref-1',
  'Ian Rogers','+12402880886','TRUE','admin','2026-07-21',
  S.legacy, S.entry, S.owner, S.thread, S.admin, S.hold];

let SHEETS;
function freshSheets() {
  return {
    Work_Orders: [WO_HEADERS, [...WO_ROW]],
    Properties:  [['ID','Address','City','Owner_ID','Access_Notes','Lockbox_Code','Active'],
                  ['10','1110 N Dukeland St','Baltimore','1','side gate is unlocked','4455','TRUE']],
    Owners:      [['ID','Company','First_Name','Phone','Active'], ['1','Phoenix Estate Rentals, LLC','Mark','+14105551111','TRUE']],
    Units:       [['ID','Property_ID','Unit_Label','Active'], ['5','10','1','TRUE']],
    Tenants:     [['ID','Property_ID','Unit_ID','First_Name','Last_Name','Phone','Active'],
                  ['7','10','5','Ian','Rogers','+12402880886','TRUE']],
    Vendors:     [['ID','Name','First_Name','Last_Name','Phone','Trade','Language','Active'],
                  ['V-1','Acme Plumbing','','','+14105559999','Plumbing','en','TRUE']],
    Keys:        [['ID','Property_ID','Unit_ID','Lockbox_Code','Lockbox_Location','Active']],
    WO_Audit:    [['ID','WO_ID','Changed_By','Changed_By_Role','Field','Old_Value','New_Value','Timestamp','Notes']],
    Config:      [['admin_phone','+14105551234']],
  };
}

function installFetchStub() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const ok = (obj) => ({ ok: true, status: 200, json: async () => obj, headers: { get: () => null } });
    if (u.includes('oauth2.googleapis.com/token')) return ok({ access_token: 'fake' });
    if (u.includes('api.twilio.com')) return ok({ sid: 'SM' });
    if (u.includes('sheets.googleapis.com')) {
      const m = u.match(/spreadsheets\/([^/]+)(\/.*)?$/);
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
          const letters = cell.match(/^([A-Z]+)/)[1];
          let ci = 0; for (const ch of letters) ci = ci * 26 + (ch.charCodeAt(0) - 64);
          const row = parseInt(cell.match(/(\d+)$/)[1], 10) - 1;
          if (SHEETS[tab] && SHEETS[tab][row]) SHEETS[tab][row][ci - 1] = d.values[0][0];
        }
        return ok({});
      }
      return ok({});
    }
    throw new Error(`UNEXPECTED NETWORK CALL: ${u}`);
  };
}

const ENV = () => ({
  STAGING: '1', SHEET_ID: 'S', STAGING_SHEET_ID: 'S', WORKER_SECRET: 'secret',
  GOOGLE_SA_EMAIL: 'sa@x.iam.gserviceaccount.com', GOOGLE_SA_KEY: PEM,
  TWILIO_SID: 'AC', TWILIO_AUTH: 'a', TWILIO_FROM: '+15550000000',
});

const reset = () => { SHEETS = freshSheets(); installFetchStub(); };
const call = async (path, { method = 'GET', body } = {}) => {
  const req = new Request(`https://maintenance-hub.brett-2f8.workers.dev${path}`, {
    method,
    headers: { 'X-Auth-Token': 'secret', 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify(body || {}) } : {}),
  });
  const res = await workerFetch(req, ENV());
  return { status: res.status, body: await res.json() };
};
const woFrom = (arr) => (arr || []).find(w => w.ID === 'WO-3001');
const cell = (name) => SHEETS.Work_Orders[1][WO_HEADERS.indexOf(name)];

// ── the matrix, field by field ───────────────────────────────────────────────
reset();
const vendorWO = woFrom((await call('/vendor-workorders?vendor_id=V-1')).body);
const tenantWO = woFrom((await call('/tenant-workorders?tenant_id=7')).body);
const ownerWO  = woFrom((await call('/owner-workorders?owner_id=1')).body);
const exportWO = woFrom((await call('/owner-export?owner_id=1')).body);

section('payloads resolve');
eq(!!vendorWO, true, 'vendor payload returned WO-3001');
eq(!!tenantWO, true, 'tenant payload returned WO-3001');
eq(!!ownerWO,  true, 'owner payload returned WO-3001');
eq(!!exportWO, true, 'owner-export returned WO-3001');

section('VENDOR — Entry, Owner_Notes, thread, Hold_Reason ✓ / Admin_Notes + legacy ✗');
eq(vendorWO.Entry_Notes, S.entry, 'sees Entry_Notes');
eq(vendorWO.Owner_Notes, S.owner, 'sees Owner_Notes');
eq(vendorWO.Vendor_Admin_Notes, S.thread, 'sees the admin↔vendor thread');
eq(vendorWO.Hold_Reason, S.hold, 'sees Hold_Reason');
eq(vendorWO.Admin_Notes, undefined, 'does NOT see Admin_Notes');
eq(vendorWO.Notes, undefined, 'does NOT see the legacy Notes archive');
eq(vendorWO.vendor_name, 'Acme Plumbing', 'sees vendor name');

section('TENANT — Hold_Reason + vendor name AND phone only');
eq(tenantWO.Hold_Reason, S.hold, 'sees Hold_Reason (the one customer-facing note)');
eq(tenantWO.vendor_name, 'Acme Plumbing', 'sees vendor name');
eq(tenantWO.vendor_phone, '+14105559999', 'sees vendor phone (v2.0 change — they coordinate access)');
for (const [k, v] of Object.entries({ Entry_Notes: S.entry, Owner_Notes: S.owner, Vendor_Admin_Notes: S.thread, Admin_Notes: S.admin, Notes: S.legacy }))
  eq(tenantWO[k], undefined, `does NOT see ${k}`);
eq(tenantWO.access_notes, undefined, 'does NOT see access notes');

section('OWNER — own Owner_Notes + Hold_Reason, vendor NAME only');
eq(ownerWO.Owner_Notes, S.owner, 'sees their own Owner_Notes');
eq(ownerWO.Hold_Reason, S.hold, 'sees Hold_Reason');
eq(ownerWO.vendor_name, 'Acme Plumbing', 'sees vendor name');
eq(ownerWO.vendor_phone, '', 'does NOT get vendor phone (protects the GC position)');
for (const [k] of Object.entries({ Entry_Notes: 1, Vendor_Admin_Notes: 1, Admin_Notes: 1, Notes: 1 }))
  eq(ownerWO[k], undefined, `does NOT see ${k}`);
eq(ownerWO.Invoice_ID, undefined, 'does NOT see Invoice_ID');
eq(ownerWO.access_notes, undefined, 'does NOT see access notes');

// ── the headline regression: whole-payload sentinel sweep ────────────────────
section('NO private note appears ANYWHERE in an owner/tenant payload or export');
const PRIVATE_FROM_OWNER  = { Entry_Notes: S.entry, Vendor_Admin_Notes: S.thread, Admin_Notes: S.admin, 'legacy Notes': S.legacy };
const PRIVATE_FROM_TENANT = { ...PRIVATE_FROM_OWNER, Owner_Notes: S.owner };
for (const [surface, payload, banned] of [
  ['OWNER payload',  ownerWO,  PRIVATE_FROM_OWNER],
  ['TENANT payload', tenantWO, PRIVATE_FROM_TENANT],
  ['WO-PDF export',  exportWO, PRIVATE_FROM_OWNER],
]) {
  const raw = JSON.stringify(payload);
  for (const [name, sentinel] of Object.entries(banned))
    eq(raw.includes(sentinel), false, `${surface}: no ${name} anywhere in the JSON`);
}

section('WO-PDF export is a strict allowlist');
eq(exportWO.Hold_Reason, S.hold, 'export keeps Hold_Reason');
eq(exportWO.Owner_Notes, S.owner, "export keeps the owner's own notes");
eq(exportWO.vendor_name, 'Acme Plumbing', 'export keeps vendor name');
eq(exportWO.vendor_phone, undefined, 'export has no vendor phone field at all');
eq(Object.keys(exportWO).some(k => /Admin|Entry|Vendor_Admin/.test(k)), false, 'export exposes no private note key');

section('ADMIN sees everything');
reset();
const adminWOs = (await call('/workorders')).body;
const adminWO  = woFrom(adminWOs);
for (const [k, v] of Object.entries({ Entry_Notes: S.entry, Owner_Notes: S.owner, Vendor_Admin_Notes: S.thread, Admin_Notes: S.admin, Notes: S.legacy, Hold_Reason: S.hold }))
  eq(adminWO[k], v, `admin sees ${k}`);

// ── role-scoped writes ───────────────────────────────────────────────────────
section('writes land in the right field and never in legacy Notes');
reset();
await call('/wo/add-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'owner says hi', author: 'Mark', author_role: 'owner', owner_id: '1' } });
eq(cell('Owner_Notes').includes('owner says hi'), true, 'owner post → Owner_Notes');
eq(cell('Owner_Notes').includes(S.owner), true, 'appended, did not overwrite');
eq(cell('Notes'), S.legacy, 'legacy Notes untouched');

reset();
await call('/wo/add-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'admin says hi', author: 'Brett', author_role: 'admin' } });
eq(cell('Vendor_Admin_Notes').includes('admin says hi'), true, 'admin post → the admin↔vendor thread by default');
eq(cell('Notes'), S.legacy, 'legacy Notes untouched');

reset();
await call('/wo/add-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'private thought', author: 'Brett', author_role: 'admin', field: 'Admin_Notes' } });
eq(cell('Admin_Notes').includes('private thought'), true, 'admin can target Admin_Notes explicitly');

reset();
let vn = await call('/workorder/vendor-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'replaced flapper', vendor_id: 'V-1' } });
eq(vn.status, 200, 'vendor note accepted');
eq(cell('Vendor_Admin_Notes').includes('replaced flapper'), true, 'vendor post → the admin↔vendor thread');
eq(/— Acme Plumbing \(vendor\)\]/.test(cell('Vendor_Admin_Notes')), true, 'attributed to the vendor');
vn = await call('/workorder/vendor-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'sneaky', vendor_id: 'V-999' } });
eq(vn.status, 403, 'a vendor cannot post to a WO that is not theirs');

section('status update no longer overwrites the note history');
reset();
await call('/status', { method: 'POST', body: { wo_id: 'WO-3001', status: 'In Progress', notes: 'on site now', updated_by: 'Acme', updated_by_role: 'vendor' } });
eq(cell('Notes'), S.legacy, 'legacy Notes NOT overwritten (it used to be clobbered wholesale)');
eq(cell('Vendor_Admin_Notes').includes('on site now'), true, 'status note appended to the thread');
eq(cell('Vendor_Admin_Notes').includes(S.thread), true, 'earlier thread content survived');

section('Hold_Reason is captured on hold, and only from an explicit reason');
reset();
await call('/status', { method: 'POST', body: { wo_id: 'WO-3001', status: 'On Hold', notes: 'internal: part backordered from supplier', hold_reason: 'waiting on a part, ETA Friday', updated_by: 'Brett', updated_by_role: 'admin' } });
eq(cell('Hold_Reason'), 'waiting on a part, ETA Friday', 'explicit hold_reason written');
eq(cell('Hold_Reason').includes('internal'), false, 'the internal status note did NOT become the customer-facing reason');

// ── admin compose boxes (exact payloads index.html sends) ────────────────────
section('admin compose — Entry_Notes box appends + attributes');
reset();
let ac = await call('/wo/append-entry-note', { method: 'POST', body: { wo_id: 'WO-3001', note: 'lockbox is red', author: 'Admin' } });
eq(ac.status, 200, 'addEntryNote() payload accepted');
eq(cell('Entry_Notes').includes(S.entry), true, 'existing entry note survived');
eq(cell('Entry_Notes').includes('lockbox is red'), true, 'new line added');
eq(/— Admin\]/.test(cell('Entry_Notes')), true, 'attributed to Admin');
eq(cell('Entry_Notes').split('\n').length, 2, 'appended as a second line, not an overwrite');
ac = await call('/wo/append-entry-note', { method: 'POST', body: { wo_id: 'WO-3001', note: '', author: 'Admin' } });
eq(ac.status, 400, 'empty note rejected (UI also guards, but the Worker must too)');

section('admin compose — Hold_Reason box sets and clears');
reset();
ac = await call('/wo/admin-update', { method: 'POST', body: { wo_id: 'WO-3001', admin_name: 'Admin', fields: { Hold_Reason: 'waiting on a part, ETA Friday' } } });
eq(ac.status, 200, 'saveHoldReason() payload accepted');
eq(cell('Hold_Reason'), 'waiting on a part, ETA Friday', 'hold reason replaced (single current value, not a thread)');
// It must actually reach the customer surfaces — that is the point of the field.
eq(woFrom((await call('/owner-workorders?owner_id=1')).body).Hold_Reason, 'waiting on a part, ETA Friday', 'owner sees the new hold reason');
eq(woFrom((await call('/tenant-workorders?tenant_id=7')).body).Hold_Reason, 'waiting on a part, ETA Friday', 'tenant sees the new hold reason');
await call('/wo/admin-update', { method: 'POST', body: { wo_id: 'WO-3001', admin_name: 'Admin', fields: { Hold_Reason: '' } } });
eq(cell('Hold_Reason'), '', 'clearHoldReason() empties the field');
// Clearing must not disturb the private fields sitting beside it.
eq(cell('Entry_Notes'), S.entry, 'clearing Hold_Reason left Entry_Notes intact');
eq(cell('Admin_Notes'), S.admin, 'clearing Hold_Reason left Admin_Notes intact');

// ── create-form compose fields (createWorkOrder) ─────────────────────────────
section('create form — hold_reason set directly, entry_notes appended attributed');
reset();
const { handleIntake: _hi } = mod; void _hi;
const createWorkOrder = mod.createWorkOrder;
let cr = await (await createWorkOrder(ENV(), {
  property_id: '10', trade: 'Plumbing', description: 'Leak',
  hold_reason: 'waiting on a part', entry_notes: 'lockbox is red', created_by: 'admin',
})).json();
eq(cr.success, true, 'WO created');
const created = SHEETS.Work_Orders.find(r => r[WO_HEADERS.indexOf('ID')] === cr.id);
const cell2 = (name) => created[WO_HEADERS.indexOf(name)];
eq(cell2('Hold_Reason'), 'waiting on a part', 'hold_reason written directly (replace)');
eq(/^\[.+ — Admin\] lockbox is red$/.test(cell2('Entry_Notes')), true, 'entry_notes appended and attributed to Admin');
eq(cell2('Notes'), '', 'legacy Notes untouched');

section('create form — blank compose fields write nothing');
reset();
cr = await (await createWorkOrder(ENV(), { property_id: '10', trade: 'Plumbing', description: 'x', created_by: 'admin' })).json();
const created2 = SHEETS.Work_Orders.find(r => r[WO_HEADERS.indexOf('ID')] === cr.id);
eq(created2[WO_HEADERS.indexOf('Entry_Notes')], '', 'no entry note when the box is empty');
eq(created2[WO_HEADERS.indexOf('Hold_Reason')], '', 'no hold reason when the box is empty');

section('intake create path does not double-write Entry_Notes');
reset();
const handleIntake = mod.handleIntake;
const BUILDIUM_EMAIL = {
  sender: 'Buildium <donotreply@managebuilding.com>',
  subject: 'Phoenix Estate Rentals, LLC: Work order 838106',
  message_id: 'msg-entry-1',
  html: `<p>Work order #838106-9: Leaking toilet</p><p>Job description</p><p>Water pooling.</p>` +
        `<p>Entry details</p><p>Pets: Yes - Cat</p>` +
        `<p>Location</p><p>1110 N Dukeland St - 1</p><p>Baltimore, MD 21216</p>`,
  plaintext: '',
};
await (await handleIntake(ENV(), BUILDIUM_EMAIL)).json();
const iwo = SHEETS.Work_Orders[SHEETS.Work_Orders.length - 1];
const entryLines = iwo[WO_HEADERS.indexOf('Entry_Notes')].split('\n').filter(Boolean);
eq(entryLines.length, 1, 'intake writes exactly one Entry_Notes line (its own append, not also createWorkOrder)');
eq(/— Owner\/Buildium\]/.test(entryLines[0]), true, 'and keeps the Owner/Buildium attribution');

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
if (fail) process.exit(1);
