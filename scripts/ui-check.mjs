#!/usr/bin/env node
// UI check (Nov 16 2026). One command for any change to an .html/.css file. See DESIGN.md and .claude/skills/ridgeco-ui-review.
//   node scripts/ui-check.mjs vendor.html proposals.html      check these pages
//   node scripts/ui-check.mjs --files-from changed.txt        same, names read from a file (one per line; .css names are expanded)
//   node scripts/ui-check.mjs --all --update-baseline         re-record today's counts (a number may only go UP with Brett's OK)
// Three parts, each reported as RAN or NOT RUN (never skipped quietly):
//   (a) Impeccable design detector, when the pinned npm package is installed (never downloaded from here)
//   (b) static checks on the page source (small text, browser pop-ups, label-wrapped file inputs, phone-only columns, no-wrap chips)
//   (c) screenshots at 412, 1366 and 1920 from a local server with every Worker call mocked; sideways scroll is a failure
// Ratchet: scripts/ui-check-baseline.json holds the counts as of the day it was recorded. A page fails only when a number gets
// WORSE than its baseline. A page that is not in the baseline is new, so its baseline is zero.
// Options: --out <dir> (default ui-check-out) --no-shots --no-detector --require-shots --require-detector --mocks <file.json>
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = path.join(ROOT, 'scripts', 'ui-check-baseline.json');
export const DETECTOR_VERSION = '4.9.2'; // npm package `impeccable`, vetted in context/THIRD_PARTY_SKILLS.md
export const VIEWPORTS = [
  { name: '412', width: 412, height: 915, mobile: true },
  { name: '1366', width: 1366, height: 768, mobile: false },
  { name: '1920', width: 1920, height: 1080, mobile: false },
];
// Pages people outside the company use (vendors, tenants, owners, customers): nothing under 13px. Everything else: 12px.
export const PORTAL_PAGES = new Set(['vendor.html', 'tenant.html', 'owner.html', 'wo.html', 'vendor-setup.html', 'cleaner.html',
  'submit.html', 'fix-check.html', 'rsvp.html', 'owner-submit.html', 'owner-setup.html', 'owner-onboard.html', 'customer.html',
  'scope-proposal.html', 'ar-report.html', 'inspection-report.html', 'inspection-photos.html', 'inspect-book.html', 'inspect-change.html']);
export const minFontFor = file => (PORTAL_PAGES.has(path.basename(file)) ? 13 : 12);
export const STATIC_KEYS = ['small_font', 'native_dialog', 'label_file_input', 'fixed_column', 'nowrap_chip', 'no_zoom'];
export const LABELS = {
  small_font: 'text smaller than the minimum',
  native_dialog: 'browser alert / confirm / prompt calls',
  label_file_input: 'file inputs wrapped in a <label>',
  fixed_column: 'narrow fixed page column with no desktop rule',
  nowrap_chip: 'chips that cannot wrap',
  no_zoom: 'viewport blocks pinch-zoom',
};

// ---------- static checks (pure; unit-tested in test/ui-check.test.mjs) ----------
const stripCssComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '');

