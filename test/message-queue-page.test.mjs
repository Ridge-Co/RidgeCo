// Oct 21 2026: message-queue.html gets search + filters + sort + grouping (incl. age buckets) with ONE list request per load.
// Runs the page's REAL inline script against a tiny fake DOM, a fake fetch and a pinned clock (same approach as the other page tests).
// Brett: "need search and full featured filter/sort for message queue page. I was looking for sent messages for a particular tenant
// and can't find easily. Also would it save reads if that page collapsed messages more than 10 days old into categories..."
// Run: node test/message-queue-page.test.mjs
import fs from 'fs';
const html = fs.readFileSync(new URL('../message-queue.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const knownIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)); };

// ---------- pinned clock: Wed Oct 21 2026 11:00 AM New York (15:00Z) ----------
const NOW = Date.UTC(2026, 9, 21, 15, 0, 0);
class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
const isoAgo = days => new Date(Date.UTC(2026, 9, 21 - days, 16, 0, 0)).toISOString();   // noon New York, `days` calendar days ago

// ---------- fake DOM: unknown ids THROW, so every id the script touches must exist in the real markup ----------
function makeDom() {
  const els = {};
  const mk = id => {
    const e = { id, innerHTML: '', textContent: '', value: '', className: '', style: {}, disabled: false, attrs: {}, handlers: {}, dataset: {}, offsetHeight: 56, focused: false };
    e.classList = {
      contains: c => e.className.split(/\s+/).includes(c),
      add: c => { if (!e.classList.contains(c)) e.className = (e.className + ' ' + c).trim(); },
      remove: c => { e.className = e.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
      toggle: (c, f) => { const on = f === undefined ? !e.classList.contains(c) : !!f; on ? e.classList.add(c) : e.classList.remove(c); return on; }
    };
    e.setAttribute = (k, v) => { e.attrs[k] = v; }; e.getAttribute = k => e.attrs[k];
    e.addEventListener = (ev, fn) => { e.handlers[ev] = fn; };
    e.focus = () => { e.focused = true; };
    return e;
  };
  const document = {
    getElementById: id => { if (!knownIds.has(id)) throw new Error('script touched an id that is not in the page markup: ' + id); return els[id] || (els[id] = mk(id)); },
    documentElement: { style: { setProperty() {} } }
  };
  return { document, els };
}

// ---------- build one page instance ----------
function build(opts = {}) {
  const { document } = makeDom();
  const calls = [], timers = [], reports = [], store = Object.assign({}, opts.store === undefined ? { mh_auth: 'tok' } : opts.store);
  const localStorage = opts.storage || {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const state = { rows: opts.rows || [], listFail: opts.listFail || null, listBody: opts.listBody, translate: opts.translate };
  const fetch = async (url, init) => {
    const path = url.replace('https://maintenance-hub.brett-2f8.workers.dev', '');
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ method, path, body });
    if (state.listFail && method === 'GET' && path.split('?')[0] === '/message-queue') {
      if (state.listFail.reject) throw new Error(state.listFail.reject);
      return { status: state.listFail.status || 500, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    }
    let data;
    if (path === '/health') data = { twilio: { twilio_enabled: false, test_mode: true, sid_set: true, api_key_sid_set: true, api_key_secret_set: true, from_set: true } };
    else if (path === '/version') data = { version: 'test-1' };
    else if (path === '/message-queue/translate') data = state.translate ? state.translate(body) : { results: body.ids.map(id => ({ id, english: 'EN for ' + id })) };
    else if (path === '/message-queue/release') data = { ok: true, results: body.ids.map(id => ({ id, sent: false })) };
    else if (path === '/message-queue/skip') data = { ok: true, results: body.ids.map(id => ({ id })) };
    else if (path.split('?')[0] === '/message-queue') data = state.listBody !== undefined ? state.listBody : state.rows;
    else data = { error: 'no such route in the test' };
    return { status: 200, json: async () => JSON.parse(JSON.stringify(data)) };
  };
  const window = { addEventListener() {}, hubReportFailure: (where, msg) => { reports.push({ where, msg }); return true; } };
  const setTimeoutF = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const clearTimeoutF = id => { if (timers[id - 1]) timers[id - 1].fn = null; };
  const consoleF = { error() {}, log() {}, warn() {} };
  const exposes = `
    return { get all(){return all}, get prefs(){return prefs}, get F(){return F}, get curGroups(){return curGroups}, get renderedRows(){return renderedRows},
      get selected(){return selected}, get english(){return english}, get translateBudget(){return translateBudget}, get prefsOk(){return prefsOk},
      doLogin, switchTab, setSort, setGroup, setRType, setMType, setProp, setPreset, setRange, applySearch, onSearchInput, clearSearch, clearFilters,
      toggleGroup, showMore, toggleBulkMode, toggleSelect, askSelectAll, confirmSelectAll, cancelSelectAll, clearSelection, releaseSelected, skipSelected,
      releaseOne, skipOne, refreshList, retryEnglish, fmtET, nyDayNum, activeFilterCount, sendableIds };`;
  const api = new Function('document', 'window', 'localStorage', 'fetch', 'setTimeout', 'clearTimeout', 'Date', 'console', script + '\n' + exposes)(
    document, window, localStorage, fetch, setTimeoutF, clearTimeoutF, FakeDate, consoleF);
  const runTimers = () => { const ts = timers.splice(0); ts.forEach(x => x.fn && x.fn()); };
  const $ = id => document.getElementById(id);
  const listCalls = () => calls.filter(c => c.method === 'GET' && c.path.split('?')[0] === '/message-queue');
  const translateCalls = () => calls.filter(c => c.path === '/message-queue/translate');
  return { api, calls, reports, store, state, $, runTimers, listCalls, translateCalls, document, localStorage };
}
const base = { Recipient_Type: 'tenant', Message_Type: 'tenant_job_assigned', Status: 'pending', Delivered_To: '', Gate_Snapshot: 'Global OFF', Active: 'TRUE', Sent_Date: '', Original_Body: '' };
let nextId = 1;
const row = (over = {}) => Object.assign({}, base, { ID: String(nextId++), WO_ID: '', Recipient_Name: 'TEST Tenant', Recipient_Phone: '+15550100001', Property_ID: '1', Property_Address: '100 Test St', Message_Body: 'hello', Created_Date: isoAgo(1) }, over);
const rowsHtml = b => b.$('list').innerHTML;
const countCards = b => (rowsHtml(b).match(/class="row-card/g) || []).length;
const ids = arr => arr.map(r => r.ID).sort().join(',');
const boot = async o => { const b = build(o); await flush(); return b; };

// =====================================================================================
// 0. static guards
// =====================================================================================
{
  t('page still loads the shared failure reporter', /<script src="failure-reporter\.js"><\/script>/.test(html));
  t('page still loads test-login.js', /<script src="test-login\.js"><\/script>/.test(html));
  t('no auto-refresh timer (it would add reads)', !/setInterval\s*\(/.test(script));
  t('no empty catch blocks', !/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(script) && !/\.catch\(\s*function\s*\(\s*\w*\s*\)\s*\{\s*\}\s*\)/.test(script));
  t('mobile-input-font rule still present', /id="mobile-input-font"/.test(html));
  t('the list is never requested with a status query (one request returns every row)', !/message-queue\?status=/.test(script) && !/\?status=/.test(script));
}

// =====================================================================================
// 1. request count: ONE list request on load, NONE on any tab / filter / search / sort / group change
// =====================================================================================
{
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(row({ Status: ['pending', 'sent', 'skipped', 'failed'][i % 4], Recipient_Name: 'TEST P' + (i % 5), Property_Address: (i % 3) + '00 Test St', Created_Date: isoAgo(i * 3), Message_Type: i % 2 ? 'tenant_job_assigned' : 'vendor_paid', Recipient_Type: i % 2 ? 'tenant' : 'vendor', Original_Body: 'EN text ' + i }));
  const b = await boot({ rows });
  t('exactly ONE list request on load (the login check IS the list load)', b.listCalls().length === 1);
  t('that request has no status filter', b.listCalls()[0].path === '/message-queue');
  t('rows were loaded and drawn', b.api.all.length === 40 && countCards(b) > 0);
  const before = b.calls.length;
  b.api.switchTab('sent'); b.api.switchTab('failed'); b.api.switchTab(''); b.api.switchTab('pending');
  b.api.setSort('oldest'); b.api.setSort('recipient'); b.api.setSort('property'); b.api.setSort('status'); b.api.setSort('newest');
  b.api.setGroup('age'); b.api.setGroup('recipient'); b.api.setGroup('none'); b.api.setGroup('prop');
  b.api.setRType('tenant'); b.api.setRType('vendor'); b.api.setRType('');
  b.api.setMType('vendor_paid'); b.api.setMType(''); b.api.setProp('100 Test St'); b.api.setProp('');
  b.api.setPreset('7'); b.api.setPreset('30'); b.api.setPreset('90'); b.api.setPreset('today'); b.api.setPreset('');
  b.$('f-from').value = '2026-10-01'; b.$('f-to').value = '2026-10-20'; b.api.setRange(); b.$('f-from').value = ''; b.$('f-to').value = ''; b.api.setRange();
  b.$('q').value = 'test p1'; b.api.onSearchInput(); b.api.onSearchInput();
  t('typing in the search box makes no request (even before the debounce fires)', b.calls.length === before);
  b.runTimers();
  t('the debounced search applied', b.api.F.tokens.join(' ') === 'test p1');
  b.api.clearFilters(); b.api.toggleBulkMode(); b.api.toggleBulkMode();
  b.api.setGroup('age'); if (b.api.curGroups.length) b.api.toggleGroup(0);
  t('NO request at all for ~35 tab / filter / sort / group / search / collapse actions', b.calls.length === before);
  t('still exactly one list request', b.listCalls().length === 1);
  await b.api.refreshList(); await flush();
  t('Refresh makes exactly one more list request', b.listCalls().length === 2);
  t('"Last loaded" text shows a time after loading', /^Last loaded \d{1,2}:\d{2} (AM|PM)$/.test(b.$('loaded').textContent));
  t('Refresh button label is back to normal after loading', b.$('refresh-btn').textContent.includes('Refresh') && !b.$('refresh-btn').disabled);
  // Send / Skip -> reload once
  b.api.switchTab('pending');
  const pend = b.api.all.find(r => r._st === 'pending');
  const c0 = b.calls.length;
  b.api.releaseOne(pend.ID); await flush();
  const after = b.calls.slice(c0);
  t('Send posts to the unchanged release endpoint with that single id', after[0].path === '/message-queue/release' && after[0].body.ids.join() === pend.ID);
  t('Send is followed by exactly one list reload', b.listCalls().length === 3 && after.filter(c => c.path === '/message-queue').length === 1);
  b.api.skipOne(b.api.all.find(r => r._st === 'pending').ID); await flush();
  t('Skip uses the unchanged skip endpoint then reloads once', b.calls.some(c => c.path === '/message-queue/skip') && b.listCalls().length === 4);
}

// =====================================================================================
// 2. search: phone digits, multi word, WO id, type, original body, delivered-to
// =====================================================================================
{
  const rows = [
    row({ ID: 'a1', Recipient_Name: 'TEST Dana Smith', Recipient_Phone: '+14439617927', Property_Address: '115 W 29th St', Message_Body: 'Your plumbing request was assigned', WO_ID: '1200', Status: 'sent', Delivered_To: '+14105559999', Sent_Date: isoAgo(2) }),
    row({ ID: 'a2', Recipient_Name: 'TEST Dana Smith', Recipient_Phone: '+14439617927', Property_Address: '115 W 29th St', Message_Body: 'Roof leak follow up', WO_ID: '1201', Status: 'pending' }),
    row({ ID: 'a3', Recipient_Name: 'TEST Omar Jones', Recipient_Phone: '+15550100077', Property_Address: '9 Elm Ave', Message_Body: 'Plumbing visit tomorrow', WO_ID: 'WO-1300', Status: 'sent', Sent_Date: isoAgo(3) }),
    row({ ID: 'a4', Recipient_Type: 'vendor', Message_Type: 'vendor_paid', Recipient_Name: 'TEST Vendor Co', Recipient_Phone: '+15550100088', Property_Address: '', Message_Body: 'Hola, tenemos un trabajo nuevo', Original_Body: 'Please bring the key to the unit', Translated_To: 'es', Status: 'sent', Sent_Date: isoAgo(4) })
  ];
  const b = await boot({ rows });
  b.api.switchTab('');
  const find = q => { b.api.applySearch(q); return ids(b.api.curGroups.flatMap(g => g.rows)); };
  t('phone digits with a space: "443 961" finds the tenant', find('443 961') === 'a1,a2');
  t('phone digits with parens: "(443)961" finds the tenant', find('(443)961') === 'a1,a2');
  t('phone digits with dashes: "443-961-7927" finds the tenant', find('443-961-7927') === 'a1,a2');
  t('last digits only: "9617927" finds the tenant', find('9617927') === 'a1,a2');
  t('+1 form: "+1443961" finds the tenant', find('+1443961') === 'a1,a2');
  t('a number that is not there finds nothing', find('443 962') === '');
  t('Delivered_To phone is searched (digits)', find('(410) 555-9999') === 'a1');
  t('multi-word is AND: "dana plumbing" finds only the plumbing message', find('dana plumbing') === 'a1');
  t('multi-word AND in any order: "plumbing dana"', find('plumbing dana') === 'a1');
  t('multi-word with no overlap finds nothing: "dana omar"', find('dana omar') === '');
  t('case-insensitive: "DANA smith"', find('DANA smith') === 'a1,a2');
  t('address match: "w 29th"', find('w 29th') === 'a1,a2');
  t('WO id with prefix: "WO-1200"', find('WO-1200') === 'a1');
  t('WO id without prefix: "1200"', find('1200') === 'a1');
  t('WO id stored with a prefix still found by bare number: "1300"', find('1300') === 'a3');
  t('message type with spaces: "vendor paid"', find('vendor paid') === 'a4');
  t('Original_Body (English original) is searched: "bring key"', find('bring key') === 'a4');
  t('Spanish body is searched too: "trabajo nuevo"', find('trabajo nuevo') === 'a4');
  t('empty search shows everything', find('   ') === 'a1,a2,a3,a4');
  b.$('q').value = 'dana'; b.api.onSearchInput();
  t('the clear (x) button appears as soon as there is text', !b.$('q-clear').classList.contains('hide'));
  b.runTimers();
  t('result count reads "N of M" (status chip is All here)', b.$('result-count').textContent === '2 of 4 messages');
  t('active filter count includes the search', b.api.activeFilterCount() === 1 && b.$('fcount').textContent === '1' && !b.$('clear-filters').classList.contains('hide'));
  b.api.clearSearch();
  t('clear (x) empties the box, restores results and refocuses', b.$('q').value === '' && b.$('q').focused && b.$('result-count').textContent === '4 of 4 messages' && b.$('q-clear').classList.contains('hide'));
  // the English view text is searchable once fetched
  b.api.english['a3'] = { english: 'Mr Jones tomorrow visit confirmed' };
  t('a fetched English translation is searchable', find('visit confirmed') === 'a3');
  // type filter is exact, combinable
  b.api.applySearch('');
  b.api.setRType('vendor'); t('recipient type filter: vendor', ids(b.api.curGroups.flatMap(g => g.rows)) === 'a4');
  b.api.setRType('tenant'); b.api.applySearch('dana'); b.api.setMType('tenant_job_assigned');
  t('filters combine (tenant + search + message type)', ids(b.api.curGroups.flatMap(g => g.rows)) === 'a1,a2' && b.api.activeFilterCount() === 3);
  b.api.setProp('9 Elm Ave');
  t('property filter narrows further to nothing and the empty state offers Clear filters', b.api.curGroups.length === 0 && /Clear filters/.test(rowsHtml(b)));
  b.api.clearFilters();
  t('Clear filters resets every filter and the box', b.api.activeFilterCount() === 0 && b.api.F.rtype === '' && b.api.F.mtype === '' && b.api.F.prop === '' && b.$('q').value === '' && ids(b.api.curGroups.flatMap(g => g.rows)) === 'a1,a2,a3,a4');
  t('property dropdown is built from the data', /9 Elm Ave/.test(b.$('f-prop').innerHTML) && /115 W 29th St/.test(b.$('f-prop').innerHTML));
  t('message type dropdown is built from the data', /vendor paid/.test(b.$('f-mtype').innerHTML) && /tenant job assigned/.test(b.$('f-mtype').innerHTML));
}

// =====================================================================================
// 3. status chips: live faceted counts, unknown statuses, missing dates
// =====================================================================================
{
  const rows = [
    row({ ID: 'p1', Status: 'pending', Recipient_Name: 'TEST Ann' }), row({ ID: 'p2', Status: 'pending', Recipient_Name: 'TEST Bob' }),
    row({ ID: 's1', Status: 'sent', Recipient_Name: 'TEST Ann', Sent_Date: isoAgo(1) }), row({ ID: 'k1', Status: 'skipped' }), row({ ID: 'f1', Status: 'failed' }),
    row({ ID: 'u1', Status: 'weird-state', Recipient_Name: 'TEST Unk' }), row({ ID: 'u2', Status: '', Recipient_Name: 'TEST Blank' }),
    row({ ID: 'n1', Status: 'pending', Created_Date: '', Recipient_Name: 'TEST NoDate' })
  ];
  const b = await boot({ rows });
  const n = id => b.$(id).textContent.trim();
  t('chip counts: pending 3 / sent 1 / skipped 1 / failed 1 / all 8', n('n-pending') === '3' && n('n-sent') === '1' && n('n-skipped') === '1' && n('n-failed') === '1' && n('n-all') === '8');
  t('default view (pending) shows the 3 pending rows incl. the one with no date', ids(b.api.renderedRows) === 'n1,p1,p2');
  b.api.switchTab('');
  t('rows with an unknown / blank status show under All', ids(b.api.renderedRows).includes('u1') && ids(b.api.renderedRows).includes('u2') && b.api.renderedRows.length === 8);
  const unk = rowsHtml(b).split('class="row-card').filter(x => x.includes('row-name">TEST Unk<') || x.includes('row-name">TEST Blank<'));
  t('unknown-status rows are drawn with an "unknown" badge and NO Send/Skip buttons', unk.length === 2 && unk.every(x => !x.includes('Send</button>') && /badge (unknown)/.test(x)));
  b.api.applySearch('ann');
  t('counts follow the search (faceted): pending 1, sent 1, all 2', n('n-pending') === '1' && n('n-sent') === '1' && n('n-all') === '2');
  b.api.switchTab('failed');
  t('empty status with matches elsewhere explains where they are', /tap <b>All<\/b>/.test(rowsHtml(b)) && /pending/.test(rowsHtml(b)));
  b.api.clearFilters(); b.api.switchTab('');
  b.api.setGroup('age');
  const old = b.api.curGroups.find(g => g.label === 'Older than 90 days');
  t('a row with no Created_Date goes to the OLDEST group, never dropped', old && old.rows.some(r => r.ID === 'n1'));
  b.api.setPreset('7');
  t('a date filter hides undated rows but SAYS so', /no date hidden/.test(b.$('result-count').textContent));
  b.api.setPreset('');
  t('chip + dropdown rendering did not throw and total is intact', b.$('result-count').textContent === '8 of 8 messages');
}

// =====================================================================================
// 4. age bucketing boundaries (pinned clock, New York days)
// =====================================================================================
{
  const mkAge = (id, age) => row({ ID: id, Status: 'sent', Sent_Date: isoAgo(age), Created_Date: isoAgo(age), Recipient_Name: 'TEST Age' + age });
  const ages = [0, 1, 10, 11, 30, 31, 60, 61, 90, 91, 200];
  const rows = ages.map(a => mkAge('d' + a, a));
  rows.push(row({ ID: 'nodate', Status: 'sent', Created_Date: '', Sent_Date: '' }));
  rows.push(row({ ID: 'badate', Status: 'sent', Created_Date: 'not a date', Sent_Date: '' }));
  const b = await boot({ rows, store: { mh_auth: 'tok' } });
  b.api.switchTab(''); b.api.setGroup('age');
  const where = id => { const g = b.api.curGroups.find(g => g.rows.some(r => r.ID === id)); return g ? g.label : null; };
  t('0 days -> Last 10 days', where('d0') === 'Last 10 days');
  t('exactly 10 days -> Last 10 days', where('d10') === 'Last 10 days');
  t('11 days -> 11–30 days', where('d11') === '11–30 days');
  t('exactly 30 days -> 11–30 days', where('d30') === '11–30 days');
  t('31 days -> 31–60 days', where('d31') === '31–60 days');
  t('exactly 60 days -> 31–60 days', where('d60') === '31–60 days');
  t('61 days -> 61–90 days', where('d61') === '61–90 days');
  t('exactly 90 days -> 61–90 days', where('d90') === '61–90 days');
  t('91 days -> Older than 90 days', where('d91') === 'Older than 90 days');
  t('200 days -> Older than 90 days', where('d200') === 'Older than 90 days');
  t('no date -> Older than 90 days (not dropped)', where('nodate') === 'Older than 90 days');
  t('unparseable date -> Older than 90 days (not dropped)', where('badate') === 'Older than 90 days');
  t('Last 10 days is open; the four older groups are collapsed by default', b.api.curGroups.map(g => g.open).join() === 'true,false,false,false,false' && b.api.curGroups.length === 5);
  t('collapsed headers say so (aria-expanded false) and show counts', (rowsHtml(b).match(/aria-expanded="false"/g) || []).length === 4 && /Older than 90 days<\/span>[^]*?\(\d+\)/.test(rowsHtml(b)));
  t('age uses New York days: a text sent 11:30 PM ET Oct 10 (03:30Z Oct 11) is 11 days old, not 10', (() => {
    const r = b.api.all.length; return b.api.nyDayNum(Date.UTC(2026, 9, 11, 3, 30)) === b.api.nyDayNum(Date.UTC(2026, 9, 10, 16, 0));
  })());
  const b2 = await boot({ rows: [row({ ID: 'edge10', Status: 'sent', Sent_Date: '2026-10-11T03:30:00Z', Created_Date: '2026-10-01T00:00:00Z' }), row({ ID: 'edge9', Status: 'sent', Sent_Date: '2026-10-11T04:30:00Z', Created_Date: '2026-10-01T00:00:00Z' })] });
  b2.api.switchTab(''); b2.api.setGroup('age');
  const w2 = id => { const g = b2.api.curGroups.find(g => g.rows.some(r => r.ID === id)); return g ? g.label : null; };
  t('11:30 PM ET Oct 10 is day -11 (11–30 group); 12:30 AM ET Oct 11 is day -10 (Last 10 days)', w2('edge10') === '11–30 days' && w2('edge9') === 'Last 10 days');
  // message date = Sent_Date for sent rows, Created_Date otherwise
  const b3 = await boot({ rows: [row({ ID: 'sentRecent', Status: 'sent', Created_Date: isoAgo(100), Sent_Date: isoAgo(5) }), row({ ID: 'pendOld', Status: 'pending', Created_Date: isoAgo(100), Sent_Date: isoAgo(5) }), row({ ID: 'sentNoSentDate', Status: 'sent', Created_Date: isoAgo(40), Sent_Date: '' })] });
  b3.api.switchTab(''); b3.api.setGroup('age');
  const w3 = id => b3.api.curGroups.find(g => g.rows.some(r => r.ID === id)).label;
  t('a sent row is dated by Sent_Date', w3('sentRecent') === 'Last 10 days');
  t('a pending row is dated by Created_Date even if Sent_Date exists', w3('pendOld') === 'Older than 90 days');
  t('a sent row with no Sent_Date falls back to Created_Date', w3('sentNoSentDate') === '31–60 days');
  // date presets use the same boundaries
  b3.api.setGroup('none');
  b3.api.setPreset('7'); t('Last 7 days preset', ids(b3.api.curGroups.flatMap(g => g.rows)) === 'sentRecent');
  b3.api.setPreset('30'); t('Last 30 days preset', ids(b3.api.curGroups.flatMap(g => g.rows)) === 'sentRecent');
  b3.api.setPreset('90'); t('Last 90 days preset includes the 40-day row', ids(b3.api.curGroups.flatMap(g => g.rows)) === 'sentNoSentDate,sentRecent');
  b3.api.setPreset('today'); t('Today preset', b3.api.curGroups.length === 0);
  b3.$('f-from').value = '2026-10-15'; b3.$('f-to').value = '2026-10-16'; b3.api.setRange();
  t('custom From/To (inclusive, NY days) picks the Oct 16 row (5 days ago)', ids(b3.api.curGroups.flatMap(g => g.rows)) === 'sentRecent' && b3.api.F.preset === 'custom' && b3.$('f-date').value === 'custom');
  b3.$('f-from').value = '2026-10-17'; b3.$('f-to').value = ''; b3.api.setRange();
  t('custom From only (Oct 17 onward) excludes Oct 16', b3.api.curGroups.length === 0);
  b3.api.setPreset('7');
  t('choosing a preset clears the custom dates', b3.$('f-from').value === '' && b3.api.F.from === '');
  // readable date
  t('readable date format: Wed Oct 14, 2:35 PM ET', b3.api.fmtET(Date.UTC(2026, 9, 14, 18, 35)) === 'Wed Oct 14, 2:35 PM ET');
  t('a different year shows the year', b3.api.fmtET(Date.UTC(2025, 11, 30, 17, 5)) === 'Tue Dec 30, 2025, 12:05 PM ET');
  b3.api.setPreset(''); b3.api.setGroup('prop'); b3.api.switchTab('sent');
  t('a sent row shows "Sent <readable date> -> <to>" and "Queued <readable date>"', /Sent \w{3} \w{3} \d+, \d+:\d{2} (AM|PM) ET → /.test(rowsHtml(b3)) && /Queued \w{3} \w{3} \d+, [\d:]+ (AM|PM) ET/.test(rowsHtml(b3)));
  const b5 = await boot({ rows: [row({ ID: 'md', Created_Date: '' })] });
  t('a missing queued date says so instead of showing blank', /Queued \(date unknown\)/.test(rowsHtml(b5)));
}

// =====================================================================================
// 5. sorting (inside groups)
// =====================================================================================
{
  const rows = [
    row({ ID: 'x1', Recipient_Name: 'TEST Zed', Property_Address: 'B Street', Status: 'sent', Sent_Date: isoAgo(5) }),
    row({ ID: 'x2', Recipient_Name: 'TEST Amy', Property_Address: 'C Street', Status: 'pending', Created_Date: isoAgo(2) }),
    row({ ID: 'x3', Recipient_Name: 'TEST Mia', Property_Address: 'A Street', Status: 'failed', Created_Date: isoAgo(9) }),
    row({ ID: 'x4', Recipient_Name: '', Property_Address: '', Status: 'skipped', Created_Date: '' })
  ];
  const b = await boot({ rows });
  b.api.switchTab(''); b.api.setGroup('none');
  const order = () => b.api.curGroups[0].rows.map(r => r.ID).join();
  t('newest first (default; undated last)', order() === 'x2,x1,x3,x4');
  b.api.setSort('oldest'); t('oldest first (undated first)', order() === 'x4,x3,x1,x2');
  b.api.setSort('recipient'); t('recipient A-Z (blank names last)', order() === 'x2,x3,x1,x4');
  b.api.setSort('property'); t('property A-Z (no property last)', order() === 'x3,x1,x2,x4');
  b.api.setSort('status'); t('status order: pending, failed, sent, skipped', order() === 'x2,x3,x1,x4');
  b.api.setGroup('recipient'); b.api.setSort('recipient');
  t('recipient grouping makes one group per person, sorted A-Z', b.api.curGroups.map(g => g.k.split('|')[0]).join() === 'test amy,test mia,test zed,(no name on file)');
  b.api.setGroup('prop'); b.api.setSort('newest');
  t('property/recipient grouping keeps the old header text', b.api.curGroups.some(g => g.label === 'B Street — TEST Zed') && /B STREET|B Street — TEST Zed/i.test(rowsHtml(b)));
  const b4 = await boot({ rows: [row({ ID: 'g1', Created_Date: isoAgo(5) }), row({ ID: 'g2', Created_Date: isoAgo(1) }), row({ ID: 'g3', Created_Date: isoAgo(3) })] });
  t('sorting applies inside a group (newest first, then oldest first)', b4.api.curGroups.length === 1 && b4.api.curGroups[0].rows.map(r => r.ID).join() === 'g2,g3,g1' && (b4.api.setSort('oldest'), b4.api.curGroups[0].rows.map(r => r.ID).join() === 'g1,g3,g2'));
}

// =====================================================================================
// 6. collapsed groups: no rows drawn, no translate calls; open groups still translate (capped)
// =====================================================================================
{
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(row({ ID: 'new' + i, Recipient_Type: 'vendor', Message_Type: 'vendor_dispatch', Recipient_Name: 'TEST Vendor' + i, Status: 'sent', Sent_Date: isoAgo(2), Created_Date: isoAgo(2), Message_Body: 'Hola ' + i, Original_Body: '' }));
  for (let i = 0; i < 9; i++) rows.push(row({ ID: 'old' + i, Recipient_Type: 'vendor', Message_Type: 'vendor_dispatch', Recipient_Name: 'TEST OldVendor' + i, Status: 'sent', Sent_Date: isoAgo(100 + i), Created_Date: isoAgo(100 + i), Message_Body: 'Hola viejo ' + i, Original_Body: '' }));
  const b = await boot({ rows, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ sort: 'newest', group: 'age', status: '' }) } });
  t('saved preference (Age, All) was restored', b.api.prefs.group === 'age' && b.api.prefs.status === '');
  const asked = b.translateCalls().flatMap(c => c.body.ids);
  t('only the rows that are drawn were sent to translate', asked.sort().join() === ['new0', 'new1', 'new2', 'new3', 'new4', 'new5'].join());
  t('collapsed old rows triggered NO translate call', !asked.some(i => i.startsWith('old')));
  t('collapsed group draws no rows (only its header)', countCards(b) === 6 && !/Hola viejo/.test(rowsHtml(b)) && /Older than 90 days/.test(rowsHtml(b)));
  b.api.toggleGroup(b.api.curGroups.findIndex(g => g.label === 'Older than 90 days')); await flush();
  t('opening the old group draws its rows', countCards(b) === 15 && /Hola viejo 3/.test(rowsHtml(b)));
  t('...and only now are those rows translated', b.translateCalls().flatMap(c => c.body.ids).filter(i => i.startsWith('old')).length === 9);
  t('translated English shows in the row', /EN for old3/.test(rowsHtml(b)));
  b.api.toggleGroup(b.api.curGroups.findIndex(g => g.label === 'Older than 90 days'));
  t('collapsing again removes the rows from the page', countCards(b) === 6);
  // the open/closed choice is remembered
  const saved = JSON.parse(b.store.mq_prefs_v1);
  t('open/closed state is saved in prefs', saved.group === 'age' && Object.keys(saved.ov).some(k => k.startsWith('age|age4')));
}
{
  // cap of 45 per load, with a visible way to ask for the rest
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push(row({ ID: 'v' + i, Recipient_Type: 'vendor', Recipient_Name: 'TEST V' + i, Status: 'sent', Sent_Date: isoAgo(1), Created_Date: isoAgo(1), Original_Body: '' }));
  const b = await boot({ rows, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ group: 'none', status: '' }) } });
  t('translate lookups are capped at 45 per load', b.translateCalls().flatMap(c => c.body.ids).length === 45 && b.translateCalls().every(c => c.body.ids.length <= 15));
  t('rows past the cap show a "Show English" button, not a silent gap', /Show English/.test(rowsHtml(b)));
  b.api.setGroup('none'); b.api.setSort('oldest'); await flush();
  t('re-rendering does not translate more than the cap', b.translateCalls().flatMap(c => c.body.ids).length === 45);
  b.api.retryEnglish('v50'); await flush();
  t('the manual button translates exactly that row', b.translateCalls().flatMap(c => c.body.ids).length === 46);
  // failed translate: visible warning + reported
  const b2 = await boot({ rows: rows.slice(0, 3), translate: () => { throw new Error('translate down'); }, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ group: 'none', status: '' }) } });
  await flush();
  t('a failed translate shows a visible warning with Retry', /English view unavailable/.test(rowsHtml(b2)) && /Retry/.test(rowsHtml(b2)));
  t('...and is reported', b2.reports.some(r => /english view/.test(r.where)));
}

