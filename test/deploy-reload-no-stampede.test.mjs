// Oct 19 2026: every deploy bumped the Worker /version, and every open copy of every app page (Hub, vendor, owner, tenant -- including every
// BACKGROUND tab) reloaded itself within a minute, a stampede of cold page loads against the shared Google Sheets read quota right after each
// deploy. Now only a visible tab reloads, at a random moment within 20s; hidden tabs wait until shown; a busy (typing) tab gets the banner.
import fs from 'fs';
function grab(src, sig) {
  const start = src.indexOf(sig); if (start < 0) throw new Error('not found: ' + sig);
  const open = src.indexOf('{', start); let depth = 0, i = open;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (!depth) break; } }
  return src.slice(start, i + 1);
}
let pass = 0, fail = 0;
const t = (n, c) => { if (c) pass++; else { fail++; console.log('FAIL:', n); } };
const pages = { 'index.html': 'dirty', 'owner.html': 'dirty', 'tenant.html': 'dirty', 'vendor.html': 'isVendorBusy' };
for (const [f, busy] of Object.entries(pages)) {
  const s = fs.readFileSync(f, 'utf8');
  t(f + ': a changed Worker version goes through autoReload (not an immediate reload)', s.includes('if (d.version !== booted){ autoReload(' + busy + '); }') && !s.includes('if (d.version !== booted){ ' + busy + '() ? banner() : reloadFresh(); }'));
  t(f + ': autoReload is defined next to reloadFresh', /var _autoReloadPending = false;[\s\S]{0,400}function autoReload\(isBusy\)/.test(s));
}
// behaviour, against the real function text from owner.html
{
  const s = fs.readFileSync('owner.html', 'utf8');
  const src = 'var _autoReloadPending = false;\n' + grab(s, 'function autoReload(');
  const build = (hidden) => {
    const timers = []; const log = { reload: 0, banner: 0 };
    const doc = { hidden };
    const f = new Function('document', 'setTimeout', 'Math', 'reloadFresh', 'banner', src + '\nreturn autoReload;')(
      doc, (fn, ms) => { timers.push({ fn, ms }); }, Math, () => { log.reload++; }, () => { log.banner++; });
    return { autoReload: f, timers, log, doc };
  };
  let m = build(true);
  m.autoReload(() => false);
  t('a HIDDEN (background) tab does not reload or even schedule a reload', m.timers.length === 0 && m.log.reload === 0);
  m = build(false);
  m.autoReload(() => false);
  t('a visible idle tab schedules ONE reload, delayed by under 20s', m.timers.length === 1 && m.timers[0].ms >= 0 && m.timers[0].ms < 20000);
  m.autoReload(() => false);
  t('repeated checks do not stack timers', m.timers.length === 1);
  m.timers[0].fn();
  t('the reload then happens exactly once', m.log.reload === 1 && m.log.banner === 0);
  m = build(false);
  m.autoReload(() => false); m.doc.hidden = true; m.timers[0].fn();
  t('a tab hidden during the delay does not reload', m.log.reload === 0);
  m = build(false);
  m.autoReload(() => true); m.timers[0].fn();
  t('a tab where the person started typing gets the banner, not a reload', m.log.banner === 1 && m.log.reload === 0);
  // jitter really spreads: 200 tabs -> delays cover most of the 20s window
  const ds = []; for (let i = 0; i < 200; i++) { const x = build(false); x.autoReload(() => false); ds.push(x.timers[0].ms); }
  t('200 tabs spread their reloads over the window (not all at once)', Math.min(...ds) < 3000 && Math.max(...ds) > 17000);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
