// Oct 27 2026 (Brett): animals + access & cooperation + per-area "No access" on the field inspection, property size on the booking
// request, and approved bookings feeding New inspection (existing owner reused, never duplicated). Runs the REAL worker code against
// the in-memory Sheets fake (test/_fi-world.mjs), including forced failures (nothing may report success on a failed write).
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 600) : ''); } };
const thr = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const etDate = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
const DAY = 86400000;

// ── 1. property size on the booking request ──
{
  const w = world();
  const ok = w.inspCleanSize({ levels: '2', bedrooms: '3', bathrooms: '1.5' }, 1);
  t('size: numbers kept', ok.Levels === '2' && ok.Bedrooms === '3' && ok.Bathrooms === '1.5', ok);
  const unk = w.inspCleanSize({ levels: 'unknown', bedrooms: 'unknown', bathrooms: 'unknown' }, 1);
  t('size: "I don\'t know" bypass accepted for all three', unk.Levels === 'unknown' && unk.Bedrooms === 'unknown' && unk.Bathrooms === 'unknown');
  t('size: studio (0 bedrooms) is valid', w.inspCleanSize({ levels: '1', bedrooms: '0', bathrooms: '1' }, 1).Bedrooms === '0');
  const e1 = thr(() => w.inspCleanSize({ levels: '2', bedrooms: '3' }, 1));
  t('size: a missing field is rejected (required)', e1 && e1.code === 'bad_size' && e1.status === 400, e1 && e1.message);
  t('size: empty body rejected', thr(() => w.inspCleanSize({}, 1)).code === 'bad_size');
  t('size: levels 0 and 7 rejected', thr(() => w.inspCleanSize({ levels: '0', bedrooms: '1', bathrooms: '1' }, 1)).code === 'bad_size' && thr(() => w.inspCleanSize({ levels: '7', bedrooms: '1', bathrooms: '1' }, 1)).code === 'bad_size');
  t('size: 1.3 bathrooms and 2.5 bedrooms rejected', thr(() => w.inspCleanSize({ levels: '1', bedrooms: '1', bathrooms: '1.3' }, 1)).code === 'bad_size' && thr(() => w.inspCleanSize({ levels: '1', bedrooms: '2.5', bathrooms: '1' }, 1)).code === 'bad_size');
  t('size: text junk rejected', thr(() => w.inspCleanSize({ levels: 'abc', bedrooms: '1', bathrooms: '1' }, 1)).code === 'bad_size');
  const multi = w.inspCleanSize({ levels: '3', bedrooms: 'vary', bathrooms: '1' }, 10);
  t('size: multi-unit may say "vary"', multi.Bedrooms === 'vary' && multi.Bathrooms === '1', multi);
  t('size: a single unit cannot say "vary" (becomes unknown, never an error loop)', w.inspCleanSize({ levels: '1', bedrooms: 'vary', bathrooms: '1' }, 1).Bedrooms === 'unknown');
  t('size text: single', w.inspSizeText({ Units: '1', Bedrooms: '3', Bathrooms: '1.5', Levels: '2' }) === '3 beds / 1.5 baths, 2 levels', w.inspSizeText({ Units: '1', Bedrooms: '3', Bathrooms: '1.5', Levels: '2' }));
  t('size text: multi says each unit', w.inspSizeText({ Units: '10', Bedrooms: '1', Bathrooms: '1', Levels: '3' }) === 'each unit: 1 bed / 1 bath, 3 levels');
  t('size text: unknown and blank are left out', w.inspSizeText({ Units: '1', Bedrooms: 'unknown', Bathrooms: '', Levels: 'unknown' }) === '' && w.inspSizeText({ Units: '1' }) === '');
  t('size text: vary', w.inspSizeText({ Units: '4', Bedrooms: 'vary', Bathrooms: '1' }) === 'each unit: beds vary / 1 bath');
  t('duration is untouched by size (worker still sizes by units/buildings)', !/inspDurationMin\([^)]*(Bedrooms|bedrooms|Bathrooms)/.test(src));
}

