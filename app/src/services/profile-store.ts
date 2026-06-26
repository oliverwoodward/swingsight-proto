/**
 * Persistence boundary for the user's {@link UserProfile}.
 *
 * Phase 1 backs this with `expo-secure-store` (device-local). Phase 2 swaps the
 * implementation for a Supabase-backed one **behind this same interface** so the
 * onboarding/capture UI never changes — that is the whole point of the seam.
 *
 * The store deals only in already-complete profiles: a profile is written once
 * onboarding finishes (handedness + view + consent all collected). Partial
 * onboarding state lives in memory (the onboarding draft), never here.
 */
import * as SecureStore from 'expo-secure-store';

import type { UserProfile } from '@/domain';
import { getSupabase } from '@/services/supabase';

export interface ProfileStore {
  /** Returns the stored profile, or null if onboarding has never completed. */
  load(): Promise<UserProfile | null>;
  /** Persists (creates or overwrites) the profile. */
  save(profile: UserProfile): Promise<void>;
  /** Removes the stored profile (e.g. a "start over" / sign-out path). */
  clear(): Promise<void>;
}

const STORAGE_KEY = 'swingsight.profile.v1';

/** Narrowing guard so a corrupt/legacy blob is treated as "no profile" rather than crashing. */
function isUserProfile(value: unknown): value is UserProfile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    (v.handedness === 'RH' || v.handedness === 'LH') &&
    (v.preferredView === 'face_on' || v.preferredView === 'dtl') &&
    typeof v.createdAt === 'string'
  );
}

export const secureStoreProfile: ProfileStore = {
  async load() {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw == null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isUserProfile(parsed) ? parsed : null;
    } catch {
      // Corrupt JSON — treat as no profile so the user re-onboards cleanly.
      return null;
    }
  },

  async save(profile) {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(profile));
  },

  async clear() {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};

// ---------------------------------------------------------------------------
// Supabase-backed profile store (Phase 2)
// ---------------------------------------------------------------------------

/** A `public.profiles` row as returned by PostgREST (snake_case). */
interface ProfileRow {
  id: string;
  handedness: 'RH' | 'LH';
  preferred_view: 'face_on' | 'dtl';
  consent_accepted_at: string | null;
  training_consent_accepted_at: string | null;
  created_at: string;
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    handedness: row.handedness,
    preferredView: row.preferred_view,
    consentAcceptedAt: row.consent_accepted_at,
    trainingConsentAcceptedAt: row.training_consent_accepted_at,
    createdAt: row.created_at,
  };
}

/**
 * Persists the {@link UserProfile} in the Supabase `profiles` table, partitioned
 * by the anonymous-auth user (RLS enforces `id = auth.uid()`). Drop-in for
 * {@link secureStoreProfile} — same {@link ProfileStore} interface, so the
 * onboarding/capture UI never changes.
 *
 * The caller mints `profile.id = auth.uid()` (see contexts/auth + profile), so the
 * row's PK matches the RLS partition key. `save` upserts; `clear` deletes the row
 * (the anonymous device user itself is kept).
 */
export function createSupabaseProfileStore(): ProfileStore {
  function requireClient() {
    const supabase = getSupabase();
    if (!supabase) {
      throw new Error('Supabase is not configured (EXPO_PUBLIC_SUPABASE_* missing)');
    }
    return supabase;
  }

  return {
    async load() {
      const supabase = requireClient();
      // RLS scopes this to the current user's single row.
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .maybeSingle<ProfileRow>();
      if (error) throw error;
      return data ? rowToProfile(data) : null;
    },

    async save(profile) {
      const supabase = requireClient();
      const { error } = await supabase.from('profiles').upsert(
        {
          id: profile.id,
          handedness: profile.handedness,
          preferred_view: profile.preferredView,
          consent_accepted_at: profile.consentAcceptedAt,
          training_consent_accepted_at: profile.trainingConsentAcceptedAt,
          created_at: profile.createdAt,
        },
        { onConflict: 'id' },
      );
      if (error) throw error;
    },

    async clear() {
      const supabase = requireClient();
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (!uid) return;
      const { error } = await supabase.from('profiles').delete().eq('id', uid);
      if (error) throw error;
    },
  };
}
