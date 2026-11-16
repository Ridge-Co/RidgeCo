// UI check (Nov 16 2026): unit tests for the static checks and the ratchet in scripts/ui-check.mjs, plus the wiring that makes
// the design standard hard to skip (DESIGN.md, the CLAUDE.md router block, the skills, the baseline file).
// No browser and no network here: the screenshot part runs in the "UI check" workflow, not in the unit suite.
// Run: node test/ui-check.test.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { countSmallFonts, countNativeDialogs, countLabelFileInputs, countFixedColumns, countNowrapChips, countNoZoom, cssRules,
  staticCounts, compare, expandFiles, minFontFor, STATIC_KEYS, VIEWPORTS } from '../scripts/ui-check.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const style = css => '<style>' + css + '</style>';

// 1. small text
t('font-size under the minimum is counted', countSmallFonts('a{font-size:11px} b{font-size: 12.5px} c{font-size:13px}', 13) === 2);
t('the same text passes a 12px minimum where it should', countSmallFonts('a{font-size:11px} b{font-size: 12.5px} c{font-size:13px}', 12) === 1);
t('inline styles and markup built in strings are counted', countSmallFonts(`<div style="font-size:10px">x</div>'<span style="font-size:9px">'`, 12) === 2);
t('font shorthand is counted', countSmallFonts('a{font:600 11px/1.2 system-ui} b{font: 14px Arial}', 12) === 1);
t('rem, em and percent are not guessed at', countSmallFonts('a{font-size:.7rem} b{font-size:80%}', 12) === 0);
t('font-family and other font- properties are not mistaken for the shorthand', countSmallFonts('a{font-family:x;font-weight:600;line-height:10px}', 12) === 0);
t('portal pages get 13px, the Hub 12px', minFontFor('vendor.html') === 13 && minFontFor('tenant.html') === 13 && minFontFor('owner.html') === 13 && minFontFor('index.html') === 12 && minFontFor('proposals.html') === 12);

// 2. browser pop-ups
t('alert / confirm / prompt calls are counted', countNativeDialogs(`if(!confirm('Delete?'))return; alert("x"); var r = prompt('Why');`) === 3);
t('window.alert( is counted', countNativeDialogs('window.alert(1); window.confirm("x")') === 2);
t('our own replacements are not counted', countNativeDialogs('rcConfirm("x"); await rcAsk("y"); ui.confirm("z"); showAlert(1); myprompt(2)') === 0);
t('a function definition and an assignment are not calls', countNativeDialogs('function confirm(m){return true} window.confirm = () => true;') === 0);

// 3. label-wrapped file inputs
t('a file input inside a label is counted', countLabelFileInputs('<label class="btn">Add photos<input type="file" style="display:none"></label>') === 1);
t('unquoted type=file is counted', countLabelFileInputs('<label>Pick <input id=f type=file hidden></label>') === 1);
t('the fixed pattern (real button, sibling input) passes', countLabelFileInputs(`<button type="button" onclick="document.getElementById('f').click()">Add photos</button><input id="f" type="file" style="display:none">`) === 0);
t('a label followed by (not wrapping) a file input passes', countLabelFileInputs('<label for="f">Receipt</label><input id="f" type="file">') === 0);
t('a label wrapping a text input passes', countLabelFileInputs('<label>Name <input type="text"></label>') === 0);
t('a comment that mentions a label, next to the fixed pattern, passes', countLabelFileInputs(`// never a <label>-wrapped file input\n'<button type="button" onclick="pick()">Add</button><input id="f" type="file">'`) === 0);

// 4. phone column on a monitor
t('a centred 560px page column with no desktop rule is counted', countFixedColumns(style('.wrap{max-width:560px;margin:0 auto;padding:0 12px}')) === 1);
t('the same column with a wider rule for big screens passes', countFixedColumns(style('.wrap{max-width:560px;margin:0 auto} @media (min-width:1100px){.wrap{max-width:1400px}}')) === 0);
t('a max-width media query does not count as a desktop rule', countFixedColumns(style('.wrap{max-width:560px} @media (max-width:420px){.wrap{padding:0}}')) === 1);
t('a wide page column (over 900px) passes', countFixedColumns(style('.container{max-width:1100px;margin:0 auto}')) === 0);
t('a small part inside the page (a card, a modal) is not a page column', countFixedColumns(style('.modal{max-width:440px} .login-card{max-width:380px} .wrap .note{max-width:400px}')) === 0);
t('body capped at a phone width is counted', countFixedColumns(style('body{max-width:480px;margin:0 auto}')) === 1);
t('cssRules reads rules inside and outside media blocks', (() => { const r = cssRules(style('/* c */ a{x:1} @media (min-width:700px){ b{y:2} c{z:3} } d{w:4}')); return r.length === 4 && r[1].media === '(min-width:700px)' && r[1].selector === 'b' && r[3].selector === 'd' && r[3].media === ''; })());

