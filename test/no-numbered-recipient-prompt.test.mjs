// Brett (Sep 28 2026): "I still see 'type the number of the recipient, 1 for tenant, 3 for vendor'."
// Sweeps EVERY root-level .html page and worker.js for any remaining prompt() that asks the admin to
// type a number to pick a recipient, and pins the two top-bar prompt() drafts to the new send modal.
import fs from 'fs';
import assert from 'node:assert';
const root = new URL('../', import.meta.url);
const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
ok(pages.length >= 30 && pages.includes('index.html') && pages.includes('vendor.html') && pages.includes('wo.html') && pages.includes('deliveries.html'), 'sweep covers every root-level page, not just index/vendor');
const RECIP = /(tenant|owner|vendor|recipient)/i;
for (const f of pages) {
  const lines = fs.readFileSync(new URL(f, root), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/\bprompt\s*\(/.test(line)) return;
    const ctx = lines.slice(Math.max(0, i - 1), i + 4).join('\n');
    const asksNumber = /1\s*(=|-|for)\s*(tenant|owner|vendor)|type the number|enter (the )?number|\bparseInt\(\s*(msg|choice|pick|which|sel)/i.test(ctx);
    ok(!(asksNumber && RECIP.test(ctx)), `${f}:${i + 1} has no prompt() asking to type a number to choose a recipient`);
  });
}
const worker = fs.readFileSync(new URL('worker.js', root), 'utf8');
ok(!/\bprompt\s*\(/.test(worker.replace(/\/\/[^\n]*/g, '')), 'worker.js contains no prompt() at all');
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const fnBody = name => { const s = html.indexOf('function ' + name + '('); let d = 0, j = html.indexOf('{', s); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } } return html.slice(s, j + 1); };
ok(!fnBody('_pickSendMessageRecipient').includes('prompt(') && html.includes('id="pick-recipient-list"'), 'the WO Message recipient picker is a button modal');
ok(!fnBody('sendTenantManualUpdate').includes('prompt(') && !fnBody('sendPhotoRequestSMS').includes('prompt(') && html.includes('id="modal-tenant-update"'), 'Send update / Request photos no longer use prompt()');
ok(/id="tu-send-btn"/.test(html) && fnBody('confirmTenantUpdate').includes('btn.disabled = true') && fnBody('confirmTenantUpdate').includes('.catch('), 'the new tenant modal is double-tap safe and shows errors');
ok(html.includes("openWOMessageModal") && html.includes('✉️ Message'), 'the ✉️ Message flow is untouched');
// stale-tab protection already exists in index.html (polls /version) — nothing to add
ok(html.includes("var VER_URL = WORKER + '/version'") && html.includes('Update ready — tap to refresh'), 'index.html already polls /version and reloads onto new deploys (no new stale-page check needed)');
console.log(`no-numbered-recipient-prompt: ${n}/${n} passing`);
