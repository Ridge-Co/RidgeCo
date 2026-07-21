// Offline tests for the email→WO intake parsers (B-103 Phase A).
// Run: node test/intake.test.mjs
//
// These cover the PURE functions only (parse / normalize / match) — no network,
// no Sheets, no Drive. The sample email below is built to the format documented
// in context/EMAIL_INTAKE_BUILD_BRIEF_v1.0.md; final validation still needs a
// real Buildium .eml (see the note at the bottom of the run output).

// worker.js is ESM but the repo has no package.json (adding one could disturb the
// Cloudflare Workers Builds pipeline — FEATURE_LOG "auto-deploy"), so Node would
// treat the .js as CommonJS and choke on `export`. Load it through a temp .mjs
// copy instead: same source, correct module type, zero changes to the repo.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp  = join(mkdtempSync(join(tmpdir(), 'ridgeco-intake-')), 'worker.mjs');
writeFileSync(tmp, readFileSync(join(here, '..', 'worker.js')));

const {
  detectSource, htmlToText, normalizeAddr, unitKey, phoneKey,
  keywordTrade, parseBuildium, resolveOwner, resolveProperty,
} = await import(pathToFileURL(tmp).href);

let pass = 0, fail = 0;
const eq = (actual, expected, label) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; console.log(`  ❌ ${label}\n       expected: ${e}\n       actual:   ${a}`); }
};
const ok = (cond, label) => eq(!!cond, true, label);
const section = (t) => console.log(`\n── ${t} ──`);

// ── Sample Buildium email (documented format) ────────────────────────────────
const BUILDIUM_HTML = `
<html><body>
  <table><tr><td>Phoenix Estate Rentals, LLC</td></tr></table>
  <p>Work order #838106-1: Leaking toilet in the upstairs bathroom</p>
  <table>
    <tr><td>Job description</td></tr>
    <tr><td>Toilet runs constantly and water is pooling on the floor.</td></tr>
    <tr><td>Tenant notes</td></tr>
    <tr><td>Please call before coming by.</td></tr>
    <tr><td>Location</td></tr>
    <tr><td>1110 North Dukeland Street - 1</td></tr>
    <tr><td>Baltimore, MD 21216</td></tr>
    <tr><td>Entry contacts</td></tr>
    <tr><td>Ian Rogers</td></tr>
    <tr><td>(240) 288-0886</td></tr>
    <tr><td>ianrogers933@gmail.com</td></tr>
    <tr><td>Entry details</td></tr>
    <tr><td>Pets: Yes &mdash; Cat</td></tr>
    <tr><td>Files</td></tr>
    <tr><td>
      <a href="https://s3.amazonaws.com/buildium-files/photo1.jpg">photo1.jpg</a>
      <a href="https://s3.amazonaws.com/buildium-files/photo1.jpg">photo1.jpg</a>
      <a href="https://s3.amazonaws.com/buildium-files/clip.MOV">clip.MOV</a>
    </td></tr>
  </table>
  <p>Sent by Phoenix Estate Rentals, LLC via Buildium</p>
</body></html>`;
const BUILDIUM_SUBJECT = 'Phoenix Estate Rentals, LLC: Work order 838106';

section('detectSource');
eq(detectSource('donotreply@managebuilding.com', ''), 'buildium', 'bare Buildium address');
eq(detectSource('Buildium <donotreply@managebuilding.com>', ''), 'buildium', 'display-name form');
eq(detectSource('DoNotReply@ManageBuilding.com', ''), 'buildium', 'case insensitive');
eq(detectSource('phoenixestatesmaryland@gmail.com', ''), 'manual', 'manual list sender');
eq(detectSource('someone@randomdomain.com', ''), 'unknown', 'unknown sender');
// Guards against a spoofed sender smuggling a trusted domain into the display name.
eq(detectSource('"managebuilding.com" <attacker@evil.com>', ''), 'unknown', 'domain in display name does not match');

section('htmlToText');
ok(!htmlToText('<p>a</p><script>var x=1;</script><p>b</p>').includes('var x'), 'strips script contents');
eq(htmlToText('<p>Hello&nbsp;&amp;&nbsp;goodbye</p>'), 'Hello & goodbye', 'decodes entities');
eq(htmlToText('<div>one</div><div>two</div>'), 'one\ntwo', 'block tags become newlines');

