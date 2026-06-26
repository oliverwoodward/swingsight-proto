/**
 * Privacy / data-rights actions (spec §21). Thin client wrappers over the
 * `export-data` and `delete-account` Edge Functions — the heavy lifting (R2 purge,
 * DB cascade) lives server-side where the secrets are. The device only ever sends its
 * own anonymous-auth JWT; both functions are RLS-scoped to `auth.uid()`.
 */
import { Share } from 'react-native';
import * as LegacyFS from 'expo-file-system/legacy';

import { getSupabase } from './supabase';

export interface ExportSummary {
  /** Number of swings included in the export bundle. */
  swings: number;
  /** Where the bundle was written on-device (so the caller can reference it). */
  fileUri: string;
}

/**
 * Pull the user's full data bundle (profile + swings + metrics + analysis + presigned
 * playback links), write it to a local file, and open the OS share sheet so they can save
 * or send it. Returns a small summary for the UI.
 */
export async function exportMyData(): Promise<ExportSummary> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Backend not configured');

  const { data, error } = await supabase.functions.invoke('export-data', { body: {} });
  if (error) throw new Error(error.message ?? 'export failed');

  const bundle = (data ?? {}) as { swings?: unknown[] };
  const fileUri = `${LegacyFS.cacheDirectory ?? ''}swingsight-export.json`;
  await LegacyFS.writeAsStringAsync(fileUri, JSON.stringify(data, null, 2));

  // Best-effort share — the export still succeeded even if the user dismisses the sheet.
  try {
    await Share.share({ url: fileUri, title: 'SwingSight data export' });
  } catch {
    /* user dismissed the share sheet */
  }

  return { swings: Array.isArray(bundle.swings) ? bundle.swings.length : 0, fileUri };
}

export interface DeleteSummary {
  objectsDeleted: number;
  objectsFailed: number;
}

/**
 * Delete the user's account and all their data — DB rows (cascade) and R2 objects. After a
 * successful server delete we sign the (now-invalid) session out so the next launch mints a
 * fresh anonymous user. The caller is responsible for wiping the local profile + routing to
 * onboarding.
 */
export async function deleteMyData(): Promise<DeleteSummary> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Backend not configured');

  const { data, error } = await supabase.functions.invoke('delete-account', { body: {} });
  if (error) throw new Error(error.message ?? 'delete failed');

  const result = (data ?? {}) as { objectsDeleted?: number; objectsFailed?: string[] };

  // The auth user is gone server-side; clear the local session so we don't keep a dead JWT.
  try {
    await supabase.auth.signOut();
  } catch {
    /* session already invalid */
  }

  return {
    objectsDeleted: result.objectsDeleted ?? 0,
    objectsFailed: (result.objectsFailed ?? []).length,
  };
}
