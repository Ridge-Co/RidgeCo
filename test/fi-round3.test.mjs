// Field Inspection round 3 (Oct 15 2026): searchable Hub directory, property + owner created together, owner on the report,
// and the per-property Drive folder ("<address>" / "Inspection MMDDYYYY"). Runs the REAL FI block against the in-memory fake.
import fs from 'fs';
import { world } from './_fi-world.mjs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 500) : ''); } };
const mkDoc = (over = {}) => Object.assign({ v: 1, date: '2026-10-15', property: { id: 'P9', unit_id: 'U9', address: '122 S Gilmor St, Baltimore, MD 21223' }, owner: { id: 'O1', name: 'Premier Property Management LLC' }, pre1978: true, overall: { condition: 'fair' }, areas: [{ id: 'a1', name: 'Kitchen', condition: 'poor', inspected: true, issues: [] }] }, over);
const seed = (w) => {
  const tb = (n, headers, rows) => { w.h.tabs[n] = { headers, rows }; };
  tb('Owners', ['ID', 'Company', 'First_Name', 'Last_Name', 'PIN', 'Active'], [['O1', 'Premier Property Management LLC', 'Pat', 'Premier', '9999', 'TRUE'], ['O2', '', 'Sam', 'Solo', '8888', 'TRUE'], ['O3', 'Gone Co', '', '', '7777', 'FALSE']]);
  tb('Properties', ['ID', 'Address', 'City', 'Type', 'Unit_Count', 'Owner_ID', 'Active'], [['P1', '122 S Gilmor St', 'Baltimore', 'rowhome', '1', 'O1', 'TRUE'], ['P2', '5 Main St', 'Baltimore', 'multi', '2', 'O3', 'TRUE'], ['P3', '9 Old Rd', 'Baltimore', 'house', '1', '', 'TRUE'], ['P4', '77 Dead Ln', 'Baltimore', 'house', '1', 'O1', 'FALSE']]);
  tb('Units', ['ID', 'Property_ID', 'Unit_Label', 'Active'], [['U1', 'P2', '1A', 'TRUE'], ['U2', 'P2', '1B', 'TRUE'], ['U3', 'P4', 'X', 'TRUE'], ['U4', 'P2', 'Old', 'FALSE']]);
};

// ── names & folder naming ──
{
  const w = world();
  t('owner name = company when present', w.fiOwnerName({ Company: 'Premier LLC', First_Name: 'Pat', Last_Name: 'P' }) === 'Premier LLC');
  t('owner name = person only when no company', w.fiOwnerName({ Company: ' ', First_Name: 'Sam', Last_Name: 'Solo' }) === 'Sam Solo');
  t('owner name empty when nothing', w.fiOwnerName({}) === '' && w.fiOwnerName(null) === '');
  t('company matching ignores LLC / punctuation / case', w.fiNormName('Premier Property Management, LLC.') === w.fiNormName('premier property management'));
  t('different companies do not match', w.fiNormName('Premier Property') !== w.fiNormName('Premiere Property'));
  t('folder name = Inspection MMDDYYYY', w.fiInspFolderName('2026-10-15', 1) === 'Inspection 10152026');
  t('second inspection same day gets (2)', w.fiInspFolderName('2026-10-15', 2) === 'Inspection 10152026 (2)');
  t('missing date still gives a name', w.fiInspFolderName('', 1) === 'Inspection');
  t('street = first address segment', w.fiStreetOf('122 S Gilmor St, Baltimore, MD 21223') === '122 S Gilmor St');
  t('folder-unsafe characters removed', !/['"\\\/]/.test(w.fiFolderSafe('A "B" / C\\D\'s')) && w.fiFolderSafe('') === 'Unknown Property');
}