// =====================================================================================
// 7. search auto-expands matching groups, hides empty ones
// =====================================================================================
{
  const rows = [row({ ID: 'r1', Status: 'sent', Sent_Date: isoAgo(2), Recipient_Name: 'TEST Dana', Message_Body: 'recent note' }), row({ ID: 'r2', Status: 'sent', Sent_Date: isoAgo(45), Recipient_Name: 'TEST Dana', Message_Body: 'mid note' }), row({ ID: 'r3', Status: 'sent', Sent_Date: isoAgo(120), Recipient_Name: 'TEST Dana', Message_Body: 'ancient note' }), row({ ID: 'r4', Status: 'sent', Sent_Date: isoAgo(120), Recipient_Name: 'TEST Other', Message_Body: 'other ancient' })];
  const b = await boot({ rows, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ group: 'age', status: '' }) } });
  t('without a search the old groups are collapsed', countCards(b) === 1);
  b.api.applySearch('dana');
  t('with a search every group that has a match expands', countCards(b) === 3 && b.api.curGroups.every(g => g.open));
  t('groups with zero matches are hidden', b.api.curGroups.length === 3 && !/11–30 days/.test(rowsHtml(b)));
  b.api.applySearch('other');
  t('search that only matches an old row opens just that group', b.api.curGroups.length === 1 && b.api.curGroups[0].label === 'Older than 90 days' && countCards(b) === 1);
  b.api.applySearch('');
  t('clearing the search returns to the saved collapsed layout', countCards(b) === 1);
}

