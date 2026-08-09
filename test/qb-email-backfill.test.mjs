// A QuickBooks sub-customer (a unit or a property "Job") is created with a name and a
// parent but no email — so an invoice sent for "3014 N Calvert St Apt B" has nobody to go
// to, while the parent property that DOES carry the owner's email sends fine. The backfill
// copies the nearest ancestor's email down. These assertions run the real planner out of
// worker.js so the test can't drift from what ships.
import fs from 'fs';
const wsrc = fs.readFileSync('worker.js', 'utf8');

function grab(src, sig) {
  const start = src.indexOf(sig);
  if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) break; }
  }
  return src.slice(start, i + 1);
}

let pass = 0, fail = 0;
const t = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL:', n); } };

const { qbResolveEmailBackfill } = new Function(
  grab(wsrc, 'function qbResolveEmailBackfill(') + '\nreturn { qbResolveEmailBackfill };')();

// ── The core case: a unit under a property that has the email ──────────────────────────
{
  const customers = [
    { id: '10', name: 'Goldszmidt Properties', email: 'owner@x.com', parent_id: '', is_sub: false },
    { id: '20', name: '3014 N Calvert St', path: 'Goldszmidt:3014 N Calvert St', email: 'owner@x.com', parent_id: '10', is_sub: true },
    { id: '30', name: '3014 N Calvert St Apt B', path: '…:Apt B', email: '', parent_id: '20', is_sub: true },
  ];
  const { toSet, skipped } = qbResolveEmailBackfill(customers);
  t('the blank unit is queued', toSet.length === 1 && toSet[0].id === '30');
  t('it inherits the PROPERTY email, not a guess', toSet[0].email === 'owner@x.com' && toSet[0].source_id === '20');
  t('nothing is skipped when a parent has an email', skipped.length === 0);
  t('the parent (which already has an email) is left alone', !toSet.find(x => x.id === '20'));
  t('the top-level owner is never a target', !toSet.find(x => x.id === '10'));
}

// ── Walk UP: property is also blank, but the owner above it has the email ───────────────
{
  const customers = [
    { id: '1', name: 'Owner LLC', email: 'billing@owner.com', parent_id: '', is_sub: false },
    { id: '2', name: '100 Main St', email: '', parent_id: '1', is_sub: true },   // property blank too
    { id: '3', name: '100 Main St Apt 2', email: '', parent_id: '2', is_sub: true },
  ];
  const { toSet } = qbResolveEmailBackfill(customers);
  const unit = toSet.find(x => x.id === '3');
  const prop = toSet.find(x => x.id === '2');
  t('the blank property inherits the owner email', prop && prop.email === 'billing@owner.com' && prop.source_id === '1');
  t('the unit climbs past its blank property to the owner', unit && unit.email === 'billing@owner.com' && unit.source_id === '1');
  t('the unit flags that it came from a grandparent', unit && unit.inherited_from_grandparent === true);
}

// ── No ancestor email anywhere → skipped, never guessed ────────────────────────────────
{
  const customers = [
    { id: '1', name: 'Owner No Email', email: '', parent_id: '', is_sub: false },
    { id: '2', name: 'Orphan Property', email: '', parent_id: '1', is_sub: true },
    { id: '3', name: 'Orphan Unit', email: '', parent_id: '2', is_sub: true },
  ];
  const { toSet, skipped } = qbResolveEmailBackfill(customers);
  t('nothing is invented when no ancestor has an email', toSet.length === 0);
  t('both blank sub-customers are reported as skipped', skipped.length === 2);
  t('the skip carries a reason', /email/.test(skipped[0].reason || ''));
}

// ── Idempotent: a unit that already has an email is never re-touched ────────────────────
{
  const customers = [
    { id: '20', name: 'Prop', email: 'a@b.com', parent_id: '', is_sub: false },
    { id: '30', name: 'Unit already set', email: 'unit@b.com', parent_id: '20', is_sub: true },
  ];
  const { toSet } = qbResolveEmailBackfill(customers);
  t('a sub-customer with its own email is left as-is', toSet.length === 0);
}