// ── 2. doc validation: visit details + area access ──
{
  const w = world();
  const base = () => ({ v: 1, property: { address: '3572 Dudley Ave' }, areas: [{ id: 'a1', name: 'Roof & Gutters', issues: [] }] });
  const good = base(); good.visit = { animals: { present: true, items: [{ type: 'Dog', count: 2 }] }, access_cooperation: { choice: 'limited', note: 'Bathroom not accessed.' } };
  good.areas[0].access = { no_access: true, reason: 'tenant_declined', note: '' }; good.booking = { id: '7', contact: { name: 'Josiah' } };
  t('doc with visit + access + booking is valid', w.fiValidateDoc(good).ok, w.fiValidateDoc(good));
  t('doc without any of it is still valid (all optional)', w.fiValidateDoc(base()).ok);
  const bad = (mut) => { const d = base(); mut(d); return w.fiValidateDoc(d); };
  t('bad access reason rejected', !bad(d => { d.areas[0].access = { no_access: true, reason: 'rude' }; }).ok);
  t('empty reason allowed (the default is no reason)', bad(d => { d.areas[0].access = { no_access: true, reason: '', note: '' }; }).ok);
  t('access note over 500 rejected', !bad(d => { d.areas[0].access = { no_access: true, note: 'x'.repeat(501) }; }).ok);
  t('access must be an object', !bad(d => { d.areas[0].access = 'yes'; }).ok);
  t('bad coop choice rejected', !bad(d => { d.visit = { access_cooperation: { choice: 'hostile' } }; }).ok);
  t('empty coop choice allowed', bad(d => { d.visit = { access_cooperation: { choice: '', note: '' } }; }).ok);
  t('coop note over 600 rejected', !bad(d => { d.visit = { access_cooperation: { note: 'x'.repeat(601) } }; }).ok);
  t('more than 10 animal lines rejected', !bad(d => { d.visit = { animals: { present: true, items: Array.from({ length: 11 }, () => ({ type: 'Cat', count: 1 })) } }; }).ok);
  t('negative / huge animal count rejected', !bad(d => { d.visit = { animals: { items: [{ type: 'Dog', count: -1 }] } }; }).ok && !bad(d => { d.visit = { animals: { items: [{ type: 'Dog', count: 1000 }] } }; }).ok);
  t('animal type over 60 rejected', !bad(d => { d.visit = { animals: { items: [{ type: 'x'.repeat(61), count: 1 }] } }; }).ok);
  t('visit must be an object; booking must be an object', !bad(d => { d.visit = []; }).ok && !bad(d => { d.booking = 'x'; }).ok);
}

// ── 3. publish checks: "No access" counts as handled ──
{
  const w = world();
  const doc = (areas) => ({ v: 1, property: { address: 'x' }, owner: { name: 'Premier' }, overall: { condition: 'fair' }, areas });
  const A = (name, extra) => Object.assign({ id: 'id' + name, name, condition: 'not_inspected', issues: [] }, extra || {});
  let r = w.fiPublishChecks(doc([A('Roof', { access: { no_access: true, reason: '', note: '' } }), A('Kitchen', { condition: 'good' })]), []);
  t('no-access area is NOT listed as "not inspected"', !r.warnings.some(x => x.code === 'areas_not_inspected') && !r.blocks.length, r);
  r = w.fiPublishChecks(doc([A('Roof', { access: { no_access: true } }), A('Attic')]), []);
  const wn = r.warnings.find(x => x.code === 'areas_not_inspected');
  t('a genuinely skipped area still warns, and only that one', wn && wn.areas.length === 1 && wn.areas[0] === 'Attic', r);
  r = w.fiPublishChecks(doc([A('Bathroom', { access: { no_access: true, reason: 'other', note: '' } })]), []);
  t('"Other" without a description blocks publishing', r.blocks.some(b => b.code === 'access_reason_missing'), r);
  r = w.fiPublishChecks(doc([A('Bathroom', { access: { no_access: true, reason: 'other', note: 'Resident asked me to leave.' } })]), []);
  t('"Other" with a description publishes', !r.blocks.length, r);
  r = w.fiPublishChecks(doc([A('Bathroom', { access: { no_access: true, reason: 'tenant_declined' } })]), []);
  t('"Tenant declined" needs no note', !r.blocks.length, r);
}

