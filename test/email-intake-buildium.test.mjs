// Buildium email -> Work Order intake (B-103, Oct 12 2026): pure-function tests against the REAL
// Phoenix Estate Rentals emails (Sep 29 / Aug 31 2026) plus synthetic multi-unit + edge cases.
// Run: node test/email-intake-buildium.test.mjs   (SRC=path/to/worker.js to test another copy)
import fs from 'fs';
const src = fs.readFileSync(process.env.SRC || 'worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1) + (kind === 'const' ? ';' : '');
}
const { intakeFlatten, parseBuildiumEmail, intakeParseContacts, intakeNormLocation, intakeMatchProperty, intakeResolveUnit, intakeMatchTenant } = new Function(
  grab('QB_ADDR_WORDS', 'const') + '\n' + grab('qbNormAddress') + '\n' + grab('intakeFlatten') + '\n' + grab('intakeBetween') + '\n' +
  grab('intakeParseContacts') + '\n' + grab('parseBuildiumEmail') + '\n' + grab('intakeNormLocation') + '\n' + grab('intakeMatchProperty') + '\n' +
  grab('intakeResolveUnit') + '\n' + grab('intakeMatchTenant') +
  '\nreturn { intakeFlatten, parseBuildiumEmail, intakeParseContacts, intakeNormLocation, intakeMatchProperty, intakeResolveUnit, intakeMatchTenant };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL:', n, '\n   got ', JSON.stringify(a), '\n   want', JSON.stringify(b)); } };

// ── Real emails (markdown-table rendering, as returned by the Gmail connector) ──
const BELLE = "| |\n| This message was sent from an email address that cannot accept email. | |\n\n| |\n| # Work order from Phoenix Estate Rentals, LLC | 9/29/2026 1:56 PM |\n| ------------------------------ |\n\n| |\n| # Work order #949124-1: Freezer gasket and light bulbs |\n\n| |\n| Location 5425 Belle Vista Avenue Baltimore, MD 21206 |\n\n| |\n| Job description Tenant notes: I've replaced the freezer gasket and the light bulbs. Found exact light bulb but didn't work. Freezer gasket I cannot find the same size or the last one I bought and yes I gave Frigidaire the model#/make but unable to locate where to buy new one for the fridge I have. |\n\n| ------------------------------ |\n\n| |\n| Contact and scheduling information |\n\n| |\n| Entry details Entry allowed Pets | Entry notes Pets on Property: Yes |\n| Entry contacts |\n\n| Renita Howell, Tenant * (410) 556-7166 * (443) 810-0081 * Nitababe1501@gmail.com [](Nitababe1501@gmail.com) |\n\n| ------------------------------ |\n\n| |\n| Parts and labor details |\n\n| |\n| Invoice no. -- | Charge work to -- |\n\n| |\n| ------------------------------ |\n\n| |\n| Vendor information |\n\n| |\n\n| Vendor name Brett Lambert | Vendor contact info * (443) 961-7927 * brett@bmoremanagement.com [](brett@bmoremanagement.com) |\n\n| Vendor notes -- |\n\n| |\n| ------------------------------ |\n| Phoenix Estate Rentals, LLC |";
const INGLESIDE_NONUM = "| |\n| # Work order from Phoenix Estate Rentals, LLC | 8/31/2026 3:07 PM |\n| # Work order #909656-1: Mailbox |\n| Location Ingleside Avenue Baltimore, MD 21207 |\n| Job description Install mailbox and anti tip bracket |\n| Contact and scheduling information |\n| Entry details Unknown Pets | Entry notes |\n| Entry contacts |\n| -- |\n| Parts and labor details |\n| Vendor information |\n| Vendor name Brett Lambert |";
const CLARKS = "| # Work order from Phoenix Estate Rentals, LLC | 8/31/2026 3:20 PM |\n| # Work order #900125-1: New Drain Metal Cup |\n| Location 3737 Clarks Lane - 1 Baltimore, MD 21215 |\n| Job description Tenant notes: Invecto Brand Kitchen Sink garbage disposal Metal Cup Needs to be Replaced because all the rubber is gone . * AI mode also suggests To FIRST JUST light and RESET i did this already . |\n| Contact and scheduling information |\n| Entry details Entry allowed Pets | Entry notes Pets on Property: No Tenant Entry Notes: # 3954 BUIDLING ENTRY CODE ON CALL BOX RIGHT OF THE FRONT GLASS DOORS . or someone will let you in . |\n| Entry contacts |\n\n| Anu Krishnamoorthy, Tenant * (443) 355-8780 * akladybug63@gmail.com [](akladybug63@gmail.com) |\n| Parts and labor details |\n| Vendor information |";
// Same Belle Vista email as Gmail's getPlainBody() is likely to render it: label on one line, value on the next.
const BELLE_PLAIN = "This message was sent from an email address that cannot accept email.\n\nWork order from Phoenix Estate Rentals, LLC\n9/29/2026 1:56 PM\n\nWork order #949124-1: Freezer gasket and light bulbs\n\nLocation\n5425 Belle Vista Avenue\nBaltimore, MD 21206\n\nJob description\nTenant notes: I've replaced the freezer gasket.\n\nContact and scheduling information\n\nEntry details\nEntry allowed\nPets\nEntry notes\nPets on Property: Yes\nEntry contacts\nRenita Howell, Tenant\n(410) 556-7166\n(443) 810-0081\nNitababe1501@gmail.com\n\nParts and labor details\nInvoice no.\n--\nVendor information\nVendor name\nBrett Lambert\n";

