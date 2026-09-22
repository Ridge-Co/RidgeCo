// Offline test for the Receipt Reconciler cutoff cleanup + un-skip (Sep 22 2026).
// Run: node test/receipt-recon-cutoff-unskip.test.mjs
// Extracts the REAL receiptReconSkipBeforeCutoff / receiptReconUnskip from worker.js.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function extract(name, isAsync) {
  const start = src.indexOf(`${isAsync ? 'async ' : ''}function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

function world(cfg = {}) {
  const tab = [
    { ID: '1', Status: 'pending', Receipt_Date: '2023-09-25', Total: '58.45', Vendor: 'Hometown Solutions', Active: 'TRUE' },
    { ID: '2', Status: 'pending', Receipt_Date: '2025-06-15', Total: '7.76', Vendor: 'Surplus City', Active: 'TRUE' },
    { ID: '3', Status: 'pending', Receipt_Date: '2026-04-10', Total: '72.02', Vendor: 'Home Depot', Active: 'TRUE' },
    { ID: '4', Status: 'pending', Receipt_Date: '2026-07-07', Total: '22.64', Vendor: 'Home Depot', Active: 'TRUE' },
    { ID: '5', Status: 'pending', Receipt_Date: '', Total: '9.00', Vendor: 'No date', Active: 'TRUE' },
    { ID: '6', Status: 'confirmed', Receipt_Date: '2024-01-01', Total: '1.00', Vendor: 'Old confirmed', Active: 'TRUE' },
    { ID: '7', Status: 'pending', Receipt_Date: '2024-02-02', Total: '3.00', Vendor: 'Soft-deleted', Active: 'FALSE' },
  ];
  const writes = [];
  const deps = {
    json: (o, status) => ({ status: status || 200, body: o }),
    fetchConfig: async () => cfg,
    fetchTab: async () => tab.map(r => ({ ...r })),
    updateRow: async (env, t, id, f) => { writes.push({ id, f }); Object.assign(tab.find(r => r.ID === id), f); },
    RECEIPT_RECON_MIN_DATE_DEFAULT: '2026-07-01',
  };
  const code = `${extract('receiptReconCutoff')}\n${extract('receiptBeforeCutoff')}\n${extract('receiptCutoffNote')}\n` +
    `${extract('receiptReconSkipBeforeCutoff', true)}\n${extract('receiptReconUnskip', true)}\nreturn { receiptReconSkipBeforeCutoff, receiptReconUnskip };`;
  const names = Object.keys(deps);
  const fns = new Function(...names, code)(...names.map(n => deps[n]));
  return { tab, writes, cleanup: async (b) => (await fns.receiptReconSkipBeforeCutoff({}, b || {})).body, unskip: async (b) => (await fns.receiptReconUnskip({}, b)) };
}

{
  const w = world();
  const dry = await w.cleanup({ dry_run: true });
  ok(dry.dry_run && dry.would_skip === 3 && w.writes.length === 0, 'dry run lists the 3 pending pre-July receipts and writes nothing');
  ok(dry.rows.map(r => r.id).join() === '1,2,3', 'the 2023, 2025 and Apr 2026 rows — not the Jul 7, no-date, confirmed, or soft-deleted ones');
  const real = await w.cleanup({});
  ok(real.skipped === 3 && ['1', '2', '3'].every(id => w.tab.find(r => r.ID === id).Status === 'skipped'), 'real run skips those 3');
  ok(/before the 2026-07-01 cutoff/.test(w.tab.find(r => r.ID === '1').Notes), 'each gets the cutoff note');
  ok(w.tab.find(r => r.ID === '4').Status === 'pending' && w.tab.find(r => r.ID === '5').Status === 'pending', 'Jul 7 and no-date rows untouched');
  ok(w.tab.find(r => r.ID === '6').Status === 'confirmed', 'already-confirmed old row untouched');
  const again = await w.cleanup({});
  ok(again.skipped === 0, 'running it twice is a no-op');

  const u = await w.unskip({ id: '3' });
  ok(u.status === 200 && w.tab.find(r => r.ID === '3').Status === 'pending' && w.tab.find(r => r.ID === '3').Notes === '', 'un-skip puts the Apr 2026 receipt back in Pending and clears the note');
  const bad = await w.unskip({ id: '6' });
  ok(bad.status === 409 && w.tab.find(r => r.ID === '6').Status === 'confirmed', 'un-skip refuses a confirmed receipt');
  ok((await w.unskip({ id: '99' })).status === 404 && (await w.unskip({})).status === 400, 'unknown / missing id rejected');
}
{
  const w = world({ receipt_recon_min_date: '2025-01-01' });
  const dry = await w.cleanup({ dry_run: true });
  ok(dry.cutoff === '2025-01-01' && dry.rows.map(r => r.id).join() === '1', 'Config cutoff 2025-01-01: only the 2023 receipt');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