// =====================================================================================
// 8. selection by id survives filter changes; sending ignores hidden / vanished ids
// =====================================================================================
{
  const rows = [row({ ID: 'q1', Recipient_Name: 'TEST Ann' }), row({ ID: 'q2', Recipient_Name: 'TEST Ann' }), row({ ID: 'q3', Recipient_Name: 'TEST Bob', Property_Address: '2 Other St' }), row({ ID: 'q4', Recipient_Name: 'TEST Cy', Status: 'sent', Sent_Date: isoAgo(1) })];
  const b = await boot({ rows });
  b.api.toggleBulkMode();
  b.api.toggleSelect('q1', true); b.api.toggleSelect('q2', true); b.api.toggleSelect('q3', true);
  t('batch bar shows 3 selected', b.$('batch-count').textContent === '3 selected' && !b.$('batch-bar').classList.contains('hide'));
  b.api.switchTab('sent'); b.api.switchTab('pending');
  t('selection survives a tab change', Object.keys(b.api.selected).length === 3);
  b.api.applySearch('ann');
  t('the bar counts only what the filter still shows and says how many are hidden', b.$('batch-count').textContent === '2 selected · 1 more hidden by filters (not included)');
  b.api.releaseSelected(); await flush();
  const rel = b.calls.filter(c => c.path === '/message-queue/release');
  t('Send selected sends ONLY the ids still inside the filter', rel.length === 1 && rel[0].body.ids.join() === 'q1,q2');
  t('the hidden selected id is still selected afterwards (not sent, not lost)', b.api.selected.q3 === true && !b.api.selected.q1);
  b.api.applySearch('');
  t('clearing the filter shows the remaining selection again', b.$('batch-count').textContent === '1 selected');
  // skip path honours the same rule
  b.api.toggleSelect('q2', true); b.api.applySearch('bob'); b.api.skipSelected(); await flush();
  const sk = b.calls.filter(c => c.path === '/message-queue/skip');
  t('Skip selected also sends only visible selected ids', sk.length === 1 && sk[0].body.ids.join() === 'q3');
}
{
  // ids that vanish after a reload are dropped from the count
  const rows = [row({ ID: 'z1' }), row({ ID: 'z2' }), row({ ID: 'z3' })];
  const b = await boot({ rows });
  b.api.toggleBulkMode(); b.api.toggleSelect('z1', true); b.api.toggleSelect('z2', true); b.api.toggleSelect('z3', true);
  b.state.rows = [row({ ID: 'z1' }), row({ ID: 'z2', Status: 'sent', Sent_Date: isoAgo(0) })];     // z3 gone, z2 no longer pending
  await b.api.refreshList(); await flush();
  t('selected ids that no longer exist or are no longer pending are not counted', b.$('batch-count').textContent === '1 selected' && Object.keys(b.api.selected).join() === 'z1');
  b.api.releaseSelected(); await flush();
  t('...and are not sent', b.calls.filter(c => c.path === '/message-queue/release').every(c => c.body.ids.join() === 'z1'));
  // double tap protection
  b.state.rows = [row({ ID: 'w1' }), row({ ID: 'w2' })]; await b.api.refreshList(); await flush();
  const n0 = b.calls.filter(c => c.path === '/message-queue/release').length;
  b.api.releaseOne('w1'); b.api.releaseOne('w1');
  t('a double tap on Send posts once (no double texts)', b.calls.filter(c => c.path === '/message-queue/release').length === n0 + 1);
  await flush();
}
{
  // Select all shown: confirm first, only drawn pending rows
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row({ ID: 'n' + i, Created_Date: isoAgo(2) }));
  for (let i = 0; i < 4; i++) rows.push(row({ ID: 'o' + i, Created_Date: isoAgo(100), Recipient_Name: 'TEST Old' }));
  rows.push(row({ ID: 'sent1', Status: 'sent', Sent_Date: isoAgo(1) }));
  const b = await boot({ rows, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ group: 'age', status: '' }) } });
  b.api.toggleBulkMode();
  b.api.askSelectAll();
  t('Select all shown asks first and shows the count', /Select all <b>5<\/b> pending/.test(b.$('selall-confirm').innerHTML) && !b.$('selall-confirm').classList.contains('hide') && Object.keys(b.api.selected).length === 0);
  b.api.cancelSelectAll();
  t('Cancel selects nothing', Object.keys(b.api.selected).length === 0 && b.$('selall-confirm').classList.contains('hide'));
  b.api.askSelectAll(); b.api.confirmSelectAll();
  t('Yes selects only the drawn pending rows (collapsed old group and sent rows excluded)', Object.keys(b.api.selected).sort().join() === 'n0,n1,n2,n3,n4' && b.$('batch-count').textContent === '5 selected');
  b.api.clearSelection();
  t('Clear selection empties it', Object.keys(b.api.selected).length === 0 && b.$('batch-bar').classList.contains('hide'));
  b.api.applySearch('old'); b.api.askSelectAll(); b.api.confirmSelectAll();
  t('with a search active, Select all shown only takes the matching rows', Object.keys(b.api.selected).sort().join() === 'o0,o1,o2,o3');
}