section('normalizeAddr');
eq(normalizeAddr('1110 North Dukeland Street'), '1110 n dukeland st', 'expands North/Street');
eq(normalizeAddr('1110 N Dukeland St'), '1110 n dukeland st', 'short form matches long form');
eq(normalizeAddr('1110 N. Dukeland St.'), '1110 n dukeland st', 'strips punctuation');
eq(normalizeAddr('1110 North Dukeland Street - 1'), '1110 n dukeland st', 'strips trailing unit');
eq(normalizeAddr('1110 North Dukeland Street #1'), '1110 n dukeland st', 'strips #unit');
eq(normalizeAddr('151 W Lanvale Ave'), '151 w lanvale ave', 'avenue');
eq(unitKey('Apt 2B'), '2b', 'unit key strips Apt');
eq(unitKey('#3'), '3', 'unit key strips hash');
eq(phoneKey('(240) 288-0886'), '2402880886', 'phone key from formatted');
eq(phoneKey('+12402880886'), '2402880886', 'phone key from E.164');
eq(phoneKey('288-0886'), '', 'too-short phone yields no key');

section('keywordTrade');
eq(keywordTrade('Leaking toilet in the bathroom'), 'Plumbing', 'toilet → Plumbing');
eq(keywordTrade('Breaker keeps tripping, no power'), 'Electrical', 'breaker → Electrical');
eq(keywordTrade('No heat on the second floor'), 'HVAC', 'no heat → HVAC');
eq(keywordTrade('Refrigerator is not cooling'), 'Appliance', 'fridge → Appliance');
eq(keywordTrade('Tenant says the vibe is off'), '', 'no keyword → blank (not a wrong guess)');

section('parseBuildium — full email');
const p = parseBuildium(BUILDIUM_HTML, BUILDIUM_SUBJECT, '');
eq(p.owner_wo_ref, '838106-1', 'ref prefers the body -1 suffix over the subject');
eq(p.property.address, '1110 North Dukeland Street', 'street address without unit');
eq(p.unit_label, '1', 'unit split off the address line');
eq(p.property.city, 'Baltimore', 'city');
eq(p.property.state, 'MD', 'state');
eq(p.property.zip, '21216', 'zip');
eq(p.tenant.name, 'Ian Rogers', 'tenant name');
eq(p.tenant.phone, '(240) 288-0886', 'tenant phone');
eq(p.tenant.email, 'ianrogers933@gmail.com', 'tenant email');
eq(p.owner_name, 'Phoenix Estate Rentals, LLC', 'owner from the subject prefix');
eq(p.trade, 'Plumbing', 'trade guess');
eq(p.priority, 'normal', 'priority');
eq(p.files.length, 2, 'files deduped (photo linked twice) and video kept');
ok(p.files.some(f => /\.MOV$/.test(f)), 'video file included');
ok(p.description.includes('Leaking toilet'), 'description keeps the title');
ok(p.description.includes('pooling'), 'description includes the job description');
ok(p.notes.includes('Cat'), 'pet/entry detail lands in notes');
eq(p.warnings, [], 'no warnings on a well-formed email');

section('parseBuildium — urgent + subject-only ref');
const urgent = parseBuildium('<p>Work order #900001: No hot water, EMERGENCY</p><p>Location</p><p>5 Main St</p>', 'Owner: Work order 900001', '');
eq(urgent.priority, 'urgent', 'emergency wording → urgent');
eq(urgent.owner_wo_ref, '900001', 'ref from body when there is no -1 suffix');

section('parseBuildium — degraded input warns instead of guessing');
const bad = parseBuildium('<p>hello there</p>', 'random subject', '');
ok(bad.warnings.length > 0, 'unparseable email produces warnings');
eq(bad.property.address, '', 'no address invented');

