// Ops_Build_Queue "invisible old items" fix (Oct 23 2026, Brett): GET /ops-queue used to return only the 50 NEWEST
// active rows (active.reverse().slice(0, 50)), so the overnight Prepare agent could never see an older greenlit item.
// Runs the REAL opsQueueRead out of worker.js against an in-memory sheet.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

function grab(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const COLS = ['ID', 'Title', 'Status'];
let ROWS = [];
const json = (o, s) => ({ status: s || 200, body: o });
const helpers = {
  json, isMissingTabError: () => false, OPS_QUEUE_TAB: 'Ops_Build_Queue',
  sheetsRequest: async () => ({ values: [COLS, ...ROWS.map(r => [r.ID, r.Title, r.Status])] }),
};
const read = new Function(...Object.keys(helpers), grab('opsQueueRead') + '\nreturn opsQueueRead;')(...Object.values(helpers));
const call = async (qs) => (await read({}, { searchParams: new URLSearchParams(qs) })).body;

// 214 rows like the live sheet: the OLD greenlit rows (IDs 3..60) sit far below the newest 50.
ROWS = [];
for (let i = 1; i <= 214; i++) ROWS.push({ ID: String(i), Title: 'item ' + i, Status: i <= 60 ? (i % 2 ? 'greenlit' : 'dropped') : (i > 190 ? 'proposed' : 'done') });
const wantActive = ROWS.filter(r => r.Status !== 'done' && r.Status !== 'dropped').length;

let r = await call('');
ok(r.ok === true && r.count === wantActive, 'count is the number of active rows');
ok(r.queue.length === wantActive, 'EVERY active row comes back (was capped at 50)');
ok(r.truncated === false, 'not truncated by default');
ok(r.queue.some(x => x.ID === '3') && r.queue.some(x => x.ID === '59'), 'old greenlit rows (#3, #59) are visible to the Prepare agent now');
ok(Number(r.queue[0].ID) > Number(r.queue[r.queue.length - 1].ID), 'still newest first');
ok(r.queue.every(x => x.Status !== 'done' && x.Status !== 'dropped'), 'done and dropped rows are still left out');

r = await call('limit=10');
ok(r.queue.length === 10 && r.count === wantActive && r.truncated === true, '?limit=10 returns 10 and SAYS it was cut off');
r = await call('limit=1000');
ok(r.queue.length === wantActive && r.truncated === false, '?limit larger than the list is not truncated');
r = await call('limit=abc');
ok(r.queue.length === wantActive && r.truncated === false, 'a bad ?limit is ignored, never silently shrinks the list');

// ?all=1 keeps its 400-row window but no longer hides that it cut rows
r = await call('all=1');
ok(r.all === true && r.count === 214 && r.queue.length === 214 && r.truncated === false, '?all=1 under 400 rows: everything, truncated false');
ROWS = []; for (let i = 1; i <= 450; i++) ROWS.push({ ID: String(i), Title: 't', Status: 'done' });
r = await call('all=1');
ok(r.count === 450 && r.queue.length === 400 && r.truncated === true, '?all=1 over 400 rows reports truncated:true instead of silently dropping the oldest');

// the Proposals page tells Brett when its list is cut off
const prop = fs.readFileSync(new URL('../proposals.html', import.meta.url), 'utf8');
ok(/q&&q\.truncated\) toast\(/.test(prop), 'proposals.html shows a visible notice when the queue list is truncated');
const body = grab('opsQueueRead').split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
ok(!/slice\(0,\s*50\)/.test(body), 'the silent 50-row cap is gone from opsQueueRead (comments ignored)');
console.log(`ops-queue-read-all-active: ${n}/${n} passing`);
