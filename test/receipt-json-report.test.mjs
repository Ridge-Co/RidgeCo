// Offline test for receiptJsonFail (silent-failure fix, Nov 17 2026): the four receipt-reconciler `.json().catch(() => ({}))` swallows now report.
// Extracts the REAL function out of worker.js and runs it against a fake reportFailure. Run: node test/receipt-json-report.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };

const start = src.indexOf('async function receiptJsonFail(');
if (start < 0) throw new Error('receiptJsonFail missing');
let i = src.indexOf('{', start), d = 0;
for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
const fn = src.slice(start, i);

let REPORTED;
const reportFailure = async (env, f) => { REPORTED.push(f); return { ok: true }; };
const receiptJsonFail = new Function('reportFailure', fn + '\nreturn receiptJsonFail;')(reportFailure);

console.log('receiptJsonFail');
REPORTED = [];
const out = await receiptJsonFail('env', 'receipt.queue.add', new SyntaxError('Unexpected end of JSON input'));
ok(out && Object.keys(out).length === 0, 'returns {} exactly as the old .catch(() => ({})) did');
ok(REPORTED.length === 1 && REPORTED[0].where === 'receipt.queue.add' && REPORTED[0].severity === 'P1' && REPORTED[0].source === 'receipt', 'reports once at P1 with the call site as where');
ok(REPORTED[0].err instanceof SyntaxError, 'the original error is passed through for the ledger message');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
