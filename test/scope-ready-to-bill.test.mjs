// scopeList()'s 'ready-to-bill' derived status (rule 150) — a deposit-booked scope whose linked
// Work Order shows the job physically done, but the final balance hasn't been booked yet. Never
// persisted to the Scopes sheet; computed fresh on every /scopes read. Extracts the REAL function
// (+ WO_STILL_ACTIVE_STATUSES) out of worker.js and runs it against a fake fetchTab/json, same
// extraction convention as test/dupe-guard.test.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert';

const here = dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(join(here, '..', 'worker.js'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('  ✗ FAIL: ' + msg); } assert.ok(cond, msg); }

function extractFn(name) {
  const start = workerSrc.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`${name} not found in worker.js — did it get renamed?`);
  let i = workerSrc.indexOf('{', start), depth = 0;
  for (; i < workerSrc.length; i++) { if (workerSrc[i] === '{') depth++; else if (workerSrc[i] === '}') { depth--; if (!depth) { i++; break; } } }
  return workerSrc.slice(start, i);
}
function extractConst(name) {
  const start = workerSrc.indexOf(`const ${name} =`);
  if (start === -1) throw new Error(`${name} not found in worker.js`);
  return workerSrc.slice(start, workerSrc.indexOf(';', start) + 1);
}
// scopesTab/ensureTab is a no-op we don't need for this test; scopeParseItems is used inside the map.
const scopesTab = async () => {};
const scopeParseItems = (s) => { try { return JSON.parse((s && s.Line_Items) || '[]'); } catch (_) { return []; } };
// scopeList calls json(...) at the end -- capture what it would have returned instead of building a Response.
const json = (body) => body;

let TABS = {};
const fetchTab = async (env, tab) => { if (TABS[tab] === undefined) throw new Error(`no fake table for ${tab}`); return TABS[tab]; };

const src = `${extractConst('WO_STILL_ACTIVE_STATUSES')}\n${extractFn('scopeList')}\nreturn scopeList;`;
const scopeList = new Function('fetchTab', 'json', 'scopesTab', 'scopeParseItems', src)(fetchTab, json, scopesTab, scopeParseItems);

console.log('scopeList — ready-to-bill derived status — offline tests\n');

TABS.Scopes = [
  // 1: deposit booked, WO still actively being worked -> stays plain 'invoiced' (in-progress)
  { ID: '1', Property_ID: '5', WO_ID: 'WO-1', Status: 'invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 2: deposit booked, WO says Complete, final NOT booked yet -> should surface as 'ready-to-bill'
  { ID: '2', Property_ID: '5', WO_ID: 'WO-2', Status: 'invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 3: deposit booked, WO says Pending Invoice (further along, still not scope-final-booked) -> also ready-to-bill
  { ID: '3', Property_ID: '5', WO_ID: 'WO-3', Status: 'invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 4: already fully-invoiced -> stays 'fully-invoiced' (completed) regardless of WO status, no WO lookup needed for correctness
  { ID: '4', Property_ID: '5', WO_ID: 'WO-4', Status: 'fully-invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 5: deposit booked but WO_ID missing entirely -> can't determine, stays plain 'invoiced', never crashes
  { ID: '5', Property_ID: '5', WO_ID: '', Status: 'invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 6: deposit booked, WO_ID set but that WO doesn't exist in Work_Orders -> stays plain 'invoiced', never crashes
  { ID: '6', Property_ID: '5', WO_ID: 'WO-GHOST', Status: 'invoiced', Active: 'TRUE', Line_Items: '[]' },
  // 7: still just proposed (no deposit booked at all) -> completely untouched by any of this
  { ID: '7', Property_ID: '5', WO_ID: 'WO-7', Status: 'proposed', Active: 'TRUE', Line_Items: '[]' },
];
TABS.Work_Orders = [
  { ID: 'WO-1', Status: 'In Progress' },
  { ID: 'WO-2', Status: 'Complete' },
  { ID: 'WO-3', Status: 'Pending Invoice' },
  { ID: 'WO-4', Status: 'Complete' }, // deliberately Complete too, to prove #4 doesn't need/use the WO lookup
  { ID: 'WO-7', Status: 'New' },
];

const rows = await scopeList({}, null);
const byId = Object.fromEntries(rows.map(r => [r.id, r]));

ok(byId['1'].status === 'invoiced', '#1: WO still In Progress -> stays plain in-progress');
ok(byId['2'].status === 'ready-to-bill', '#2: WO Complete, final not booked -> ready-to-bill');
ok(byId['3'].status === 'ready-to-bill', '#3: WO Pending Invoice (further along), final not booked -> ready-to-bill');
ok(byId['4'].status === 'fully-invoiced', '#4: already fully-invoiced stays that way regardless of WO status');
ok(byId['5'].status === 'invoiced', '#5: no WO_ID at all -> can\'t determine, stays plain in-progress, no crash');
ok(byId['6'].status === 'invoiced', '#6: WO_ID set but no matching Work_Orders row -> stays plain in-progress, no crash');
ok(byId['7'].status === 'proposed', '#7: not deposit-booked at all -> completely unaffected');

// ---- No Work_Orders fetch at all when nothing could possibly need it (cheap by default) ----
TABS.Scopes = [{ ID: '10', Property_ID: '5', WO_ID: '', Status: 'draft', Active: 'TRUE', Line_Items: '[]' }];
delete TABS.Work_Orders; // if scopeList tries to fetch it here, fetchTab throws -> test fails loudly
const rows2 = await scopeList({}, null);
ok(rows2.length === 1 && rows2[0].status === 'draft', 'no invoiced+WO_ID rows present -> Work_Orders is never fetched at all');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