// ── parseBuildiumEmail: real email #1 ──
const b = parseBuildiumEmail('Phoenix Estate Rentals, LLC: Work order 949124', BELLE);
t('Belle Vista parses ok', b.ok);
eq('ref_key', b.ref_key, '949124-1');
eq('title', b.title, 'Freezer gasket and light bulbs');
eq('address_raw', b.address_raw, '5425 Belle Vista Avenue Baltimore, MD 21206');
t('description starts with Tenant notes', b.description.startsWith("Tenant notes: I've replaced the freezer gasket"));
t('description does not leak into Contact section', !/Contact and scheduling/.test(b.description) && !/Entry details/.test(b.description));
eq('entry_details', b.entry_details, 'Entry allowed Pets');
eq('entry_notes', b.entry_notes, 'Pets on Property: Yes');
eq('org', b.org, 'Phoenix Estate Rentals, LLC');
eq('1 contact', b.contacts.length, 1);
eq('contact name', b.contacts[0].name, 'Renita Howell');
eq('contact role', b.contacts[0].role, 'Tenant');
eq('contact phones', b.contacts[0].phones, ['(410) 556-7166', '(443) 810-0081']);
eq('contact email', b.contacts[0].emails, ['Nitababe1501@gmail.com']);

// plain-text layout parses to the same fields
const bp = parseBuildiumEmail('Phoenix Estate Rentals, LLC: Work order 949124', BELLE_PLAIN);
t('plain-body layout parses ok', bp.ok);
eq('plain: address', bp.address_raw, '5425 Belle Vista Avenue Baltimore, MD 21206');
eq('plain: entry_notes', bp.entry_notes, 'Pets on Property: Yes');
eq('plain: contact phones', (bp.contacts[0] || {}).phones, ['(410) 556-7166', '(443) 810-0081']);
eq('plain: contact name', (bp.contacts[0] || {}).name, 'Renita Howell');
eq('plain: contact role', (bp.contacts[0] || {}).role, 'Tenant');
eq('plain: contact email', (bp.contacts[0] || {}).emails, ['Nitababe1501@gmail.com']);
eq('plain: two contacts split', intakeParseContacts('Jo Smith, Tenant (410) 111-2222 jo@x.com Bob Jones, Owner (410) 333-4444').map(x => x.name), ['Jo Smith', 'Bob Jones']);

// no-contact / empty entry notes email
const g = parseBuildiumEmail('Phoenix Estate Rentals, LLC: Work order 909656', INGLESIDE_NONUM);
t('no-street-number email still parses', g.ok);
eq('empty entry notes is empty (not the rest of the email)', g.entry_notes, '');
eq('"--" contacts => none', g.contacts, []);
eq('Ingleside description', g.description, 'Install mailbox and anti tip bracket');