// ── directory ──
{
  const w = world(); seed(w);
  const r = await w.fiDirectory(w.env);
  const d = r.body;
  t('directory ok', r.status === 200 && d.ok);
  t('directory has no PINs anywhere', !JSON.stringify(d).includes('9999') && !JSON.stringify(d).includes('PIN'), d);
  t('inactive property dropped', !d.properties.some(p => p.id === 'P4') && !d.units.some(u => u.id === 'U3'));
  t('inactive unit dropped', !d.units.some(u => u.id === 'U4') && d.units.filter(u => u.property_id === 'P2').length === 2);
  t('owner shown as company', d.properties.find(p => p.id === 'P1').owner_name === 'Premier Property Management LLC');
  t('property with deactivated owner has NO owner (must be chosen)', d.properties.find(p => p.id === 'P2').owner_id === '' && d.properties.find(p => p.id === 'P2').owner_name === '');
  t('property with no owner has none', d.properties.find(p => p.id === 'P3').owner_id === '');
  t('owner list: active only, person name when no company', d.owners.length === 2 && d.owners.some(o => o.name === 'Sam Solo') && !d.owners.some(o => o.name === 'Gone Co'), d.owners);
}

// ── property + owner creation ──
{
  const w = world(); seed(w);
  let r = await w.fiPropertyCreate(w.env, { address: '', owner: { company: 'X' } });
  t('address required', r.status === 400 && r.body.error === 'address_required');
  r = await w.fiPropertyCreate(w.env, { address: '1 New St' });
  t('owner required', r.status === 400 && r.body.error === 'owner_required', r.body);
  t('nothing written on rejected requests', !w.h.added);
  r = await w.fiPropertyCreate(w.env, { address: '122 s gilmor st', city: 'Baltimore', owner: { id: 'O1' } });
  t('duplicate property -> 409 with matches, nothing written', r.status === 409 && r.body.error === 'duplicate_property' && r.body.matches.length === 1 && !w.h.added, r.body);
  r = await w.fiPropertyCreate(w.env, { address: '1 New St', city: 'Baltimore', type: 'rowhome', owner: { company: 'Acme Holdings LLC', first: 'Al', last: 'Acme', phone: '410', email: 'a@b.co' } });
  t('new house + new owner created', r.status === 200 && r.body.ok && r.body.owner.created && r.body.owner.name === 'Acme Holdings LLC' && r.body.property.owner_name === 'Acme Holdings LLC', r.body);
  const orow = w.h.added.find(a => a.tab === 'Owners').obj, prow = w.h.added.find(a => a.tab === 'Properties').obj;
  t('owner row: company name, active, tagged field_inspection', orow.Company === 'Acme Holdings LLC' && orow.Active === 'TRUE' && orow.Onboarding_Source === 'field_inspection');
  t('property row linked to the new owner, single unit', prow.Owner_ID === r.body.owner.id && prow.Unit_Count === '1' && prow.Address === '1 New St' && prow.Market === 'Baltimore' && prow.SMS_Enabled === 'FALSE', prow);
  r = await w.fiPropertyCreate(w.env, { address: '2 New St', owner: { company: 'ACME Holdings' } });
  t('same company again -> owner_exists (no duplicate owner)', r.status === 409 && r.body.error === 'owner_exists' && r.body.matches.length === 1, r.body);
  const before = w.h.tabs.Owners.rows.length;
  r = await w.fiPropertyCreate(w.env, { address: '2 New St', owner: { id: r.body.matches[0].id } });
  t('existing owner reused, no new owner row', r.status === 200 && !r.body.owner.created && w.h.tabs.Owners.rows.length === before, r.body);
  r = await w.fiPropertyCreate(w.env, { address: '3 New St', owner: { id: 'O3' } });
  t('deactivated owner rejected', r.status === 404 && r.body.error === 'owner_not_found');
  r = await w.fiPropertyCreate(w.env, { address: '4 New St', owner: { company: 'Solo Person' }, force: true });
  t('person-only owner allowed with first+last', (await w.fiPropertyCreate(w.env, { address: '4b New St', owner: { first: 'Zed', last: 'Zee' } })).body.owner.name === 'Zed Zee');
  r = await w.fiPropertyCreate(w.env, { address: '10 Multi St', city: 'Baltimore', type: 'multi', unit_labels: ['1A', '1B', '2A'], owner: { id: 'O2' } });
  t('multi-unit: units created and linked', r.body.ok && r.body.units.length === 3 && r.body.property.unit_count === 3 && w.h.tabs.Units.rows.filter(x => x[w.h.tabs.Units.headers.indexOf('Property_ID')] === r.body.property.id).length === 3, r.body);
  // failure honesty
  const w2 = world(); seed(w2); w2.h.dropAdd = 'Owners';
  r = await w2.fiPropertyCreate(w2.env, { address: '1 Fail St', owner: { company: 'Ghost LLC' } });
  t('owner not persisted -> 500, no property created', r.status === 500 && r.body.error === 'owner_not_saved' && r.body.ok === false && !w2.h.added.some(a => a.tab === 'Properties'), r.body);
  const w3 = world(); seed(w3); w3.h.dropAdd = 'Properties';
  r = await w3.fiPropertyCreate(w3.env, { address: '1 Fail St', owner: { company: 'Kept LLC' } });
  t('property not persisted -> 500 that says the owner WAS saved', r.status === 500 && r.body.error === 'property_not_saved' && r.body.owner_created === true && /WAS saved/.test(r.body.message), r.body);
  const w4 = world(); seed(w4); w4.h.unitFail = true;
  r = await w4.fiPropertyCreate(w4.env, { address: '1 Unit St', type: 'multi', unit_labels: ['A'], owner: { id: 'O1' } });
  t('unit not saved -> 500 not ok', r.status === 500 && r.body.error === 'unit_not_saved' && r.body.property_id, r.body);
}

