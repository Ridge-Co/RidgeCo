// Trash service (B-203) — the pure billing/tracking logic, pulled straight out of worker.js
// and run against real inputs. Covers:
//   (1) week bucketing is Monday-anchored and TZ-stable (a Sunday belongs to the week just
//       ending, a Monday starts a new one);
//   (2) invoice lines = one flat-rate line per visit + one extra line per visit with an extra,
//       and the total is the exact sum (the money guarantee);
//   (3) the item fallback (no QB item → General item 40) and per-property rate;
//   (4) the nudge deadline: a shortfall is NOT actionable before the deadline and IS after
//       (so a day-late trip never false-alarms).
import fs from 'fs';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++){ if (src[j] === '{') d++; else if (src[j] === '}'){ d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const TRASH_DOW_SRC = "const TRASH_DOW = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 };\n";
const trashWeekKey        = new Function(grab('trashWeekKey') + '\nreturn trashWeekKey;')();
const buildTrashInvoiceLines = new Function(grab('buildTrashInvoiceLines') + '\nreturn buildTrashInvoiceLines;')();
const trashPastDeadline   = new Function(TRASH_DOW_SRC + grab('trashPastDeadline') + '\nreturn trashPastDeadline;')();
const trashIsSkipped      = new Function(grab('trashIsSkipped') + '\nreturn trashIsSkipped;')();

let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? ('got ' + JSON.stringify(got)) : ''); } };

// ── 1. Week bucketing (Monday-anchored) ──────────────────────────────────────
{
  // Wed 2026-08-05 → that week's Monday is 2026-08-03
  t('wed maps to its Monday', trashWeekKey('2026-08-05') === '2026-08-03', trashWeekKey('2026-08-05'));
  // Monday itself is its own key
  t('monday is its own week', trashWeekKey('2026-08-03') === '2026-08-03', trashWeekKey('2026-08-03'));
  // Sunday 2026-08-09 belongs to the week that STARTED Mon 2026-08-03
  t('sunday belongs to the ending week', trashWeekKey('2026-08-09') === '2026-08-03', trashWeekKey('2026-08-09'));
  // The next Monday rolls to a new week
  t('next monday is a new week', trashWeekKey('2026-08-10') === '2026-08-10', trashWeekKey('2026-08-10'));
}

// ── 2. Invoice lines + total (the money guarantee) ───────────────────────────
{
  // One property, two $40 visits, one with a $40 extra → 3 lines, $120 total (115 W 29th shape)
  const prop = { QBO_Item_ID: '55', Flat_Rate: 40 };
  const visits = [
    { Visit_Date: '2026-08-04', Base_Rate: '40', Extra_Amount: '', Extra_Reason: '' },
    { Visit_Date: '2026-08-06', Base_Rate: '40', Extra_Amount: '40', Extra_Reason: 'furniture haul' },
  ];
  const r = buildTrashInvoiceLines(prop, visits);
  t('two visits + one extra = 3 lines', r.lines.length === 3, r.lines.length);
  t('total is exact sum', r.total === 120, r.total);
  t('lines sum to total', r.lines.reduce((s,l)=>s+l.Amount,0) === r.total);
  t('base line uses the QB item', r.lines[0].SalesItemLineDetail.ItemRef.value === '55', r.lines[0].SalesItemLineDetail.ItemRef.value);
  t('base line is flat rate Qty 1', r.lines[0].SalesItemLineDetail.Qty === 1 && r.lines[0].SalesItemLineDetail.UnitPrice === 40);
  t('extra line names the reason', /furniture haul/.test(r.lines[2].Description), r.lines[2].Description);
  t('extra line carries the date', /2026-08-06/.test(r.lines[2].Description), r.lines[2].Description);
}
{
  // Single $40 visit, no item set → General item 40 fallback, rate from property
  const r = buildTrashInvoiceLines({ Flat_Rate: 40 }, [{ Visit_Date: '2026-08-05' }]);
  t('single visit = 1 line', r.lines.length === 1, r.lines.length);
  t('total $40', r.total === 40, r.total);
  t('no item → General 40 fallback', r.lines[0].SalesItemLineDetail.ItemRef.value === '40', r.lines[0].SalesItemLineDetail.ItemRef.value);
}
{
  // Zero visits → no lines, zero total (guarded elsewhere, but must not throw)
  const r = buildTrashInvoiceLines({ Flat_Rate: 40 }, []);
  t('no visits = no lines', r.lines.length === 0 && r.total === 0);
}
{
  // A visit with only an extra (base 0) still bills the extra
  const r = buildTrashInvoiceLines({ QBO_Item_ID: '9', Flat_Rate: 40 }, [{ Visit_Date: '2026-08-05', Base_Rate: '0', Extra_Amount: '20', Extra_Reason: 'cleanup' }]);
  t('base 0 skips base line', r.lines.length === 1, r.lines.length);
  t('extra-only total is the extra', r.total === 20, r.total);
}

// ── 3. Nudge deadline ────────────────────────────────────────────────────────
{
  // Property nudges Thursday + 1 grace day. Week Monday 2026-08-03 → deadline is
  // Thu 08-06 + 1 = Fri 2026-08-07 (noon UTC).
  const p = { Nudge_Day: 'Thu', Grace_Days: 1 };
  const week = '2026-08-03';
  t('before deadline (Wed) → not actionable', trashPastDeadline(p, week, new Date('2026-08-05T12:00:00Z')) === false);
  t('on deadline (Fri noon) → actionable',    trashPastDeadline(p, week, new Date('2026-08-07T12:00:00Z')) === true);
  t('after deadline (Sat) → actionable',      trashPastDeadline(p, week, new Date('2026-08-08T09:00:00Z')) === true);
}
{
  // Zero grace, nudge Wed → deadline Wed 2026-08-05 noon
  const p = { Nudge_Day: 'Wed', Grace_Days: 0 };
  t('zero grace: Tue not yet', trashPastDeadline(p, '2026-08-03', new Date('2026-08-04T23:00:00Z')) === false);
  t('zero grace: Wed noon yes', trashPastDeadline(p, '2026-08-03', new Date('2026-08-05T12:00:00Z')) === true);
}

// ── 4. Mark-skipped suppression predicate (B-??? — "nothing done" vs. silently forgot) ──
{
  const skips = [
    { Property_ID: '5', Week_Key: '2026-08-10', Active: 'TRUE' },
    { Property_ID: '6', Week_Key: '2026-08-10', Active: 'FALSE' }, // undone — must not count
    { Property_ID: '5', Week_Key: '2026-08-17', Active: 'TRUE' },
  ];
  t('marked property/week is skipped', trashIsSkipped(skips, '5', '2026-08-10') === true);
  t('un-marked (Active FALSE) is not skipped', trashIsSkipped(skips, '6', '2026-08-10') === false);
  t('same property, different week is not skipped', trashIsSkipped(skips, '5', '2026-08-24') === false);
  t('unrelated property is not skipped', trashIsSkipped(skips, '99', '2026-08-10') === false);
  t('numeric property id matches string-typed ID', trashIsSkipped(skips, 5, '2026-08-10') === true);
  t('empty skip list never matches', trashIsSkipped([], '5', '2026-08-10') === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