// ── 4. save keeps visit/access/booking byte-for-byte; the public report never shows the booking ──
{
  const w = world();
  const doc = { v: 1, id: 'fi_vb000001', date: '2026-10-27', property: { source: 'hub', id: '97', address: '3572 Dudley Ave, Baltimore, MD 21213', street: '3572 Dudley Ave' }, owner: { id: '25', name: 'Premier Property Management', source: 'hub' }, overall: { condition: 'fair', notes: '' },
    visit: { animals: { present: true, items: [{ type: 'Dog', count: 2 }] }, access_cooperation: { choice: 'limited', note: 'Bathroom was not accessed.' } },
    booking: { id: '41', contact: { name: 'Josiah', phone: '+14105550100', email: 'j@premier.example' }, notes: 'Key under mat' },
    areas: [{ id: 'a1', name: 'Roof & Gutters', group: 'exterior', condition: 'not_inspected', excluded: false, issues: [], photo_ids: [], access: { no_access: true, reason: '', note: '' } }, { id: 'a2', name: 'Kitchen', group: 'interior', condition: 'good', issues: [], photo_ids: [] }] };
  const s = await w.fiSave(w.env, { id: doc.id, base_rev: 0, doc, meta: { inspection_date: doc.date } });
  t('save ok', s.status === 200 && s.body.ok, s.body);
  const g = await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + doc.id));
  t('visit details survive save + read-back', JSON.stringify(g.body.doc.visit) === JSON.stringify(doc.visit), g.body.doc && g.body.doc.visit);
  t('area access survives save + read-back', JSON.stringify(g.body.doc.areas[0].access) === JSON.stringify(doc.areas[0].access));
  t('booking survives save + read-back (internal copy)', g.body.doc.booking && g.body.doc.booking.contact.name === 'Josiah');
  const bad = JSON.parse(JSON.stringify(doc)); bad.id = 'fi_vb000002'; bad.areas[0].access.reason = 'rude';
  const sb = await w.fiSave(w.env, { id: bad.id, base_rev: 0, doc: bad, meta: {} });
  t('a bad access reason is refused by save, nothing written', sb.status === 400 && sb.body.error === 'invalid_doc' && !(w.h.tabs.FI_Inspections.rows.some(r => r && r.includes('fi_vb000002'))), sb.body);
  const adminReq = { headers: { get: (k) => (k === 'X-Auth-Token' ? 'sek' : '') } };
  const rep = await w.fiReport(w.env, adminReq, new URL('https://x/fi/report?r=' + s.body.report_token));
  t('report keeps visit details + access', rep.status === 200 && rep.body.doc.visit.animals.present === true && rep.body.doc.areas[0].access.no_access === true, rep.body);
  t('report NEVER carries the booking (requester phone/email/notes)', rep.body.doc.booking === undefined && !JSON.stringify(rep.body).includes('j@premier.example') && !JSON.stringify(rep.body).includes('Key under mat'));
}