// ── owner on the inspection: required to publish, never leaked ids on the public report ──
{
  const w = world(); seed(w);
  const ID = 'fi_r3_0001';
  const noOwner = mkDoc(); delete noOwner.owner;
  let r = await w.fiSave(w.env, { id: ID, base_rev: 0, doc: noOwner });
  t('inspection without owner still saves (draft)', r.status === 200 && r.body.ok, r.body);
  let p = await w.fiPublish(w.env, { id: ID, rev: r.body.rev, ack_warnings: true });
  t('publish blocked: owner_missing', p.status === 409 && p.body.blocks.some(b => b.code === 'owner_missing'), p.body);
  r = await w.fiSave(w.env, { id: ID, base_rev: r.body.rev, doc: mkDoc() });
  const hdr = w.h.tabs.FI_Inspections.headers, row = w.h.tabs.FI_Inspections.rows[0];
  t('owner id + name stored on the row', row[hdr.indexOf('Owner_ID')] === 'O1' && row[hdr.indexOf('Owner_Name')] === 'Premier Property Management LLC');
  p = await w.fiPublish(w.env, { id: ID, rev: r.body.rev, ack_warnings: true });
  t('publish ok with owner', p.status === 200 && p.body.ok, p.body);
  const rep = await w.fiReport(w.env, { headers: { get: () => '' } }, new URL('https://x/fi/report?r=' + p.body.report_token));
  t('public report shows owner company name', rep.body.ok && rep.body.doc.owner.name === 'Premier Property Management LLC', rep.body);
  t('public report hides owner id, property id, unit id', !('id' in rep.body.doc.owner) && !('id' in rep.body.doc.property) && !('unit_id' in rep.body.doc.property) && rep.body.inspection.property_id === '', rep.body.doc);
  t('public report carries no Drive folder', !JSON.stringify(rep.body).includes('drive.google'), 1);
  const bad = await w.fiSave(w.env, { id: ID, base_rev: 99, force: true, doc: mkDoc({ owner: 'x' }) });
  t('malformed owner rejected', bad.status === 400, bad);
}

