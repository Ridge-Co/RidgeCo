// Owner Scheduled notification (Sep 15 2026) — real gap found live-testing: nothing in this
// codebase ever sets Work_Orders.Status to the literal 'Scheduled' (scheduling only ever
// touches Scheduled_Date/Scheduled_Window via scheduleWO, independent of Status), so the
// owner-scheduled notification — wired into updateStatus, gated on body.status==='Scheduled'
// — was permanently unreachable. This test locks in the fix structurally: the trigger now
// lives in scheduleWO itself, and updateStatus's OWNER_STATUS_EVENTS map no longer references
// 'Scheduled' at all (removed, not left as harmless dead code, specifically to prevent a
// future double-send if something ever did post status:'Scheduled').
import fs from 'fs';
import assert from 'node:assert';
const src = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
function grabAsync(name) {
  const i = src.indexOf('async function ' + name + '(');
  if (i < 0) throw new Error('missing ' + name);
  let d = 0, j = src.indexOf('{', src.indexOf(')', i));
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) break; } }
  return src.slice(i, j + 1);
}

let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

{
  const src2 = src;
  ok(!/Status\s*[=:]\s*'Scheduled'/.test(src2), "confirms the underlying bug premise: Work_Orders.Status is never literally set to 'Scheduled' anywhere in worker.js — if this ever starts failing, re-check whether OWNER_STATUS_EVENTS should get 'Scheduled' back");
}

const scheduleBody = grabAsync('scheduleWO');
{
  ok(scheduleBody.includes("message_type: 'owner_job_scheduled'"), 'scheduleWO sends owner_job_scheduled directly — the real, reachable trigger point');
  ok(scheduleBody.includes("shouldNotifyOwner(env, wo, 'Scheduled')"), "scheduleWO checks the owner's notify tier for the 'Scheduled' event before sending");
  ok(scheduleBody.includes('owner_sms'), 'the /schedule response reports owner_sms so a caller (or a live test) can verify it actually happened');
}
{
  // Owner notification should NOT be gated behind notify_tenant — an owner's own preference
  // isn't tied to whether the tenant-notify toggle happens to be on for this particular call.
  const tenantBlockStart = scheduleBody.indexOf('if(body.notify_tenant');
  const ownerSendIdx = scheduleBody.indexOf("message_type: 'owner_job_scheduled'");
  const tenantBlockEnd = scheduleBody.indexOf('\n  }', tenantBlockStart); // rough end of the notify_tenant if-block
  ok(ownerSendIdx > tenantBlockEnd, 'the owner-scheduled send sits outside (after) the notify_tenant conditional block, not nested inside it');
}

const statusBody = grabAsync('updateStatus');
{
  ok(!statusBody.includes('Scheduled:') || !statusBody.includes('OWNER_STATUS_EVENTS'), 'sanity: if OWNER_STATUS_EVENTS still exists in updateStatus, it must not map Scheduled anymore');
  const mapMatch = statusBody.match(/OWNER_STATUS_EVENTS\s*=\s*\{([^}]*)\}/);
  ok(mapMatch && !/\bScheduled\s*:/.test(mapMatch[1]), "OWNER_STATUS_EVENTS in updateStatus no longer maps 'Scheduled' — removed, not left as dead/defensive code, to avoid a future double-send");
  ok(mapMatch && /Complete\s*:/.test(mapMatch[1]) && /'On Hold'\s*:/.test(mapMatch[1]), 'Complete and On Hold mappings are still intact in updateStatus — only Scheduled moved');
}

console.log(`owner-scheduled-fix: ${n}/${n} passing`);