// ── 5. approved bookings list ──
const seedBookings = (w) => {
  const tb = (n, headers, rows) => { w.h.tabs[n] = { headers, rows }; };
  const today = Date.now();
  tb('Owners', ['ID', 'Company', 'First_Name', 'Last_Name', 'Phone', 'Email', 'Active'], [['25', 'Premier Property Management', '', '', '', '', 'TRUE'], ['26', 'Other Owner LLC', '', '', '', '', 'TRUE']]);
  tb('Properties', ['ID', 'Address', 'City', 'Type', 'Unit_Count', 'Owner_ID', 'Active'], [['97', '3572 Dudley Avenue', 'Baltimore', 'house', '1', '25', 'TRUE'], ['96', '3133 Dudley Ave', 'Baltimore', 'house', '1', '25', 'TRUE']]);
  tb('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], []);
  tb('Insp_Customers', ['ID', 'Name', 'Line', 'Contact_Name', 'Contact_Phone', 'Contact_Email', 'Notes', 'Active', 'Created_Date', 'Book_Token', 'Key_Address', 'Key_Pickup_Min', 'Hub_Owner_ID'],
    [['1', 'Premier Property Management', 'rental', 'Josiah', '', '', '', 'TRUE', '2026-10-01', 'tok1', '', '', '25'], ['2', 'Brand New Partner', 'rental', '', '', '', '', 'TRUE', '2026-10-01', 'tok2', '', '', '']]);
  const H = ['ID', 'Customer_ID', 'Status', 'Address', 'Formatted_Address', 'Units', 'Buildings', 'Date', 'Start_Time', 'Start_ISO', 'End_ISO', 'Contact_Name', 'Contact_Phone', 'Contact_Email', 'Notes', 'Active', 'Levels', 'Bedrooms', 'Bathrooms', 'Inspection_ID', 'Hub_Property_ID', 'Insp_Claimed_At'];
  const row = (id, cust, status, addr, fmt, units, dayOff, extra) => { const ms = today + dayOff * DAY; return [id, cust, status, addr, fmt, String(units), '1', etDate(ms), '10:00 AM', new Date(ms).toISOString(), new Date(ms + 3600000).toISOString(), 'Josiah', '+14105550100', 'j@premier.example', 'Key under mat', 'TRUE', '2', '3', '1', '', '', ''].map((v, i) => (extra && extra[H[i]] !== undefined ? extra[H[i]] : v)); };
  tb('Insp_Bookings', H, [
    row('41', '1', 'approved', '3572 Dudley Ave', '3572 Dudley Ave, Baltimore, MD 21213, USA', 1, 0),
    row('42', '1', 'pending', '1 Pending St', '1 Pending St, Baltimore, MD, USA', 1, 1),
    row('43', '1', 'declined', '2 Declined St', '2 Declined St, Baltimore, MD, USA', 1, 1),
    row('44', '1', 'approved', '9 Old Rd', '9 Old Rd, Baltimore, MD, USA', 1, -60),
    row('45', '1', 'approved', '3207 Cliffmont Ave', '3207 Cliffmont Ave, Baltimore, MD 21213, USA', 1, 1, { Inspection_ID: 'fi_done000001' }),
    row('46', '2', 'approved', '500 New St', '500 New St, Baltimore, MD 21201, USA', 12, 2, { Bedrooms: 'vary', Bathrooms: '1' }),
    row('47', '1', 'approved', '3133 Dudley Ave', '3133 Dudley Ave, Baltimore, MD 21213, USA', 1, 0, { Inspection_ID: 'fi_lost0000001' }),
  ]);
  tb('FI_Inspections', w.FI_INSP_HEADERS, []);
};
{
  const w = world(); seedBookings(w);
  // an inspection that really exists for booking 45; booking 47's claim points at one that never reached the server
  await w.fiSave(w.env, { id: 'fi_done000001', base_rev: 0, doc: { v: 1, property: { address: '3207 Cliffmont Ave' }, areas: [] }, meta: {} });
  const r = await w.fiBookings(w.env);
  const ids = r.body.bookings.map(b => b.id);
  t('only approved, in-window bookings are listed', ids.includes('41') && ids.includes('46') && !ids.includes('42') && !ids.includes('43') && !ids.includes('44'), ids);
  t('a booking already turned into a real inspection is hidden', !ids.includes('45'), ids);
  t('a claim whose inspection never reached the server is offered again', ids.includes('47'), ids);
  const b41 = r.body.bookings.find(b => b.id === '41');
  t('owner resolved from the explicit Hub_Owner_ID link (existing record 25)', b41.owner && b41.owner.id === '25' && b41.owner.name === 'Premier Property Management', b41.owner);
  t('existing Hub property matched across Ave / Avenue', b41.property && b41.property.id === '97', b41.property);
  t('contact, notes and size come through', b41.contact.name === 'Josiah' && b41.notes === 'Key under mat' && b41.size.text === '3 beds / 1 bath, 2 levels', b41);
  const b46 = r.body.bookings.find(b => b.id === '46');
  t('unknown partner: no owner guessed, no property yet', b46.owner === null && b46.property === null, b46);
  t('multi-unit size reads "each unit"', /^each unit: beds vary/.test(b46.size.text), b46.size.text);
  t('address label drops ", USA"', b41.address === '3572 Dudley Ave, Baltimore, MD 21213', b41.address);
  // owner by exact company name when no explicit link is set
  w.h.tabs.Insp_Customers.rows[0][12] = '';
  const r2 = await w.fiBookings(w.env);
  t('owner falls back to an exact company-name match', r2.body.bookings.find(b => b.id === '41').owner.id === '25');
  // a duplicate-name owner must NOT be guessed
  w.h.tabs.Owners.rows.push(['27', 'Premier Property Management', '', '', '', '', 'TRUE']);
  const r3 = await w.fiBookings(w.env);
  t('two owners with the same name: not guessed (no silent wrong owner)', r3.body.bookings.find(b => b.id === '41').owner === null);
}

// ── 6. tapping a booking: existing owner + property reused, claim written and verified ──
{
  const w = world(); seedBookings(w);
  const before = { owners: w.h.tabs.Owners.rows.length, props: w.h.tabs.Properties.rows.length };
  const r = await w.fiBookingStart(w.env, { booking_id: '41', inspection_id: 'fi_vb100001' });
  t('start ok', r.status === 200 && r.body.ok, r.body);
  t('reuses the EXISTING owner (no duplicate created)', w.h.tabs.Owners.rows.length === before.owners && r.body.owner.id === '25');
  t('reuses the EXISTING property (no duplicate created)', w.h.tabs.Properties.rows.length === before.props && r.body.property.id === '97' && r.body.property_created === false);
  const row = w.h.tabs.Insp_Bookings.rows.find(x => x[0] === '41'), H = w.h.tabs.Insp_Bookings.headers;
  t('claim written and read back on the booking row', row[H.indexOf('Inspection_ID')] === 'fi_vb100001' && row[H.indexOf('Hub_Property_ID')] === '97' && !!row[H.indexOf('Insp_Claimed_At')]);
  t('the label the phone uses includes state + zip', r.body.property.address === '3572 Dudley Ave, Baltimore, MD 21213');
  t('claimed booking no longer offered once its inspection exists', await (async () => { await w.fiSave(w.env, { id: 'fi_vb100001', base_rev: 0, doc: { v: 1, property: { address: '3572 Dudley Ave' }, areas: [] }, meta: {} }); return !(await w.fiBookings(w.env)).body.bookings.some(b => b.id === '41'); })());
  const again = await w.fiBookingStart(w.env, { booking_id: '41', inspection_id: 'fi_vb100002' });
  t('a second inspection cannot grab a booking that already has one', again.status === 409 && again.body.error === 'already_started' && again.body.inspection_id === 'fi_vb100001', again.body);
  const same = await w.fiBookingStart(w.env, { booking_id: '41', inspection_id: 'fi_vb100001' });
  t('re-linking the same inspection is idempotent', same.status === 200 && w.h.tabs.Properties.rows.length === before.props);
  t('unknown booking -> 404', (await w.fiBookingStart(w.env, { booking_id: '999', inspection_id: 'fi_vb100003' })).status === 404);
  t('pending booking -> 409 not_approved', (await w.fiBookingStart(w.env, { booking_id: '42', inspection_id: 'fi_vb100003' })).body.error === 'not_approved');
  t('bad inspection id -> 400', (await w.fiBookingStart(w.env, { booking_id: '41', inspection_id: '!!' })).status === 400);
  t('missing booking id -> 400', (await w.fiBookingStart(w.env, { inspection_id: 'fi_vb100004' })).status === 400);
  // stale claim (inspection never saved) can be taken over
  const take = await w.fiBookingStart(w.env, { booking_id: '47', inspection_id: 'fi_vb100005' });
  t('a claim with no saved inspection can be taken over', take.status === 200 && take.body.property.id === '96');
}
{
  // new property is created UNDER THE EXISTING OWNER (never a new owner); unknown partner -> nothing guessed
  const w = world(); seedBookings(w);
  w.h.tabs.Insp_Bookings.rows.push(['48', '1', 'approved', '77 Fresh St', '77 Fresh St, Baltimore, MD 21201, USA', '1', '1', etDate(Date.now()), '10:00 AM', new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), 'Josiah', '', '', '', 'TRUE', '1', '2', '1', '', '', '']);
  const owners0 = w.h.tabs.Owners.rows.length;
  const r = await w.fiBookingStart(w.env, { booking_id: '48', inspection_id: 'fi_vb200001' });
  t('new property created', r.status === 200 && r.body.property_created === true && r.body.property.street === '77 Fresh St', r.body);
  t('...under the existing owner 25; no owner created', w.h.tabs.Owners.rows.length === owners0 && w.h.tabs.Properties.rows.find(x => x[1] === '77 Fresh St')[5] === '25');
  t('...and the booking points at it', w.h.tabs.Insp_Bookings.rows.find(x => x[0] === '48')[w.h.tabs.Insp_Bookings.headers.indexOf('Hub_Property_ID')] === r.body.property.id);
  const unk = await w.fiBookingStart(w.env, { booking_id: '46', inspection_id: 'fi_vb200002' });
  t('unknown partner: nothing is created, the phone is told to choose the owner', unk.status === 200 && unk.body.owner_missing === true && unk.body.property === null && w.h.tabs.Properties.rows.length === 3 && w.h.tabs.Owners.rows.length === owners0, unk.body);
}