// =====================================================================================
// 9. list failures are loud: banner + Retry + reporter (never a bare message)
// =====================================================================================
{
  const b = await boot({ listFail: { reject: 'boom network' } });
  t('failed list request shows a red banner', /class="banner err"/.test(b.$('banner').innerHTML) && /role="alert"/.test(b.$('banner').innerHTML));
  t('the banner carries the real message', /boom network/.test(b.$('banner').innerHTML));
  t('the banner has a Retry button', /Retry<\/button>/.test(b.$('banner').innerHTML) && /refreshList\(\)/.test(b.$('banner').innerHTML));
  t('the failure was reported to the shared reporter', b.reports.some(r => /list load/.test(r.where) && /boom network/.test(r.msg)));
  b.state.listFail = null; b.state.rows = [row({ ID: 'ok1' })];
  await b.api.refreshList(); await flush();
  t('Retry loads the list and clears the banner', b.$('banner').innerHTML === '' && b.api.all.length === 1);
  b.state.listFail = { reject: 'second failure' }; await b.api.refreshList(); await flush();
  t('a failed refresh keeps the old list visible with the banner and the time it is from', countCards(b) === 1 && /second failure/.test(b.$('banner').innerHTML) && /may be out of date/.test(b.$('banner').innerHTML));
  b.state.listFail = null; await b.api.refreshList(); await flush();
  t('recovers again', b.$('banner').innerHTML === '');
}
{
  const b = await boot({ listFail: { status: 502 } });
  t('an HTML error page (HTTP 502) is explained, not "Unexpected token <"', /HTTP 502/.test(b.$('banner').innerHTML) && !/Unexpected token/.test(b.$('banner').innerHTML) && b.reports.length > 0);
}
{
  const b = await boot({ listBody: { error: 'Sheets quota exceeded' } });
  t('an {error} object instead of a list shows the banner with that error', /Sheets quota exceeded/.test(b.$('banner').innerHTML) && /Retry/.test(b.$('banner').innerHTML) && b.reports.some(r => /Sheets quota exceeded/.test(r.msg)));
  const c = await boot({ listBody: { weird: true } });
  t('a non-array answer shows the banner', /not a message list/.test(c.$('banner').innerHTML) && /Retry/.test(c.$('banner').innerHTML) && c.reports.some(r => /list load/.test(r.where)));
  const d = await boot({ listBody: 'oops' });
  t('a string answer shows the banner too', /not a message list/.test(d.$('banner').innerHTML));
  const e = await boot({ listBody: [row({ ID: 'g1' }), null, 5, row({ ID: 'g2' })] });
  t('unreadable entries are counted, reported and warned about; good rows still show', e.api.all.length === 2 && /2 entries/.test(e.$('banner').innerHTML) && e.reports.some(r => /list rows/.test(r.where)));
  const f = await boot({ listBody: [] });
  t('a genuinely empty list says "Nothing here." (not an error)', /Nothing here/.test(f.$('list').innerHTML) && f.$('banner').innerHTML === '');
}
{
  // login box path
  const b = await boot({ store: {}, rows: [row({ ID: 'l1' })] });
  t('without a stored code nothing is requested until sign in', b.calls.length === 0);
  b.$('login-input').value = 'secret'; b.api.doLogin(); await flush();
  t('sign in loads the list exactly once and remembers the code', b.listCalls().length === 1 && b.store.mh_auth === 'secret' && b.api.all.length === 1);
}

