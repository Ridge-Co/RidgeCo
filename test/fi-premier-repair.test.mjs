// Oct 27 2026 (Brett): one-time Premier repair. Links the booking partner to its EXISTING Hub owner, and ties already-started inspections to their
// approved bookings (address + date must match). Additive only; a dry run (the default) writes nothing; every real write is read back.
// Runs the REAL worker code against the in-memory Sheets fake (test/_fi-world.mjs), including forced write failures.
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 700) : ''); } };
const etDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DAY = 86400000, now = Date.now(), D0 = etDate(now), D1 = etDate(now - 12 * DAY);

async function seed() {
  const w = world();
  const tb = (n, headers, rows) => { w.h.tabs[n] = { headers, rows }; };
  tb('Owners', ['ID', 'Company', 'First_Name', 'Last_Name', 'Phone', 'Email', 'Active'], [['25', 'Premier Property Management', '', '', '', '', 'TRUE'], ['26', 'Other Owner LLC', '', '', '', '', 'TRUE']]);
  tb('Properties', ['ID', 'Address', 'City', 'Type', 'Unit_Count', 'Owner_ID', 'Active'], [['97', '3572 Dudley Avenue', 'Baltimore', 'house', '1', '25', 'TRUE']]);
  tb('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], []);
  tb('Insp_Customers', ['ID', 'Name', 'Line', 'Contact_Name', 'Contact_Phone', 'Contact_Email', 'Notes', 'Active', 'Created_Date', 'Book_Token', 'Key_Address', 'Key_Pickup_Min', 'Hub_Owner_ID'],
    [['2', 'Premier Property Management', 'rental', 'Josiah Speed', '+16674158226', 'josiah@example.test', '', 'TRUE', '2026-10-07', 'tokP', '', '', ''], ['3', 'Other Partner', 'rental', '', '', '', '', 'TRUE', '2026-10-07', 'tokO', '', '', '26']]);
  const H = ['ID', 'Customer_ID', 'Status', 'Address', 'Formatted_Address', 'Units', 'Buildings', 'Date', 'Start_Time', 'Start_ISO', 'End_ISO', 'Contact_Name', 'Contact_Phone', 'Contact_Email', 'Notes', 'Active', 'Levels', 'Bedrooms', 'Bathrooms', 'Inspection_ID', 'Hub_Property_ID', 'Insp_Claimed_At'];
  const bk = (id, cust, status, addr, fmt, date) => [id, cust, status, addr, fmt, '1', '1', date, '12:00 PM', date + 'T16:00:00.000Z', date + 'T16:40:00.000Z', 'Josiah Speed', '+16674158226', 'josiah@example.test', 'keys at office', 'TRUE', '', '', '', '', '', ''];
  tb('Insp_Bookings', H, [
    bk('4', '2', 'approved', '3572 Dudley Avenue', '3572 Dudley Ave, Baltimore, MD 21213, USA', D0),
    bk('2', '2', 'approved', '122 S Gilmor Street', '122 S Gilmor St, Baltimore, MD 21223, USA', D1),
    bk('5', '2', 'approved', '3572 Dudley Avenue', '3572 Dudley Ave, Baltimore, MD 21213, USA', etDate(now + 9 * DAY)),   // same address, different day
    bk('6', '2', 'pending', '9 Pending St', '9 Pending St, Baltimore, MD, USA', D0),
    bk('7', '3', 'approved', '5 Other St', '5 Other St, Baltimore, MD, USA', D0),
  ]);
  tb('FI_Inspections', w.FI_INSP_HEADERS, []);
  await w.fiSave(w.env, { id: 'fi_dudley00001', base_rev: 0, doc: { v: 1, date: D0, property: { source: 'hub', id: '97', address: '3572 Dudley Ave, Baltimore, MD 21213', street: '3572 Dudley Ave' }, owner: { id: '25', name: 'Premier Property Management', source: 'hub' }, areas: [] }, meta: { inspection_date: D0 } });
  await w.fiSave(w.env, { id: 'fi_gilmor00001', base_rev: 0, doc: { v: 1, date: D1, property: { address: '122 S Gilmor St, Baltimore, MD' }, areas: [] }, meta: { inspection_date: D1 } });
  return w;
}
const cell = (w, tab, id, col) => { const tbl = w.h.tabs[tab], ix = tbl.headers.indexOf('ID'), r = tbl.rows.find(x => x && String(x[ix]) === String(id)); return r ? r[tbl.headers.indexOf(col)] : undefined; };
const snap = (w) => JSON.stringify(['Owners', 'Properties', 'Insp_Customers', 'Insp_Bookings', 'FI_Inspections'].map(n => w.h.tabs[n].rows));
const LINKS = [{ booking_id: '4', inspection_id: 'fi_dudley00001' }, { booking_id: '2', inspection_id: 'fi_gilmor00001', doc: true }];
const run = (w, body) => w.fiRoute(w.env, 'premier-repair', () => w.fiPremierRepair(w.env, body));

// ── 1. a dry run (the default) writes nothing and says what it would do ──
{
  const w = await seed(), before = snap(w);
  const r = await run(w, { customer_id: '2', owner_id: '25', links: LINKS });
  t('dry run is ok', r.status === 200 && r.body.ok && r.body.dry_run === true, r.body);
  t('dry run plans the partner link + both claims', r.body.steps.filter(s => s.status === 'planned').length === 3, r.body.steps);
  t('dry run writes NOTHING (no cell changed, no row added)', snap(w) === before);
  t('dry run says which property each link will use (reuse #97, or create new)', r.body.steps.some(x => /property #97/.test(x.detail)) && r.body.steps.some(x => /creates a new property under owner 25/.test(x.detail)), r.body.steps);
  const r2 = await run(w, { customer_id: '2', owner_id: '25', links: LINKS, dry_run: 'false' });
  t('only a real boolean false turns the dry run off', r2.body.dry_run === true && snap(w) === before);
}

// ── 2. the real run ──
{
  const w = await seed();
  const owners0 = w.h.tabs.Owners.rows.length, props0 = w.h.tabs.Properties.rows.length, rev0 = cell(w, 'FI_Inspections', 'fi_dudley00001', 'Rev');
  const ownersBefore = JSON.stringify(w.h.tabs.Owners.rows);
  const r = await run(w, { customer_id: '2', owner_id: '25', links: LINKS, dry_run: false });
  t('real run ok', r.status === 200 && r.body.ok && r.body.dry_run === false, r.body);
  t('partner linked to the EXISTING owner record', cell(w, 'Insp_Customers', '2', 'Hub_Owner_ID') === '25');
  t('no duplicate owner created', w.h.tabs.Owners.rows.length === owners0);
  t('owner phone / email / name are NOT touched (that stays a separate decision)', JSON.stringify(w.h.tabs.Owners.rows) === ownersBefore);
  t('Dudley booking claimed by the existing inspection, existing property 97', cell(w, 'Insp_Bookings', '4', 'Inspection_ID') === 'fi_dudley00001' && cell(w, 'Insp_Bookings', '4', 'Hub_Property_ID') === '97' && !!cell(w, 'Insp_Bookings', '4', 'Insp_Claimed_At'));
  t('Dudley inspection itself is NOT edited (no version bump, so a phone mid-edit never conflicts)', cell(w, 'FI_Inspections', 'fi_dudley00001', 'Rev') === rev0);
  t('Gilmor booking claimed', cell(w, 'Insp_Bookings', '2', 'Inspection_ID') === 'fi_gilmor00001');
  t('Gilmor got a Hub property under the EXISTING owner (one new property)', w.h.tabs.Properties.rows.length === props0 + 1 && w.h.tabs.Properties.rows[w.h.tabs.Properties.rows.length - 1][w.h.tabs.Properties.headers.indexOf('Owner_ID')] === '25');
  const gp = cell(w, 'Insp_Bookings', '2', 'Hub_Property_ID');
  t('Gilmor inspection row now carries owner 25 + that property', cell(w, 'FI_Inspections', 'fi_gilmor00001', 'Owner_ID') === '25' && cell(w, 'FI_Inspections', 'fi_gilmor00001', 'Property_ID') === gp && !!gp);
  const gdoc = JSON.parse(w.fiJoinRow(w.h.tabs.FI_Inspections.rows.length ? (() => { const tbl = w.h.tabs.FI_Inspections, o = {}; const row = tbl.rows.find(x => x[0] === 'fi_gilmor00001'); tbl.headers.forEach((k, i) => { o[k] = row[i]; }); return o; })() : {}));
  t('Gilmor doc keeps its own address text and gains owner + booking', gdoc.property.address === '122 S Gilmor St, Baltimore, MD' && gdoc.owner.id === '25' && gdoc.booking.id === '2' && gdoc.property.id === gp, gdoc);
  t('Gilmor edit was version-checked (rev went up exactly once)', cell(w, 'FI_Inspections', 'fi_gilmor00001', 'Rev') === '2');
  t('booking no longer offered in the approved list (both started)', !(await w.fiBookings(w.env)).body.bookings.some(b => b.id === '4' || b.id === '2'));
  // ── idempotent ──
  const mid = snap(w);
  const again = await run(w, { customer_id: '2', owner_id: '25', links: LINKS, dry_run: false });
  t('second run is ok and does nothing', again.body.ok && snap(w) === mid && again.body.steps.every(s => s.status === 'skipped'), again.body.steps);
}

// ── 3. refusals: wrong day, not approved, another partner's, already linked elsewhere ──
{
  const w = await seed(); const before = snap(w);
  const wrongDay = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '5', inspection_id: 'fi_dudley00001' }] });
  t('same address but a different day is refused (address + date must match)', wrongDay.status === 409 && wrongDay.body.steps.some(s => s.status === 'conflict' && /date/.test(s.detail)), wrongDay.body);
  const pend = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '6', inspection_id: 'fi_dudley00001' }] });
  t('a pending booking is refused', pend.status === 409 && pend.body.steps.some(s => s.status === 'conflict'));
  const other = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '7', inspection_id: 'fi_dudley00001' }] });
  t("another partner's booking is refused", other.status === 409 && other.body.steps.some(s => s.status === 'conflict'));
  t('refused links claimed nothing', ['4', '5', '6', '7'].every(id => !cell(w, 'Insp_Bookings', id, 'Inspection_ID')));
  const wrongOwner = await run(w, { customer_id: '3', owner_id: '25', dry_run: false, links: [] });
  t('a partner already linked to a different owner is NOT relinked', wrongOwner.status === 409 && cell(w, 'Insp_Customers', '3', 'Hub_Owner_ID') === '26', wrongOwner.body);
  t('unknown partner / owner -> 404, bad input -> 400', (await run(w, { customer_id: '99', owner_id: '25' })).status === 404 && (await run(w, { customer_id: '2', owner_id: '99' })).status === 404 && (await run(w, { customer_id: '2' })).status === 400);
  // an inspection that already belongs to another owner is never taken over
  w.h.tabs.FI_Inspections.rows.find(x => x[0] === 'fi_dudley00001')[w.h.tabs.FI_Inspections.headers.indexOf('Owner_ID')] = '26';
  const own = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '4', inspection_id: 'fi_dudley00001' }] });
  t("an inspection that belongs to another owner is never taken over", own.status === 409 && !cell(w, 'Insp_Bookings', '4', 'Inspection_ID'), own.body);
  t('refusals changed no booking', cell(w, 'Insp_Bookings', '4', 'Inspection_ID') === '' || cell(w, 'Insp_Bookings', '4', 'Inspection_ID') === undefined);
  void before;
}