section('parseBuildium — HTML preferred, plaintext is the fallback');
// NOTE: this assertion was inverted before the July 21 review. Preferring
// plaintext meant the poller (which always sends both) never exercised the HTML
// path in production. See the REGRESSION section at the bottom for the details.
const pt = parseBuildium('<p>Work order #111: FROM HTML</p>', 'x', 'Work order #222: FROM PLAINTEXT\nLocation\n9 Oak St');
eq(pt.owner_wo_ref, '111', 'HTML wins when both are present');
const ptOnly = parseBuildium('', 'x', 'Work order #222: FROM PLAINTEXT\nLocation\n9 Oak St');
eq(ptOnly.owner_wo_ref, '222', 'plaintext used when there is no HTML');

section('resolveOwner');
const OWNERS = [
  { ID: '1', Company: 'Phoenix Estate Rentals, LLC', Active: 'TRUE' },
  { ID: '2', Company: 'Other Holdings Inc', Active: 'TRUE' },
  { ID: '3', Company: 'Retired Co', Active: 'FALSE' },
];
eq(resolveOwner(OWNERS, 'Phoenix Estate Rentals, LLC').row.ID, '1', 'exact company match');
eq(resolveOwner(OWNERS, 'Phoenix Estate Rentals').row.ID, '1', 'match ignoring the LLC suffix');
eq(resolveOwner(OWNERS, 'Nobody At All').status, 'no_match', 'unknown owner is not matched');
eq(resolveOwner(OWNERS, '').status, 'no_match', 'blank owner is not matched');
eq(resolveOwner(OWNERS, 'Retired Co').status, 'no_match', 'inactive owner is excluded');

section('resolveProperty');
const PROPS = [
  { ID: '10', Address: '1110 N Dukeland St', Active: 'TRUE' },
  { ID: '11', Address: '151 W Lanvale St',   Active: 'TRUE' },
  { ID: '12', Address: '1110 N Dukeland Ave', Active: 'TRUE' },
];
eq(resolveProperty(PROPS, { property: { address: '1110 North Dukeland Street' } }).row.ID, '10', 'normalized exact match reuses the property');
eq(resolveProperty(PROPS, { property: { address: '1110 N Dukeland St - 1' } }).row.ID, '10', 'unit suffix ignored');
// The safety property that matters most: a near-miss must NEVER auto-create.
eq(resolveProperty(PROPS, { property: { address: '1110 N Dukeland Boulevard' } }).status, 'ambiguous', 'partial match → review, never a duplicate property');
eq(resolveProperty(PROPS, { property: { address: '77 Brand New Rd' } }).status, 'no_match', 'genuinely new address → no_match (safe to create)');
eq(resolveProperty(PROPS, { property: { address: '' } }).status, 'no_address', 'blank address');
const DUPES = [{ ID: '1', Address: '5 Oak St', Active: 'TRUE' }, { ID: '2', Address: '5 Oak Street', Active: 'TRUE' }];
eq(resolveProperty(DUPES, { property: { address: '5 Oak St' } }).status, 'ambiguous', 'two existing rows normalize the same → ambiguous');

// ── Regressions from the July 21 adversarial review ──────────────────────────
section('REGRESSION: unit-suffix regex must not eat street names');
// Was: the unanchored (?:-|#|unit|apt|ste) alternation matched mid-word, so
// "1200 Winchester" became "1200 winche" plus a phantom Unit "r".
eq(normalizeAddr('1200 Winchester'), '1200 winchester', 'Winchester survives (contains "ste")');
eq(normalizeAddr('45 Manchester Ave'), '45 manchester ave', 'Manchester survives');
eq(normalizeAddr('100 Baptist St'), '100 baptist st', 'Baptist survives (contains "apt")');
eq(normalizeAddr('8 Cross-Keys Rd'), '8 cross-keys rd', 'hyphenated street name survives');
eq(normalizeAddr('12 Unity Lane'), '12 unity ln', 'Unity survives (contains "unit")');
// ...while genuine trailing unit designators are still stripped.
eq(normalizeAddr('1200 Winchester - 2'), '1200 winchester', 'real " - 2" suffix still stripped');
eq(normalizeAddr('1200 Winchester Apt 2'), '1200 winchester', 'real "Apt 2" suffix still stripped');
eq(normalizeAddr('1200 Winchester #2B'), '1200 winchester', 'real "#2B" suffix still stripped');
// The asymmetric-truncation bug: both spellings must land on the SAME key, or a
// property matches itself as "ambiguous" and every WO there sticks in review.
eq(normalizeAddr('1200 Winchester - 2') === normalizeAddr('1200 Winchester'), true, 'with/without unit normalize identically');
const WINCH = [{ ID: '20', Address: '1200 Winchester', Active: 'TRUE' }];
eq(resolveProperty(WINCH, { property: { address: '1200 Winchester - 2' } }).row.ID, '20', 'Winchester + unit matches its own property');
const wp = parseBuildium('<p>Work order #5: leak</p><p>Location</p><p>1200 Winchester</p>', 's', '');
eq(wp.property.address, '1200 Winchester', 'address not truncated');
eq(wp.unit_label, '', 'no phantom unit invented');