// =====================================================================================
// 10. localStorage unavailable never breaks the page
// =====================================================================================
{
  const throwing = { getItem() { throw new Error('storage blocked'); }, setItem() { throw new Error('storage blocked'); }, removeItem() { throw new Error('storage blocked'); } };
  const b = await boot({ storage: throwing, rows: [row({ ID: 's1' })] });
  t('with storage blocked the page boots to the login box without throwing', b.calls.length === 0 && b.api.prefsOk === false);
  b.$('login-input').value = 'secret'; b.api.doLogin(); await flush();
  t('...and signing in still works (just not remembered, and it says so)', b.api.all.length === 1 && b.$('toast').textContent.includes('would not remember'));
  b.api.switchTab('sent'); b.api.setSort('oldest'); b.api.setGroup('age'); b.api.toggleGroup(0);
  t('changing view options with storage blocked does not throw', b.api.prefs.sort === 'oldest' && b.api.prefs.group === 'age');
}
{
  // only the preference key fails; the page works and uses defaults
  const store = { mh_auth: 'tok' };
  const partial = { getItem: k => { if (k === 'mq_prefs_v1') throw new Error('nope'); return store[k] || null; }, setItem() { throw new Error('quota'); } };
  const b = await boot({ storage: partial, rows: [row({ ID: 'p1' }), row({ ID: 'p2', Status: 'sent', Sent_Date: isoAgo(1) })] });
  t('a failing preference read falls back to defaults (pending, newest, property/recipient)', b.api.prefs.status === 'pending' && b.api.prefs.sort === 'newest' && b.api.prefs.group === 'prop' && countCards(b) === 1);
  b.api.switchTab('sent');
  t('a failing preference write does not stop the click from working', countCards(b) === 1 && b.api.prefs.status === 'sent');
  const bad = await boot({ store: { mh_auth: 'tok', mq_prefs_v1: '{not json' }, rows: [row({ ID: 'p1' })] });
  t('corrupt saved preferences are ignored', bad.api.prefs.sort === 'newest' && countCards(bad) === 1);
  const junk = await boot({ store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ sort: 'evil', group: 7, status: 'hacked', ov: 5 }) }, rows: [row({ ID: 'p1' })] });
  t('unknown saved values are ignored', junk.api.prefs.sort === 'newest' && junk.api.prefs.group === 'prop' && junk.api.prefs.status === 'pending');
}
{
  // preferences persist across a reload of the page
  const b = await boot({ rows: [row({ ID: 'r1' })] });
  b.api.setSort('oldest'); b.api.setGroup('recipient'); b.api.switchTab('');
  const saved = JSON.parse(b.store.mq_prefs_v1);
  t('sort, group-by and status chip are saved', saved.sort === 'oldest' && saved.group === 'recipient' && saved.status === '');
  const again = await boot({ store: b.store, rows: [row({ ID: 'r1' })] });
  t('and restored on the next visit', again.api.prefs.sort === 'oldest' && again.api.prefs.group === 'recipient' && again.api.prefs.status === '' && again.$('f-sort').value === 'oldest' && again.$('f-group').value === 'recipient');
  t('filters and search are NOT persisted (a stale filter must never hide messages next visit)', again.api.activeFilterCount() === 0);
}

