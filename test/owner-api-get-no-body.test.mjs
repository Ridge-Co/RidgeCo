// Owner page Tenants tab bug (Nov 12 2026): tenant-roster.js calls call('GET', path, null) and owner.html's api() turned that null into a
// request body ("null") on a GET. Browsers refuse that with "Request with GET/HEAD method cannot have body", so the Tenants tab never loaded
// for ANY owner. This test runs the real api() from owner.html against a fetch that behaves like the browser (throws on a GET with a body).
import fs from 'fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const html = fs.readFileSync(root + 'owner.html', 'utf8');
let pass = 0, fail = 0;
const t = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL:', n, x === undefined ? '' : JSON.stringify(x)); } };
const i = html.indexOf('function api(path, opts)'); let j = html.indexOf('{', i), d = 0, k = j;
for (; k < html.length; k++) { const c = html[k]; if (c === '{') d++; else if (c === '}') { d--; if (d === 0) break; } }
const src = html.slice(i, k + 1);
const seen = [];
const fakeFetch = (url, opts) => { const m = String((opts && opts.method) || 'GET').toUpperCase(); if ((m === 'GET' || m === 'HEAD') && opts && opts.body != null) return Promise.reject(new TypeError("Failed to execute 'fetch' on 'Window': Request with GET/HEAD method cannot have body.")); seen.push({ url, m, body: opts && opts.body }); return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }); };
const api = new Function('fetch', 'WORKER', 'SECRET', 'AbortController', 'setTimeout', 'clearTimeout', src + '\nreturn api;')(fakeFetch, 'https://w', 'tok', undefined, () => 0, () => {});
let r, err = null;
try { r = await api('GET', '/owner/tenant-roster', null); } catch (e) { err = e; }
t('GET with a null body (what the Tenants tab sends) goes out as a plain GET', !err && Array.isArray(r) && seen.length === 1 && seen[0].m === 'GET' && seen[0].body === undefined, { err: err && err.message, seen });
err = null; try { await api('GET', '/owner/tenant-roster'); } catch (e) { err = e; }
t('GET with no body still works', !err);
err = null; try { await api('POST', '/owner/tenant-roster/preview', { rows: [], consent: true }); } catch (e) { err = e; }
const post = seen[seen.length - 1];
t('POST still carries its JSON body', !err && post.m === 'POST' && post.body === JSON.stringify({ rows: [], consent: true }), { err: err && err.message, post });
err = null; try { await api('/owner-properties?owner_id=1'); } catch (e) { err = e; }
t('plain api(path) form still works', !err);
console.log(`owner-api-get-no-body: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
