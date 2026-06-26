#!/usr/bin/env node
/**
 * Phase 2 checkpoint — prove the upload + orchestration wiring end to end with a
 * REAL clip, no app build required. Dependency-free (Node 18+ global fetch).
 *
 * It exercises exactly the path the app will take in Phase 4:
 *   1. anonymous sign-in (each device = its own RLS user)
 *   2. ask the `upload-url` Edge Function for a presigned R2 PUT URL
 *   3. PUT the real clip straight to R2 (private bucket; the URL is the only cred)
 *   4. upsert the profile row, insert a swing_analyses row (status `uploading`)
 *   5. flip it to `queued` with the raw_object_key set
 *      → the DB webhook fires `on-swing-insert` → POST worker /analyze
 *
 * Usage:
 *   SUPABASE_URL=...  SUPABASE_ANON_KEY=...  SAMPLE_CLIP=/path/to/clip.mov \
 *     node supabase/scripts/checkpoint-upload.mjs
 *
 * Local stack: read SUPABASE_URL / SUPABASE_ANON_KEY from `supabase status`.
 * A real sample swing exists at ~/Code/Swing_Prototype/data/videos/IMG_5736.mov.
 *
 * Verifying the webhook actually fired (worker returns 501 until Phase 3 — that
 * still proves the wiring):
 *   • Hosted:  supabase functions logs on-swing-insert   → "worker /analyze -> 501"
 *   • Either:  SQL (service role):
 *       select status_code, content from net._http_response order by id desc limit 5;
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SAMPLE_CLIP =
  process.env.SAMPLE_CLIP ??
  `${homedir()}/Code/Swing_Prototype/data/videos/IMG_5736.mov`;
const VIEW = process.env.VIEW ?? 'face_on'; // 'face_on' | 'dtl'
const HANDEDNESS = process.env.HANDEDNESS ?? 'RH'; // 'RH' | 'LH'

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}
function step(msg) {
  console.log(`\n→ ${msg}`);
}
function ok(msg) {
  console.log(`  ✓ ${msg}`);
}

if (!SUPABASE_URL || !ANON_KEY) {
  die('Set SUPABASE_URL and SUPABASE_ANON_KEY (see `supabase status` for the local stack).');
}

const baseHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };

async function main() {
  // 0. Load the real clip.
  step(`Reading sample clip: ${SAMPLE_CLIP}`);
  let clip;
  try {
    clip = await readFile(SAMPLE_CLIP);
  } catch {
    die(`Could not read SAMPLE_CLIP at ${SAMPLE_CLIP}. Pass SAMPLE_CLIP=/path/to/clip.mov`);
  }
  ok(`${(clip.length / 1_000_000).toFixed(1)} MB`);

  // 1. Anonymous sign-in.
  step('Anonymous sign-in');
  const signInRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify({ data: {}, gotrue_meta_security: {} }),
  });
  if (!signInRes.ok) die(`anonymous sign-in failed: ${signInRes.status} ${await signInRes.text()}`);
  const session = await signInRes.json();
  const accessToken = session.access_token;
  const uid = session.user?.id;
  if (!accessToken || !uid) die('sign-in returned no session/user (is anonymous auth enabled?)');
  ok(`uid ${uid}`);

  const authHeaders = { ...baseHeaders, Authorization: `Bearer ${accessToken}` };

  // 2. Presigned upload URL from the Edge Function.
  step('Requesting presigned upload URL (upload-url)');
  const urlRes = await fetch(`${SUPABASE_URL}/functions/v1/upload-url`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ext: 'mov', contentType: 'video/quicktime' }),
  });
  if (!urlRes.ok) die(`upload-url failed: ${urlRes.status} ${await urlRes.text()}`);
  const { uploadUrl, objectKey, contentType } = await urlRes.json();
  if (!uploadUrl || !objectKey) die('upload-url returned no uploadUrl/objectKey');
  ok(`objectKey ${objectKey}`);

  // 3. PUT the real clip to R2.
  step('Uploading clip to R2 via the presigned URL');
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType ?? 'video/quicktime' },
    body: clip,
  });
  if (!putRes.ok) die(`R2 PUT failed: ${putRes.status} ${await putRes.text()}`);
  ok(`R2 responded ${putRes.status}${putRes.headers.get('etag') ? ` (etag ${putRes.headers.get('etag')})` : ''}`);

  // 4. Upsert the profile (FK target for swing_analyses) + insert the analysis.
  step('Upserting profile row');
  const profRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=id`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: uid,
      handedness: HANDEDNESS,
      preferred_view: VIEW,
      consent_accepted_at: new Date().toISOString(),
    }),
  });
  if (!profRes.ok) die(`profile upsert failed: ${profRes.status} ${await profRes.text()}`);
  ok('profile ready');

  step('Inserting swing_analyses row (status uploading)');
  const insRes = await fetch(`${SUPABASE_URL}/rest/v1/swing_analyses`, {
    method: 'POST',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({
      profile_id: uid,
      view: VIEW,
      handedness: HANDEDNESS,
      raw_object_key: objectKey,
      status: 'uploading',
    }),
  });
  if (!insRes.ok) die(`insert failed: ${insRes.status} ${await insRes.text()}`);
  const [row] = await insRes.json();
  ok(`analysis ${row.id}`);

  // 5. Flip to queued → fires the DB webhook → on-swing-insert → worker /analyze.
  step('Advancing status to queued (fires the worker webhook)');
  const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/swing_analyses?id=eq.${row.id}`, {
    method: 'PATCH',
    headers: { ...authHeaders, Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'queued' }),
  });
  if (!patchRes.ok) die(`status update failed: ${patchRes.status} ${await patchRes.text()}`);
  const [queued] = await patchRes.json();
  ok(`status = ${queued.status}`);

  console.log(`
✅ Checkpoint upload succeeded.
   analysis_id : ${row.id}
   object_key  : ${objectKey}

   The queued row fired the DB webhook → on-swing-insert → worker /analyze.
   Confirm the webhook reached the worker (501 until Phase 3 is deployed — that
   still proves the wiring):
     • Hosted: supabase functions logs on-swing-insert   → "worker /analyze -> 501"
     • SQL (service role):
         select status_code, content from net._http_response order by id desc limit 5;
`);
}

main().catch((e) => die(e?.stack ?? String(e)));
