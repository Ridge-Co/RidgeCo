// Oct 30 2026 — Field Inspection and the Inspection Scheduler link to each other directly (no trip back to the Hub), and that is the DEFAULT for related tools.
// Pins: every page in a RC_RELATED group loads rc-related.js with that group; every page that loads it is in the registry; every registry target exists;
// the script really renders "the other pages" (not itself) into the blue bar; a bad group is a loud console error, not a silent blank bar.
import fs from 'fs';
import vm from 'vm';
const root = new URL('../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, root), 'utf8');
let pass = 0, fail = 0;
const t = (n, c, got) => { if (c) pass++; else { fail++; console.log('FAIL:', n, got !== undefined ? 'got ' + JSON.stringify(got).slice(0, 300) : ''); } };
const js = read('rc-related.js');
const reg = (() => { const m = /var RC_RELATED = (\{[\s\S]*?\n  \});/.exec(js); return m ? vm.runInNewContext('(' + m[1] + ')') : null; })();
t('registry parses', !!reg && reg.inspections && reg.inspections.length >= 2, reg);
const pages = reg.inspections.map(x => x.href);
t('scheduler and field inspection are both in the inspections group', pages.includes('inspect.html') && pages.includes('field-inspect.html'), pages);

for (const [g, items] of Object.entries(reg)) {
  for (const it of items) {
    t(g + ': target exists ' + it.href, fs.existsSync(new URL(it.href, root)));
    const h = fs.existsSync(new URL(it.href, root)) ? read(it.href) : '';
    t(g + ': ' + it.href + ' loads rc-related.js with data-group="' + g + '"', new RegExp('<script src="rc-related\\.js" data-group="' + g + '"></script>').test(h));
    t(g + ': ' + it.href + ' loads it AFTER the #rc-navbar element', h.indexOf('id="rc-navbar"') > -1 && h.indexOf('id="rc-navbar"') < h.indexOf('rc-related.js'));
    t(g + ': ' + it.href + ' has a label', !!it.label);
  }
}
// no page uses the script without being in the registry (forgotten registration)
for (const f of fs.readdirSync(root).filter(x => x.endsWith('.html'))) {
  const h = read(f), m = /<script src="rc-related\.js" data-group="([^"]+)"/.exec(h);
  if (m) t(f + ' uses group ' + m[1] + ' and is registered in it', (reg[m[1]] || []).some(x => x.href === f), m[1]);
}
t('the scheduler jump menu also lists Field Inspection', /<option value="field-inspect\.html">/.test(read('inspect.html')));

// ── run it ──
function run(file, group, withBar = true) {
  const logs = [], errs = [];
  const mkEl = (tag) => ({ tag, style: {}, children: [], childNodes: [], setAttribute() {}, appendChild(c) { this.children.push(c); this.childNodes.push(c); c.parent = this; return c; },
    insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); this.childNodes = this.children; c.parent = this; return c; },
    querySelector(sel) { return this.children.find(c => c.tag === 'a') || null; }, get nextSibling() { const p = this.parent; if (!p) return null; return p.children[p.children.indexOf(this) + 1] || null; } });
  const bar = mkEl('div'); bar.id = 'rc-navbar'; const hub = mkEl('a'); hub.href = 'index.html'; bar.appendChild(hub); const ver = mkEl('span'); bar.appendChild(ver);
  const body = mkEl('body');
  const doc = { currentScript: { getAttribute: () => group }, getElementById: (id) => (id === 'rc-navbar' && withBar ? bar : null), createElement: mkEl, body };
  vm.runInNewContext(js, { document: doc, location: { pathname: '/RidgeCo/' + file }, console: { error: (...a) => errs.push(a.join(' ')), log: (...a) => logs.push(a) }, window: {} });
  const wrap = (withBar ? bar : body.children[0] || bar).children.find(c => c.id === 'rc-related');
  return { links: wrap ? wrap.children.map(c => c.href + '|' + c.textContent) : [], errs, bar, body, wrap };
}
const a = run('field-inspect.html', 'inspections');
t('field-inspect shows a link to the scheduler and not to itself', a.links.length === 1 && a.links[0].startsWith('inspect.html|'), a.links);
t('the chip sits right after the Hub link', a.bar.children[1].id === 'rc-related', a.bar.children.map(c => c.id || c.tag));
const b = run('inspect.html', 'inspections');
t('scheduler shows a link to field inspection and not to itself', b.links.length === 1 && b.links[0].startsWith('field-inspect.html|'), b.links);
const c = run('inspect.html', 'nope');
t('unknown group is a loud console error', c.errs.length === 1 && /unknown or missing data-group/.test(c.errs[0]), c.errs);
const d = run('field-inspect.html', 'inspections', false);
t('a page with no #rc-navbar gets one (Hub link + related links), never nothing', d.body.children.length === 1 && d.body.children[0].id === 'rc-navbar', d.body.children.map(x => x.id));

console.log(`rc-related: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