// ── 3b. property + published guards (independent review, Oct 27) ──
{
  const w = await seed(), ph = w.h.tabs.Properties.headers;
  w.h.tabs.Properties.rows.find(x => x[0] === '97')[ph.indexOf('Owner_ID')] = '26';
  const dry = await run(w, { customer_id: '2', owner_id: '25', links: [{ booking_id: '4', inspection_id: 'fi_dudley00001' }] });
  t("a same-address property that belongs to ANOTHER owner is refused, even on a dry run", dry.status === 409 && dry.body.steps.some(s => s.status === 'conflict' && /belongs to owner 26/.test(s.detail)), dry.body);
  const real = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '4', inspection_id: 'fi_dudley00001' }] });
  t('...and a real run claims nothing', real.status === 409 && !cell(w, 'Insp_Bookings', '4', 'Inspection_ID'));
}
{
  const w = await seed(), ph = w.h.tabs.Properties.headers, pc = w.h.tabs.Properties.rows.length;
  const dupe = w.h.tabs.Properties.rows[0].slice(); dupe[0] = '150'; w.h.tabs.Properties.rows.push(dupe);
  const r = await run(w, { customer_id: '2', owner_id: '25', links: [{ booking_id: '4', inspection_id: 'fi_dudley00001' }] });
  // both rows are owner 25 so fiBookingPropMatches narrows by owner and still has 2
  t('two properties at the same address -> refused, pick by hand', r.status === 409 && r.body.steps.some(s => /2 properties match/.test(s.detail)), r.body);
  void ph; void pc;
}
{
  const w = await seed(), fh = w.h.tabs.FI_Inspections.headers;
  w.h.tabs.FI_Inspections.rows.find(x => x[0] === 'fi_gilmor00001')[fh.indexOf('Status')] = 'published';
  const before = snap(w);
  const r = await run(w, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '2', inspection_id: 'fi_gilmor00001', doc: true }] });
  t('a PUBLISHED inspection is never edited (that would un-publish the report)', r.status === 409 && r.body.steps.some(s => /published/.test(s.detail)), r.body);
  t('...nothing was claimed, created or edited', cell(w, 'Insp_Bookings', '2', 'Inspection_ID') === '' || cell(w, 'Insp_Bookings', '2', 'Inspection_ID') === undefined);
  void before;
  const noDoc = await run(w, { customer_id: '2', owner_id: '25', links: [{ booking_id: '2', inspection_id: 'fi_gilmor00001' }] });
  t('a published inspection can still have its booking claimed without editing it (doc not requested)', noDoc.status === 200 && noDoc.body.steps.some(s => s.status === 'planned' && /claim booking/.test(s.detail)), noDoc.body);
}
{
  const w = await seed();
  w.h.tabs.Properties.rows.find(x => x[0] === '97')[w.h.tabs.Properties.headers.indexOf('Owner_ID')] = '25';
  const fh = w.h.tabs.FI_Inspections.headers;
  w.h.tabs.FI_Inspections.rows.find(x => x[0] === 'fi_gilmor00001')[fh.indexOf('Property_ID')] = '97';
  const r = await run(w, { customer_id: '2', owner_id: '25', links: [{ booking_id: '2', inspection_id: 'fi_gilmor00001', doc: true }] });
  t("an inspection already on a different property than the booking resolves to is refused", r.status === 409 && r.body.steps.some(s => /is on property 97/.test(s.detail)), r.body);
}

