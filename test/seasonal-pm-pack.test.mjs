// Queue #108 (Nov 18 2026): seasonal preventive-maintenance starter pack. Run: node test/seasonal-pm-pack.test.mjs
// Real worker.js functions run in a sandbox with a fake sheet. Proves: dry run writes nothing; real run adds only the missing names, all OFF with
// no property / vendor / tenant notice; a second run adds nothing; a failed write is returned by name and logged; the write is re-read and checked;
// the dates the engine produces are the dates in the brief; the pack carries no private data; the route is admin-only.
import fs from 'fs';
import './_wo-status-global.mjs';
const src = fs.readFileSync('worker.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConstArr(name) { const i = src.indexOf('const ' + name + ' = ['); const j = src.indexOf('\n];', i); return src.slice(i, j + 3); }
function grabConst(name) { const m = new RegExp('const ' + name + ' = [^;]*;').exec(src); if (!m) throw new Error('missing const ' + name); return m[0]; }
const names = ['recurParseISO','recurDayNum','recurISOFromDayNum','recurAddDays','recurWeekday','recurDaysInMonth','recurInSeason','recurInt','recurIsOccurrence','recurLatestDue','recurNextOccurrences','recurIsTrue','maxPriceNum','recurSanitizeTemplateFields','recurPackKey','recurPackRow','recurSeedSeasonalPack'];
const body = [grabConst('RECUR_LOOKBACK_DAYS'), grabConstArr('SEASONAL_PM_PACK'), ...names.map(grab)].join('\n') + '\nreturn {SEASONAL_PM_PACK,' + names.join(',') + '};';
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const eq = (n, a, b) => t(n + ' -> ' + JSON.stringify(a), JSON.stringify(a) === JSON.stringify(b), a);

// ---- fake sheet + fakes for the Worker's helpers ----
function world(opts = {}) {
  const w = { rows: (opts.rows || []).map(r => ({ ...r })), tel: [], appended: 0, reads: 0, ensure: 0 };
  const json = (d, s = 200) => ({ ok: s < 400, status: s, body: d, json: async () => d });
  const fetchTab = async () => { w.reads++; if (opts.readFails && w.reads >= opts.readFails) throw new Error('sheets down'); return w.rows.map(r => ({ ...r })); };
  const addRow = async (env, tab, row) => {
    if (opts.failName && row.Name === opts.failName) throw new Error('append refused');
    if (opts.silentDrop && row.Name === opts.silentDrop) return json({ success: true, id: '999' });   // says success, writes nothing
    const id = String(w.rows.reduce((m, r) => Math.max(m, +r.ID || 0), 0) + 1); w.appended++;
    w.rows.push({ ID: id, ...row, ...(opts.flipOn && row.Name === opts.flipOn ? { Recurrence_Enabled: 'TRUE' } : {}) });
    return json({ success: true, id });
  };
  const logTelemetry = async (env, rec) => { w.tel.push(rec); };
  const recurEnsureCols = async () => { w.ensure++; };
  const api = new Function('json', 'fetchTab', 'addRow', 'logTelemetry', 'recurEnsureCols', 'schedErrText', body)(json, fetchTab, addRow, logTelemetry, recurEnsureCols, e => String((e && e.message) || e));
  w.api = api; w.json = json; return w;
}
const call = async (w, b) => { const r = await w.api.recurSeedSeasonalPack({}, b); return { status: r.status, ...r.body }; };

// ---- the pack itself ----
{ const w = world(); const P = w.api.SEASONAL_PM_PACK;
  t('five templates', P.length === 5);
  t('names are unique and all start with "PM - " (so the From Template picker never shows two identical names)', new Set(P.map(p => p.Name)).size === 5 && P.every(p => p.Name.startsWith('PM - ')));
  for (const p of P) {
    const row = w.api.recurPackRow(p);
    t(p.Name + ': survives the sanitizer unchanged (no field dropped or clamped)', ['Freq_Type', 'Freq_Interval', 'Freq_Day_Of_Month', 'Start_Date', 'Lead_Days', 'Name', 'Description', 'Trade'].every(k => String(row[k]) === String(({ ...p, Freq_Type: 'monthly_date', Lead_Days: '14' })[k])), row);
    t(p.Name + ': seeded OFF, no property, no vendor, no tenant notice, no max price, global, active', row.Recurrence_Enabled === 'FALSE' && row.Targets === '[]' && row.Default_Vendor_ID === '' && row.Notify_Tenant === 'FALSE' && !row.Max_Price && row.Owner_ID === '' && row.Active === 'TRUE' && row.Season_Enabled === 'FALSE');
    t(p.Name + ': helper text field is not written', !('_due' in row));
    t(p.Name + ': no private data in the description (no digits runs of 4+, no $, no @)', !/\d{4,}|\$|@/.test(p.Description), p.Description);
    t(p.Name + ': first due date is next year or later (the engine never posts more than 3 days late)', p.Start_Date >= '2027-01-01');
  }
  const on = (p) => ({ ...w.api.recurPackRow(p), Recurrence_Enabled: 'TRUE' });
  const next = (name, from, n) => w.api.recurNextOccurrences(on(P.find(p => p.Name.includes(name))), from, n);
  eq('winterization: Nov 1 each year', next('Winterization', '2027-01-01', 3), ['2027-11-01', '2028-11-01', '2029-11-01']);
  eq('HVAC: Apr 1 and Oct 1 alternating', next('HVAC', '2027-01-01', 5), ['2027-04-01', '2027-10-01', '2028-04-01', '2028-10-01', '2029-04-01']);
  eq('dryer vent: Sep 15', next('Dryer', '2027-01-01', 2), ['2027-09-15', '2028-09-15']);
  eq('water heater: May 15', next('Water heater', '2027-01-01', 2), ['2027-05-15', '2028-05-15']);
  eq('detectors: Mar 10 (also across the 2028 leap year)', next('detector', '2027-01-01', 3), ['2027-03-10', '2028-03-10', '2029-03-10']);
  eq('nothing is due before the first date', next('Winterization', '2026-01-01', 1), ['2027-11-01']);
  const win = on(P[0]);
  eq('lead days: 14 days before Nov 1 the work order is due to post', w.api.recurLatestDue(win, '2027-10-18', 3), '2027-11-01');
  eq('lead days: 4 days after the posting day nothing is posted late', w.api.recurLatestDue(win, '2027-10-22', 3), '');
  eq('OFF and no targets: the sweep has nothing to post (Recurrence_Enabled stays FALSE)', w.api.recurPackRow(P[0]).Recurrence_Enabled, 'FALSE'); }

// ---- dry run ----
{ const w = world({ rows: [{ ID: '1', Name: 'Something else', Active: 'TRUE' }] }); const r = await call(w, { dry_run: true });
  t('dry run: ok, lists all five, writes nothing', r.ok === true && r.dry_run === true && r.would_add.length === 5 && w.appended === 0 && w.rows.length === 1 && w.ensure === 0 && w.tel.length === 0, r);
  const d = await call(w, {}); t('dry run is the DEFAULT when dry_run is absent', d.dry_run === true && w.appended === 0);
  const d2 = await call(w, { dry_run: 'false' }); t('only the boolean false writes ("false" the string does not)', d2.dry_run === true && w.appended === 0);
  t('dry run costs one read', w.reads === 3, w.reads); }

// ---- real run ----
{ const w = world(); const r = await call(w, { dry_run: false });
  t('real run: adds exactly five, all confirmed, none failed', r.ok === true && r.added.length === 5 && r.failed.length === 0 && w.appended === 5, r);
  t('real run: rows in the sheet are OFF with no targets', w.rows.length === 5 && w.rows.every(x => x.Recurrence_Enabled === 'FALSE' && x.Targets === '[]' && x.Default_Vendor_ID === '' && x.Notify_Tenant === 'FALSE'));
  t('real run: columns ensured once, one success telemetry row', w.ensure === 1 && w.tel.length === 1 && w.tel[0].Success === 'TRUE' && w.tel[0].Job_Type === 'seasonal_pack_seed');
  const again = await call(w, { dry_run: false });
  t('second run adds nothing and reports all five already there', again.ok === true && again.added.length === 0 && again.already_there.length === 5 && w.appended === 5, again); }

// ---- hand-made duplicates are left alone (case and spacing ignored); an inactive one does not count ----
{ const w = world({ rows: [{ ID: '1', Name: '  pm -   winterization (pipes + outside faucets) ', Active: 'TRUE', Recurrence_Enabled: 'TRUE', Targets: '[{"p":"7"}]' }, { ID: '2', Name: 'PM - Dryer vent cleaning', Active: 'FALSE' }] });
  const r = await call(w, { dry_run: false });
  t('existing name skipped (case/spacing ignored), inactive one is re-added', r.already_there.length === 1 && r.added.length === 4 && r.added.some(a => /Dryer/.test(a.name)) && !r.added.some(a => /Winterization/.test(a.name)), r);
  t('the hand-made row is untouched', w.rows[0].Recurrence_Enabled === 'TRUE' && w.rows[0].Targets === '[{"p":"7"}]'); }

// ---- failures are never silent ----
{ const w = world({ failName: 'PM - Water heater flush' }); const r = await call(w, { dry_run: false });
  t('one write fails: the other four still land, the failure is named with its reason', r.ok === false && r.added.length === 4 && r.failed.length === 1 && r.failed[0].name === 'PM - Water heater flush' && /append refused/.test(r.failed[0].error), r);
  t('one write fails: a FALSE telemetry row names it', w.tel.length === 1 && w.tel[0].Success === 'FALSE' && /Water heater flush/.test(w.tel[0].Notes));
  const retry = await call(world({ rows: w.rows }), { dry_run: false }); t('trying again adds only the missing one', retry.added.length === 1 && retry.already_there.length === 4); }
{ const w = world({ silentDrop: 'PM - Dryer vent cleaning' }); const r = await call(w, { dry_run: false });
  t('a write that says success but is not in the sheet is caught by the re-read', r.ok === false && r.failed.some(f => /Dryer/.test(f.name) && /not found after the write/.test(f.error)) && w.tel[0].Success === 'FALSE', r); }
{ const w = world({ flipOn: 'PM - HVAC pre-season service' }); const r = await call(w, { dry_run: false });
  t('a row that lands with recurrence ON is reported, never passed', r.ok === false && r.failed.some(f => /HVAC/.test(f.name) && /recurrence on/.test(f.error)), r); }
{ const w = world({ readFails: 1 }); const r = await call(w, { dry_run: true });
  t('cannot read the templates: 500, says nothing was added, files a failure row', r.status === 500 && r.ok === false && /nothing was checked or added/.test(r.error) && w.tel[0].Success === 'FALSE', r); }
{ const w = world({ readFails: 2 }); const r = await call(w, { dry_run: false });
  t('cannot re-read to confirm: reported as saved-but-unconfirmed, not as success', r.ok === false && r.failed.length === 5 && /could not be confirmed/.test(r.failed[0].error) && r.added.length === 0, r); }

// ---- wiring ----
t('route exists once, admin gate only', (src.match(/path === '\/wo-template\/seed-seasonal'\) return await recurSeedSeasonalPack/g) || []).length === 1);
const pub = src.slice(src.indexOf('const PUBLIC_PATHS = ['), src.indexOf(']', src.indexOf('const PUBLIC_PATHS = [')));
t('not in PUBLIC_PATHS', !pub.includes('seed-seasonal'));
t('not in HUB_PROD_WRITE_PATHS', !/HUB_PROD_WRITE_PATHS = \[[^\]]*seed-seasonal/.test(src));
t('not in any ROLE_SCOPES list', !(src.match(/const ROLE_SCOPES = \{[\s\S]*?\n\};/) || [''])[0].includes('seed-seasonal'));
t('the staging test token may only run the dry run', /path === '\/wo-template\/seed-seasonal'\) return !!\(body && body\.dry_run === true\)/.test(src));
t('no cron, no new scheduler job', !/seed-seasonal[\s\S]{0,200}SCHED_JOBS/.test(src) && !/SEASONAL_PM_PACK[\s\S]{0,400}crons/.test(src));
t('no new sheet columns (uses the existing recurrence columns)', !/RECUR_TEMPLATE_COLS = \[[^\]]*Seasonal/i.test(src));

