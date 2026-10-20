// Shared helpers for the cpa-* page tests (Phase C, batch pa): pull the REAL function text out of a page's inline scripts.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mask } from '../scripts/silent-failure-lint.mjs';
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = {};
export function pageScript(file) {
  if (cache[file]) return cache[file];
  const html = readFileSync(join(ROOT, file), 'utf8');
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi; let m, out = [];
  while ((m = re.exec(html))) { if (/\bsrc\s*=/.test(m[1])) continue; out.push(m[2]); }
  return (cache[file] = out.join('\n;\n'));
}
// Returns the full text of `[async ]function name(...) { ... }` from the page's inline scripts.
export function grabFn(file, name) {
  const src = pageScript(file), masked = mask(src).masked;
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'g');
  const m = re.exec(masked); if (!m) throw new Error('missing function ' + name + ' in ' + file);
  let i = masked.indexOf('{', masked.indexOf(')', m.index)), d = 0;
  for (; i < masked.length; i++) { if (masked[i] === '{') d++; else if (masked[i] === '}') { d--; if (!d) { i++; break; } } }
  return src.slice(m.index, i);
}
export function makeOk() {
  const r = { pass: 0, fail: 0 };
  r.ok = (c, m, x) => { if (c) { r.pass++; } else { r.fail++; console.log('  FAIL: ' + m + (x !== undefined ? ' ' + JSON.stringify(x) : '')); } };
  r.done = (name) => { console.log(`${name}: ${r.pass} passed, ${r.fail} failed`); if (r.fail) process.exit(1); };
  return r;
}
// A tiny fake DOM element: remembers innerHTML/textContent/style, supports insertAdjacentHTML.
export function el(extra) { const e = { innerHTML: '', textContent: '', style: {}, className: '', value: '', disabled: false, _adj: [],
  insertAdjacentHTML(pos, h) { e._adj.push([pos, h]); e.innerHTML = pos === 'afterbegin' ? h + e.innerHTML : e.innerHTML + h; } }; return Object.assign(e, extra || {}); }
