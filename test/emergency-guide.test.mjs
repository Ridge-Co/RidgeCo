// Queue #132 (Nov 22 2026): "Is this an emergency?" guidance (EN + ES) above the urgency select
// on the tenant request modal and the public intake form. Static markup only: no JS, no payload change.
import fs from 'fs';
import assert from 'node:assert';
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
for (const f of ['tenant.html', 'submit.html']) {
  const html = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  const g = html.indexOf('class="emergency-guide"');
  ok(g > 0, f + ': guide block exists');
  const sel = html.indexOf(f === 'tenant.html' ? 'id="srPriority"' : 'id="priority-select"');
  ok(sel > g, f + ': guide sits ABOVE the urgency select');
  const block = html.slice(g, html.indexOf('</div>', g));
  ok(/Call 911 first/.test(block) && /Llame al 911/.test(block), f + ': 911 first, EN and ES');
  ok(/Is this an emergency\?/.test(block) && /&iquest;Es una emergencia\?/.test(block), f + ': heading EN and ES');
  ok(/water leak/i.test(block) && /fuga de agua/i.test(block), f + ': self-mitigation steps EN and ES');
  ok(!/\d{3}[-. ]\d{4}/.test(block.replace(/911/g, '')), f + ': no invented phone number');
  ok(!/<script|onclick|<input|<button/i.test(block), f + ': block is static (no script, input or button)');
  const fs13 = [...block.matchAll(/font-size:(\d+)px/g)].map(m => +m[1]);
  ok(fs13.length > 0 && fs13.every(x => x >= 13), f + ': text is 13px or larger');
  const opts = html.slice(sel, html.indexOf('</select>', sel));
  ok(/value="normal"/.test(opts) && /value="urgent"/.test(opts) && /value="low"/.test(opts) && (opts.match(/<option/g) || []).length === 3, f + ': urgency options unchanged (normal, urgent, low)');
}
console.log('emergency-guide: ' + n + ' checks passed');