// ---- the Hub screen (static) ----
t('button is a real <button> in the Templates modal', /<button class="btn secondary small" style="min-height:44px" id="pack-open-btn" onclick="openSeasonalPackModal\(\)">Add seasonal starter pack<\/button>/.test(html));
const conf = html.slice(html.indexOf('function confirmSeasonalPack()'), html.indexOf('function copyTemplate(id)'));
t('confirm handler disables the button on its first statement, before any api call', /^function confirmSeasonalPack\(\) \{\n  var btn = document\.getElementById\('pack-add-btn'\); btn\.disabled = true;/.test(conf) && conf.indexOf('btn.disabled = true') < conf.indexOf('api('));
t('the button comes back on failure (error and network paths)', (conf.match(/btn\.disabled = false/g) || []).length >= 3);
t('a partial result names what failed, never a silent partial', /Could not add: /.test(conf) && /f\.name/.test(conf));
const opn = html.slice(html.indexOf('function openSeasonalPackModal()'), html.indexOf('function confirmSeasonalPack()'));
t('preview calls the dry run first and shows retry on failure', /dry_run:true/.test(opn) && /Retry/.test(opn) && /Nothing was added/.test(opn));
t('all-five-exist state hides the add button', /All five are already in your templates\. Nothing to add\./.test(opn));
t('a failed template load shows an error with Retry, not the empty message', /Could not load templates: /.test(html) && /_tmplLoadError = Array\.isArray\(items\)/.test(html));
t('Templates row buttons are 44px (not the old 32px)', !/min-height:32px" onclick="openEditTemplateModal/.test(html) && /min-height:44px" onclick="openEditTemplateModal/.test(html));
t('the plain sentence is on the modal: OFF, no property, nothing posted, nobody texted', /switched OFF and linked to no property\. Nothing is posted and nobody is texted/.test(html));

console.log(`seasonal-pm-pack: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
