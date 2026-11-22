// Queue #63 (Nov 22 2026): possible-duplicate check at intake, Phase 1 (tenant portal). Run: node test/wo-similar.test.mjs
// Pulls the REAL functions out of worker.js and runs them against stubbed sheets.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../tenant.html', import.meta.url), 'utf8');
function grab(kind, name) {
  const i = src.indexOf(kind + ' ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
const line = (start) => { const l = src.split('\n').find(x => x.startsWith(start)); assert.ok(l, 'missing ' + start); return l; };
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

const tel = []; let cfg = {}, sheets = {};
const json = (body, status = 200) => ({ body, status });
const WOStatus = new Function(fs.readFileSync(new URL('../wo-status.js', import.meta.url), 'utf8') + '; return WOStatus;')();
const factory = new Function('WOStatus', 'json', 'fetchConfig', 'fetchTabs', 'logTelemetry', `
  ${line('const QUEUE_STOPWORDS')}
  ${grab('function', 'queueTokens')}
  ${grab('function', 'queueDice')}
  ${line('const WO_SIMILAR_TENANT_STATUSES')}
  ${grab('function', 'woSimilarOpen')}
  ${line('const WO_SIMILAR_TENANT_LABEL')}
  ${grab('function', 'isBackgroundWO')}
  ${grab('function', 'tenantCanSeeWO')}
  ${grab('async function', 'woSimilarCheck')}
  return { woSimilarOpen, woSimilarCheck };
`);
const { woSimilarOpen, woSimilarCheck } = factory(WOStatus, json, async () => cfg, async (env, tabs) => tabs.map(t => sheets[t] || []), async (env, r) => { tel.push(r); });

const base = { property_id: 'P1', unit_id: 'U1' };
const wo = (o) => Object.assign({ ID: 'WO-1', Property_ID: 'P1', Unit_ID: 'U1', Trade: 'Plumbing', Status: 'Assigned', Description: 'kitchen sink leaking under the cabinet', Created_Date: '2026-11-10T12:00:00Z' }, o);

// pure matcher
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'sink in kitchen is leaking again' }, [wo({})]).length === 1, 'same unit + trade + reworded text matches');
ok(woSimilarOpen({ ...base, trade: 'Electrical', description: 'bedroom outlet has no power' }, [wo({})]).length === 0, 'different problem does not match');
ok(woSimilarOpen({ ...base, unit_id: 'U2', trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({})]).length === 0, 'different unit never matches');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({ Status: 'Complete' })]).length === 0, 'closed work is not looked at');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({ Status: 'Pending Invoice' })]).length === 0, 'billing states are not open work');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({ Voided: 'TRUE' })]).length === 0, 'voided never matches');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({ Bid_Group_ID: 'BG-1' })]).length === 0, 'bid-group copies are never flagged');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({ Type: 'addon' })]).length === 0, 'add-on work never matches');
ok(woSimilarOpen({ ...base, trade: 'General', description: 'kitchen sink leaking under the cabinet' }, [wo({})]).length === 1, 'different trade but near-identical text still matches (0.70 band)');
ok(woSimilarOpen({ ...base, trade: 'General', description: 'sink leaking' }, [wo({})]).length === 0, 'different trade with only partly similar text does not match');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'leak' }, [wo({ Description: 'leak' })]).length === 1, 'one-word descriptions match on same trade + shared word');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'toilet' }, [wo({})]).length === 0, 'one-word with no shared word does not match');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking under cabinet' }, [wo({ Recurring_Template_ID: 'R1' })]).length === 1, 'recurring job matches on the same trade');
ok(woSimilarOpen({ ...base, trade: 'General', description: 'kitchen sink leaking under the cabinet' }, [wo({ Recurring_Template_ID: 'R1' })]).length === 0, 'recurring job never matches across trades');
const many = [1, 2, 3, 4, 5].map(i => wo({ ID: 'WO-' + i, Description: 'kitchen sink leaking under the cabinet ' + 'x'.repeat(i) }));
const top = woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking under the cabinet' }, many);
ok(top.length === 3 && top[0].score >= top[1].score && top[1].score >= top[2].score, 'at most 3, best first');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'kitchen sink leaking' }, [wo({})], { threshold: 'junk', otherTradeThreshold: '', max: 'x' }).length === 1, 'junk settings fall back to safe defaults');
ok(woSimilarOpen({ ...base, trade: 'Plumbing', description: 'fregadero de la cocina gotea' }, [wo({ Description: 'fregadero de la cocina gotea mucho' })]).length === 1, 'Spanish text works');
ok(woSimilarOpen(null, null).length === 0, 'null inputs give no matches');
ok(JSON.stringify(WOStatus.sets.TENANT_OPEN.filter(st => st !== 'Pending Invoice')) === JSON.stringify(['New', 'Assigned', 'Accepted', 'In Progress', 'On Hold']), 'open set comes from the status single source of truth, without the billing state');

