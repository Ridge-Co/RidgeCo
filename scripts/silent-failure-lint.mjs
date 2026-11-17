#!/usr/bin/env node
// Silent-failure lint (Nov 17 2026). The CI gate planned in context/NO_SILENT_FAILURES_PROGRAM_v1.0.md section 7, and the
// command the no-silent-failures / test-verified-builds skills tell every build to run. Free, no AI, no network.
//
// It counts SWALLOWING error handlers in every production source file at the repo root (*.js, *.html):
//   1. an empty catch                      catch (e) {}            catch {}
//   2. a comment-only catch                catch (e) { /* ignore */ }
//   3. a log-only catch                    catch (e) { console.error('x', e); }
//   4. a swallowing promise .catch         .catch(() => {})  .catch(() => null)  .catch(function () {})  .catch(() => [])
//   5. a return-default catch (Nov 17)     catch (e) { return null; }   catch { return []; }   catch (e) { return false; }   catch { return; }
//      (a comment before the return does not make it visible: the caller still cannot tell "no data" from "the read failed")
// A handler that is genuinely benign is allowed when its line carries   // silent-ok: <a reason of 3 or more words>
// (a shorter reason is itself a finding).
//
// RATCHET: scripts/silent-failure-baseline.json holds today's count per file. A file whose count goes UP fails (exit 1) and
// every occurrence in that file is listed, so the new one is easy to spot. Counts going DOWN are good: run with --update to
// lower the baseline in the same PR. Never raise a baseline to get a red check green; report the failure instead
// (reportFailure / softNote in the Worker, window.hubReportFailure in pages), or mark it silent-ok with a real reason.
//
// Usage:  node scripts/silent-failure-lint.mjs            check (exit 0 pass, 1 new silent handler, 2 the lint itself broke)
//         node scripts/silent-failure-lint.mjs --update   rewrite the baseline to today's counts (only after reading the diff)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = path.join(ROOT, 'scripts', 'silent-failure-baseline.json');

const PATTERNS = [
  ['empty catch', /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g],
  ['comment-only catch', /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)+\}/g],
  ['log-only catch', /catch\s*(?:\([^)]*\))?\s*\{\s*console\.(?:log|warn|error|info|debug)\((?:[^()]|\([^()]*\))*\)\s*;?\s*\}/g],
  ['swallowing .catch', /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:\{\s*\}|null|undefined|false|true|''|""|\[\]|\(\s*\{\s*\}\s*\)|\{\s*return\s*(?:null|undefined|false|\[\]|\{\})?\s*;?\s*\})\s*\)/g],
  ['return-default catch', /catch\s*(?:\([^)]*\))?\s*\{\s*(?:(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*)\s*)*return(?:\s+(?:null|undefined|false|true|0|''|""|\[\]|\{\}))?\s*;?\s*(?:\/\/[^\n]*)?\s*\}/g],
  ['swallowing .catch', /\.catch\(\s*function\s*\w*\s*\([^)]*\)\s*\{\s*\}\s*\)/g],
];
const SILENT_OK = /\/\/\s*silent-ok:\s*(.*)$/;

// PURE. Returns { findings: [{kind, line}], badReasons: [line] } for one file's text.
export function scan(text) {
  const lines = text.split('\n');
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;
  const seen = new Set();
  const findings = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const start = lineOf(m.index), end = lineOf(m.index + m[0].length);
      const key = m.index + m[0].indexOf('catch');   // one handler matched by two patterns (".catch(function(){})") counts once
      if (seen.has(key)) continue;
      seen.add(key);
      let ok = false;
      for (let l = start; l <= end; l++) {
        const s = SILENT_OK.exec(lines[l - 1] || '');
        if (s && s[1].trim().split(/\s+/).filter(Boolean).length >= 3) { ok = true; break; }
      }
      if (!ok) findings.push({ kind, line: start });
    }
  }
  const badReasons = [];
  lines.forEach((l, i) => { const s = SILENT_OK.exec(l); if (s && s[1].trim().split(/\s+/).filter(Boolean).length < 3) badReasons.push(i + 1); });
  findings.sort((a, b) => a.line - b.line);
  return { findings, badReasons };
}

export function sourceFiles(root = ROOT) {
  return fs.readdirSync(root).filter(f => /\.(js|html)$/.test(f) && fs.statSync(path.join(root, f)).isFile()).sort();
}

export function run(root = ROOT, baselinePath = BASELINE, update = false) {
  const counts = {};
  const detail = {};
  const badReasons = [];
  for (const f of sourceFiles(root)) {
    const r = scan(fs.readFileSync(path.join(root, f), 'utf8'));
    counts[f] = r.findings.length;
    detail[f] = r.findings;
    for (const l of r.badReasons) badReasons.push(`${f}:${l}`);
  }
  if (update) {
    fs.writeFileSync(baselinePath, JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0)), null, 2) + '\n');
    return { code: 0, out: [`Baseline written: ${Object.values(counts).reduce((a, b) => a + b, 0)} silent handlers in ${Object.keys(counts).filter(f => counts[f]).length} files.`] };
  }
  let base;
  try { base = JSON.parse(fs.readFileSync(baselinePath, 'utf8')); }
  catch (e) { return { code: 2, out: [`silent-failure-lint: cannot read ${path.relative(root, baselinePath)} (${e.message}). Nothing was checked.`] }; }
  const out = [];
  let code = 0;
  for (const f of Object.keys(counts)) {
    const have = counts[f], allowed = base[f] || 0;
    if (have > allowed) {
      code = 1;
      out.push(`NEW silent handler in ${f}: ${have} found, baseline ${allowed}. Report the failure instead (reportFailure / softNote / window.hubReportFailure), or add "// silent-ok: <3+ word reason>" if it is truly benign. All of them in this file:`);
      for (const d of detail[f]) out.push(`  ${f}:${d.line}  ${d.kind}`);
    }
  }
  for (const b of badReasons) { code = 1; out.push(`silent-ok without a real reason (needs 3 or more words): ${b}`); }
  const lower = Object.keys(base).filter(f => (counts[f] || 0) < base[f]);
  if (code === 0) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    out.push(`silent-failure-lint: pass. ${total} known silent handlers, none new.`);
    if (lower.length) out.push(`Fewer than the baseline in: ${lower.join(', ')}. Run with --update to lock the lower count in.`);
  }
  return { code, out, counts, lower };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let r;
  try { r = run(ROOT, BASELINE, process.argv.includes('--update')); }
  catch (e) { console.error('silent-failure-lint: the lint itself failed:', e && e.stack || e); process.exit(2); }
  for (const l of r.out) (r.code ? console.error : console.log)(l);
  process.exit(r.code);
}
