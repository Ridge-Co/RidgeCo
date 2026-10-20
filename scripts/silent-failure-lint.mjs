#!/usr/bin/env node
// silent-failure-lint.mjs - Brett's standing rule (Oct 1 + Oct 16 2026): NOTHING fails silently, in new code or old.
//
// What it finds (the ways a failure disappears in this codebase):
//   empty         catch { }  or a catch whose only content is a comment ("non-fatal", "ignore") - the error vanishes
//   log-only      catch { console.log/warn/error(...) } only - Workers logs and browser consoles are read by nobody
//   return-default catch { return null | [] | {} | false | undefined; }  or  catch { continue; } - failure becomes "nothing found"
//   swallow-catch  promise.catch(() => null) / .catch(() => {}) / .catch(e => console.log(e))
//   log-and-bail   catch { console.error(e); return; }  (or continue / break / return <literal>) - logged where nobody looks, then carried on
//   return-literal catch { return { ok:false }; } / { return -1; } / { return 'n/a'; } / { x = null; } / { void 0; } - the error becomes a plain value
//   swallow-literal .catch(noop) / .catch(e => ({ ok:false })) / .catch(() => 'x') - a .catch handler that only produces a literal
//   then-noop      .then(ok, () => {})  - the second argument of .then is an error handler that does nothing
//   inline-handler on*="...catch(e){}" attributes in HTML (an onclick that swallows)
//
// What to do instead (see skill `no-silent-failures`): rethrow, return an error the caller must handle, or report it
// (worker: reportFailure(...); pages: window.hubReportFailure(where, err); Apps Script: ledger_(...)).
// A catch that is genuinely benign (a JSON.parse probe, an optional lookup) is allowed ONLY with a reviewed marker
// INSIDE the catch braces or on the SAME line as the `catch` token (a comment ending the previous line does NOT count):
//   // silent-ok: <reason, at least 3 words>
//
// RATCHET: scripts/silent-failure-baseline.json holds today's count per file and category. A change may lower counts, never
// raise them. Raising a count fails the check (exit 1) and prints the new offenders with file:line.
//
// Usage:
//   node scripts/silent-failure-lint.mjs              check against the baseline (CI)        exit 1 if anything went UP
//   node scripts/silent-failure-lint.mjs --list       print every current offender (file:line category)
//   node scripts/silent-failure-lint.mjs --update     rewrite the baseline to the current (lower or equal) counts
//   node scripts/silent-failure-lint.mjs --files a.html b.js   only report offenders in these files (for a quick local check)
//   node scripts/silent-failure-lint.mjs --summary    counts only
//   node scripts/silent-failure-lint.mjs --baseline <path>   compare against another baseline file (CI: the BASE branch's, so a PR cannot raise its own ceiling)
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CATEGORIES = ['empty', 'log-only', 'return-default', 'swallow-catch', 'log-and-bail', 'return-literal', 'swallow-literal', 'then-noop', 'inline-handler'];