// 5. chips that cannot wrap
t('a nowrap chip is counted', countNowrapChips(style('.chip{font-size:10px;white-space:nowrap}')) === 1);
t('badge and pill count too', countNowrapChips(style('.badge{white-space:nowrap} .status-pill{white-space: nowrap}')) === 2);
t('a chip that ends long text with an ellipsis passes', countNowrapChips(style('.chip{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}')) === 0);
t('a chip that wraps passes, and nowrap on something else is not a chip', countNowrapChips(style('.chip{white-space:normal} .nav a{white-space:nowrap}')) === 0);

// 6. pinch-zoom
t('maximum-scale=1 is counted', countNoZoom('<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">') === 1);
t('user-scalable=no is counted', countNoZoom('<meta name="viewport" content="width=device-width,user-scalable=no">') === 1);
t('a normal viewport passes', countNoZoom('<meta name="viewport" content="width=device-width, initial-scale=1.0">') === 0);

// 7. the ratchet
const cur = (s, d, o) => ({ static: Object.assign({ small_font: 0, native_dialog: 0, label_file_input: 0, fixed_column: 0, nowrap_chip: 0, no_zoom: 0 }, s), detector: d || null, overflow: o || null });
t('same as baseline: nothing worse', compare(cur({ small_font: 5 }), { static: { small_font: 5 } }).worse.length === 0);
t('existing debt does not fail', compare(cur({ small_font: 300, native_dialog: 97 }), { static: { small_font: 300, native_dialog: 97 } }).worse.length === 0);
t('one more than baseline fails', (() => { const w = compare(cur({ small_font: 6 }), { static: { small_font: 5 } }).worse; return w.length === 1 && w[0].key === 'small_font' && w[0].was === 5 && w[0].now === 6; })());
t('fewer than baseline is reported as better, not worse', (() => { const r = compare(cur({ native_dialog: 2 }), { static: { native_dialog: 4 } }); return r.worse.length === 0 && r.better.length === 1; })());
t('a page with no baseline is held to zero', compare(cur({ native_dialog: 1 }), undefined).worse.length === 1 && compare(cur({}), undefined).worse.length === 0);
t('a key left out of the baseline means zero', compare(cur({ nowrap_chip: 1 }), { static: { small_font: 9 } }).worse.some(w => w.key === 'nowrap_chip'));
t('a new detector finding fails', compare(cur({}, { 'tiny-text': 3 }), { static: {}, detector: { 'tiny-text': 2 } }).worse.some(w => w.key === 'detector:tiny-text'));
t('a detector rule that is new to the page fails', compare(cur({}, { 'low-contrast': 1 }), { static: {}, detector: {} }).worse.length === 1);
t('detector counts are not compared across detector versions', compare(cur({}, { 'tiny-text': 9 }), { static: {}, detector: { 'tiny-text': 2 } }, { detectorComparable: false }).worse.length === 0);
t('a detector that did not run fails nothing by itself', compare(cur({}), { static: {}, detector: { 'tiny-text': 2 } }).worse.length === 0);
t('new sideways scroll fails', compare(cur({}, null, { 412: true, 1366: false, 1920: false }), { static: {}, overflow: [] }).worse.length === 1);
t('sideways scroll that was already there does not fail', compare(cur({}, null, { 412: true }), { static: {}, overflow: ['412'] }).worse.length === 0);
t('sideways scroll on a new page fails', compare(cur({}, null, { 1366: true }), undefined).worse.length === 1);

// 8. which pages a list of changed files means
t('unknown and non-page names are dropped', JSON.stringify(expandFiles(['worker.js', 'nope.html', '', 'README.md'], root)) === '[]');
t('page names are kept and sorted, ./ is tolerated', JSON.stringify(expandFiles(['./vendor.html', 'proposals.html', 'vendor.html'], root)) === '["proposals.html","vendor.html"]');

