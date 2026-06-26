#!/usr/bin/env node
/**
 * Sync the golden-set manifest (worker/validation/golden_set.json) into the
 * `validation_set` table (spec §13.1 / §16.1) — the optional shared REGISTRY of the golden
 * set. The RUNNABLE source of truth is the manifest (the DB can't hold clip bytes and the
 * regression runner needs local files); this just mirrors the labels into the table so the
 * golden set is queryable server-side. Dependency-free (Node 18+ global fetch).
 *
 * `validation_set` is service-role only (RLS on, no policy), so this needs the SERVICE-ROLE
 * key — it is a hand-off step, like the worker redeploy:
 *   SUPABASE_URL=...  SUPABASE_SERVICE_ROLE_KEY=...  node supabase/scripts/sync-validation-set.mjs
 *
 * Get the key:  supabase projects api-keys --project-ref grhwgmloocegvgiccltp
 *
 * Idempotent: upserts by `label` (= the manifest swing id) — deletes any existing row with
 * that label, then inserts the current one. Non-destructive to unrelated rows. Never
 * uploads clips (raw_object_key stays null until a clip is pushed to R2 separately).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const MANIFEST =
  process.env.GOLDEN_SET ??
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'worker', 'validation', 'golden_set.json');

const die = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};

if (!SUPABASE_URL) die('SUPABASE_URL is required');
if (!SERVICE_KEY) die('SUPABASE_SERVICE_ROLE_KEY is required (validation_set is service-role only)');

const rest = `${SUPABASE_URL}/rest/v1/validation_set`;
const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const swings = manifest.swings ?? [];
if (swings.length === 0) die('golden set has no swings');

let upserted = 0;
for (const s of swings) {
  const label = s.id;
  // Upsert by label: delete any prior row with this label, then insert the current one.
  const delRes = await fetch(`${rest}?label=eq.${encodeURIComponent(label)}`, {
    method: 'DELETE',
    headers,
  });
  if (!delRes.ok && delRes.status !== 404) die(`delete ${label} failed: ${delRes.status} ${await delRes.text()}`);

  const row = {
    label,
    description: s.notes ?? null,
    view: s.view,
    handedness: s.handedness,
    raw_object_key: null, // clips are not uploaded by this script
    expected_primary_fault_id: s.expectedPrimaryFaultId ?? null,
    coach_labels: {
      labelSource: s.labelSource,
      labeledBy: s.labeledBy ?? null,
      labeledAt: s.labeledAt ?? null,
      expectedNoFault: s.expectedNoFault ?? false,
      metricGroundTruth: s.metricGroundTruth ?? {},
      clip: s.clip,
    },
  };
  const insRes = await fetch(rest, { method: 'POST', headers, body: JSON.stringify(row) });
  if (!insRes.ok) die(`insert ${label} failed: ${insRes.status} ${await insRes.text()}`);
  upserted += 1;
  console.log(`  ✓ ${label} (${s.labelSource})`);
}

console.log(`\n✓ synced ${upserted} golden swing(s) into validation_set\n`);
