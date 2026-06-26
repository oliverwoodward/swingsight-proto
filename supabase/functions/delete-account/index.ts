// delete-account — the user-facing "delete my data" action (spec §21 right to deletion).
//
// The device calls this with its anonymous-auth JWT. We:
//   1. enumerate the caller's OWN R2 object keys (raw clips, playback clips, keyframe
//      JPEGs) from their rows UNDER RLS — so we can only ever see/delete this user's data;
//   2. delete those objects from R2 (the bucket is private; the R2 secret never leaves
//      this function);
//   3. delete the auth user with the service role, which CASCADES through the schema
//      (auth.users → profiles → swing_analyses → metrics/keyframes/keypoints/drill_recheck),
//      removing every database row the user owns.
//
// Order matters: we read the object keys BEFORE deleting the rows, or we'd lose them.
// R2 deletion is best-effort and reported honestly: if an object delete fails, the DB rows
// are still removed (the account is gone) and any orphan object is bounded by the R2
// lifecycle rules (raw 2d / frames 7d / playback 30d). No identifiable data is sent anywhere
// external; this only deletes.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function r2Endpoint(): string {
  const explicit = Deno.env.get('R2_ENDPOINT');
  if (explicit) return explicit.replace(/\/$/, '');
  return `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization' }, 401);

  // --- authenticate the device user (RLS-scoped client) ---
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'invalid session' }, 401);
  const userId = userData.user.id;

  // --- 1. enumerate THIS user's R2 object keys (RLS restricts both selects to them) ---
  const objectKeys = new Set<string>();

  const { data: analyses, error: aErr } = await userClient
    .from('swing_analyses')
    .select('raw_object_key, playback_video_url');
  if (aErr) return json({ error: 'could not read analyses' }, 500);
  for (const row of analyses ?? []) {
    if (row.raw_object_key) objectKeys.add(row.raw_object_key as string);
    if (row.playback_video_url) objectKeys.add(row.playback_video_url as string);
  }

  const { data: keyframes, error: kErr } = await userClient
    .from('swing_keyframes')
    .select('frame_object_key');
  if (kErr) return json({ error: 'could not read keyframes' }, 500);
  for (const row of keyframes ?? []) {
    if (row.frame_object_key) objectKeys.add(row.frame_object_key as string);
  }

  // --- 2. delete the R2 objects (best-effort; report failures honestly) ---
  const aws = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto',
    service: 's3',
  });
  const bucket = env('R2_BUCKET');
  const endpoint = r2Endpoint();

  let objectsDeleted = 0;
  const objectsFailed: string[] = [];
  for (const key of objectKeys) {
    try {
      const res = await aws.fetch(`${endpoint}/${bucket}/${encodeURI(key)}`, { method: 'DELETE' });
      // R2/S3 return 204 on delete, and 200/204 even if the key was already gone.
      if (res.ok || res.status === 404) objectsDeleted += 1;
      else objectsFailed.push(key);
    } catch {
      objectsFailed.push(key);
    }
  }

  // --- 3. delete the auth user with the service role -> DB cascade removes every row ---
  const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    // The R2 objects are already gone; surface that the DB delete needs a retry.
    return json(
      {
        error: 'account row deletion failed; please retry',
        detail: delErr.message,
        objectsDeleted,
        objectsFailed,
      },
      500,
    );
  }

  return new Response(
    JSON.stringify({
      deleted: true,
      objectsDeleted,
      objectsFailed,
      note:
        objectsFailed.length > 0
          ? 'account and database rows deleted; some storage objects will be removed by the R2 lifecycle rules'
          : 'account, database rows, and storage objects deleted',
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