// ── A sub that already has an email is SURFACED in `already` (not dropped) with the owner's ─
// This is the "why doesn't 153 W Lanvale show up" case: it had a stale email, so it was
// silently skipped. Now it comes back so it can be seen and force-corrected.
{
  const customers = [
    { id: '10', name: 'Goldszmidt Properties', email: 'owner@x.com', parent_id: '', is_sub: false },
    { id: '50', name: '153 W Lanvale St', email: 'old@stale.com', parent_id: '10', is_sub: true },
  ];
  const { toSet, skipped, already } = qbResolveEmailBackfill(customers);
  t('a sub with its own email is not queued to auto-set', toSet.length === 0);
  t('and it is not in skipped', skipped.length === 0);
  t('it is surfaced in `already`, not dropped silently', already.length === 1 && already[0].id === '50');
  t('`already` carries the current email and the owner email a force would use',
     already[0].current_email === 'old@stale.com' && already[0].owner_email === 'owner@x.com');
}

// ── An already-emailed sub whose owner ALSO has no email exposes a blank owner_email ───────
// (the page uses this to disable the Force button — there's nothing to copy down).
{
  const customers = [
    { id: '1', name: 'Owner No Email', email: '', parent_id: '', is_sub: false },
    { id: '2', name: 'Prop with own email', email: 'p@x.com', parent_id: '1', is_sub: true },
  ];
  const { already } = qbResolveEmailBackfill(customers);
  t('already row exists but owner_email is blank when no ancestor has one',
     already.length === 1 && already[0].owner_email === '');
}

// ── A parent-reference cycle can never hang the planner ─────────────────────────────────
{
  const customers = [
    { id: 'a', name: 'A', email: '', parent_id: 'b', is_sub: true },
    { id: 'b', name: 'B', email: '', parent_id: 'a', is_sub: true },
  ];
  const { toSet, skipped } = qbResolveEmailBackfill(customers);
  t('a cycle resolves to skipped, not an infinite loop', toSet.length === 0 && skipped.length === 2);
}

// ── is_sub may be absent; a non-empty parent_id still marks a sub-customer ──────────────
{
  const customers = [
    { id: '1', name: 'Owner', email: 'o@x.com', parent_id: '' },
    { id: '2', name: 'Unit', email: '', parent_id: '1' },  // no is_sub flag at all
  ];
  const { toSet } = qbResolveEmailBackfill(customers);
  t('a parent_id alone is enough to treat a row as a sub-customer', toSet.length === 1 && toSet[0].id === '2');
}

// ── qbNearestCustomerEmail: give an existing invoice a send-to by climbing the QB tree ─────
const { qbNearestCustomerEmail } = new Function(
  grab(wsrc, 'function qbNearestCustomerEmail(') + '\nreturn { qbNearestCustomerEmail };')();

{
  const customers = [
    { id: '10', name: 'Goldszmidt Properties', email: 'owner@x.com', parent_id: '' },
    { id: '20', name: '153 W Lanvale St', email: '', parent_id: '10' },       // property blank
    { id: '30', name: '153 W Lanvale St Apt 1', email: '', parent_id: '20' },  // unit blank
    { id: '40', name: '928 N Calvert St Apt B', email: 'unit@x.com', parent_id: '10' },
  ];
  // invoice billed to the unit → climbs unit→property→owner to owner@x.com
  const a = qbNearestCustomerEmail(customers, '30');
  t('invoice on a blank unit climbs to the owner email', a.email === 'owner@x.com' && a.source_id === '10');
  // invoice billed to a customer that has its OWN email uses that, not the owner's
  const b = qbNearestCustomerEmail(customers, '40');
  t('a customer with its own email uses that one', b.email === 'unit@x.com' && b.source_id === '40');
  // nobody in the chain has an email
  const none = qbNearestCustomerEmail(
    [{ id: '1', name: 'Owner', email: '', parent_id: '' }, { id: '2', name: 'Prop', email: '', parent_id: '1' }], '2');
  t('no email anywhere up the chain returns blank', none.email === '');
  // unknown customer id
  t('an unknown customer id returns blank, not a throw', qbNearestCustomerEmail(customers, 'nope').email === '');
  // cycle guard
  const cyc = qbNearestCustomerEmail([{ id: 'a', email: '', parent_id: 'b' }, { id: 'b', email: '', parent_id: 'a' }], 'a');
  t('a parent cycle resolves to blank, not an infinite loop', cyc.email === '');
}

console.log(`\nqb-email-backfill: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