// Clarks Lane: "- 1" unit marker, '#' inside entry notes, "*" inside description
const c = parseBuildiumEmail('Phoenix Estate Rentals, LLC: Work order 900125', CLARKS);
t('Clarks parses ok', c.ok);
eq('Clarks address_raw', c.address_raw, '3737 Clarks Lane - 1 Baltimore, MD 21215');
t('Clarks entry notes keep the building code text', /3954/.test(c.entry_notes));
eq('Clarks single contact', c.contacts.map(x => x.name), ['Anu Krishnamoorthy']);

// failure modes are reported, never thrown
t('garbage body => ok:false with errors', (() => { const r = parseBuildiumEmail('x: Work order 1', 'hello world'); return !r.ok && r.errors.length > 0; })());
t('subject/body WO number mismatch is flagged', !parseBuildiumEmail('Phoenix Estate Rentals, LLC: Work order 111111', BELLE).ok);
t('missing Location is flagged', !parseBuildiumEmail('a: Work order 5', '# Work order #5-1: Thing Job description x').ok);
t('title containing the word Location still finds the address', (() => {
  const r = parseBuildiumEmail('a: Work order 7', '# Work order #7-1: Location of leak Location 5425 Belle Vista Avenue Baltimore, MD 21206 Job description x');
  return r.ok && r.title === 'Location of leak' && r.address_raw.startsWith('5425 Belle Vista');
})());
t('HTML-ish body with entities parses', (() => {
  const r = parseBuildiumEmail('a: Work order 8', '<td># Work order #8-1: It&#39;s a leak</td><td>Location 545 Wellesley Street - 1 Baltimore, MD 21211</td><td>Job description under sink</td>');
  return r.ok && r.title === "It's a leak" && r.description === 'under sink';
})());
eq('seq other than 1 is preserved in the key', parseBuildiumEmail('a: Work order 9', '# Work order #9-2: x Location 1 A St Job description y').ref_key, '9-2');