// ── 7. fault injection: failures are reported and never claim success ──
{
  const w = world(); seedBookings(w);
  w.h.updateFail = true;
  const r = await w.fiRoute(w.env, 'booking-start', () => w.fiBookingStart(w.env, { booking_id: '41', inspection_id: 'fi_vb300001' }));
  t('claim write failure -> 500, not a success', r.status === 500 && r.body.ok === false, r.body);
  t('...it was reported to telemetry', w.h.telemetry.some(x => x.Success === 'FALSE' && /booking-start/.test(x.Skill_Or_Endpoint)), w.h.telemetry);
  t('...and the booking was not marked started', !w.h.tabs.Insp_Bookings.rows.find(x => x[0] === '41')[w.h.tabs.Insp_Bookings.headers.indexOf('Inspection_ID')]);
  w.h.updateFail = false;
  const ok = await w.fiRoute(w.env, 'booking-start', () => w.fiBookingStart(w.env, { booking_id: '41', inspection_id: 'fi_vb300001' }));
  t('happy path reports nothing', ok.status === 200 && w.h.telemetry.length === 1);
  const w2 = world(); seedBookings(w2); w2.h.dropAdd = 'Properties';
  w2.h.tabs.Insp_Bookings.rows.push(['49', '1', 'approved', '8 Lost St', '8 Lost St, Baltimore, MD, USA', '1', '1', etDate(Date.now()), '10:00 AM', new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), 'J', '', '', '', 'TRUE', '1', '1', '1', '', '', '']);
  const lost = await w2.fiRoute(w2.env, 'booking-start', () => w2.fiBookingStart(w2.env, { booking_id: '49', inspection_id: 'fi_vb300002' }));
  t('property write that did not persist -> error, booking NOT claimed', lost.body.ok === false && !w2.h.tabs.Insp_Bookings.rows.find(x => x[0] === '49')[w2.h.tabs.Insp_Bookings.headers.indexOf('Inspection_ID')], lost.body);
}

