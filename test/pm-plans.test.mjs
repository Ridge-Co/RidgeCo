// PM plans (queue #155, Phase 1). Pure helpers are executed for real; wiring is checked structurally.
// Run: node test/pm-plans.test.mjs
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
function grabArr(name) { const i = src.indexOf('const ' + name + ' = ['); if (i < 0) throw new Error('missing const ' + name); const e = src.indexOf('\n];', i); return src.slice(i, (e > 0 && src.indexOf('];', i) > e ? e + 3 : src.indexOf('];', i) + 2)); }
const recurNames = ['recurParseISO','recurDayNum','recurISOFromDayNum','recurAddDays','recurWeekday','recurDaysInMonth','recurInSeason','recurInt','recurIsOccurrence','recurNextOccurrences','recurIsTrue','recurEtDateISO'];
const pmNames = ['pmParseIds','pmTargetsAfter','pmFindDuplicate','pmPreviewVisits','pmSanitizePlan','pmLogLine','pmAppendLog'];
const consts = ["const PM_STATUSES = ['Active','Paused','Ended'];", "const PM_BASES = ['per_unit','per_property'];", "const PM_PERIODS = ['monthly','quarterly','yearly'];"];
const code = [...consts, grabArr('PM_SEASONAL_PACK'), ...recurNames.map(grab), ...pmNames.map(grab)].join('\n') + '\nreturn {' + [...recurNames, ...pmNames, 'PM_SEASONAL_PACK'].join(',') + '};';
const R = new Function(code)();
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => t(n + ' -> ' + JSON.stringify(a), JSON.stringify(a) === JSON.stringify(b));

// ids
eq('ids from JSON array', R.pmParseIds('["5","6"]'), ['5', '6']);
eq('ids from comma text', R.pmParseIds('5, 6,5'), ['5', '6']);
eq('blank ids', R.pmParseIds(''), []);
eq('numbers become strings', R.pmParseIds('[5,6]'), ['5', '6']);

// enrollment -> targets add / remove / round trip
const base = [{ p: '1', u: '' }, { p: '2', u: '9' }];
let a = R.pmTargetsAfter(base, { p: '3' }, 'add');
eq('add keeps others', a, [{ p: '1', u: '' }, { p: '2', u: '9' }, { p: '3', u: '' }]);
eq('add twice does not duplicate', R.pmTargetsAfter(a, { p: '3', u: '' }, 'add'), a);
eq('remove only that one', R.pmTargetsAfter(a, { p: '3' }, 'remove'), base);
eq('pause then resume round trip', R.pmTargetsAfter(R.pmTargetsAfter(base, { p: '7', u: '2' }, 'add'), { p: '7', u: '2' }, 'remove'), base);
eq('unit target differs from whole property', R.pmTargetsAfter([{ p: '3', u: '' }], { p: '3', u: '4' }, 'add').length, 2);

// duplicate guard
const en = [{ ID: '1', Plan_ID: '1', Property_ID: '3', Unit_ID: '', Status: 'Active' }, { ID: '2', Plan_ID: '1', Property_ID: '4', Unit_ID: '', Status: 'Ended' }];
t('same property same plan is a duplicate', !!R.pmFindDuplicate(en, '1', '3', ''));
t('ended row is not a duplicate', !R.pmFindDuplicate(en, '1', '4', ''));
t('other plan is not a duplicate', !R.pmFindDuplicate(en, '2', '3', ''));
t('other unit is not a duplicate', !R.pmFindDuplicate(en, '1', '3', '8'));

// 12-month preview
const tpl = { ID: '10', Name: 'Winterization', Freq_Type: 'monthly_date', Freq_Interval: '12', Freq_Day_Of_Month: '15', Start_Date: '2026-10-15', Recurrence_Enabled: 'FALSE' };
const pv = R.pmPreviewVisits([tpl], '2026-11-21');
eq('winterization next date within 12 months', pv[0].dates, ['2027-10-15']);
t('switched-off template warns by name', pv[0].switched_off && /Winterization is switched off, so no visits will post/.test(pv[0].warning));
const on = R.pmPreviewVisits([{ ...tpl, Recurrence_Enabled: 'TRUE' }], '2026-11-21');
t('switched-on template has no warning', !on[0].switched_off && on[0].warning === '');
eq('a date past 12 months is dropped', R.pmPreviewVisits([{ ...tpl, Start_Date: '2028-10-15' }], '2026-11-21')[0].dates, []);

// plan validation
let s = R.pmSanitizePlan({ Name: ' Seasonal ', Template_IDs: ['10', '11'], Price: '$1,200', Price_Basis: 'per_unit', Billing_Period: 'quarterly' }, new Set(['10', '11']));
eq('plan normalizes', s.fields, { Name: 'Seasonal', Template_IDs: '["10","11"]', Price: '1200.00', Price_Basis: 'per_unit', Billing_Period: 'quarterly' });
t('blank price is allowed (bill by hand)', R.pmSanitizePlan({ Price: '' }).fields.Price === '');
t('bad price refused', !!R.pmSanitizePlan({ Price: 'abc' }).error);
t('empty name refused', !!R.pmSanitizePlan({ Name: '  ' }).error);
t('no visits refused', !!R.pmSanitizePlan({ Template_IDs: [] }).error);
t('unknown template refused', !!R.pmSanitizePlan({ Template_IDs: ['99'] }, new Set(['10'])).error);
t('bad basis refused', !!R.pmSanitizePlan({ Price_Basis: 'per_pound' }).error);
t('Active false is stored as FALSE (hide, not delete)', R.pmSanitizePlan({ Active: false }).fields.Active === 'FALSE');

