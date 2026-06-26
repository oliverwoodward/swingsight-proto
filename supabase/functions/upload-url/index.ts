// upload-url — mint a short-lived R2 presigned upload URL (spec §6.2, §21).
//
// The device calls this with its anonymous-auth JWT (verify_jwt = true). We read
// the authenticated auth.uid(), build a raw-clip object key SERVER-SIDE under that
// uid (so a client can never target another user's key), and return a presigned
// S3 PUT URL with a 15-minute expiry. R2 buckets are private; the presigned URL is
// the only credential the device ever sees — the R2 secret stays in this function.
//
// Phase 2 ships single-shot PUT (what the checkpoint script and a small clip need).
// Resumable multipart/TUS for large clips is wired app-side in Phase 4 on top of
// the same S3 endpoint; this function gains a multipart branch then.

import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2.108.2';
import { corsHeaders, json, preflight } from '../_shared/cors.ts';

const EXPIRY_SECONDS = 15 * 60; // spec §21: presigned URLs, 15-minute expiry

interface UploadUrlRequest {
  /** Optional client-supplied analysis id to name the object; else a uuid. */
  analysisId?: string;
  /** File extension without the dot (default 'mov'). */
  ext?: string;
  /** MIME type the device will PUT with (default video/quicktime). */
  contentType?: string;
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

/** Conservative object-key segment sanitiser (defends the key path). */
function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '');
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
  const uid = userData.user.id;

  // --- parse the (optional) request body ---
  let body: UploadUrlRequest = {};
  if (req.headers.get('content-length') !== '0') {
    try {
      body = (await req.json()) as UploadUrlRequest;
    } catch {
      body = {};
    }
  }
  const ext = safeSegment(body.ext ?? 'mov') || 'mov';
  const contentType = body.contentType ?? 'video/quicktime';
  const objectName = body.analysisId ? safeSegment(body.analysisId) : crypto.randomUUID();
  // Prefix `raw/` so the R2 lifecycle rule can auto-delete raws after processing,
  // and `/{uid}/` partitions every device's objects.
  const objectKey = `raw/${uid}/${objectName}.${ext}`;

  // --- presign the S3 PUT (R2 speaks S3; region 'auto') ---
  const aws = new AwsClient({
    accessKeyId: env('R2_ACCESS_KEY_ID'),
    secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    region: 'auto',
    service: 's3',
  });

  const url = new URL(`${r2Endpoint()}/${env('R2_BUCKET')}/${objectKey}`);
  url.searchParams.set('X-Amz-Expires', String(EXPIRY_SECONDS));

  const signed = await aws.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true },
  });

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString();

  return new Response(
    JSON.stringify({
      uploadUrl: signed.url,
      method: 'PUT',
      objectKey,
      contentType,
      expiresAt,
      // The device PUTs the bytes with this header set; nothing else is required.
      headers: { 'Content-Type': contentType },
    }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
