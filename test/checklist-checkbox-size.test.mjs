// Job checklist checkboxes (Nov 5 2026): big, obvious, whole-row tap target, clear done state.
import fs from 'fs';
import assert from 'node:assert';
const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

for (const f of ['vendor.html', 'wo.html']) {
  const h = read(f);
  const css = (h.match(/input\.clbox\{[^}]*\}/) || [''])[0];
  ok(css, f + ': clbox rule exists');
  const size = Number((css.match(/width:(\d+)px/) || [])[1]);
  ok(size >= 28, f + ': checkbox is at least 28px wide (was the ~13px browser default), got ' + size);
  ok(/height:\d+px/.test(css) && /appearance:none/.test(css), f + ': custom-drawn box');
  ok(/border:3px solid #1b1f24/.test(css), f + ': thick dark border so an empty box is easy to see');
  ok(/input\.clbox:checked\{[^}]*#166534[^}]*svg/.test(h), f + ': ticked box turns solid green with a white check');
  ok(/input\.clbox:focus-visible/.test(h), f + ': keyboard focus ring');
  const row = (h.match(/\.clrow\{[^}]*\}/) || [''])[0];
  ok(/min-height:(5\d|6\d)px/.test(row), f + ': row is at least 50px tall (finger sized)');
  ok(/\.clrow\.on\{[^}]*#e7f6ec/.test(h), f + ': ticked row is tinted green');
  ok(/class="clbox"/.test(h) && /class="clrow/.test(h), f + ': checklist markup uses the new classes');
  ok(!/style="width:auto;margin-top:2px;flex-shrink:0"/.test(h) && !/style="margin-top:3px"><span class="v" style="font-size:14px"/.test(h), f + ': old tiny-checkbox markup is gone');
  ok(/cl-lbl-/.test(h) && /classList\.toggle\('on'/.test(h), f + ': ticking toggles the green row live');
}
const v = read('vendor.html');
ok(/\.cltxt\{[^}]*text-transform:none/.test(v), 'vendor page: item text is not forced to UPPERCASE by the global label rule');
ok(/\.clrow\{[^}]*letter-spacing:normal/.test(v), 'vendor page: item text is not letter-spaced by the global label rule');
const a = read('index.html');
ok(/font-size:18px;font-weight:bold;line-height:1">✓/.test(a), 'admin work order detail: bigger done mark');

console.log(`checklist-checkbox-size: ${n} assertions passed`);
