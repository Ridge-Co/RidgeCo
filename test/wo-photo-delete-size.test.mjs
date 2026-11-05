// Work order photo thumbnails: the corner delete "x" must stay small (Nov 5 2026).
// The coarse-pointer rule in index.html (`button{min-height:44px !important; min-width:44px !important}`)
// stretched the 56px thumbnail's delete button over the whole picture, so every tap meant to open the
// photo landed on delete. The thumbnail's delete button now sets its own inline !important minimums,
// which win over the stylesheet's !important. This test pins both halves so neither can drift back.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// 1. The global touch rule still exists (this fix must not remove it for everything else).
ok(/button,input\[type=button\],input\[type=submit\],select,summary,\.btn,\.btn-sm,\.filter-btn,#rc-navbar a\{min-height:44px !important\}/.test(src),
  'global 44px touch-target rule is still present for ordinary buttons');

// 2. The thumbnail delete button opts out of it with inline !important minimums.
const i = src.indexOf("del.className = 'wo-photo-del';");
ok(i > 0, 'thumbnail delete button is tagged wo-photo-del');
const block = src.slice(i, src.indexOf('thumb.appendChild(del)', i));
const css = (block.match(/del\.style\.cssText = '([^']*)'/) || [])[1] || '';
ok(css.length > 0, 'thumbnail delete button sets an inline style');
const num = (re) => { const m = css.match(re); return m ? parseInt(m[1], 10) : NaN; };
ok(num(/min-height:(\d+)px !important/) <= 28, 'delete button min-height is overridden inline with !important and is at most 28px');
ok(num(/min-width:(\d+)px !important/) <= 28, 'delete button min-width is overridden inline with !important and is at most 28px');
ok(num(/height:(\d+)px !important/) <= 28, 'delete button height is at most 28px');

// 3. The thumbnail itself is big enough that most of it is a plain "open the photo" target.
const t = src.match(/thumb\.style\.cssText = 'position:relative;display:inline-block;width:(\d+)px;height:(\d+)px/);
ok(t && +t[1] >= 56 && +t[2] >= 56, 'thumbnail is at least 56px square');
ok(t && (22 * 22) / (+t[1] * +t[2]) < 0.15, 'delete button covers under 15% of the thumbnail');

// 4. The two-step confirm still exists, so one stray tap can never delete.
ok(src.includes("del.textContent = '✓ confirm'"), 'first tap on delete only asks for confirmation');

console.log(`wo-photo-delete-size: ${n} assertions passed`);