// ───────────────────────────── scanner: mask strings, regex literals and comments ─────────────────────────────
// Returns { masked, comments } where masked has the same length/newlines as src, with the CONTENT of strings, templates'
// text, regex literals and comments replaced by spaces (so braces/keywords inside them cannot confuse the matcher).
export function mask(src) {
  const n = src.length, out = new Array(n);
  const comments = [];
  let i = 0, prevSig = '';                    // last significant (non-space, non-comment) code char, for regex-vs-divide
  let prevWord = '';
  const tplStack = [];                          // for each open template literal: brace depth inside current ${ }
  const keep = (k) => { out[k] = src[k]; };
  const blank = (k) => { out[k] = (src[k] === '\n' || src[k] === '\r') ? src[k] : ' '; };
  const REGEX_AFTER_WORD = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield', 'await']);
  function readTemplate() {                     // at i just after an opening ` or after a closing } of ${ }
    keep(i - 1 < 0 ? 0 : i - 1);
    while (i < n) {
      const c = src[i];
      if (c === '\\') { blank(i); if (i + 1 < n) blank(i + 1); i += 2; continue; }
      if (c === '`') { keep(i); i++; prevSig = '`'; prevWord = ''; return 'closed'; }
      if (c === '$' && src[i + 1] === '{') { keep(i); keep(i + 1); i += 2; tplStack.push(0); prevSig = '{'; prevWord = ''; return 'expr'; }
      blank(i); i++;
    }
    return 'eof';
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') {               // line comment
      let j = i; while (j < n && src[j] !== '\n') j++;
      comments.push({ start: i, end: j, text: src.slice(i, j) });
      for (let k = i; k < j; k++) blank(k);
      i = j; continue;
    }
    if (c === '/' && d === '*') {               // block comment
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      comments.push({ start: i, end: j, text: src.slice(i, j) });
      for (let k = i; k < j; k++) blank(k);
      i = j; continue;
    }
    if (c === '"' || c === "'") {               // string
      keep(i); let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') { blank(j); j++; } if (j < n) blank(j); j++; }
      if (j < n && src[j] === c) { keep(j); j++; }
      i = j; prevSig = c; prevWord = ''; continue;
    }
    if (c === '`') {
      keep(i); i++;
      const st = readTemplate();
      if (st === 'expr') continue;
      continue;
    }
    if (c === '/') {                            // regex literal or division?
      const regexOk = prevSig === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prevSig) || (prevWord && REGEX_AFTER_WORD.has(prevWord));
      if (regexOk) {
        keep(i); let j = i + 1, inClass = false, ok = false;
        while (j < n && src[j] !== '\n') {
          const e = src[j];
          if (e === '\\') { blank(j); j++; if (j < n && src[j] !== '\n') blank(j); j++; continue; }
          if (e === '[') inClass = true; else if (e === ']') inClass = false;
          else if (e === '/' && !inClass) { ok = true; break; }
          blank(j); j++;
        }
        if (ok) { keep(j); j++; while (j < n && /[a-z]/i.test(src[j])) { keep(j); j++; } i = j; prevSig = '/'; prevWord = ''; continue; }
        // not actually a regex on this line: fall through and treat as division
        for (let k = i + 1; k < j; k++) out[k] = src[k];
      }
      keep(i); i++; prevSig = '/'; prevWord = ''; continue;
    }
    if (c === '{') { if (tplStack.length) tplStack[tplStack.length - 1]++; keep(i); i++; prevSig = '{'; prevWord = ''; continue; }
    if (c === '}') {
      if (tplStack.length && tplStack[tplStack.length - 1] === 0) {   // end of ${ ... }: back into template text
        tplStack.pop(); keep(i); i++;
        const st = readTemplate();
        if (st === 'expr') continue;
        continue;
      }
      if (tplStack.length) tplStack[tplStack.length - 1]--;
      keep(i); i++; prevSig = '}'; prevWord = ''; continue;
    }
    if (/\s/.test(c)) { keep(i); i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) { keep(j); j++; }
      prevWord = src.slice(i, j); prevSig = src[j - 1]; i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i; while (j < n && /[\w.]/.test(src[j])) { keep(j); j++; } i = j; prevSig = '0'; prevWord = ''; continue; }
    keep(i); prevSig = c; prevWord = ''; i++;
  }
  for (let k = 0; k < n; k++) if (out[k] === undefined) out[k] = src[k] === '\n' ? '\n' : ' ';
  return { masked: out.join(''), comments };
}

function matchClose(masked, openIdx, open, close) {
  let d = 0;
  for (let i = openIdx; i < masked.length; i++) {
    const c = masked[i];
    if (c === open) d++; else if (c === close) { d--; if (!d) return i; }
  }
  return -1;
}
const lineStarts = (src) => { const a = [0]; for (let i = 0; i < src.length; i++) if (src[i] === '\n') a.push(i + 1); return a; };
const lineOf = (starts, pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; } return lo + 1; };
const SILENT_OK = /silent-ok:\s*\S+(?:\s+\S+){2,}/;       // reason must be at least 3 words so it cannot be a bare "ok"