// change log cap
t('log keeps newest and stays under 4000', R.pmAppendLog('x'.repeat(5000), 'new line').length <= 4000 && R.pmAppendLog('x'.repeat(5000), 'new line').endsWith('new line'));

// seasonal pack: five visits, yearly, valid dates, trades the Hub knows
t('pack has five visits', R.PM_SEASONAL_PACK.length === 5);
for (const d of R.PM_SEASONAL_PACK) {
  t(d.Name + ': valid month-day', /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d.md));
  t(d.Name + ': trade is a known trade', ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'General'].includes(d.Trade));
  t(d.Name + ': yearly schedule gives one date a year', R.recurNextOccurrences({ Freq_Type: 'monthly_date', Freq_Interval: '12', Freq_Day_Of_Month: d.md.slice(3), Start_Date: '2026-' + d.md }, '2026-01-01', 3).length === 3);
}

// wiring (structural)
t('seven routes are wired', ['/pm/plans', '/pm/enrollments', '/pm/plan/save', '/pm/seasonal-pack', '/pm/enroll/preview', '/pm/enroll', '/pm/enroll/status'].every(p => src.includes("path === '" + p + "'")));
const pubLine = src.slice(src.indexOf('const PUBLIC_PATHS'), src.indexOf('const PUBLIC_PATHS') + 3000);
t('no /pm path in PUBLIC_PATHS', !/\/pm\//.test(pubLine.slice(0, pubLine.indexOf('];'))));
const prodWrite = src.slice(src.indexOf('const HUB_PROD_WRITE_PATHS'), src.indexOf('const HUB_PROD_WRITE_PATHS') + 800);
t('no /pm path in HUB_PROD_WRITE_PATHS', !/\/pm\//.test(prodWrite.slice(0, prodWrite.indexOf('];'))));
t('ROLE_SCOPES does not mention /pm', !/ROLE_SCOPES[\s\S]{0,4000}\/pm\//.test(src.slice(src.indexOf('const ROLE_SCOPES'), src.indexOf('const ROLE_SCOPES') + 4000)) || src.indexOf('const ROLE_SCOPES') < 0);
t('staging guard covers every /pm write', ['/pm/enroll/preview', '/pm/seasonal-pack', '/pm/plan/save', "path === '/pm/enroll'"].every(p => src.includes(p)) && /isTestRecord\(env, 'Properties', _prop\)/.test(src));
const enroll = grab('pmEnroll');
t('enrollment row is written and read back BEFORE templates change', enroll.indexOf('addRow(env, PM_ENROLL_TAB') < enroll.indexOf('pmApplyTargets') && /did not read back/.test(enroll));
t('a half state marks needs-attention and answers 500', /pmHalfState/.test(enroll) && /needs_attention: true/.test(grab('pmHalfState')) && /Attention:/.test(grab('pmHalfState')));
const apply = grab('pmApplyTargets');
t('template writes are verified and failures logged', /updateRowVerified\(env, 'WO_Templates'/.test(apply) && /pmFail\(/.test(apply));
t('enrolling never switches a template on', !/Recurrence_Enabled/.test(enroll) && !/Recurrence_Enabled: *'TRUE'/.test(grab('pmApplyTargets')));
t('seasonal pack templates are created OFF with no targets', /Recurrence_Enabled: 'FALSE'/.test(grab('pmSeasonalPack')) && /Targets: '\[\]'/.test(grab('pmSeasonalPack')));
t('tabs use ensureTab + ensureColumns, never a bare ensureTab on a live tab', /ensureTab\(env, PM_PLANS_TAB/.test(grab('pmEnsureTabs')) && /ensureColumns\(env, PM_PLANS_TAB/.test(grab('pmEnsureTabs')) && /ensureColumns\(env, PM_ENROLL_TAB/.test(grab('pmEnsureTabs')));
t('no new scheduled job, no cron', !/SCHED_JOBS[\s\S]{0,40}pm_/.test(src) && !/PM_[A-Z_]+[\s\S]{0,30}crons/.test(src));
t('no text or QuickBooks call in the PM block', !/sendSms|smsSend|qbRequest|gmailSendEmail|createInvoice/.test(src.slice(src.indexOf('// ── PM plans (queue #155'), src.indexOf('async function listWOSnippets'))));
t('no swallowing catch in the PM block', !/catch\s*\(\w*\)\s*\{\s*\}/.test(src.slice(src.indexOf('// ── PM plans (queue #155'), src.indexOf('async function listWOSnippets'))));
// the screen
t('PM Plans tool button exists', /data-tool="pm-plans"[\s\S]{0,200}pmOpen\(\)/.test(html));
t('modal exists', /id="modal-pm-plans"/.test(html));
t('screen shows a load error with Try again', /Could not load PM plans/.test(html) && /Try again/.test(html));
t('screen has an empty state', /No properties on a plan yet/.test(html));
t('writes go through the double-tap guard', /function pmWrite/.test(html) && /pmBusy\(true\)/.test(html) && /data-pm-write/.test(html));
t('screen warns when a visit is switched off', /Switched off, so these will not post/.test(html));
t('every write button is at least 44px', !/<button[^>]*data-pm-write[^>]*min-height:(?!44)/.test(html));
t('no owner-facing money or price is shown anywhere new', !/owner\.html/.test(src.slice(src.indexOf('// ── PM plans (queue #155'), src.indexOf('async function listWOSnippets'))));

console.log(`pm-plans: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
