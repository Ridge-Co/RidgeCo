// Every state a unit can be in, and whether the audit names it. The mapping screen only
// ever flagged ONE of these and showed a green tick for the rest.
import fs from 'fs';
const src = fs.readFileSync('worker.js','utf8');
const fn = src.slice(src.indexOf('async function qbUnitAudit'), src.indexOf('async function qbReparentUnit'));

let pass=0,fail=0;
const t=(n,c)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',n); } };

// the states it must distinguish
['no property','blocked','property stale','not linked','stale','wrong parent',
 'nested, name is ambiguous','ok'].forEach(function(state){
  t('names the "' + state + '" state', fn.includes("'" + state + "'"));
});

// the one Brett hit: linked unit, unlinked property — must NOT look fine
t('an unlinked property blocks rather than passing', /if \(!propQb\)/.test(fn));
t('and explains why the unit cannot be moved', /which is why this unit shows no problem and can't be moved/.test(fn));
t('an unlinked owner is caught before the property', fn.indexOf('!ownerQb') < fn.indexOf('!propQb'));

// only genuinely fixable states offer the button
t('movable is limited to wrong parent and bad name',
  /movable: state === 'wrong parent' \|\| state === 'nested, name is ambiguous'/.test(fn));

// the wrong-parent check compares against the PROPERTY's QuickBooks id
t('wrong parent compares the unit parent to the property', /String\(inQB\.parent_id \|\| ''\) !== propQb/.test(fn));
t('and says what it is actually nested under', /it is top-level/.test(fn));

// the name check is what stops the "Apt 1" collision recurring
t('a correctly nested unit with an ambiguous name is still flagged',
  /inQB\.name !== wantName/.test(fn));

// the audit must force a fresh read — a cached tree is how you audit yesterday's state
t('the audit re-reads QuickBooks rather than trusting the cache',
  /const force = !url \|\| url\.searchParams\.get\('refresh'\) !== '0'/.test(fn));

// the row display must not show a green tick when the parent is unknown
const html = fs.readFileSync('index.html','utf8');
t('the mapping row no longer ticks a unit whose property is unlinked',
  /kind === 'unit' && !row\.parent_qb_id/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