// =====================================================================================
// 11. performance: ~1000 rows draw only what is open
// =====================================================================================
{
  const rows = [];
  for (let i = 0; i < 1000; i++) rows.push(row({ Status: ['sent', 'sent', 'sent', 'pending', 'skipped', 'failed'][i % 6], Sent_Date: isoAgo(i % 130), Created_Date: isoAgo(i % 130), Recipient_Name: 'TEST P' + (i % 120), Recipient_Phone: '+15550100' + String(100 + (i % 120)), Property_Address: (i % 60) + ' Test Ave', Message_Body: 'msg ' + i, Recipient_Type: i % 5 === 0 ? 'vendor' : 'tenant', Original_Body: 'EN' }));
  const t0 = Date.now();
  const b = await boot({ rows, store: { mh_auth: 'tok', mq_prefs_v1: JSON.stringify({ group: 'age', status: '' }) } });
  t('1000 rows load', b.api.all.length === 1000);
  t('Age view draws only the open group, capped at 50 rows', countCards(b) === 50 && /Show 38 more \(38 not shown yet\)/.test(rowsHtml(b)));
  t('every older group is just a header', b.api.curGroups.filter(g => !g.open).length === 4);
  b.api.showMore(0); t('"Show more" adds the next page (rest of the group)', countCards(b) === 88 && !/class="btn more"/.test(rowsHtml(b)));
  b.api.setGroup('prop'); b.api.switchTab('');
  t('Property view keeps drawn rows to a small budget', countCards(b) <= 140 && b.api.curGroups.filter(g => !g.open).length > 10);
  b.api.setGroup('none');
  t('flat view draws one page of 50', countCards(b) === 50);
  b.api.applySearch('test p7');
  t('search across 1000 rows is instant and correct', b.api.curGroups.flatMap(g => g.rows).every(r => /test p7/.test(r._s)) && Date.now() - t0 < 5000);
  b.api.applySearch('555010011'); // phone digits partial
  t('phone-digit search across 1000 rows', b.api.curGroups.flatMap(g => g.rows).length > 0 && b.api.curGroups.flatMap(g => g.rows).every(r => r.Recipient_Phone.includes('555010011')));
  t('no translate calls: every vendor row already has its English original', b.translateCalls().length === 0);
  b.api.applySearch('');
  b.api.setGroup('age'); b.api.setPreset('90');
  t('narrowing with a date filter auto-opens groups but stays inside the render budget', countCards(b) <= 260);
}