// 9. the real files: baseline, standard, router, skills
const baseline = JSON.parse(fs.readFileSync(root + 'scripts/ui-check-baseline.json', 'utf8'));
t('baseline covers the main pages and only uses known static keys', ['index.html', 'vendor.html', 'tenant.html', 'owner.html', 'proposals.html'].every(p => baseline.pages[p] && baseline.pages[p].static) && Object.values(baseline.pages).every(b => Object.entries(b.static).every(([k, v]) => STATIC_KEYS.includes(k) && Number.isInteger(v) && v > 0)));
t('baseline names only pages that exist', Object.keys(baseline.pages).every(p => fs.existsSync(root + p)), Object.keys(baseline.pages).filter(p => !fs.existsSync(root + p)));
t('baseline lists sideways scroll as known widths only', Object.values(baseline.pages).every(b => !b.overflow || (Array.isArray(b.overflow) && b.overflow.every(w => VIEWPORTS.some(v => v.name === String(w))))));
t('baseline says which detector version its counts came from', /^\d+\.\d+\.\d+$/.test(baseline.detector_version || ''));
t('staticCounts returns every key', STATIC_KEYS.every(k => k in staticCounts('<style>a{font-size:9px}</style>', 'x.html')));
const design = fs.readFileSync(root + 'DESIGN.md', 'utf8');
t('DESIGN.md states the type scale, spacing scale, breakpoints and tap target', /13 \/ 15 \/ 17 \/ 20 \/ 24/.test(design) && /4 \/ 8 \/ 12 \/ 16 \/ 24 \/ 32/.test(design) && /700/.test(design) && /1100/.test(design) && /44px/.test(design) && /4\.5:1/.test(design));
t('DESIGN.md has the common-mistakes list', /## Common mistakes we keep making/.test(design));
const claude = fs.readFileSync(root + 'CLAUDE.md', 'utf8');
const router = (/## UI and process skills \(always\)\n([\s\S]*?)\n## /.exec(claude) || [])[1] || '';
t('CLAUDE.md has the router block near the top', router.length > 0 && claude.indexOf('## UI and process skills (always)') < claude.indexOf('## MANDATORY: load context before writing code'));
t('the router block is under 25 lines and names the pieces', router.split('\n').length < 25 && ['DESIGN.md', 'scripts/ui-check.mjs', '412', '1366', 'pre-build-grill', 'verification-before-completion', 'ridgeco-ui-review'].every(s => router.includes(s)), router.split('\n').length);
const skills = ['impeccable', 'playwright-cli', 'pre-build-grill', 'brainstorming', 'writing-plans', 'systematic-debugging', 'verification-before-completion', 'office-hours', 'public-site-taste', 'ridgeco-ui-review'];
for (const s of skills) {
  const f = root + '.claude/skills/' + s + '/SKILL.md';
  const txt = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  t(`skill ${s}: SKILL.md has name and description`, new RegExp('^---\\nname: ' + s + '\\ndescription: .{40,}').test(txt));
}
// Vetting rule: nothing under .claude/skills may fetch-and-run remote code, carry a hook, or wave off the user's tools.
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(d + e.name + '/') : [d + e.name]);
const skillFiles = fs.existsSync(root + '.claude/skills/') ? walk(root + '.claude/skills/') : [];
t('skills are text only (no scripts, binaries or hook manifests)', skillFiles.length > 0 && skillFiles.every(f => /\.(md|txt)$/.test(f)), skillFiles.filter(f => !/\.(md|txt)$/.test(f)));
const bad = [/curl[^\n|]*\|\s*(ba)?sh/i, /wget[^\n|]*\|\s*(ba)?sh/i, /^hooks:\s*$/m, /@latest\b/, /ignore (all |any )?(previous|prior|other) instructions/i, /\{\{scripts_path\}\}/, /gstack-[a-z-]+ --/];
for (const f of skillFiles.filter(f => f.endsWith('.md'))) {
  const txt = fs.readFileSync(f, 'utf8');
  t(`${f.replace(root, '')}: no remote-run, hook, unpinned install or leftover launcher line`, !bad.some(re => re.test(txt)), bad.filter(re => re.test(txt)).map(String));
}
t('public-site-taste says it is not for the Hub or the portals', /must NOT be used on the Hub/i.test(fs.readFileSync(root + '.claude/skills/public-site-taste/SKILL.md', 'utf8')));
const third = fs.readFileSync(root + 'context/THIRD_PARTY_SKILLS.md', 'utf8');
t('the vetting record pins a 40-character commit for every source', (third.match(/\b[0-9a-f]{40}\b/g) || []).length >= 6);
const wf = root + '.github/workflows/ui-check.yml';
if (fs.existsSync(wf)) {
  const y = fs.readFileSync(wf, 'utf8');
  t('ui-check.yml: pull_request trigger only, no timer', /^on:\s*\n\s+pull_request:/m.test(y) && !/^\s*schedule:/m.test(y) && !/^\s*-?\s*cron:/m.test(y) && !/^\s*(push|workflow_dispatch|pull_request_target):/m.test(y));
  t('ui-check.yml: read-only token and pinned detector', /permissions:\s*\n\s+contents: read/.test(y) && /impeccable@\d+\.\d+\.\d+/.test(y) && /--ignore-scripts/.test(y));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