// ── 8. neutral rewording is a suggestion only ──
{
  const w = world();
  w.h.ai = JSON.stringify({ text: 'The occupant declined access to the bathroom.' });
  const r = await w.fiReword(w.env, { text: 'resident was super rude and wouldnt let me in the bathroom for no reason' });
  t('reword returns text', r.status === 200 && r.body.text === 'The occupant declined access to the bathroom.', r.body);
  t('reword is a customer-facing job (strongest model)', w.h.calls.some(c => /AI fi_reword customerFacing=true/.test(c)), w.h.calls);
  t('reword writes nothing to any sheet', !w.h.calls.some(c => /^(PUT|POST) \/values/.test(c)), w.h.calls);
  t('empty note -> 400', (await w.fiReword(w.env, { text: '  ' })).status === 400);
  w.h.ai = new Error('boom');
  const f = await w.fiReword(w.env, { text: 'x' });
  t('AI failure -> 502 that says the note is kept', f.status === 502 && /kept exactly/.test(f.body.message), f.body);
  w.h.ai = 'not json at all';
  const g = await w.fiReword(w.env, { text: 'x' });
  t('garbage AI output -> 502, never a made-up rewording', g.status === 502 && g.body.ok === false, g.body);
  t('prompt forbids attitude words and speculation', /never rude/i.test(w.FI_REWORD_SYSTEM) && /No guesses about reasons/i.test(w.FI_REWORD_SYSTEM) && /Do not add any fact/i.test(w.FI_REWORD_SYSTEM));
}

