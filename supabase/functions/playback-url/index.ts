// playback-url — mint a short-lived presigned R2 GET for the report's playback clip.
//
// The worker stores `playback_video_url` as an R2 OBJECT KEY (the bucket is private),
// not a URL. The report screen calls this with the device's anonymous-auth JWT; we read
// the authenticated auth.uid(), look up the analysis row UNDER RLS (so a client can only
// ever resolve its own clip), take the object key from that row SERVER-SIDE, and return a
// presigned S3 GET. The R2 secret never leaves this function.
//
// Symmetric to upload-url (same SigV4 / aws4fetch pattern, same R2 endpoint resolution).
// The expiry is longer than upload-url's 15 min: a golfer scrubs/replays the report for a
// while and expo-video re-issues range requests, so a too-short URL would break mid-watch.
// Still short-lived (1 h) and far inside the playback object's 30-day lifecycle window.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';

const EXPIRY_SECONDS = 60 * 60; // 1 hour — long enough to watch/scrub, still short-lived

interface PlaybackUrlRequest {
  /** The swing_analyses row id to fetch the playback clip for. */
  analysisId: string;
}

function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

/** Resolve the R2 S3 endpoint (EU jurisdiction supported via explicit R2_ENDPOINT). */
function r2Endpoint(): string {
  const explicit = Deno.env.get('R2_ENDPOINT');
  if (explicit) return explicit.replace(/\/$/, '');
  return `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // --- authenticate the device user (JWT already verified by the platform) ---
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'missing Authorization' }, 401);

  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'invalid session' }, 401);

  // --- parse the request ---
  let body: PlaybackUrlRequest;
  try {
    body = (await req.json()) as PlaybackUrlRequest;
  } catch {
    return json({ error: 'invalid json body' }, 400);
  }
  if (!body.analysisId) return json({ error: 'analysisId required' }, 400);

  // --- resolve the object key SERVER-SIDE from the user's own row (RLS-scoped) ---
  // The query runs under the user's JWT, so RLS already restricts it to their analyses;
  // a wrong/foreign id simply returns no row.
  const { data: row, error: rowErr } = await supabase
    .from('swing_analyses')
    .select('playback_video_url, status')
    .eq('id', body.analysisId)
    .maybeSingle<{ playback_video_url: string | null; status: string }>();

  if (rowErr) return json({ error: 'lookup failed' }, 500);
  if (!row) return json({ error: 'analysis not found' }, 404);
  if (!row.playback_video_url) {
    return json({ error: 'playback clip not ready', status: row.status }, 409);
  }
  const objectKey = row.playback_video_url;

  // --- presign the S3 GET (R2 speaks S3; region 'auto') ---
  const aws = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto',
    service: 's3',
  });

  const url = new URL(`${r2Endpoint()}/${env('R2_BUCKET')}/${objectKey}`);
  url.searchParams.set('X-Amz-Expires', String(EXPIRY_SECONDS));

  const signed = await aws.sign(url.toString(), {
    method: 'GET',
    aws: { signQuery: true },
  });

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString();

  return new Response(
    JSON.stringify({ url: signed.url, method: 'GET', objectKey, expiresAt }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
