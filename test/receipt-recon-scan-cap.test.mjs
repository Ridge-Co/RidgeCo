// Offline test for the Receipt Reconciler scan batch cap (Sep 22 2026).
// Run: node test/receipt-recon-scan-cap.test.mjs
// Extracts the REAL receiptReconScan from worker.js and runs it against fakes for Drive, Sheets,
// OCR and the matcher, so it can't drift from what ships. Checks: a 23-file drop is worked down
// 8 per Hub tap (5 per cron call), `remaining` is reported, nothing is scanned twice, and the
// cap is clamped to 1..10.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

function extractFn(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(name + ' not found');
  let i = src.indexOf('{', start), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}

function world(nFiles, cfg = {}) {
  const queue = [];
  const files = Array.from({ length: nFiles }, (_, k) => ({ id: 'f' + k, name: 'r' + k + '.pdf', mimeType: 'application/pdf', webViewLink: '' }));
  let downloads = 0;
  const deps = {
    fetchConfig: async () => cfg,
    getAccessToken: async () => 'tok',
    ensureTab: async () => {}, ensureColumns: async () => {},
    fetch: async () => ({ json: async () => ({ files }) }),
    fetchTab: async () => queue.slice(),
    receiptCustomerCards: async () => ({}),
    fetchTabs: async () => [[], [], []],
    driveDownload: async () => { downloads++; return { bytes: new ArrayBuffer(1), mime: 'application/pdf' }; },
    receiptExtract: async () => ({ vendor: 'Home Depot', total: 12.34, date: '2026-09-10', items: [] }),
    receiptSuggestCore: () => ({ verdict: 'review' }),
    addRow: async (env, tab, row) => { queue.push(row); },
    json: (o) => o,
    RECEIPT_RECON_QUEUE_HEADERS: [], RECEIPT_RECON_FOLDER_ID_DEFAULT: 'FOLDER',
  };
  const names = Object.keys(deps);
  const fn = new Function(...names, `return (${extractFn('receiptReconScan')});`)(...names.map(n => deps[n]));
  return { scan: (b) => fn({}, b), queue, get downloads() { return downloads; } };
}

{
  const w = world(23);
  const r1 = await w.scan({});
  ok(r1.scanned === 8 && r1.remaining === 15, `Hub tap 1: 8 scanned, 15 remaining (got ${r1.scanned}/${r1.remaining})`);
  const r2 = await w.scan({});
  ok(r2.scanned === 8 && r2.remaining === 7, 'Hub tap 2: next 8, 7 remaining');
  const r3 = await w.scan({});
  ok(r3.scanned === 7 && r3.remaining === 0, 'Hub tap 3: last 7, 0 remaining');
  const r4 = await w.scan({});
  ok(r4.scanned === 0 && r4.remaining === 0, 'tap 4: nothing new');
  ok(w.queue.length === 23 && new Set(w.queue.map(q => q.Source_File_ID)).size === 23, 'all 23 queued exactly once');
  ok(w.downloads === 23, 'each file downloaded/OCRed exactly once');
}
{
  const w = world(12);
  const r = await w.scan({ max: 5 });
  ok(r.scanned === 5 && r.remaining === 7, 'cron call (max 5): 5 scanned, 7 remaining');
}
{
  ok((await world(30).scan({ max: 50 })).scanned === 10, 'max clamped to 10');
  ok((await world(30).scan({ max: -3 })).scanned === 8, 'nonsense max falls back to default 8');
  ok((await world(30, { receipt_recon_scan_batch: '3' }).scan({})).scanned === 3, 'Config receipt_recon_scan_batch overrides the default');
  ok((await world(30).scan(undefined)).scanned === 8, 'no body (old callers) still works');
}
{
  const r = await world(4).scan({});
  ok(r.scanned === 4 && r.remaining === 0, 'small drop: all scanned, remaining 0');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
