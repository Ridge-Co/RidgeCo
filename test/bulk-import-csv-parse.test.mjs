// Regression test for the multi-line-quoted-cell CSV parsing bug found Aug 21 2026 during
// Brett's live check of the Bulk Importer (FEATURE_LOG rule 130). His real paste had one cell —
// a Phone field — with two numbers on two lines inside one quoted CSV cell:
//   931 St. Paul St.,2R,"609-608-5080
//   443-333-7107",Gabriel Bellone & Faith Dean,gabriel@gabrielbellone.com; 1faithvdean@gmail.com
// The old parseDelimited() in bulk-importer.html split the WHOLE raw paste on every newline
// FIRST, then only tracked quote-state within one already-split line — so this one logical row
// got sliced into two garbage rows: the real "2R" row lost its tenant name/email into a phantom
// brand-new "property" (whose Address was literally the mangled leftover text), and the real
// unit got a nameless tenant with only the first phone number. Confirmed live: the preview
// showed "1 new property, 7 new units" for a paste that should have produced 0 new properties
// and 6 new units. Fixed by tokenizing the ENTIRE raw text in one pass (quote-state carries
// across newlines — a newline only ends a row when NOT inside an open quote), and by adding
// worker.js's firstPhone() so a correctly-parsed multi-number phone cell doesn't get concatenated
// into a garbage digit string by normalizePhone().
import fs from 'fs';

// ── parseDelimited from bulk-importer.html (client-side parser) ────────────
const html = fs.readFileSync('bulk-importer.html', 'utf8');
const clientSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
function grabHtmlFn(name) {
  const i = clientSrc.indexOf('function ' + name);
  if (i < 0) throw new Error('missing ' + name + ' in bulk-importer.html');
  let d = 0, j = clientSrc.indexOf('{', i);
  for (; j < clientSrc.length; j++) { if (clientSrc[j] === '{') d++; else if (clientSrc[j] === '}') { d--; if (!d) break; } }
  return clientSrc.slice(i, j + 1);
}
const { parseDelimited, pick, mapRow } = new Function(
  grabHtmlFn('parseDelimited') + '\n' + grabHtmlFn('pick') + '\n' + grabHtmlFn('mapRow') +
  '\nreturn { parseDelimited, pick, mapRow };'
)();

// ── firstPhone from worker.js (server-side guard) ───────────────────────────
const worker = fs.readFileSync('worker.js', 'utf8');
function grabWorkerFn(name) {
  const i = worker.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name + ' in worker.js');
  let d = 0, j = worker.indexOf('{', i);
  for (; j < worker.length; j++) { if (worker[j] === '{') d++; else if (worker[j] === '}') { d--; if (!d) break; } }
  return worker.slice(i, j + 1);
}
const { firstPhone } = new Function(grabWorkerFn('firstPhone') + '\nreturn { firstPhone };')();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// Brett's exact real-world paste.
const CSV = `Property,Units,Phone,Renter Name,Email Address
1305 N Calvert St.,1st,240-877-6276,Albert Hargis,
1305 N Calvert St.,2nd,937-681-4660,Tyler Osborne,
1305 N Calvert St.,3rd,240-285-2588,Gus Williams,
1305 N Calvert St.,4th,585-944-5492,Caitlin Glastonbury,
,,,,
931 St. Paul St.,BF,443-630-7144,Mr Shane Caswell,shanecaswell3@gmail.com
931 St. Paul St.,BR,,Vacant,
931 St. Paul St.,1F,540-550-8687,Mr Lugenbeel,
931 St. Paul St.,1R,443-204-3415,Rose Dominique Beck,dahlia.rose5@icloud.com
931 St. Paul St.,2F,,Vacant,
931 St. Paul St.,2R,"609-608-5080
443-333-7107",Gabriel Bellone & Faith Dean,gabriel@gabrielbellone.com; 1faithvdean@gmail.com
931 St. Paul St.,3F,912-670-0145,Dr Sandeep Nayak,smnayak1@gmail.com
931 St. Paul St.,3R,443-484-6911,Erik Simmons,`;

const parsed = parseDelimited(CSV).map(mapRow).filter(r => r.Address);

t('exactly 12 real rows — no phantom row from the multi-line quoted cell', parsed.length === 12);
t('no row has a garbage/mangled Address (the old bug\'s phantom property)',
  parsed.every(r => r.Address === '1305 N Calvert St.' || r.Address === '931 St. Paul St.'));

const row2R = parsed.find(r => r.Unit_Label === '2R');
t('the 2R row exists at all', !!row2R);
t('2R keeps its real tenant name intact', row2R && row2R.Tenant_Name === 'Gabriel Bellone & Faith Dean');
t('2R keeps its real email intact', row2R && row2R.Tenant_Email === 'gabriel@gabrielbellone.com; 1faithvdean@gmail.com');
t('2R\'s phone field carries both numbers (raw, before firstPhone/normalizePhone apply)',
  row2R && row2R.Tenant_Phone === '609-608-5080\n443-333-7107');

// Every other row must be completely unaffected by the parser rewrite.
const albert = parsed.find(r => r.Tenant_Name === 'Albert Hargis');
t('an ordinary single-line row is unaffected', albert && albert.Address === '1305 N Calvert St.' && albert.Unit_Label === '1st' && albert.Tenant_Phone === '240-877-6276');
const vacantRows = parsed.filter(r => r.Tenant_Name === 'Vacant');
t('both Vacant rows still parse (BR, 2F)', vacantRows.length === 2);
t('the blank separator line produced no row', parsed.filter(r => !r.Unit_Label && r.Address !== '1305 N Calvert St.' && r.Address !== '931 St. Paul St.').length === 0);

// firstPhone: the server-side guard against a correctly-parsed multi-number cell.
t('firstPhone takes only the first of two newline-separated numbers',
  firstPhone('609-608-5080\n443-333-7107') === '609-608-5080');
t('firstPhone takes only the first of two semicolon-separated numbers',
  firstPhone('609-608-5080; 443-333-7107') === '609-608-5080');
t('firstPhone is a no-op on an ordinary single phone', firstPhone('443-630-7144') === '443-630-7144');
t('firstPhone on empty input returns empty', firstPhone('') === '');
t('firstPhone on null/undefined returns empty', firstPhone(null) === '' && firstPhone(undefined) === '');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