// endpoint
const tenant = { ID: 'T1', Property_ID: 'P1', Unit_ID: 'U1', Active: 'TRUE', Move_In_Date: '2026-01-01' };
sheets = { Tenants: [tenant], Work_Orders: [wo({ ID: 'WO-10', Vendor_ID: 'V9', Notes: 'secret note', Max_Price: '500' }), wo({ ID: 'WO-11', Unit_ID: 'U2' }), wo({ ID: 'WO-12', Tenant_Visible: 'FALSE' }), wo({ ID: 'WO-13', Created_Date: '2025-06-01T00:00:00Z' })] };
const call = (role, sid, body) => woSimilarCheck({}, body, role, sid);
cfg = {};
let r = await call('tenant', 'T1', { trade: 'Plumbing', description: 'kitchen sink leaking' });
ok(r.body.enabled === false && r.body.matches.length === 0 && tel.length === 0, 'blank Config = OFF: nothing returned, nothing logged');
cfg = { wo_similar_enabled: 'TRUE' };
r = await call('tenant', 'T1', { trade: 'Plumbing', description: 'kitchen sink leaking', unit_id: 'U2', property_id: 'P9' });
ok(r.body.enabled && r.body.matches.map(m => m.id).join() === 'WO-10', 'ids sent by the page are ignored; only visible WOs on the session unit match (not other unit, not tenant-hidden, not before move-in)');
const m0 = r.body.matches[0];
ok(Object.keys(m0).sort().join() === 'created,id,snippet,status_label,trade', 'response has no vendor, cost, notes or phone fields');
ok(m0.status_label === 'Assigned' && !JSON.stringify(r.body).includes('secret') && !JSON.stringify(r.body).includes('500'), 'tenant-safe status label, no notes or price');
ok(tel.length === 1 && tel[0].Job_Type === 'wo_similar_check' && tel[0].Success === 'TRUE' && /WO-10/.test(tel[0].Notes), 'each real check leaves a telemetry row');
r = await call('admin', '', { trade: 'Plumbing', description: 'kitchen sink leaking' });
ok(r.body.enabled === false, 'only tenant sessions in Phase 1');
r = await call('tenant', 'NOPE', { trade: 'Plumbing', description: 'x' });
ok(r.status === 403, 'unknown tenant session refused');
cfg = { wo_similar_enabled: 'TRUE', wo_similar_threshold: '0.99' };
r = await call('tenant', 'T1', { trade: 'Plumbing', description: 'sink in kitchen is leaking again' });
ok(r.body.matches.length === 0, 'threshold is read from Config');

// wiring
ok(src.includes("if (path === '/workorder/similar-check')  return await woSimilarCheck(env, body, callerRole, callerSessionId);"), 'route exists');
const scopes = /const ROLE_SCOPES = \{[\s\S]*?\n  tenant: \[([\s\S]*?)\],/.exec(src);
ok(scopes && scopes[1].includes("'/workorder/similar-check'"), 'path is in the tenant role scope');
const owner = /\n  owner:\s*\[([\s\S]*?)\],/.exec(src.slice(src.indexOf('const ROLE_SCOPES')));
ok(owner && !owner[1].includes('similar-check'), 'not in the owner scope (Phase 2)');
const cw = grab('async function', 'createWorkOrder');
ok(cw.includes('Possible_Dup_Of') && cw.includes("ensureColumns(env, 'Work_Orders', ['Possible_Dup_Of'])") && /if \(_dupOf\)/.test(cw), 'possible_dup_of lands in its column, column created only when a value is sent');
ok(cw.includes('/^WO-\\d{1,9}$/'), 'possible_dup_of must look like a WO id');
ok(cw.indexOf('findRecentDuplicate(env, \'Work_Orders\'') < cw.indexOf('Possible_Dup_Of'), 'the 60-second exact guard still runs first');
ok(!/ensureTab/.test(grab('async function', 'woSimilarCheck')), 'no ensureTab');

// tenant.html
const sub = html.slice(html.indexOf('function submitNewRequest'));
ok(html.includes('id="srDupPanel"') && html.includes('id="srActions"'), 'warning panel exists in the modal');
ok(sub.indexOf("subBtn.disabled = true") > -1 && sub.indexOf("subBtn.disabled = true") < sub.indexOf('srSimilarCheck(trade, desc)'), 'Submit is disabled before the first await');
ok(sub.includes('setTimeout(function() { timedOut = true') && sub.includes('3000'), 'check times out after 3 seconds');
ok(/function srSimilarCheck[\s\S]*srReportMiss/.test(sub) && sub.includes("hubReportFailure('wo_similar_check'"), 'a check that fails is reported, and the request still goes through (fail open)');
ok(sub.includes('srCreateRequest(trade, desc, matches[0].id)') && sub.includes("possible_dup_of: dupOf || ''"), '"different problem" creates the WO with possible_dup_of');
const addFn = sub.slice(sub.indexOf('function srAddToExisting'), sub.indexOf('function srCreateRequest'));
ok(addFn.includes("api('/wo/add-note'") && addFn.includes('uploadTenantPhoto(srFiles[i], woId)') && !addFn.includes("api('/workorder'"), '"Add to this request" adds a note and photos to the existing WO and creates no new WO');
ok(sub.includes('did not upload. Close this window, open'), 'a failed photo on the existing WO is still reported');
ok(html.includes('Esto se parece a una solicitud que ya tiene abierta') && html.includes('This looks like a request you already have open') && html.includes('Agregar a esta solicitud') && html.includes('Add to this request') && html.includes('No, this is a different problem') && html.includes('No, es un problema diferente'), 'EN and ES strings present');
ok(!/<label[^>]*>[^<]*<input type="file"/.test(html), 'UI_QA grep: no label-wrapped file input');
ok(/class="btn btn-green btn-full"[^>]*onclick="srAddToExisting/.test(html), 'primary action is a real button');
console.log(n + ' checks passed');
