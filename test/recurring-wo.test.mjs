// Recurring / scheduled work orders (Sep 28 2026). Pure date math is executed for real;
// wiring (quiet-hours exception, vendor-only notify, owner suppression, cron hook) is checked structurally.
import fs from 'fs';
const src = fs.readFileSync('worker.js', 'utf8');
function grab(name) {
  let i = src.indexOf('async function ' + name + '('); if (i < 0) i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}
function grabConst(name) { const m = new RegExp('const ' + name + ' = [^;]*;').exec(src); if (!m) throw new Error('missing const ' + name); return m[0]; }
const names = ['recurParseISO','recurDayNum','recurISOFromDayNum','recurAddDays','recurWeekday','recurDaysInMonth','recurInSeason','recurInt','recurIsOccurrence','recurLatestDue','recurNextOccurrences','recurTargets','recurTargetKey','recurWOIsOpen','recurIsTrue','recurSanitizeTemplateFields'];
const code = [grabConst('RECUR_CLOSED_STATUSES'), grabConst('RECUR_LOOKBACK_DAYS'), ...names.map(grab)].join('\n') + '\nreturn {' + names.join(',') + '};';
const R = new Function(code)();
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const eq = (n, a, b) => t(n + ' -> ' + JSON.stringify(a), JSON.stringify(a) === JSON.stringify(b));

// every N days
let tpl = { Freq_Type: 'days', Freq_Interval: 10, Start_Date: '2026-01-01' };
eq('every 10 days', R.recurNextOccurrences(tpl, '2026-01-01', 3), ['2026-01-01', '2026-01-11', '2026-01-21']);
t('before start is never due', !R.recurIsOccurrence(tpl, '2025-12-22'));
// weekly / biweekly / every 4 weeks (2026-09-28 is a Monday)
tpl = { Freq_Type: 'weekly', Freq_Interval: 2, Freq_Weekday: 1, Start_Date: '2026-09-28' };
eq('biweekly Monday', R.recurNextOccurrences(tpl, '2026-09-28', 3), ['2026-09-28', '2026-10-12', '2026-10-26']);
tpl = { Freq_Type: 'weekly', Freq_Interval: 4, Freq_Weekday: 3, Start_Date: '2026-09-28' }; // Wed, first is 09-30
eq('every 4 weeks Wed anchored after start', R.recurNextOccurrences(tpl, '2026-09-28', 2), ['2026-09-30', '2026-10-28']);
tpl = { Freq_Type: 'weekly', Freq_Interval: 1, Freq_Weekday: 5, Start_Date: '2026-09-28' };
eq('weekly Friday', R.recurNextOccurrences(tpl, '2026-09-28', 2), ['2026-10-02', '2026-10-09']);
// monthly by date, clamps to month end
tpl = { Freq_Type: 'monthly_date', Freq_Interval: 1, Freq_Day_Of_Month: 31, Start_Date: '2026-01-01' };
eq('monthly 31st clamps', R.recurNextOccurrences(tpl, '2026-01-01', 3), ['2026-01-31', '2026-02-28', '2026-03-31']);
tpl = { Freq_Type: 'monthly_date', Freq_Interval: 3, Freq_Day_Of_Month: 15, Start_Date: '2026-01-01' };
eq('every 3 months on 15th', R.recurNextOccurrences(tpl, '2026-01-01', 3), ['2026-01-15', '2026-04-15', '2026-07-15']);
// nth weekday
tpl = { Freq_Type: 'monthly_nth', Freq_Interval: 1, Freq_Nth: 3, Freq_Weekday: 2, Start_Date: '2026-09-01' };
eq('3rd Tuesday', R.recurNextOccurrences(tpl, '2026-09-01', 3), ['2026-09-15', '2026-10-20', '2026-11-17']);
tpl = { Freq_Type: 'monthly_nth', Freq_Interval: 1, Freq_Nth: 5, Freq_Weekday: 5, Start_Date: '2026-09-01' };
eq('last Friday', R.recurNextOccurrences(tpl, '2026-09-01', 3), ['2026-09-25', '2026-10-30', '2026-11-27']);
tpl = { Freq_Type: 'monthly_nth', Freq_Interval: 3, Freq_Nth: 1, Freq_Weekday: 1, Start_Date: '2026-01-01' };
eq('quarterly 1st Monday', R.recurNextOccurrences(tpl, '2026-01-01', 3), ['2026-01-05', '2026-04-06', '2026-07-06']);
// end date
tpl = { Freq_Type: 'weekly', Freq_Interval: 1, Freq_Weekday: 1, Start_Date: '2026-09-28', End_Date: '2026-10-12' };
eq('end date honored', R.recurNextOccurrences(tpl, '2026-09-28', 10), ['2026-09-28', '2026-10-05', '2026-10-12']);
// seasonal window, incl. wrap-around, independent of frequency
tpl = { Freq_Type: 'monthly_date', Freq_Interval: 1, Freq_Day_Of_Month: 1, Start_Date: '2026-01-01', Season_Enabled: 'TRUE', Season_Start: '03-15', Season_End: '11-01' };
eq('season Mar15-Nov1', R.recurNextOccurrences(tpl, '2026-01-01', 8), ['2026-04-01','2026-05-01','2026-06-01','2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01']);
tpl = { ...tpl, Season_Start: '11-01', Season_End: '03-15' };
t('wrap-around season includes Dec', R.recurInSeason('2026-12-10', '11-01', '03-15') && R.recurInSeason('2027-02-01', '11-01', '03-15') && !R.recurInSeason('2026-07-01', '11-01', '03-15'));
tpl = { ...tpl, Season_Enabled: 'FALSE', Season_Start: '03-15', Season_End: '11-01' };
t('season off = ignored', R.recurIsOccurrence(tpl, '2026-01-01'));
// lead time + lookback
tpl = { Freq_Type: 'weekly', Freq_Interval: 1, Freq_Weekday: 1, Start_Date: '2026-09-28', Lead_Days: 2 };
eq('lead 2d: post on Sat for Monday due', R.recurLatestDue(tpl, '2026-10-03'), '2026-10-05');
eq('no due on unrelated day', R.recurLatestDue({ ...tpl, Lead_Days: 0 }, '2026-10-01', 0), '');
eq('catch-up within 3 days', R.recurLatestDue({ ...tpl, Lead_Days: 0 }, '2026-10-01'), '2026-09-28');
eq('older than lookback dropped', R.recurLatestDue({ ...tpl, Lead_Days: 0 }, '2026-10-02'), '');
// garbage in
t('bad type never due', !R.recurIsOccurrence({ Freq_Type: 'nope', Start_Date: '2026-01-01' }, '2026-01-01'));
t('missing start never due', !R.recurIsOccurrence({ Freq_Type: 'days', Freq_Interval: 1 }, '2026-01-01'));
t('invalid date rejected', R.recurParseISO('2026-02-30') === null);
// targets
eq('targets parse+dedupe', R.recurTargets({ Targets: '[{"p":"1","u":"2"},{"p":"1","u":"2"},{"p":"3"},{"x":1}]' }), [{ p: '1', u: '2' }, { p: '3', u: '' }]);
eq('targets bad json', R.recurTargets({ Targets: '{oops' }), []);
// open detection
t('Assigned is open', R.recurWOIsOpen({ Status: 'Assigned' }));
t('Complete is closed', !R.recurWOIsOpen({ Status: 'Complete' }));
t('Inactive is closed', !R.recurWOIsOpen({ Status: 'New', Active: 'FALSE' }));
// sanitize
const sf = R.recurSanitizeTemplateFields({ Freq_Type: 'bogus', Freq_Interval: '0', Start_Date: 'garbage', Season_Start: '13-40', Recurrence_Enabled: true, Notify_Tenant: 'false', Lead_Days: '999', Name: 'x' });
t('sanitize drops bad type', sf.Freq_Type === undefined);
t('sanitize clamps interval/lead', sf.Freq_Interval === '1' && sf.Lead_Days === '60');
t('sanitize blanks bad dates', sf.Start_Date === '' && sf.Season_Start === '');
t('sanitize bools', sf.Recurrence_Enabled === 'TRUE' && sf.Notify_Tenant === 'FALSE' && sf.Name === 'x');