section('REGRESSION: HTML is parsed even when plaintext is supplied');
// The poller ALWAYS sends both bodies; preferring plaintext meant the tested HTML
// path never ran in production and Gmail's flattened body failed to parse at all.
const both = parseBuildium(BUILDIUM_HTML, BUILDIUM_SUBJECT, 'Work order #838106-1: Leaking toilet Location 1110 North Dukeland Street - 1');
eq(both.property.address, '1110 North Dukeland Street', 'HTML wins when both bodies are present');
eq(both.tenant.name, 'Ian Rogers', 'HTML tenant block still parsed');
// Plaintext is still the fallback for a text-only message, including "Label value".
const flat = parseBuildium('', 'x', 'Work order #77: Broken window\nLocation 500 Oak St\nBaltimore, MD 21201');
eq(flat.property.address, '500 Oak St', 'flattened "Label value" line parses in the fallback');
eq(flat.owner_wo_ref, '77', 'ref from the plaintext fallback');

section('REGRESSION: owner loose-match must not bind the wrong owner');
const TRAP = [{ ID: '1', Company: 'Ridge Co, LLC', Active: 'TRUE' }];
eq(resolveOwner(TRAP, 'Ridge Estates of Maryland').status, 'no_match', '"ridge" substring alone must NOT match');
eq(resolveOwner(TRAP, 'Ridge Co').row.ID, '1', 'a genuine match still works');
eq(resolveOwner(OWNERS, 'Phoenix Estate Rentals of Baltimore').row.ID, '1', 'real overlap (2+ shared words) still matches');

section('REGRESSION: tenant name must not be invented from prose');
const prose = parseBuildium(
  '<p>Work order #9: leak</p><p>Location</p><p>5 Oak St</p><p>Entry contacts</p><p>Tenant will be home</p><p>No pets</p>', 'x', '');
eq(prose.tenant.name, '', 'prose in the contacts block does not become a tenant name');
const named = parseBuildium(
  '<p>Work order #9: leak</p><p>Location</p><p>5 Oak St</p><p>Entry contacts</p><p>Maria Gonzalez-Ruiz</p>', 'x', '');
eq(named.tenant.name, 'Maria Gonzalez-Ruiz', 'a real hyphenated name is still captured');

section('REGRESSION: file links — extension-less and thumbnail variants');
const files = parseBuildium(
  `<p>Work order #9: leak</p><p>Files</p>
   <a href="https://x.managebuilding.com/manager/api/file/download?id=99">doc</a>
   <a href="https://s3.amazonaws.com/b/photo.jpg?w=100">thumb</a>
   <a href="https://s3.amazonaws.com/b/photo.jpg">full</a>
   <a href="https://s3.amazonaws.com/b/report.pdf">pdf</a>`, 'x', '');
ok(files.files.some(u => u.includes('/file/download')), 'extension-less download link kept (was silently dropped)');
eq(files.files.filter(u => u.includes('photo.jpg')).length, 1, 'thumbnail and full-size deduped to one');
eq(files.files.find(u => u.includes('photo.jpg')), 'https://s3.amazonaws.com/b/photo.jpg', 'full-size variant preferred over the thumbnail');
eq(files.files.some(u => u.endsWith('.pdf')), false, 'PDF excluded — intake files are job photos (FEATURE_LOG rule 13)');

console.log(`\n${'='.repeat(52)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(52)}`);
if (fail) process.exit(1);
