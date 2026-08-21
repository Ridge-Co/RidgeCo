// St/Saint/Street address-folding fix for the shared Bulk Importer (hubBulkImport +
// inspBulkImport), run against the live worker source. Brett's real case: 931 St Paul St
// is on file as "931 Saint Paul St" with 6 units already added (1F/1R/2F/2R/BF/BR); pasting
// "931 St. Paul St." (abbreviated) must still match it, not create a duplicate property with
// every unit marked new. See worker.js QB_ADDR_WORDS ('saint' entry) + normAddr comment block
// right above inspBulkImport.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name, kind = 'function') {
  const needle = kind === 'const' ? ('const ' + name + ' =') : ('function ' + name + '(');
  const i = src.indexOf(needle);
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1) + (kind === 'const' ? ';' : '');
}
// normAddr itself is just `const normAddr = qbNormAddress;` (a plain alias, no braces to
// bracket-match) — reconstruct it directly rather than trying to grab() it.
const { qbNormAddress, normAddr, normAddrStrict } = new Function(
  grab('QB_ADDR_WORDS', 'const') + '\n' + grab('qbNormAddress') + '\n' +
  'const normAddr = qbNormAddress;\n' + grab('normAddrStrict') +
  '\nreturn { qbNormAddress, normAddr, normAddrStrict };'
)();

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

// The exact real-world mismatch that broke the bulk importer.
t('abbreviated "St. Paul St." matches spelled-out "Saint Paul St" on file',
  normAddr('931 St. Paul St.') === normAddr('931 Saint Paul St'));
t('ALL CAPS variant also matches', normAddr('931 ST PAUL ST') === normAddr('931 Saint Paul St'));
t('fully spelled out both ways matches', normAddr('931 Saint Paul Street') === normAddr('931 st paul st'));
t('bare "St Paul St" (no punctuation at all) matches', normAddr('931 St Paul St') === normAddr('931 Saint Paul St'));

// Must not start merging genuinely different streets.
t('N Calvert and S Calvert stay different', normAddr('1305 N Calvert St') !== normAddr('1305 S Calvert St'));
t('different house numbers stay different', normAddr('931 Saint Paul St') !== normAddr('930 Saint Paul St'));
t('an unrelated street name is untouched', normAddr('151 W Lanvale St') === normAddr('151 W Lanvale Street'));

// normAddr is just qbNormAddress reused (single source of truth, not a second normalizer).
t('normAddr and qbNormAddress agree', normAddr('931 St. Paul St.') === qbNormAddress('931 St. Paul St.'));

// The diagnostic flag: normAddrStrict must NOT fold St/Saint/Street, so it can detect when
// the folding above is the reason a property matched (bulk-importer.html "matched via
// normalization" note).
t('strict compare still sees them as different text',
  normAddrStrict('931 St. Paul St.') !== normAddrStrict('931 Saint Paul St'));
t('strict compare treats identical text as identical',
  normAddrStrict('931 Saint Paul St') === normAddrStrict('931 Saint Paul St'));
t('strict compare is untouched by a plain punctuation/case difference (no false flag)',
  normAddrStrict('1305 N Calvert St.') === normAddrStrict('1305 N Calvert St'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