// ── structural wiring ──
const proc = grab('processRecurringWorkOrders'), post = grab('recurPostWO'), sms = grab('smsGatedSend'), assign = grab('assignVendor'), sweep = grab('cronSweep'), hubw = grab('hubTestWriteAllowed');
t('sweep runs recurring poster', /processRecurringWorkOrders\(env\)/.test(sweep));
t('poster gated to 8am-7pm ET', /h < RECUR_POST_START_HOUR_ET \|\| h >= QUIET_HOURS_START_ET/.test(proc) && /RECUR_POST_START_HOUR_ET = 8/.test(src));
t('skip when previous still open', /recurWOIsOpen/.test(proc) && /skipped_open/.test(proc));
t('idempotent per occurrence', /Recurring_Due === due/.test(proc));
t('tenant notify off unless override', /const notifyTenant = recurIsTrue\(tpl\.Notify_Tenant\)/.test(post) && /tenant_notify_created: notifyTenant/.test(post) && /notify_tenant: notifyTenant/.test(post));
t('owner always suppressed', /owner_notify_override: 'off'/.test(post) && /NOTIFY_TIERS=\{[^}]*off:\[\]/.test(src));
t('vendor gets early-morning flag', /allow_early_morning_sms: true/.test(post));
t('assignVendor honors notify_tenant:false', /notify && notifyTenantOnAssign/.test(assign) && /body\.notify_tenant !== false/.test(assign));
t('assignVendor passes early flag to sms', /allowEarlyMorning: body\.allow_early_morning_sms === true/.test(assign));
t('sms exception only 8am hour + opt-in', /allowEarlyMorning === true && etHour\(new Date\(\)\) === 8/.test(sms) && /&& !_earlyMorningOk/.test(sms));
t('quiet hours constants unchanged', /QUIET_HOURS_START_ET = 19/.test(src) && /QUIET_HOURS_END_ET = 9/.test(src));
t('test-token guards present', /'\/wo-template\/post-now'/.test(hubw) && /isTestRecord\(env, 'Properties'/.test(hubw));
t('new columns ensured before write', /ensureColumns\(env, 'WO_Templates', RECUR_TEMPLATE_COLS\)/.test(src) && /ensureColumns\(env, 'Work_Orders', RECUR_WO_COLS\)/.test(src));
t('routes wired', ['post-now','copy','link','preview'].every(p => src.includes("path === '/wo-template/" + p + "'")) && src.includes("path === '/wo-snippets'"));
t('copy starts unlinked', /copy\.Targets = Array\.isArray\(body\.targets\) \? JSON\.stringify\(body\.targets\) : '\[\]'/.test(src));
console.log(`recurring-wo: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