// font-size: Npx and the font: shorthand, anywhere in the file (style blocks, inline styles, strings that build markup).
export function countSmallFonts(src, min) {
  let n = 0;
  for (const m of src.matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi)) if (parseFloat(m[1]) < min) n++;
  for (const m of src.matchAll(/(?<![-\w])font\s*:\s*[^;"'{}<>]*?(\d+(?:\.\d+)?)px/gi)) if (parseFloat(m[1]) < min) n++;
  return n;
}

// alert( / confirm( / prompt( as real calls. Not counted: rcConfirm(, obj.confirm(, "function confirm(".
export function countNativeDialogs(src) {
  let n = 0;
  for (const m of src.matchAll(/(?<![\w$.])(?:window\.)?(alert|confirm|prompt)\s*\(/g)) {
    const before = src.slice(Math.max(0, m.index - 12), m.index);
    if (/function\s+$/.test(before)) continue;
    n++;
  }
  return n;
}

// UI_QA_CHECKLIST rule 1: a file input inside a <label> only opens from the label's text on real phones.
export function countLabelFileInputs(src) {
  return [...src.matchAll(/<label\b[^>]*>(?:(?!<\/label>|<button\b|<label\b)[\s\S]){0,600}?<input\b[^>]*type\s*=\s*["']?file/gi)].length;
}

// Top-level CSS rules and @media blocks of every <style> block: [{ media: ''|'(min-width:...)', selector, body }]
export function cssRules(src) {
  const out = [];
  const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m => stripCssComments(m[1])).join('\n');
  const walk = (text, media) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const selector = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      const body = text.slice(open + 1, j - 1);
      if (/^@media/i.test(selector)) walk(body, selector.replace(/^@media/i, '').trim());
      else if (!selector.startsWith('@')) out.push({ media, selector, body });
      i = j;
    }
  };
  walk(css, '');
  return out;
}

const PAGE_SEL = /(^|[\s,>])(body|main|#app|#main|\.wrap|\.wrapper|\.container|\.page|\.app|\.shell|\.content|\.main)(?![\w-])/i;
// A page-level column capped under 900px with no wider rule for big screens: a phone column centred on a monitor.
export function countFixedColumns(src) {
  const rules = cssRules(src);
  let n = 0;
  for (const r of rules) {
    if (r.media) continue;
    const mw = /(?<![-\w])max-width\s*:\s*(\d+)px/i.exec(r.body);
    if (!mw || +mw[1] > 900 || +mw[1] < 300) continue;
    const sels = r.selector.split(',').map(s => s.trim()).filter(s => PAGE_SEL.test(s) && !/\s/.test(s.replace(/\s*>\s*/g, '>')));
    for (const sel of sels) {
      const widened = rules.some(o => /min-width/i.test(o.media) && o.selector.split(',').map(s => s.trim()).includes(sel) && /max-width|width|grid|columns/i.test(o.body));
      if (!widened) n++;
    }
  }
  return n;
}

// A chip/badge/pill with white-space:nowrap and nothing that lets long text end (ellipsis) runs off the card.
export function countNowrapChips(src) {
  let n = 0;
  for (const r of cssRules(src)) {
    if (!/(chip|badge|pill|\.tag)(?![\w]*\{)/i.test(r.selector)) continue;
    if (/white-space\s*:\s*nowrap/i.test(r.body) && !/text-overflow\s*:\s*ellipsis/i.test(r.body)) n++;
  }
  return n;
}

export function countNoZoom(src) {
  const vp = /<meta[^>]*name\s*=\s*["']viewport["'][^>]*>/i.exec(src);
  return vp && /maximum-scale\s*=\s*1(\.0)?(?!\d)|user-scalable\s*=\s*(no|0)/i.test(vp[0]) ? 1 : 0;
}

export function staticCounts(src, file) {
  return {
    small_font: countSmallFonts(src, minFontFor(file)),
    native_dialog: countNativeDialogs(src),
    label_file_input: countLabelFileInputs(src),
    fixed_column: countFixedColumns(src),
    nowrap_chip: countNowrapChips(src),
    no_zoom: countNoZoom(src),
  };
}

// ---------- ratchet (pure) ----------
// current: { static:{key:n}, detector:{rule:n}|null, overflow:{'412':bool}|null }. base (from the baseline file): { static:{key:n, zeros left out},
// detector:{rule:n}, overflow:['412', ...widths that already scrolled sideways] }. Returns what got worse and what got better.
export function compare(current, base, opts = {}) {
  const worse = [], better = [];
  const b = base || {};
  for (const k of STATIC_KEYS) {
    const was = (b.static && b.static[k]) || 0, now = current.static[k] || 0;
    if (now > was) worse.push({ key: k, was, now }); else if (now < was) better.push({ key: k, was, now });
  }
  if (current.detector && opts.detectorComparable !== false) {
    const bd = b.detector || {};
    for (const k of new Set([...Object.keys(current.detector), ...Object.keys(bd)])) {
      const was = bd[k] || 0, now = current.detector[k] || 0;
      if (now > was) worse.push({ key: 'detector:' + k, was, now }); else if (now < was) better.push({ key: 'detector:' + k, was, now });
    }
  }
  if (current.overflow) {
    const bo = Array.isArray(b.overflow) ? b.overflow.map(String) : []; // baseline: the widths that already scrolled sideways
    for (const w of Object.keys(current.overflow)) {
      if (current.overflow[w] && !bo.includes(w)) worse.push({ key: 'sideways scroll at ' + w + 'px', was: 0, now: 1 });
      else if (!current.overflow[w] && bo.includes(w)) better.push({ key: 'sideways scroll at ' + w + 'px', was: 1, now: 0 });
    }
  }
  return { worse, better };
}

// Every page in the repo: the root, plus one folder down (shop/). Not tests, context or installed packages.
const SKIP_DIRS = new Set(['node_modules', 'test', 'context', 'scripts', 'apps-script', 'ui-check-out']);
export function allPages(root = ROOT) {
  const out = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  for (const d of fs.readdirSync(root, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.') || SKIP_DIRS.has(d.name)) continue;
    for (const f of fs.readdirSync(path.join(root, d.name))) if (f.endsWith('.html')) out.push(d.name + '/' + f);
  }
  return out.sort();
}

// Names from the command line or a file -> the .html pages to check. A changed .css file means every page that loads it.
export function expandFiles(names, root = ROOT) {
  const pages = new Set();
  for (const raw of names) {
    const f = raw.trim().replace(/^\.\//, '');
    if (!f) continue;
    if (f.endsWith('.html')) { if (fs.existsSync(path.join(root, f))) pages.add(f); }
    else if (f.endsWith('.css')) {
      const base = path.basename(f);
      for (const p of allPages(root)) if (fs.readFileSync(path.join(root, p), 'utf8').includes(base)) pages.add(p);
    }
  }
  return [...pages].sort();
}

// ---------- (a) Impeccable detector ----------
function findDetector() {
  const cands = [process.env.UI_CHECK_IMPECCABLE, path.join(ROOT, 'node_modules', '.bin', 'impeccable')].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  const which = spawnSync('sh', ['-c', 'command -v impeccable'], { encoding: 'utf8' });
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : null;
}
function runDetector(bin, pages) {
  // Telemetry off, project config and DESIGN.md parsing off (repeatable counts), cwd outside the repo (it writes nothing here).
  const env = { ...process.env, DO_NOT_TRACK: '1', IMPECCABLE_NO_TELEMETRY: '1' };
  const ver = spawnSync(bin, ['--version'], { encoding: 'utf8', env });
  const version = (ver.stdout || '').trim();
  const out = {};
  for (const p of pages) {
    const r = spawnSync(bin, ['detect', '--json', '--no-config', path.join(ROOT, p)], { encoding: 'utf8', env, cwd: fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'uicheck-')), maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0 && r.status !== 2) return { error: `detector exit ${r.status} on ${p}: ${(r.stderr || '').slice(0, 300)}`, version };
    let list;
    try { list = JSON.parse(r.stdout || '[]'); } catch (e) { return { error: `detector output for ${p} was not JSON: ${String(e).slice(0, 120)}`, version }; }
    const counts = {};
    for (const f of list) { if (f.advisory) continue; counts[f.antipattern] = (counts[f.antipattern] || 0) + 1; }
    out[p] = counts;
  }
  return { version, pages: out };
}

// ---------- (c) screenshots ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
function serve(root) {
  return new Promise(resolve => {
    const srv = http.createServer((q, s) => {
      const rel = decodeURIComponent(q.url.split('?')[0]);
      const p = path.normalize(path.join(root, rel));
      if (!p.startsWith(root)) { s.writeHead(403); return s.end(); }
      fs.readFile(p, (e, d) => {
        if (e) { s.writeHead(404); return s.end(); }
        s.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream', 'cache-control': 'no-store' }); s.end(d);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
const DEFAULT_SESSIONS = {
  mh_auth: 'TEST-TOKEN', mh_auth_staging: 'TEST-TOKEN',
  mh_vendor_sess: JSON.stringify({ token: 'x', vendor_id: '3', vendor_name: 'Test Vendor', language: 'en' }),
  mh_tenant_sess: JSON.stringify({ token: 'x', tenant_id: '5', tenant_name: 'Test Tenant', unit_label: 'Unit 1', can_submit_wo: true }),
  mh_owner_sess: JSON.stringify({ token: 'x', owner_id: '7', owner_name: 'Test Owner' }),
};
async function takeShots(pages, outDir, mocks) {
  let chromium;
  try { ({ chromium } = createRequire(import.meta.url)('playwright')); }
  catch (e) { return { notRun: 'Playwright is not installed here (' + String(e.message || e).split('\n')[0] + ')' }; }
  const srv = await serve(ROOT);
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const result = {};
  let browser;
  try {
    browser = await chromium.launch();
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, isMobile: vp.mobile, hasTouch: vp.mobile, serviceWorkers: 'block' });
      await ctx.addInitScript(sess => { for (const k in sess) { try { localStorage.setItem(k, sess[k]); } catch (e) { /* storage blocked: page shows its login */ } } }, DEFAULT_SESSIONS);
      await ctx.route('**/*', async route => {
        const r = route.request(); const u = new URL(r.url());
        if (u.origin === origin) return route.continue();
        if (/workers\.dev$/.test(u.hostname)) {
          const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
          if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
          const body = Object.prototype.hasOwnProperty.call(mocks, u.pathname) ? mocks[u.pathname] : (r.method() === 'GET' ? [] : { success: true, ok: true });
          return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
        }
        // Nothing else leaves the machine, except passive assets a page may load (fonts, images, styles).
        return ['font', 'image', 'stylesheet'].includes(r.resourceType()) ? route.continue() : route.abort();
      });
      for (const p of pages) {
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
        page.on('dialog', d => d.dismiss().catch(e => errors.push('dialog: ' + e)));
        const rec = (result[p] = result[p] || { overflow: {}, shots: [], errors: [] });
        try {
          await page.goto(origin + '/' + p, { waitUntil: 'load', timeout: 30000 });
          await page.waitForTimeout(1200);
          const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
          rec.overflow[vp.name] = m.sw > m.iw + 1;
          const shot = path.join(outDir, p.replace(/[\\/]/g, '_').replace(/\.html$/, '') + '-' + vp.name + '.png');
          await page.screenshot({ path: shot, fullPage: true });
          rec.shots.push(path.basename(shot));
        } catch (e) { rec.failed = (rec.failed || []).concat(vp.name + ': ' + String(e.message || e).split('\n')[0]); }
        for (const e of errors) if (!rec.errors.includes(e)) rec.errors.push(e);
        await page.close();
      }
      await ctx.close();
    }
  } finally { if (browser) await browser.close(); srv.close(); }
  return { pages: result };
}

// ---------- main ----------
async function main(argv) {
  const opt = { files: [], out: 'ui-check-out' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opt.out = argv[++i];
    else if (a === '--files-from') opt.files.push(...fs.readFileSync(argv[++i], 'utf8').split('\n'));
    else if (a === '--mocks') opt.mocks = argv[++i];
    else if (a === '--all') opt.all = true;
    else if (a.startsWith('--')) opt[a.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = true;
    else opt.files.push(a);
  }
  const pages = opt.all ? allPages() : expandFiles(opt.files);
  if (!pages.length) { console.log('ui-check: no .html pages to check (nothing given, or none of the names exist). Nothing ran.'); return 0; }
  const baseline = fs.existsSync(BASELINE_PATH) ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) : { pages: {} };
  const problems = [];   // things that make the run fail
  const status = {};     // part -> 'RAN' | 'NOT RUN: why'

  const current = {};
  for (const p of pages) current[p] = { static: staticCounts(fs.readFileSync(path.join(ROOT, p), 'utf8'), p), detector: null, overflow: null };
  status.static = 'RAN';

  let detectorComparable = true;
  if (opt.noDetector) status.detector = 'NOT RUN: --no-detector';
  else {
    const bin = findDetector();
    if (!bin) status.detector = 'NOT RUN: impeccable is not installed (npm install --no-save --ignore-scripts impeccable@' + DETECTOR_VERSION + ')';
    else {
      const d = runDetector(bin, pages);
      if (d.error) { status.detector = 'NOT RUN: ' + d.error; problems.push('Impeccable detector failed: ' + d.error); }
      else {
        for (const p of pages) current[p].detector = d.pages[p];
        status.detector = 'RAN (impeccable ' + d.version + ')';
        if (baseline.detector_version && d.version !== baseline.detector_version && !opt.updateBaseline) {
          detectorComparable = false;
          status.detector += ' - version differs from the baseline (' + baseline.detector_version + '), so its counts are shown but not compared';
        }
      }
    }
    if (opt.requireDetector && !/^RAN/.test(status.detector)) problems.push('The design detector was required and did not run: ' + status.detector);
  }

  let shots = null;
  if (opt.noShots) status.screenshots = 'NOT RUN: --no-shots';
  else {
    fs.mkdirSync(opt.out, { recursive: true });
    let mocks = {};
    const mockFile = opt.mocks || path.join(ROOT, 'scripts', 'ui-check-mocks.json');
    if (fs.existsSync(mockFile)) mocks = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    shots = await takeShots(pages, opt.out, mocks);
    if (shots.notRun) status.screenshots = 'NOT RUN: ' + shots.notRun;
    else {
      status.screenshots = 'RAN (' + VIEWPORTS.map(v => v.name).join(', ') + ' px) -> ' + opt.out + '/';
      for (const p of pages) {
        const rec = shots.pages[p];
        if (rec.failed) problems.push(p + ': could not be opened for a screenshot (' + rec.failed.join('; ') + ')');
        else current[p].overflow = rec.overflow;
      }
    }
    if (opt.requireShots && !/^RAN/.test(status.screenshots)) problems.push('Screenshots were required and did not run: ' + status.screenshots);
  }

  if (opt.updateBaseline) {
    const next = { _about: baseline._about || 'Counts recorded by scripts/ui-check.mjs --update-baseline. A PR fails only when a number gets worse. Never raise a number without saying so in the PR and getting Brett\'s OK.', recorded: new Date().toISOString().slice(0, 10), detector_version: baseline.detector_version || null, pages: { ...baseline.pages } };
    if (/^RAN/.test(status.detector)) next.detector_version = /impeccable ([\d.]+)/.exec(status.detector)[1];
    for (const p of pages) {
      const old = baseline.pages[p] || {};
      const entry = { static: Object.fromEntries(Object.entries(current[p].static).filter(([, v]) => v)) };
      const det = current[p].detector || old.detector; if (det) entry.detector = det;
      const ov = current[p].overflow ? Object.keys(current[p].overflow).filter(w => current[p].overflow[w]) : old.overflow; if (ov) entry.overflow = ov;
      next.pages[p] = entry;
    }
    const { pages: pg, ...head } = next;   // one page per line, so a PR diff shows exactly which page's numbers moved
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(head, null, 1).replace(/\n}$/, ',\n "pages": {\n' + Object.keys(pg).sort().map(k => '  ' + JSON.stringify(k) + ': ' + JSON.stringify(pg[k])).join(',\n') + '\n }\n}\n'));
    console.log('ui-check: baseline written for ' + pages.length + ' page(s). detector: ' + status.detector + '. screenshots: ' + status.screenshots);
    return problems.length ? 1 : 0;
  }

  // report
  const lines = ['## UI check', '', '| Part | Status |', '|---|---|', '| Static checks | ' + status.static + ' |', '| Design detector | ' + status.detector + ' |', '| Screenshots | ' + status.screenshots + ' |', ''];
  const tighten = [];
  for (const p of pages) {
    const isNew = !baseline.pages[p];
    const { worse, better } = compare(current[p], baseline.pages[p], { detectorComparable });
    const c = current[p];
    lines.push('### ' + p + (isNew ? ' (new page: baseline is zero)' : '') + (worse.length ? ' - FAIL' : ' - ok'));
    lines.push('Static: ' + STATIC_KEYS.map(k => k + ' ' + c.static[k]).join(', ') + ' (minimum text ' + minFontFor(p) + 'px)');
    if (c.detector) lines.push('Detector: ' + (Object.keys(c.detector).length ? Object.entries(c.detector).map(([k, v]) => k + ' ' + v).join(', ') : 'no findings'));
    if (c.overflow) lines.push('Sideways scroll: ' + VIEWPORTS.map(v => v.name + 'px ' + (c.overflow[v.name] ? 'YES' : 'no')).join(', '));
    if (shots && shots.pages && shots.pages[p]) {
      if (shots.pages[p].shots.length) lines.push('Screenshots (in ' + opt.out + '/): ' + shots.pages[p].shots.join(', '));
      if (shots.pages[p].errors.length) lines.push('Page errors with mocked data (look at these, they may be the mock): ' + shots.pages[p].errors.slice(0, 3).join(' | '));
    }
    for (const w of worse) { lines.push('- WORSE: ' + (LABELS[w.key] || w.key) + ': ' + w.was + ' -> ' + w.now); problems.push(p + ': ' + (LABELS[w.key] || w.key) + ' went from ' + w.was + ' to ' + w.now); }
    for (const b of better) { lines.push('- better: ' + (LABELS[b.key] || b.key) + ': ' + b.was + ' -> ' + b.now); tighten.push(p); }
    lines.push('');
  }
  if (tighten.length) lines.push('Numbers improved on: ' + [...new Set(tighten)].join(', ') + '. Lock that in with `node scripts/ui-check.mjs --update-baseline ' + [...new Set(tighten)].join(' ') + '` and commit the baseline file.', '');
  lines.push(problems.length ? 'RESULT: FAIL (' + problems.length + ')\n' + problems.map(x => '- ' + x).join('\n') : 'RESULT: PASS (nothing got worse than the baseline)');
  const text = lines.join('\n');
  console.log(text);
  if (!opt.noShots) fs.writeFileSync(path.join(opt.out, 'summary.md'), text + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  return problems.length ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error('ui-check crashed: ' + (e && e.stack || e)); process.exit(2); });
}
