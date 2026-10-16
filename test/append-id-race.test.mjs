// Offline tests for the append-race guard (Oct 16 2026): two rows given the same ID, and the Message_Queue update/skip that used to
// edit the wrong row and report success. Extracts the REAL function bodies from worker.js; fake Sheets below can inject a race.
// Run: node test/append-id-race.test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'worker.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL: ' + m); } };
function extract(name, isAsync = true) {
  const sig = (isAsync ? 'async function ' : 'function ') + name + '(';
  const start = src.indexOf(sig); if (start < 0) throw new Error(name + ' not found');
  let i = src.indexOf('{', src.indexOf(')', start)), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(start, i);
}

// ── fake Sheets ──
let TABS, onBeforeAppend, TELE, ALERTS, FAIL_BATCH;
const colIdx = L => L.split('').reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
async function sheetsRequest(env, method, path, body) {
  let m;
  if (method === 'GET' && (m = /^\/values\/([^!:?]+)$/.exec(path))) return { values: TABS[m[1]].map(r => r.slice()) };
  if (method === 'POST' && (m = /^\/values\/([^!:?]+):append/.exec(path))) {
    if (onBeforeAppend) { const f = onBeforeAppend; onBeforeAppend = null; f(); }
    const t = TABS[m[1]], first = t.length + 1; for (const r of body.values) t.push(r.slice());
    return { updates: { updatedRange: `${m[1]}!A${first}:Z${first + body.values.length - 1}`, updatedRows: body.values.length } };
  }
  if (method === 'POST' && path === '/values:batchUpdate') {
    if (FAIL_BATCH) throw new Error('Sheets 500');
    let n = 0; for (const u of body.data) { const mm = /^([^!]+)!([A-Z]+)(\d+)$/.exec(u.range); const t = TABS[mm[1]]; t[+mm[3] - 1][colIdx(mm[2])] = u.values[0][0]; n++; }
    return { totalUpdatedCells: n };
  }
  throw new Error('unhandled ' + method + ' ' + path);
}
const env = {}, MSG_QUEUE_TAB = 'Message_Queue';
const json = (o, s) => ({ body: o, status: s || 200 });
const invalidateTabCache = () => {};
const logTelemetry = async (e, rec) => { TELE.push(rec); };
const alertAdminOnFailure = async (e, j, m) => { ALERTS.push(j + ': ' + m); };
const col = new Function(`return (${extract('col', false)});`)();
const mk = (names) => new Function('sheetsRequest', 'col', 'invalidateTabCache', 'logTelemetry', 'alertAdminOnFailure', 'MSG_QUEUE_TAB', 'json', 'mqReportFailureRef',
  names.map(n => n === 'appendedRowNumber' || n === 'mintNextNumericId' ? extract(n, false) : extract(n)).join('\n') + `\nreturn {${names.join(',')}};`);
const F = mk(['appendedRowNumber', 'mintNextNumericId', 'guardAppendedIds', 'mqReportFailure', 'updateMessageQueueRow', 'skipMessageQueue'])(sheetsRequest, col, invalidateTabCache, logTelemetry, alertAdminOnFailure, MSG_QUEUE_TAB, json);
const reset = () => { TABS = { Message_Queue: [['ID', 'Status', 'Body'], ['1', 'sent', 'a'], ['2', 'sent', 'b']], Work_Orders: [['Vendor_Needs_Access', 'ID', 'Description'], ['', 'WO-1001', 'x']] }; onBeforeAppend = null; TELE = []; ALERTS = []; FAIL_BATCH = false; };

console.log('append-race guard — offline tests\n');
console.log('appendedRowNumber / mintNextNumericId');
ok(F.appendedRowNumber({ updates: { updatedRange: 'Message_Queue!A301:S301' } }) === 301, 'reads the landing row from the append response');
ok(F.appendedRowNumber({ updates: { updatedRange: "'My Tab'!A5:C7" } }) === 5, 'handles quoted tab names / multi-row ranges (first row)');
ok(F.appendedRowNumber({}) === 0 && F.appendedRowNumber(null) === 0, 'missing response gives 0 (never throws)');
ok(F.mintNextNumericId([['1'], ['WO-1004'], ['x']], 0) === '1005', 'next id is max+1 ignoring prefixes/junk');

console.log('\nNormal path (no race)');
reset();
let rowsAtRead = TABS.Message_Queue.length;
let resp = await sheetsRequest(env, 'POST', '/values/Message_Queue:append?valueInputOption=RAW', { values: [['3', 'pending', 'c']] });
let g = await F.guardAppendedIds(env, 'Message_Queue', resp, rowsAtRead, 0, ['3']);
ok(!g.repaired && g.ids[0] === '3' && g.row === 4, 'unchanged id, row number reported, no repair');
ok(TELE.length === 0, 'no telemetry noise on the normal path');

console.log('\nThe Oct 14 incident: another request takes the same id inside the gap');
reset();
rowsAtRead = TABS.Message_Queue.length;            // we read 3 rows, mint id 3
onBeforeAppend = () => TABS.Message_Queue.push(['3', 'pending', 'THEIRS']);   // someone else lands id 3 first
resp = await sheetsRequest(env, 'POST', '/values/Message_Queue:append?valueInputOption=RAW', { values: [['3', 'pending', 'MINE']] });
g = await F.guardAppendedIds(env, 'Message_Queue', resp, rowsAtRead, 0, ['3']);
ok(g.repaired && g.ids[0] === '4', 'our row is given the next free id (4)');
ok(TABS.Message_Queue[3][0] === '3' && TABS.Message_Queue[3][2] === 'THEIRS', "the other request's row is untouched");
ok(TABS.Message_Queue[4][0] === '4' && TABS.Message_Queue[4][2] === 'MINE', 'our row (addressed by row number) carries the new id');
ok(TELE.some(t => t.Job_Type === 'append_id_race_repaired' && t.Success === 'TRUE'), 'the repair is logged to telemetry');
const ids = TABS.Message_Queue.slice(1).map(r => r[0]); ok(new Set(ids).size === ids.length, 'every id in the tab is unique afterwards');