// ── 3c. owner contact copy (Brett's explicit yes, Oct 28): opt-in, blank cells only, phone + email only ──
{
  const w = await seed(), oh = w.h.tabs.Owners.headers, row25 = () => w.h.tabs.Owners.rows.find(x => x[0] === '25');
  const before = snap(w);
  const base = { customer_id: '2', owner_id: '25', links: [] };
  const off = await run(w, Object.assign({}, base, { dry_run: false }));
  t('without the flag the owner is never touched', off.body.ok && JSON.stringify(w.h.tabs.Owners.rows) === JSON.stringify(JSON.parse(before)[0]) && !off.body.steps.some(s => s.what === 'owner_contact'), off.body);
  const str = await run(w, Object.assign({}, base, { dry_run: false, copy_partner_contact: 'true' }));
  t('only a real boolean true enables the copy', !str.body.steps.some(s => s.what === 'owner_contact') && row25()[oh.indexOf('Phone')] === '');
  const dry = await run(w, Object.assign({}, base, { copy_partner_contact: true }));
  t('dry run plans the copy and writes nothing', dry.body.steps.some(s => s.what === 'owner_contact' && s.status === 'planned' && /Phone \+ Email/.test(s.detail)) && row25()[oh.indexOf('Phone')] === '' && row25()[oh.indexOf('Email')] === '', dry.body);
  const before2 = row25().slice();
  const real = await run(w, Object.assign({}, base, { dry_run: false, copy_partner_contact: true }));
  t('real run fills the blank Phone + Email from the partner contact', real.status === 200 && real.body.steps.some(s => s.what === 'owner_contact' && s.status === 'done') && row25()[oh.indexOf('Phone')] === '+16674158226' && row25()[oh.indexOf('Email')] === 'josiah@example.test', real.body);
  const changed = row25().map((v, i) => v !== before2[i] ? oh[i] : null).filter(Boolean);
  t('...and nothing else on the owner row changed (name, active, etc.)', changed.sort().join(',') === 'Email,Phone', changed);
  const again = await run(w, Object.assign({}, base, { dry_run: false, copy_partner_contact: true }));
  t('second run skips (idempotent)', again.body.steps.some(s => s.what === 'owner_contact' && s.status === 'skipped'));
}
{
  const w = await seed(), oh = w.h.tabs.Owners.headers, row25 = () => w.h.tabs.Owners.rows.find(x => x[0] === '25');
  row25()[oh.indexOf('Phone')] = '+14105550000';
  const r = await run(w, { customer_id: '2', owner_id: '25', links: [], dry_run: false, copy_partner_contact: true });
  t('an existing owner phone is NEVER overwritten (email still filled)', row25()[oh.indexOf('Phone')] === '+14105550000' && row25()[oh.indexOf('Email')] === 'josiah@example.test' && r.body.steps.some(s => s.what === 'owner_contact' && /Email/.test(s.detail) && !/Phone/.test(s.detail)), r.body);
  const w2 = await seed(); const ch = w2.h.tabs.Insp_Customers.headers;
  w2.h.tabs.Insp_Customers.rows.find(x => x[0] === '2')[ch.indexOf('Contact_Email')] = 'not-an-email';
  w2.h.tabs.Insp_Customers.rows.find(x => x[0] === '2')[ch.indexOf('Contact_Phone')] = '';
  const r2 = await run(w2, { customer_id: '2', owner_id: '25', links: [], dry_run: false, copy_partner_contact: true });
  t('no usable phone / email on the partner -> nothing copied, reported as skipped', r2.body.steps.some(s => s.what === 'owner_contact' && s.status === 'skipped') && w2.h.tabs.Owners.rows.find(x => x[0] === '25')[w2.h.tabs.Owners.headers.indexOf('Phone')] === '');
}