// ── Drive folders ──
{
  const w = world(); seed(w); const d = () => w.h.drive;
  const pr = (n) => ({ headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => new ArrayBuffer(n) });
  const u = (id, ph) => new URL('https://x/fi/photo?inspection_id=' + id + '&photo_id=' + ph);
  const A = 'fi_r3_aaaa', B = 'fi_r3_bbbb';
  await w.fiSave(w.env, { id: A, base_rev: 0, doc: mkDoc() });
  let up = await w.fiPhotoUpload(w.env, pr(50), u(A, 'ph_000001'));
  t('first upload ok', up.status === 200 && up.body.ok, up);
  const prop = d().folders.find(f => f.name === '122 S Gilmor St'), insp = d().folders.find(f => f.name === 'Inspection 10152026');
  t('property folder under the Properties root', prop && prop.parent === 'root');
  t('inspection folder "Inspection 10152026" under the property folder', insp && insp.parent === prop.id, d().folders);
  t('photo landed in the inspection folder', w.h.uploads[0].folderId === insp.id);
  const hdr = w.h.tabs.FI_Inspections.headers, row = () => w.h.tabs.FI_Inspections.rows[0];
  t('folder id + url remembered on the inspection row', row()[hdr.indexOf('Drive_Folder_ID')] === insp.id && /drive\.google\.com\/drive\/folders\//.test(row()[hdr.indexOf('Drive_Folder_URL')]));
  t('writing the folder cells did not touch Rev or the doc', row()[hdr.indexOf('Rev')] === '1' && (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + A))).body.doc.areas.length === 1);
  const n0 = d().folders.length;
  await w.fiPhotoUpload(w.env, pr(50), u(A, 'ph_000002'));
  t('second photo reuses the folder, creates nothing', d().folders.length === n0 && w.h.uploads[1].folderId === insp.id);
  t('GET inspection exposes the Drive folder link', (await w.fiGetInspection(w.env, new URL('https://x/fi/inspection?id=' + A))).body.drive_folder_url.includes(insp.id));
  // second inspection, same property + day
  await w.fiSave(w.env, { id: B, base_rev: 0, doc: mkDoc() });
  await w.fiPhotoUpload(w.env, pr(50), u(B, 'ph_000003'));
  t('same property folder reused (one place to look)', d().folders.filter(f => f.name === '122 S Gilmor St').length === 1);
  const second = d().folders.find(f => f.name === 'Inspection 10152026 (2)');
  t('second inspection same day -> "(2)" folder, not mixed in', second && second.parent === prop.id && w.h.uploads[2].folderId === second.id);
  // stale remembered folder (deleted in Drive)
  insp.trashed = true; w.h.driveFailFolder = insp.id;
  up = await w.fiPhotoUpload(w.env, pr(50), u(A, 'ph_000004'));
  t('deleted folder -> re-created once and the photo still lands', up.status === 200 && up.body.ok && w.h.uploads.at(-1).folderId !== insp.id && d().folders.some(f => f.id === w.h.uploads.at(-1).folderId && f.name === 'Inspection 10152026' && !f.trashed), [up, w.h.uploads]);
  // folder search failure is loud
  const w2 = world(); seed(w2); await w2.fiSave(w2.env, { id: A, base_rev: 0, doc: mkDoc() }); w2.h.driveListFail = true;
  up = await w2.fiPhotoUpload(w2.env, pr(50), u(A, 'ph_000009'));
  t('Drive folder error -> 502 drive_folder, no photo row', up.status === 502 && up.body.error === 'drive_folder' && !(w2.h.tabs.FI_Photos && w2.h.tabs.FI_Photos.rows.length), up);
}
{ // organize old photos
  const w = world(); seed(w); const ID = 'fi_r3_orgg';
  const none = await w.fiFolderOrganize(w.env, { inspection_id: ID });
  t('organize: unsaved inspection -> 404', none.status === 404);
  await w.fiSave(w.env, { id: ID, base_rev: 0, doc: mkDoc() });
  w.h.drive = { folders: [], files: {}, seq: 0, patches: 0 };
  w.h.tabs.FI_Photos = w.h.tabs.FI_Photos || { headers: ['ID', 'Inspection_ID', 'Drive_File_ID', 'Mime', 'Bytes', 'Created_At', 'Active'], rows: [] };
  for (let i = 0; i < 7; i++) { w.h.tabs.FI_Photos.rows.push(['ph_old' + i, ID, 'old' + i, 'image/jpeg', '1', 'x', 'TRUE']); w.h.drive.files['old' + i] = { parents: ['oldFolder'] }; }
  let r = await w.fiFolderOrganize(w.env, { inspection_id: ID, limit: 5 });
  t('organize slice: moves 5, 2 remain, not done', r.status === 200 && r.body.moved === 5 && r.body.remaining === 2 && r.body.done === false, r.body);
  const fid = r.body.folder.id;
  r = await w.fiFolderOrganize(w.env, { inspection_id: ID, limit: 5 });
  t('organize second run finishes (already-moved are skipped, not re-patched)', r.body.done === true && r.body.already === 5 && r.body.moved === 2 && r.body.failed_count === 0 && r.body.remaining === 0, r.body);
  t('every photo now has exactly the one inspection folder as parent', Object.values(w.h.drive.files).every(f => f.parents.length === 1 && f.parents[0] === fid));
  const patches = w.h.drive.patches; r = await w.fiFolderOrganize(w.env, { inspection_id: ID });
  t('organize is idempotent', r.body.done && r.body.moved === 0 && w.h.drive.patches === patches, r.body);
  const w2 = world(); seed(w2); await w2.fiSave(w2.env, { id: ID, base_rev: 0, doc: mkDoc() });
  w2.h.drive = { folders: [], files: { old0: { parents: ['oldFolder'] } }, seq: 0, patches: 0 };
  w2.h.tabs.FI_Photos = { headers: ['ID', 'Inspection_ID', 'Drive_File_ID', 'Mime', 'Bytes', 'Created_At', 'Active'], rows: [['ph_old0', ID, 'old0', 'image/jpeg', '1', 'x', 'TRUE'], ['ph_gone', ID, 'nope', 'image/jpeg', '1', 'x', 'TRUE']] };
  r = await w2.fiFolderOrganize(w2.env, { inspection_id: ID });
  t('missing Drive file is reported, never hidden', r.status === 502 && r.body.ok === false && r.body.failed_count === 1 && r.body.moved === 1 && !r.body.done, r.body);
  w2.h.tabs.FI_Photos.rows.pop(); w2.h.drive.files.old1 = { parents: ['oldFolder'] }; w2.h.tabs.FI_Photos.rows.push(['ph_old1', ID, 'old1', 'image/jpeg', '1', 'x', 'TRUE']); w2.h.drivePatchNoop = true;
  r = await w2.fiFolderOrganize(w2.env, { inspection_id: ID });
  t('Drive that ignores the move is caught by read-back', r.status === 502 && r.body.failed_count === 1, r.body);
}

// ── wiring / staging guards ──
{
  for (const p of ['/fi/directory', '/fi/property/create', '/fi/folder/organize']) t('route wired: ' + p, src.includes("path === '" + p + "'"));
  t('staging token: organize limited to TEST- inspections', /path === '\/fi\/folder\/organize'\) return String\(\(body && body\.inspection_id\) \|\| ''\)\.startsWith\('TEST-'\)/.test(src));
  const g = src.slice(src.indexOf("path === '/fi/property/create') {"), src.indexOf("path === '/fi/property/create') {") + 900);
  t('staging token: property/create needs a TEST- address AND a TEST- owner', g.includes("startsWith('TEST-')") && g.includes('isTestRecord') && g.includes('company'));
  t('BUILD_VERSION valid + bumped past round 2', /BUILD_VERSION = '2026-10-15\.0[3-9]-[a-z-]+'/.test(src));
  t('inspection sheet has the new columns', ['Owner_ID', 'Owner_Name', 'Drive_Folder_ID', 'Drive_Folder_URL'].every(c => w0().FI_INSP_HEADERS.includes(c)));
}
function w0() { return world(); }
console.log(`fi-round3: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