console.log('\nRace where both writers minted the same id but landed in order (no other row in between)');
reset();
rowsAtRead = 3; TABS.Message_Queue.push(['3', 'pending', 'THEIRS']);   // their row already there before our append, we read before it
resp = await sheetsRequest(env, 'POST', '/values/Message_Queue:append?valueInputOption=RAW', { values: [['3', 'pending', 'MINE']] });
g = await F.guardAppendedIds(env, 'Message_Queue', resp, rowsAtRead, 0, ['3']);
ok(g.repaired && g.ids[0] === '4' && TABS.Message_Queue[4][0] === '4', 'detected by the landing row not being the one we expected');

console.log('\nWork_Orders style ids (WO-nnnn, ID not in column 0)');
reset();
rowsAtRead = TABS.Work_Orders.length;
onBeforeAppend = () => TABS.Work_Orders.push(['', 'WO-1002', 'THEIRS']);
resp = await sheetsRequest(env, 'POST', '/values/Work_Orders:append?valueInputOption=RAW', { values: [['', 'WO-1002', 'MINE']] });
g = await F.guardAppendedIds(env, 'Work_Orders', resp, rowsAtRead, 1, ['WO-1002'], (v, c) => 'WO-' + F.mintNextNumericId(v, c));
ok(g.repaired && g.ids[0] === 'WO-1003' && TABS.Work_Orders[3][1] === 'WO-1003', 'our WO gets WO-1003, theirs keeps WO-1002');

console.log('\nRepair failure is loud, never silent');
reset();
rowsAtRead = TABS.Message_Queue.length;
onBeforeAppend = () => TABS.Message_Queue.push(['3', 'pending', 'THEIRS']);
resp = await sheetsRequest(env, 'POST', '/values/Message_Queue:append?valueInputOption=RAW', { values: [['3', 'pending', 'MINE']] });
FAIL_BATCH = true; let threw = '';
try { await F.guardAppendedIds(env, 'Message_Queue', resp, rowsAtRead, 0, ['3']); } catch (e) { threw = e.message; }
ok(/500/.test(threw), 'a failed renumber throws instead of returning success');

console.log('\nupdateMessageQueueRow / skip — duplicates that already exist in the sheet');
reset();
TABS.Message_Queue.push(['298', 'sent', 'old text'], ['298', 'pending', 'Kayla offer']);
ok(await F.updateMessageQueueRow(env, '298', { Status: 'skipped' }) === true, 'update returns true when it saved');
ok(TABS.Message_Queue[4][1] === 'skipped' && TABS.Message_Queue[3][1] === 'sent', 'with a duplicate id it edits the PENDING row, not the old sent one');
ok(ALERTS.length >= 1 && TELE.some(t => t.Success === 'FALSE'), 'the duplicate itself is reported (telemetry + admin alert)');
reset(); TABS.Message_Queue.push(['9', 'pending', 'x']);
ok(await F.updateMessageQueueRow(env, '9', { Status: 'failed' }, { sheetRow: 4 }) === true && TABS.Message_Queue[3][1] === 'failed', 'sheetRow option edits exactly that row');
reset();
ok(await F.updateMessageQueueRow(env, '777', { Status: 'skipped' }) === false, 'unknown id returns false (was silently "best-effort")');
ok(ALERTS.length === 1 && /not found/.test(ALERTS[0]), 'unknown id raises a failure alert');
reset(); FAIL_BATCH = true; TABS.Message_Queue.push(['5', 'pending', 'x']);
ok(await F.updateMessageQueueRow(env, '5', { Status: 'skipped' }) === false, 'a Sheets error returns false instead of vanishing');

console.log('\nskipMessageQueue tells the truth');
reset(); TABS.Message_Queue.push(['5', 'pending', 'x']);
let r = await F.skipMessageQueue(env, { ids: ['5'] });
ok(r.body.ok === true && TABS.Message_Queue[3][1] === 'skipped', 'real skip reports ok and the row is skipped');
reset();
r = await F.skipMessageQueue(env, { ids: ['404'] });
ok(r.body.ok === false && /could not be skipped/.test(r.body.error), 'skip of a missing row reports an error (used to say ok:true)');

console.log('\nStatic checks on worker.js');
ok(!/best-effort/i.test(extract('updateMessageQueueRow')), 'updateMessageQueueRow no longer swallows silently');
for (const site of ["`/values/${MSG_QUEUE_TAB}:append", "`/values/${tab}:append?valueInputOption=RAW`,{values:[newRow]}", "`/values/Work_Orders:append?valueInputOption=RAW`, { values: [newRow] }", "`/values/${tab}:append?valueInputOption=RAW`, { values }"]) {
  const at = src.indexOf(site); ok(at > 0 && /guardAppendedIds/.test(src.slice(at, at + 1200)), 'append site guarded: ' + site.slice(0, 48));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