// ── 4. fault injection: a failed write is reported and never claims success ──
{
  const w = await seed();
  w.h.updateFail = true;
  const r = await run(w, { customer_id: '2', owner_id: '25', links: LINKS, dry_run: false });
  t('write failure -> 500 (not a success)', r.status === 500 && r.body.ok === false, r.body);
  t('...reported to telemetry (P1 data write)', w.h.telemetry.some(x => x.Success === 'FALSE' && /premier-repair/.test(x.Skill_Or_Endpoint)), w.h.telemetry);
  t('...and nothing was claimed or linked', !cell(w, 'Insp_Bookings', '4', 'Inspection_ID') && !cell(w, 'Insp_Customers', '2', 'Hub_Owner_ID'));
  w.h.updateFail = false;
  const ok = await run(w, { customer_id: '2', owner_id: '25', links: LINKS, dry_run: false });
  t('happy path reports nothing', ok.status === 200 && w.h.telemetry.length === 1);
  // the owner contact write failing (partner already linked, so the owner write is the only write): 500 + telemetry, owner cells untouched
  const w3 = await seed(); w3.h.tabs.Insp_Customers.rows.find(x => x[0] === '2')[w3.h.tabs.Insp_Customers.headers.indexOf('Hub_Owner_ID')] = '25';
  w3.h.updateFail = true;
  const oc = await run(w3, { customer_id: '2', owner_id: '25', links: [], dry_run: false, copy_partner_contact: true });
  t('owner contact write fails -> 500 (not a success), reported, owner cells still blank', oc.status === 500 && oc.body.ok === false && w3.h.telemetry.some(x => x.Success === 'FALSE' && /premier-repair/.test(x.Skill_Or_Endpoint)) && w3.h.tabs.Owners.rows.find(x => x[0] === '25')[w3.h.tabs.Owners.headers.indexOf('Phone')] === '', oc.body);
  // a property write that does not persist: the Gilmor link must stop, claim nothing, edit nothing
  const w2 = await seed(); w2.h.dropAdd = 'Properties';
  const lost = await run(w2, { customer_id: '2', owner_id: '25', dry_run: false, links: [{ booking_id: '2', inspection_id: 'fi_gilmor00001', doc: true }] });
  t('...a step-level error also reaches the failure log (not only the response)', w2.h.telemetry.some(x => x.Success === 'FALSE' && x.Job_Type === 'fi_premier_repair_error'), w2.h.telemetry);
  t('property that did not persist -> error, booking NOT claimed, inspection NOT edited', lost.body.ok === false && !cell(w2, 'Insp_Bookings', '2', 'Inspection_ID') && !cell(w2, 'FI_Inspections', 'fi_gilmor00001', 'Owner_ID'), lost.body);
}