// =====================================================================================
// 12. markup / UX guards
// =====================================================================================
{
  t('search box is a type=search input with an accessible label', /<input id="q" type="search"[^>]*aria-label="Search messages"/.test(html));
  t('Refresh button and "Last loaded" text exist', /id="refresh-btn"/.test(html) && /id="loaded"/.test(html));
  t('status chips exist for pending/sent/skipped/failed/all', ['pending', 'sent', 'skipped', 'failed', 'all'].every(s => html.includes('id="chip-' + s + '"')));
  t('sort options present', ['newest', 'oldest', 'recipient', 'property', 'status'].every(s => html.includes('<option value="' + s + '">')));
  t('group-by options present', ['prop', 'age', 'recipient', 'none'].every(s => html.includes('<option value="' + s + '">')));
  t('date presets present', ['today', '7', '30', '90', 'custom'].every(s => html.includes('<option value="' + s + '"')));
  t('tap targets: buttons are at least 44px tall', /\.btn\{[^}]*min-height:44px/.test(html) && /\.group-header\{[^}]*min-height:44px/.test(html));
  t('page does not scroll sideways', /overflow-x:hidden/.test(html));
  t('only the production Worker URL appears (never staging/other hosts)', (html.match(/https?:\/\/[^'"\s)]+/g) || []).every(u => /maintenance-hub\.brett-2f8\.workers\.dev|fonts|w3\.org/.test(u)));
}

console.log(`\nmessage-queue-page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