// ── property matching against the real portfolio shapes ──
const props = [
  { ID: '14', Address: '567 Welbrook Rd', City: 'Essex', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '18', Address: '5425 Belle Vista Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '26', Address: '1575 Ingleside Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '37', Address: '545 Wellesley St', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '47', Address: '1110 N Dukeland St', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '20', Address: '3737 Clarks Lane Unit #104', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '2', Address: '928 N Calvert St', City: 'Baltimore', Type: 'multi', Unit_Count: '8', Active: 'FALSE' },
  { ID: '11', Address: '928 N Calvert St', City: 'Baltimore', Type: 'multi', Unit_Count: '8', Active: 'TRUE' },
  { ID: '70', Address: '931 Saint Paul St', City: 'Baltimore, MD', Type: 'multi', Unit_Count: '8', Active: 'TRUE' },
  { ID: '90', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
  { ID: '91', Address: '10 Dup Ave', City: 'Baltimore', Type: 'house', Unit_Count: '1', Active: 'TRUE' },
];
const m = (a) => intakeMatchProperty(a, props).matches.map(x => x.property.ID + (x.unit_raw ? '/' + x.unit_raw : ''));
eq('Avenue -> Ave, city+state+zip stripped', m('5425 Belle Vista Avenue Baltimore, MD 21206'), ['18']);
eq('Street -> St with "- 1" SFH noise', m('545 Wellesley Street - 1 Baltimore, MD 21211'), ['37/1']);
eq('North Dukeland Street - 1 (July sample)', m('1110 North Dukeland Street - 1'), ['47/1']);
eq('dangling " -" is no unit', m('1575 Ingleside Avenue -'), ['26']);
eq('"- Baltimore" is a city, not a unit', m('1575 Ingleside Avenue - Baltimore, MD 21207'), ['26']);
eq('city other than the one on file still matches (street is unique)', m('567 Welbrook Road Baltimore, MD 21221'), ['14']);
eq('no street number => no match (Ingleside Avenue Baltimore)', m('Ingleside Avenue Baltimore, MD 21207'), []);
eq('Clarks Lane "- 1" vs "Unit #104" on file => no match (parked, not guessed)', m('3737 Clarks Lane - 1 Baltimore, MD 21215'), []);
eq('inactive property is skipped; active twin wins', m('928 North Calvert Street Apt 3R Baltimore, MD 21202'), ['11/3r']);
eq('St Paul / Saint Paul fold', m('931 St. Paul Street #2F Baltimore, MD 21202'), ['70/2f']);
eq('two active properties same address => both returned (caller parks)', m('10 Dup Avenue Baltimore, MD 21201'), ['90', '91']);
eq('different house number does not match', m('5426 Belle Vista Avenue Baltimore, MD 21206'), []);
eq('prefix-of-number does not match (5425 vs 54251)', m('54251 Belle Vista Avenue'), []);
eq('trailing junk after the city => no match', m('5425 Belle Vista Avenue Baltimore, MD 21206 rear building 2'), []);

// ── unit resolution ──
const units = [
  { ID: '501', Property_ID: '18', Unit_Label: '1' },
  { ID: '601', Property_ID: '70', Unit_Label: '1F' }, { ID: '602', Property_ID: '70', Unit_Label: '1R' }, { ID: '603', Property_ID: '70', Unit_Label: '2F' },
  { ID: '701', Property_ID: '11', Unit_Label: 'Apt 3R' }, { ID: '702', Property_ID: '11', Unit_Label: '4R' },
  { ID: '801', Property_ID: '37', Unit_Label: '1', Active: 'FALSE' },
];
const P = id => props.find(p => p.ID === id);
eq('SFH with one unit row => that unit, email unit ignored', intakeResolveUnit(P('18'), '1', units), { ok: true, unit_id: '501', unit_label: '1' });
eq('SFH with no unit rows => no unit, ok', intakeResolveUnit(P('26'), '', units), { ok: true, unit_id: '', unit_label: '' });
eq('SFH, inactive unit row ignored', intakeResolveUnit(P('37'), '1', units), { ok: true, unit_id: '', unit_label: '' });
eq('multi + matching unit', intakeResolveUnit(P('70'), '2f', units).unit_id, '603');
eq('multi + "Apt 3R" label matches "3r"', intakeResolveUnit(P('11'), '3r', units).unit_id, '701');
eq('multi + no unit in email => parked unit_required', intakeResolveUnit(P('70'), '', units).reason, 'unit_required');
eq('multi + wrong unit => unit_no_match', intakeResolveUnit(P('70'), '9z', units).reason, 'unit_no_match');
eq('multi property with zero Units rows => parked', intakeResolveUnit({ ID: '99', Type: 'multi', Unit_Count: '4' }, '1', units).reason, 'no_unit_records');

// ── tenant matching ──
const tenants = [
  { ID: 't1', Property_ID: '18', Unit_ID: '501', Phone: '+14105567166', Email: 'x@y.com', Active: 'TRUE' },
  { ID: 't2', Property_ID: '18', Unit_ID: '501', Phone: '+14100000000', Email: 'nitababe1501@gmail.com', Active: 'TRUE' },
  { ID: 't3', Property_ID: '70', Unit_ID: '603', Phone: '+14435551111', Email: '', Active: 'FALSE' },
];
eq('phone match (formatting-insensitive)', intakeMatchTenant([{ phones: ['(410) 556-7166'], emails: [] }], tenants, '18', '501'), 't1');
eq('email match is case-insensitive', intakeMatchTenant([{ phones: [], emails: ['Nitababe1501@gmail.com'] }], tenants, '18', '501'), 't2');
eq('two different tenants match => ambiguous => none', intakeMatchTenant([{ phones: ['4105567166'], emails: ['nitababe1501@gmail.com'] }], tenants, '18', '501'), '');
eq('inactive tenant never matches', intakeMatchTenant([{ phones: ['4435551111'], emails: [] }], tenants, '70', '603'), '');
eq('tenant of another unit never matches', intakeMatchTenant([{ phones: ['4105567166'], emails: [] }], tenants, '70', '603'), '');
eq('no contacts => none', intakeMatchTenant([], tenants, '18', '501'), '');

console.log(`email-intake-buildium: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