// ── 5. wiring: reachable on production only through the reviewed allow-list; staging only for TEST- data ──
{
  t('route registered', /path === '\/admin\/fi-premier-repair'\)\s+return await fiRoute\(env, 'premier-repair'/.test(src));
  const list = src.match(/const HUB_PROD_WRITE_PATHS = \[[^\]]*\]/)[0];
  t('on the production write allow-list (additive-only class)', list.includes("'/admin/fi-premier-repair'"));
  const a = src.indexOf("path === '/admin/fi-premier-repair') { // staging may only"), seg = src.slice(a, a + 700);
  t('staging guard: a dry run is free, a real run needs a TEST- partner and TEST- inspections', a > 0 && /dry_run !== false\) return true/.test(seg) && /startsWith\('TEST-'\)/.test(seg));
  const fn = src.slice(src.indexOf('async function fiPremierRepair'), src.indexOf("// Neutral, factual rewording of the inspector's own note"));
  const ownerWrites = fn.match(/updateRowVerified\(env, 'Owners'[^;]*;|updateRow\(env, 'Owners'|addRow\(env, 'Owners'/g) || [];
  t('the ONLY Owners write is the opt-in blank-cell fill of Phone/Email (read back), inside the copy_partner_contact block', ownerWrites.length === 1 && /updateRowVerified\(env, 'Owners', ownerId, fill\)/.test(ownerWrites[0]) && fn.indexOf("copy_partner_contact === true") < fn.indexOf("updateRowVerified(env, 'Owners'") && /if \(ph && !String\(owner\.Phone/.test(fn) && /!String\(owner\.Email/.test(fn), ownerWrites);
  t('the staging guard keeps a contact copy on TEST- owners only', /copy_partner_contact === true\) \{[^}]*startsWith\('TEST-'\)/.test(src.slice(src.indexOf("path === '/admin/fi-premier-repair') { // staging may only"), src.indexOf("path === '/admin/fi-premier-repair') { // staging may only") + 1100)));
  t('never creates an owner', !/addRow\(env, 'Owners'/.test(fn) && !/owner:\s*\{\s*name/.test(fn));
}
console.log(`fi-premier-repair: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
