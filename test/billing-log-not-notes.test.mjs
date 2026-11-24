// Nov 24 2026 — billing history never goes into a work order's Notes (WO-1253: the scope billing line with the invoiced
// amount, invoice number, vendor pay and instant-pay fee was appended to Notes, which vendors, tenants and owners read).
// It goes to Billing_Log, which the Hub shows and every portal strips.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const ih = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m); };

const at = src.indexOf("Scope Proposal billed — ' + labelList");
ok(at > 0, 'the scope billing line still exists');
const block = src.slice(at, at + 1200);
ok(/Billing_Log: woRow\.Billing_Log \? \(woRow\.Billing_Log \+ '\\n' \+ noteLine\) : noteLine/.test(block), 'scope billing line is written to Billing_Log');
ok(!/Notes: woRow\.Notes/.test(block), 'scope billing line is NOT written to Notes');
ok(/await ensureColumns\(env, 'Work_Orders', \['Billing_Log'\]\);/.test(block), 'Billing_Log column is ensured before the write (no silent skip)');
// No code path appends a money template into Notes: any line that builds a Notes value with a "$" amount fails the build.
const offenders = src.split('\n').filter(l => /Notes:\s*[^,]*\+[^,]*'\$'\s*\+/.test(l) || /Notes:[^\n]*invoiced \(/.test(l));
assert.deepStrictEqual(offenders, [], 'a Notes write builds a dollar amount into the note: ' + offenders.join(' || '));
ok(true, 'no Notes write anywhere builds a dollar amount into the note');
ok(src.includes("'Markup', 'Margin', 'Billing_Log'];"), 'enrichWO strips Billing_Log from every external work order');
ok(/const PORTAL_MARKUP_KEYS = [^\n]*billing_\?log/.test(src), 'the portal money firewall removes Billing_Log for every audience');
ok(/wo\.Billing_Log \? '<div[^\n]*/.test(ih) && ih.includes('BILLING LOG'), 'the Hub work order shows the billing log');
console.log(`billing-log-not-notes: ${n}/${n} passing`);
