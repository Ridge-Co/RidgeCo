// Field inspection (Nov 5 2026): "All inspections" button on deep screens, published+billed inspections collapsed at the bottom,
// and no booking offered for a house + day that already has an inspection.
import fs from 'fs';
import assert from 'node:assert';
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../field-inspect.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// --- server: billed flag (run the real functions) ---
const grab = (re) => { const m = worker.match(re); assert.ok(m, 'could not find ' + re); return m[0]; };
const src = grab(/function fiDupKey\([\s\S]*?\n\}\n/) + grab(/const FI_BILLED_STATES = [^\n]*\n/) + grab(/function fiBilledInspectionIds\([\s\S]*?\n\}\n/);
const { fiDupKey, fiBilledInspectionIds } = new Function(src + '; return { fiDupKey, fiBilledInspectionIds };')();

const row = (o) => Object.assign({ Active: 'TRUE', Inspection_ID: 'fi_a', Completed_At: '2026-11-04T01:52:09Z', Invoice_Status: 'invoiced' }, o);
ok(fiBilledInspectionIds([row({})]).has('fi_a'), 'completed + invoiced = billed');
ok(fiBilledInspectionIds([row({ Invoice_Status: 'emailed' })]).has('fi_a'), 'completed + emailed = billed');
ok(fiBilledInspectionIds([row({ Invoice_Status: 'none' })]).has('fi_a'), 'completed with no charge = billing step done');
ok(!fiBilledInspectionIds([row({ Completed_At: '' })]).has('fi_a'), 'not completed = not billed');
ok(!fiBilledInspectionIds([row({ Invoice_Status: '' })]).has('fi_a'), 'no invoice status = not billed');
ok(!fiBilledInspectionIds([row({ Invoice_Status: 'staged' })]).has('fi_a'), 'staging test run is not billed');
ok(!fiBilledInspectionIds([row({ Invoice_Status: 'creating|abc|2026-11-04' })]).has('fi_a'), 'invoice still being created is not billed');
ok(!fiBilledInspectionIds([row({ Invoice_Status: 'sending|x' })]).has('fi_a'), 'invoice mid-send is not billed');
ok(!fiBilledInspectionIds([row({ Active: 'FALSE' })]).has('fi_a'), 'inactive booking ignored');
ok(!fiBilledInspectionIds([row({ Inspection_ID: '' })]).size, 'booking never linked to an inspection marks nothing');
ok(/billed: billedIds\.has\(String\(r\.o\.ID\)\)/.test(worker), '/fi/list returns billed per inspection');
ok(/try \{ billedIds = fiBilledInspectionIds\(await fetchTab\(env, 'Insp_Bookings'\)\); \} catch/.test(worker), 'a billing read failure can never break the list');

// --- server: duplicate guard on offered bookings ---
ok(fiDupKey('1510 E Madison St, Baltimore, MD 21205', '2026-11-02') === fiDupKey('1510 E Madison Street Baltimore Md 21205', '2026-11-02'), 'same house + day match across address spellings');
ok(fiDupKey('1510 E Madison St', '2026-11-02') !== fiDupKey('1510 E Madison St', '2026-11-03'), 'different day is a different visit');
ok(fiDupKey('3216 W Belvedere Ave', '2026-11-06') !== fiDupKey('3207 Cliftmont Ave', '2026-11-06'), 'different houses differ');
ok(fiDupKey('', '2026-11-06') === '' && fiDupKey('Main St', '2026-11-06') === '', 'no house number = no key (never hides a booking on a guess)');
ok(worker.includes('!(!b.Inspection_ID && doneKeys.has(fiDupKey(b.Formatted_Address || b.Address, b.Date)))'), 'fiBookings hides an unlinked booking whose house + day already has an inspection');

// --- the work-order backfill must stay update-only (never create a booking or inspection) ---
const bf = grab(/async function insbBackfillWo\([\s\S]*?\n\}\n/);
ok(!/addRow\(/.test(bf) && !/fiWriteRow\(/.test(bf), 'the WO backfill only sets a WO number on an existing booking; it creates nothing');

// --- phone ---
ok((page.match(/onclick="leaveInsp\(\)">‹ All inspections<\/button>/g) || []).length >= 4, 'All inspections button on the inspection, area, review and voice screens');
ok(/function leaveInsp\(\)\{\s*try \{ stopDictation\(\); \} catch\(e\)\{\}/.test(page), 'leaving from the area screen stops dictation first');
ok(/billed:!!i\.billed/.test(page), 'home list carries the billed flag');
ok(page.includes("var isDone = function(it){ return it.status==='published' && it.billed && it.server && !it.dirty; }"), 'only published + billed + saved-to-server inspections are collapsed');
ok(/<details id="fi-billed"/.test(page) && /Submitted &amp; billed \(/.test(page), 'collapsed section exists and is labelled with a count');
ok(page.includes('ontoggle="S.billedOpen=this.open"'), 'open/closed state survives a re-render');
ok(page.indexOf('active.forEach') < page.indexOf('<details id="fi-billed"'), 'collapsed section is at the bottom, after the open inspections');

console.log(`fi-billed-collapse: ${n} assertions passed`);