// ── 9. wiring: routes, staging guard, front ends ──
{
  t('routes wired', /path === '\/fi\/bookings'/.test(src) && /path === '\/fi\/booking\/start'/.test(src) && /path === '\/fi\/reword'/.test(src));
  t('staging write guard: booking start only for TEST- booking + TEST- inspection', /path === '\/fi\/booking\/start'\) \{[^}]*TEST-/.test(src) && /startsWith\('TEST-'\)/.test(src.slice(src.indexOf("path === '/fi/booking/start') {")), src.indexOf("path === '/fi/booking/start') {") + 500)));
  t('booking request validates size BEFORE placing the calendar hold', src.indexOf('inspCleanSize(body, input.units)') > 0 && src.indexOf('inspCleanSize(body, input.units)') < src.indexOf('Reserve the slot on Brett'));
  t('size reaches the sheet row, the text to Brett and the calendar event', /Levels: size\.Levels, Bedrooms: size\.Bedrooms, Bathrooms: size\.Bathrooms/.test(src) && /Size: \$\{inspSizeText\(rec\)/.test(src) && /`Size: \$\{inspSizeText\(b\)/.test(src));
  const fi = read('field-inspect.html'), rep = read('inspection-report.html'), bk = read('inspect-book.html');
  t('app: approved bookings, start, link', /\/fi\/bookings/.test(fi) && /\/fi\/booking\/start/.test(fi) && /function startFromBooking/.test(fi) && /function linkBooking/.test(fi));
  t('app: visit details sheet + animals + access & cooperation + neutral reword (suggestion only)', /function visitSheet/.test(fi) && /Animals present\?/.test(fi) && /Use this wording/.test(fi) && /Keep mine/.test(fi));
  t('app: a No-access button on every area, reasons per Brett', /function accessHtml/.test(fi) && /No access to this area/.test(fi) && /Tenant declined access/.test(fi) && /Area blocked/.test(fi) && /Other \(describe\)/.test(fi) && /h \+= accessHtml\(a\)/.test(fi));
  t('app: access & cooperation defaults to nothing', /access_cooperation:\{ choice:'', note:'' \}/.test(fi));
  t('report: Areas not accessed + visit details, neutral wording', /Areas not accessed/.test(rep) && /Access declined by occupant/.test(rep) && /function visitHtml/.test(rep));
  t('report: nothing printed for an empty Access & cooperation', /if \(lab \|\| note\)/.test(rep));
  t('booking page: levels / bedrooms / bathrooms required with "I don\'t know"', /id="s-lv"|'s-lv'/.test(bk) && /I don’t know/.test(bk) && /Please choose levels, bedrooms and bathrooms/.test(bk) && /They vary/.test(bk));
  t('approval page shows property size', /Property size/.test(bk) && /function sizeText/.test(bk));
}
console.log(`fi-visit-bookings: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
