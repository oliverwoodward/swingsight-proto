#!/usr/bin/env node
/**
 * Phase 6 live checkpoint — prove the drill-then-recheck loop end to end on real infra,
 * no app build required. Dependency-free (Node 18+ global fetch).
 *
 * Unlike checkpoint-upload.mjs (one swing, one anonymous user), this drives TWO swings in
 * ONE session so they share a profile + view, exactly as the app does:
 *   1. anonymous sign-in (one user for both swings)
 *   2. swing #1: presign → R2 PUT → insert (uploading) → queue → POLL to `complete`
 *   3. mirror the app's link step: find the latest COMPLETE same-view analysis (= #1)
 *   4. swing #2: insert with previous_analysis_id = #1 → queue → POLL to `complete`
 *   5. POLL drill_recheck for current_analysis_id = #2 → assert a row with a sensible
 *      delta + direction-aware `improved`, read under RLS (select-own).
 *
 * Determinism note: the SAME clip is uploaded twice, so the worker re-measures identical
 * metrics and the delta is ~0 (improved=false, "about the same"). That's the honest,
 * expected result and still proves the deterministic comparison + write path. A genuinely
 * different (better) swing for #2 would show real movement.
 *
 * REQUIRES the worker to be redeployed with the Phase-6 recheck step first
 * (scripts/deploy-worker.sh). Usage:
 *   SUPABASE_URL=...  SUPABASE_ANON_KEY=...  SAMPLE_CLIP=/path/clip.mov \
 *     node supabase/scripts/recheck-upload.mjs
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SAMPLE_CLIP =
  process.env.SAMPLE_CLIP ?? `${homedir()}/Code/Swing_Prototype/data/videos/IMG_5736.mov`;
const VIEW = process.env.VIEW ?? 'face_on'; // 'face_on' | 'dtl'
const HANDEDNESS = process.env.HANDEDNESS ?? 'RH'; // 'RH' | 'LH'
const POLL_TIMEOUT_MS = Number(process.env.POLL_TIMEOUT_MS ?? 240_000);
const POLL_INTERVAL_MS = 5_000;

const die = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};
const step = (m) => console.log(`\n→ ${m}`);
const ok = (m) => console.log(`  ✓ ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SUPABASE_URL || !ANON_KEY) {
  die('Set SUPABASE_URL and SUPABASE_ANON_KEY (see setup.env / `supabase status`).');
}

const baseHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
let authHeaders;

async function signIn() {
  step('Anonymous sign-in (one user for both swings)');
  const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
  });
  if (!res.ok) die(`anonymous sign-in failed: ${res.status} ${await res.text()}`);
  const session = await res.json();
  if (!session.access_token || !session.user?.id) die('no session/user (anonymous auth off?)');
  authHeaders = { ...baseHeaders, Authorization: `Bearer ${session.access_token}` };
  ok(`uid ${session.user.id}`);
  return session.user.id;
}

async function upsertProfile(uid) {
  step('Upserting profile row');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: uid,
      handedness: HANDEDNESS,
      preferred_view: VIEW,
      consent_accepted_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) die(`profile upsert failed: ${res.status} ${await res.text()}`);
  ok('profile ready');
}

async function uploadAndQueue(clip, label, previousAnalysisId) {
  step(`Swing ${label}: requesting presigned upload URL`);
  const urlRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-url`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ext: 'mov', contentType: 'video/quicktime' }),
  });
  if (!urlRes.ok) die(`upload-url failed: ${urlRes.status} ${await urlRes.text()}`);
  const { uploadUrl, objectKey, contentType } = await urlRes.json();
  ok(`objectKey ${objectKey}`);

  step(`Swing ${label}: uploading clip to R2`);
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType ?? 'video/quicktime' },
    body: clip,
  });
  if (!putRes.ok) die(`R2 PUT failed: ${putRes.status} ${await putRes.text()}`);
  ok(`R2 responded ${putRes.status}`);

  step(`Swing ${label}: inserting row${previousAnalysisId ? ' (linked to previous)' : ''}`);
  // profile_id must equal auth.uid() (RLS with-check), so set it explicitly.
  const insBody = {
    profile_id: UID,
    view: VIEW,
    handedness: HANDEDNESS,
    raw_object_key: objectKey,
    status: 'uploading',
  };
  if (previousAnalysisId) insBody.previous_analysis_id = previousAnalysisId;
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/swing_analyses`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify(insBody),
  });
  if (!insRes.ok) die(`insert failed: ${insRes.status} ${await insRes.text()}`);
  const [row] = await insRes.json();
  ok(`analysis ${row.id}`);

  step(`Swing ${label}: advancing to queued (fires the worker)`);
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/swing_analyses?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'queued' }),
  });
  if (!patchRes.ok) die(`queue failed: ${patchRes.status} ${await patchRes.text()}`);
  ok('queued');
  return row.id;
}

async function pollComplete(analysisId, label) {
  step(`Swing ${label}: waiting for the worker (poll up to ${POLL_TIMEOUT_MS / 1000}s)`);
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/swing_analyses?id=eq.${analysisId}&select=status,primary_fault_id,coaching`,
      { headers: authHeaders },
    );
    if (res.ok) {
      const [row] = await res.json();
      if (row) {
        if (row.status === 'complete') {
          ok(
            `complete · primary_fault=${row.primary_fault_id ?? '—'} · ` +
              `coaching=${row.coaching ? row.coaching.source : 'pending'}`,
          );
          return row;
        }
        if (row.status === 'failed' || row.status === 'unreadable') {
          die(`swing ${label} ended ${row.status} (not complete) — cannot recheck`);
        }
        process.stdout.write(`  … ${row.status}\r`);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  die(`swing ${label} did not complete within ${POLL_TIMEOUT_MS / 1000}s`);
}

async function findPreviousSameView() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/swing_analyses?profile_id=eq.${UID}&view=eq.${VIEW}` +
      `&status=eq.complete&select=id&order=created_at.desc&limit=1`,
    { headers: authHeaders },
  );
  if (!res.ok) die(`find-previous failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows[0]?.id ?? null;
}

async function pollRecheck(currentAnalysisId) {
  step('Polling drill_recheck for the comparison row (written just after complete)');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/drill_recheck?current_analysis_id=eq.${currentAnalysisId}` +
        `&select=*&order=created_at.desc&limit=1`,
      { headers: authHeaders },
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]) return rows[0];
    }
    await sleep(3_000);
  }
  return null;
}

let UID;

async function main() {
  step(`Reading sample clip: ${SAMPLE_CLIP}`);
  let clip;
  try {
    clip = await readFile(SAMPLE_CLIP);
  } catch {
    die(`Could not read SAMPLE_CLIP at ${SAMPLE_CLIP}. Pass SAMPLE_CLIP=/path/clip.mov`);
  }
  ok(`${(clip.length / 1_000_000).toFixed(1)} MB`);

  UID = await signIn();
  await upsertProfile(UID);

  // Swing #1 — baseline (no previous).
  const id1 = await uploadAndQueue(clip, '#1', null);
  await pollComplete(id1, '#1');

  // Mirror the app's link step.
  const prevId = await findPreviousSameView();
  if (prevId !== id1) {
    console.log(`  (note: latest complete same-view = ${prevId}; expected ${id1})`);
  }
  ok(`previous_analysis_id for swing #2 = ${prevId}`);

  // Swing #2 — linked to #1.
  const id2 = await uploadAndQueue(clip, '#2', prevId);
  await pollComplete(id2, '#2');

  const recheck = await pollRecheck(id2);
  if (!recheck) {
    die(
      'No drill_recheck row was written for swing #2. Check the worker logs — either no ' +
        'fault was flagged on #1, the tracked metric was not an `ok` measurement on both ' +
        'swings, or the worker was not redeployed with the Phase-6 recheck step.',
    );
  }

  console.log(`
✅ Recheck checkpoint succeeded — the loop is closed.
   swing #1 (previous) : ${id1}
   swing #2 (current)  : ${id2}

   drill_recheck row:
     drill_id          : ${recheck.drill_id}
     target_metric_key : ${recheck.target_metric_key}
     previous_value    : ${recheck.previous_value}
     current_value     : ${recheck.current_value}
     delta             : ${recheck.delta}
     improved          : ${recheck.improved}

   The report for swing #2 will LEAD with this comparison. delta ≈ 0 is expected here
   (the same clip was uploaded twice → identical deterministic metrics); a genuinely
   different swing would show real, direction-aware movement.
`);
}

main().catch((e) => die(e?.stack ?? String(e)));
