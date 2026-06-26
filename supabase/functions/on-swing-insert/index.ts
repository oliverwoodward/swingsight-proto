// on-swing-insert — DB-webhook → Cloud Run worker bridge (spec §7.2 step 4).
//
// The database trigger (pg_net) calls this when a swing_analyses row is queued
// with its raw clip uploaded. We authenticate the webhook via a shared secret
// (this function runs with verify_jwt = false), translate the row into the
// worker's AnalyzeRequest contract, and POST the Cloud Run worker /analyze with a
// bearer invoker token. The worker (Phase 3) downloads the raw clip and runs the
// pipeline; until then it returns 501 — which still proves the whole wiring.
//
// Worker contract (worker/src/swingsight_worker/main.py AnalyzeRequest):
//   { analysis_id, profile_id, view, handedness, raw_object_key, previous_analysis_id? }

import { json } from '../_shared/cors.ts';

interface SwingAnalysesRow {
  id: string;
  profile_id: string;
  view: string;
  handedness: string;
  raw_object_key: string | null;
  previous_analysis_id: string | null;
  status: string;
}

interface WebhookPayload {
  type: string;
  table: string;
  record: SwingAnalysesRow;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // --- authenticate the webhook (shared secret set by the DB trigger) ---
  const expectedSecret = Deno.env.get('ON_SWING_INSERT_SECRET');
  if (expectedSecret) {
    const got = req.headers.get('x-webhook-secret');
    if (got !== expectedSecret) {
      return json({ error: 'unauthorized webhook' }, 401);
    }
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const row = payload?.record;
  if (!row?.id || !row.raw_object_key) {
    // Nothing to dispatch (e.g. still `uploading`); ack so pg_net doesn't retry.
    return json({ skipped: true, reason: 'no raw_object_key yet' }, 200);
  }

  const workerUrl = Deno.env.get('WORKER_URL');
  if (!workerUrl) {
    console.log('on-swing-insert: WORKER_URL not set; skipping dispatch for', row.id);
    return json({ skipped: true, reason: 'WORKER_URL not configured' }, 200);
  }

  // Exactly the worker's AnalyzeRequest shape.
  const analyzeRequest = {
    analysis_id: row.id,
    profile_id: row.profile_id,
    view: row.view,
    handedness: row.handedness,
    raw_object_key: row.raw_object_key,
    previous_analysis_id: row.previous_analysis_id ?? null,
  };

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const invokerToken = Deno.env.get('WORKER_INVOKER_TOKEN');
  if (invokerToken) headers['Authorization'] = `Bearer ${invokerToken}`;

  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify(analyzeRequest),
    });
    const text = await res.text();
    console.log(`on-swing-insert: worker /analyze -> ${res.status} for ${row.id}`);

    // 501 = worker skeleton (Phase 3 not built yet): wiring is proven, not an error.
    if (res.status === 501) {
      return json({ dispatched: true, worker_status: 501, note: 'worker skeleton (Phase 3 pending)' }, 200);
    }
    return json({ dispatched: res.ok, worker_status: res.status, worker_body: text }, res.ok ? 200 : 502);
  } catch (err) {
    console.error('on-swing-insert: worker dispatch failed', err);
    return json({ dispatched: false, error: String(err) }, 502);
  }
});
