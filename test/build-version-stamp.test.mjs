// Oct 21 2026: BUILD_VERSION is a frozen base; the version portals see is stamped by Cloudflare at deploy time.
// Why: every PR used to edit the one BUILD_VERSION line, so any two open PRs conflicted. This pins the new design.
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const toml = fs.readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// 1) the Cloudflare binding is declared (without it every deploy would look identical to the portals)
ok(/^\[version_metadata\]\s*\nbinding\s*=\s*"CF_VERSION_METADATA"/m.test(toml), 'wrangler.toml declares [version_metadata] binding CF_VERSION_METADATA');

// 2) the base literal keeps the old format (older tests and the deploy checks read it) and says not to edit it
const lit = /const BUILD_VERSION = '(\d{4}-\d{2}-\d{2}\.\d+-[a-z0-9-]+)';/.exec(src);
ok(!!lit, 'BUILD_VERSION base literal keeps the YYYY-MM-DD.N-name format');
ok(/FROZEN BASE LABEL\. DO NOT EDIT IT IN A PR/.test(src), 'the comment above BUILD_VERSION says not to edit it');

// 3) buildVersion(): stamped and unstamped behaviour, pulled out of the real worker.js
const i = src.indexOf('function buildVersion(env)'), j = src.indexOf('function buildVersionJson(');
ok(i > 0 && j > i, 'buildVersion() exists in worker.js');
const BUILD_VERSION = lit[1];
const buildVersion = new Function('BUILD_VERSION', src.slice(i, j) + '; return buildVersion;')(BUILD_VERSION);
const a = buildVersion({ CF_VERSION_METADATA: { id: 'aaaaaaaa-1111-2222-3333-444444444444', timestamp: '2026-10-21T16:30:12.345Z' } });
ok(a.stamped === true && a.version === BUILD_VERSION + '+202610211630.aaaaaaaa', 'stamped version = base + deploy minute + first 8 of the version id: ' + a.version);
ok(a.version_id === 'aaaaaaaa-1111-2222-3333-444444444444' && a.deployed_at === '2026-10-21T16:30:12.345Z' && a.base === BUILD_VERSION, 'stamped answer carries id, deploy time, base');
const b = buildVersion({ CF_VERSION_METADATA: { id: 'bbbbbbbb-1111-2222-3333-444444444444', timestamp: '2026-10-21T16:31:00.000Z' } });
ok(a.version !== b.version, 'two different deploys give two different versions (that is what makes open portals refresh)');
const c = buildVersion({});
ok(c.stamped === false && c.version === BUILD_VERSION + '+unstamped', 'no binding -> "+unstamped", never a throw');
ok(buildVersion(undefined).stamped === false && buildVersion({ CF_VERSION_METADATA: {} }).stamped === false && buildVersion({ CF_VERSION_METADATA: { id: 'zzzzzzzzzz' } }).version.startsWith(BUILD_VERSION + '+x.'), 'missing/odd metadata never throws');

// 4) NOT SILENT: an unstamped Worker says so in the /version answer and files one failure-ledger row per isolate
const k = src.slice(j, src.indexOf('\n}\n', j) + 3);
ok(/stamped/.test(k) && /warning: 'unstamped/.test(k), '/version carries a warning when unstamped');
ok(/reportFailure\(env, \{[^}]*where: 'build_version_unstamped'/.test(k) && /__unstampedReported/.test(k), 'unstamped files ONE failure-ledger row per isolate (build_version_unstamped)');

// 5) the two version endpoints use the stamped version; nothing else answers /version with the bare base
ok(/path === '\/version'\)\s*return buildVersionJson\(env, ctx\)/.test(src), 'GET /version is stamped');
ok(/case 'version': return json\(\{ version: buildVersion\(env\)\.version \}\)/.test(src), 'selftest version is stamped');
ok(!/json\(\{ version: BUILD_VERSION \}\)/.test(src), 'no endpoint answers with the bare base any more');

// 6) real worker run: the real fetch handler answers /version with the stamp (no Sheets needed)
const mod = await import('../worker.js');
const env = { CF_VERSION_METADATA: { id: 'cccccccc-1111-2222-3333-444444444444', timestamp: '2026-10-21T17:00:00.000Z' } };
const res = await mod.default.fetch(new Request('https://hub.test/version'), env, { waitUntil() {} });
const body = await res.json();
ok(res.status === 200 && body.stamped === true && /\+202610211700\.cccccccc$/.test(body.version), 'the real Worker answers GET /version with the deploy stamp: ' + body.version);
console.log('build-version-stamp: ' + n + ' checks passed');