// ───────────────────────────── finder ─────────────────────────────
// Literal expressions (computed on MASKED text, where string contents are blanks but the quotes stay).
const ATOM = "(?:null|undefined|void 0|true|false|NaN|-?\\d[\\d.]*|'\\s*'|\"\\s*\"|`\\s*`)";
const VAL = '(?:' + ATOM + '|\\[\\s*\\]|\\{\\s*\\})';
const KEY = "(?:[\\w$]+|'\\s*'|\"\\s*\")";
const ARR = '\\[\\s*(?:' + ATOM + '(?:\\s*,\\s*' + ATOM + ')*\\s*,?\\s*)?\\]';
const OBJ = '\\{\\s*(?:' + KEY + '\\s*:\\s*' + VAL + '(?:\\s*,\\s*' + KEY + '\\s*:\\s*' + VAL + ')*\\s*,?\\s*)?\\}';
const LIT = '(?:' + ATOM + '|' + ARR + '|' + OBJ + ')';
const EMPTYV = "(?:null|undefined|false|true|0|''|\"\"|\\[\\s*\\]|\\{\\s*\\}|void 0|\\(\\s*\\{\\s*\\}\\s*\\)|\\(\\s*\\[\\s*\\]\\s*\\)|\\(\\s*null\\s*\\))";
const RE_LIT = new RegExp('^' + LIT + '$');
const RE_NOOP_NAME = /^_?(?:noop|nop|ignore\w*|swallow\w*|nothing|empty\w*)$/i;
const norm = (t) => t.replace(/\s+/g, ' ').trim();
// Strip leading console.xxx(...) statements (paren-matched, so `console.log(a) x.y()` is NOT "log-only"). Returns { rest, n }.
function stripConsole(body) {
  let rest = norm(body), n = 0, m;
  while ((m = /^console\.\w+\s*\(/.exec(rest))) {
    const close = matchClose(rest, m[0].length - 1, '(', ')');
    if (close < 0) break;
    rest = rest.slice(close + 1).replace(/^\s*;?\s*/, ''); n++;
  }
  return { rest, n };
}
// catch-block body (masked) -> category or null
function classifyCatchBody(body) {
  const b = norm(body);
  if (b === '') return 'empty';
  const { rest, n } = stripConsole(b);
  if (n && rest === '') return 'log-only';
  if (new RegExp('^(?:return\\s*' + EMPTYV + '?\\s*;?|continue\\s*;?|break\\s*;?)$').test(b)) return 'return-default';
  if (n && new RegExp('^(?:return(?:\\s+' + LIT + ')?|continue|break)\\s*;?$').test(rest)) return 'log-and-bail';
  if (new RegExp('^return\\s+' + LIT + '\\s*;?$').test(b)) return 'return-literal';
  if (/^(?:(?:var|let|const)\s+)?[\w$.]+\s*=\s*(?:null|undefined|void 0)\s*;?$/.test(b) || /^void 0\s*;?$/.test(b)) return 'return-literal';
  return null;
}
// a function / arrow / identifier passed as an error handler -> null | 'old' (empty / log-only / return-empty) | 'literal' (noop name, or only produces a literal)
function classifyHandler(arg) {
  arg = norm(arg);
  if (RE_NOOP_NAME.test(arg)) return 'literal';
  const params = '(?:async\\s*)?(?:\\(\\s*[\\w$\\s,]*\\)|[\\w$]+)';
  const block = (bd) => {
    bd = norm(bd);
    if (bd === '') return 'old';
    const { rest, n } = stripConsole(bd);
    if (n && rest === '') return 'old';
    if (new RegExp('^return\\s*' + EMPTYV + '?\\s*;?$').test(bd)) return 'old';
    if (new RegExp('^return\\s+' + LIT + '\\s*;?$').test(rest) || (n && /^return\s*;?$/.test(rest))) return 'literal';
    return null;
  };
  let fm;
  if ((fm = /^(?:async\s*)?function\s*[\w$]*\s*\([^)]*\)\s*\{([\s\S]*)\}$/.exec(arg))) return block(fm[1]);
  if ((fm = new RegExp('^' + params + '\\s*=>\\s*\\{([\\s\\S]*)\\}$').exec(arg))) return block(fm[1]);
  if ((fm = new RegExp('^' + params + '\\s*=>\\s*([\\s\\S]*)$').exec(arg))) {
    let ex = fm[1].trim();
    if (new RegExp('^' + EMPTYV + '$').test(ex) || /^console\.\w+\([^;]*\)$/.test(ex)) return 'old';
    while (/^\(.*\)$/.test(ex) && matchClose(ex, 0, '(', ')') === ex.length - 1) ex = ex.slice(1, -1).trim();   // ({ ok: false }) -> { ok: false }
    if (RE_LIT.test(ex)) return 'literal';
  }
  return null;
}
// split a masked argument list at top-level commas
function splitArgs(s) {
  const out = []; let d = 0, cur = '';
  for (const c of s) {
    if ('([{'.includes(c)) d++; else if (')]}'.includes(c)) d--;
    if (c === ',' && d === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out;
}

// scanSource(src) -> [{ category, line, snippet, allowed }]   (allowed = carries a valid silent-ok marker)
export function scanSource(src, lineOffset = 0) {
  const { masked, comments } = mask(src);
  const starts = lineStarts(src);
  const found = [];
  const snippetAt = (pos) => src.slice(starts[lineOf(starts, pos) - 1], (starts[lineOf(starts, pos)] || src.length)).trim().slice(0, 140);
  const lineEnd = (pos) => { const l = lineOf(starts, pos); return starts[l] !== undefined ? starts[l] - 1 : src.length; };
  // A marker counts only INSIDE the construct's braces/parens or on the SAME line as the `catch` token (or the closing line of a .catch(...) call).
  // A comment that ends the previous line exempts nothing, so one marker can never silently cover the next catch.
  const allowedNear = (tokenPos, closePos, endLineOfClose) => {
    const a = starts[lineOf(starts, tokenPos) - 1], b = Math.max(closePos, lineEnd(endLineOfClose ? closePos : tokenPos));
    return comments.some(c => c.start >= a && c.start <= b && SILENT_OK.test(c.text));
  };
  // 1. try/catch blocks
  const reCatch = /(?<![.\w$])catch\b\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = reCatch.exec(masked))) {
    const open = m.index + m[0].length - 1, close = matchClose(masked, open, '{', '}');
    if (close < 0) continue;
    const category = classifyCatchBody(masked.slice(open + 1, close));
    if (!category) continue;
    found.push({ category, line: lineOf(starts, m.index) + lineOffset, snippet: snippetAt(m.index), allowed: allowedNear(m.index, close, false) });
  }
  // 2. promise .catch(handler) that swallows
  const reDotCatch = /\.catch\s*\(/g;
  while ((m = reDotCatch.exec(masked))) {
    const open = m.index + m[0].length - 1, close = matchClose(masked, open, '(', ')');
    if (close < 0) continue;
    const kind = classifyHandler(masked.slice(open + 1, close));
    if (!kind) continue;
    found.push({ category: kind === 'old' ? 'swallow-catch' : 'swallow-literal', line: lineOf(starts, m.index) + lineOffset, snippet: snippetAt(m.index), allowed: allowedNear(m.index, close, true) });
  }
  // 3. .then(onOk, onError) where onError does nothing
  const reThen = /\.then\s*\(/g;
  while ((m = reThen.exec(masked))) {
    const open = m.index + m[0].length - 1, close = matchClose(masked, open, '(', ')');
    if (close < 0) continue;
    const args = splitArgs(masked.slice(open + 1, close));
    if (args.length < 2 || !norm(args[1])) continue;
    if (!classifyHandler(args[1])) continue;
    found.push({ category: 'then-noop', line: lineOf(starts, m.index) + lineOffset, snippet: snippetAt(m.index), allowed: allowedNear(m.index, close, true) });
  }
  return found.sort((a, b) => a.line - b.line);
}

// HTML: scan inline <script> blocks (no src) and report real file line numbers.
export function scanHtml(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1])) continue;
    if (/\btype\s*=\s*["']?(?:application\/(?:ld\+)?json|text\/template|text\/html)/i.test(m[1])) continue;
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const offset = html.slice(0, bodyStart).split('\n').length - 1;
    for (const f of scanSource(m[2], offset)) out.push(f);
  }
  // inline on*="..." attributes (outside or inside strings of scripts): an onclick that swallows is just as silent
  const reAttr = /\bon[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  while ((m = reAttr.exec(html))) {
    const val = (m[1] !== undefined ? m[1] : m[2]).replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
    if (!/catch|\.then\s*\(/.test(val)) continue;
    const offset = html.slice(0, m.index).split('\n').length - 1;
    for (const f of scanSource(val, offset)) out.push({ ...f, category: 'inline-handler' });
  }
  return out;
}

export function scanFile(path, text) {
  const ext = extname(path).toLowerCase();
  if (ext === '.html') return scanHtml(text);
  return scanSource(text, 0);
}

// ───────────────────────────── repo walk ─────────────────────────────
const SKIP_DIRS = new Set(['node_modules', '.git', 'test', 'tests', '.github', 'context', 'shop-assets', 'dist']);
const SCAN_EXT = new Set(['.js', '.mjs', '.gs', '.html']);
export function listFiles(root) {
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st; try { st = statSync(p); } catch (e) { throw new Error('silent-failure-lint: cannot stat ' + p + ': ' + e.message); }
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); continue; }
      if (!SCAN_EXT.has(extname(name).toLowerCase())) continue;
      if (/\.min\.js$/.test(name)) continue;
      const rel = relative(root, p).split(sep).join('/');
      if (rel.startsWith('scripts/silent-failure-lint')) continue;       // the linter's own examples are strings/regexes
      files.push(rel);
    }
  })(root);
  return files.sort();
}

export function countRepo(root, only) {
  const files = {}, offenders = [];
  for (const rel of (only && only.length ? only : listFiles(root))) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    const found = scanFile(rel, readFileSync(p, 'utf8')).filter(f => !f.allowed);
    if (!found.length) continue;
    const c = {}; for (const f of found) { c[f.category] = (c[f.category] || 0) + 1; offenders.push({ file: rel, ...f }); }
    files[rel] = c;
  }
  return { files, offenders };
}

// compare current counts to the baseline: returns list of increases
export function compare(current, baseline) {
  const ups = [], downs = [];
  const allFiles = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  for (const f of allFiles) for (const cat of CATEGORIES) {
    const now = (current[f] && current[f][cat]) || 0, was = (baseline[f] && baseline[f][cat]) || 0;
    if (now > was) ups.push({ file: f, category: cat, was, now });
    else if (now < was) downs.push({ file: f, category: cat, was, now });
  }
  return { ups, downs };
}
export const totals = (files) => { const t = {}; for (const cat of CATEGORIES) t[cat] = 0; for (const f of Object.values(files)) for (const cat of CATEGORIES) t[cat] += f[cat] || 0; return t; };

// ───────────────────────────── CLI ─────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const args = process.argv.slice(2);
  const bIdx = args.indexOf('--baseline');
  if (bIdx >= 0 && !args[bIdx + 1]) { console.error('--baseline needs a file path'); process.exit(2); }
  const baselinePath = bIdx >= 0 ? args[bIdx + 1] : join(root, 'scripts', 'silent-failure-baseline.json');
  const filesIdx = args.indexOf('--files');
  const only = filesIdx >= 0 ? args.slice(filesIdx + 1).filter(a => !a.startsWith('--') && (bIdx < 0 || a !== args[bIdx + 1])) : null;
  const { files, offenders } = countRepo(root, only);
  const t = totals(files);
  if (args.includes('--list')) {
    for (const o of offenders) console.log(`${o.file}:${o.line}  ${o.category}  ${o.snippet}`);
    console.log(`\n${offenders.length} offenders  ` + JSON.stringify(t));
    process.exit(0);
  }
  if (args.includes('--summary')) { console.log(JSON.stringify({ total: offenders.length, ...t }, null, 1)); process.exit(0); }
  if (args.includes('--update')) {
    if (only) { console.error('--update cannot be combined with --files'); process.exit(2); }
    let notes = null; try { notes = JSON.parse(readFileSync(baselinePath, 'utf8')).notes || null; } catch (e) { notes = null; /* silent-ok: unreadable baseline is reported just below */ }
    let old = {}; try { old = JSON.parse(readFileSync(baselinePath, 'utf8')).files || {}; } catch (e) { if (existsSync(baselinePath)) { console.error('baseline unreadable: ' + e.message); process.exit(2); } /* no baseline yet: first run creates it */ }
    const { ups } = compare(files, old);
    if (existsSync(baselinePath) && ups.length && !args.includes('--allow-raise')) {
      console.error('Refusing to RAISE the baseline (the ratchet only goes down):'); for (const u of ups) console.error(`  ${u.file} ${u.category}: ${u.was} -> ${u.now}`); process.exit(1);
    }
    writeFileSync(baselinePath, JSON.stringify(Object.assign({ about: 'Silent-failure ratchet. Counts may only go down. See scripts/silent-failure-lint.mjs.' }, notes ? { notes } : {}, { total: offenders.length, totals: t, files }), null, 1) + '\n');
    console.log('baseline written: ' + offenders.length + ' offenders ' + JSON.stringify(t));
    process.exit(0);
  }
  // check mode
  if (!existsSync(baselinePath)) { console.error(baselinePath + ' missing: run  node scripts/silent-failure-lint.mjs --update  once and commit it.'); process.exit(2); }
  let baseline;
  try { baseline = JSON.parse(readFileSync(baselinePath, 'utf8')).files || {}; } catch (e) { console.error(baselinePath + ' unreadable: ' + e.message); process.exit(2); }
  const { ups, downs } = compare(files, only ? Object.fromEntries(Object.entries(baseline).filter(([f]) => only.includes(f))) : baseline);
  console.log(`silent-failure-lint: ${offenders.length} offenders now ` + JSON.stringify(t) + `  (baseline total ${JSON.parse(readFileSync(baselinePath, 'utf8')).total})`);
  if (downs.length) console.log(`  improved in ${downs.length} file/category cell(s) - run  node scripts/silent-failure-lint.mjs --update  to lock the lower numbers in`);
  if (ups.length) {
    console.error('\nFAIL: this change ADDS silent failures. Nothing may fail silently (skill: no-silent-failures).');
    for (const u of ups) {
      console.error(`  ${u.file}  ${u.category}: ${u.was} -> ${u.now}`);
      const mine = offenders.filter(o => o.file === u.file && o.category === u.category).slice(-(u.now - u.was));
      for (const o of mine) console.error(`      likely new: ${o.file}:${o.line}  ${o.snippet}`);
    }
    console.error('\nFix it: rethrow, return an error, or report it (worker reportFailure / page window.hubReportFailure / Apps Script ledger_).');
    console.error('If it is genuinely benign add   // silent-ok: <reason, 3+ words>   inside the catch.');
    process.exit(1);
  }
  console.log('OK - no new silent failures.');
}
