/**
 * Supabase client for the device (Phase 2).
 *
 * The app only ever holds the project URL + anon key (EXPO_PUBLIC_* — public by
 * design). The service-role key, R2 secrets and Anthropic key live only in the
 * worker / Edge Functions, never here.
 *
 * Auth is anonymous: each device is its own RLS-partitioned user. The session
 * (incl. the refresh token) is persisted in the iOS keychain via expo-secure-store,
 * chunked because a Supabase session can exceed SecureStore's ~2KB per-item limit.
 *
 * If the EXPO_PUBLIC_SUPABASE_* env vars are absent (e.g. before the backend is
 * provisioned) this module reports "not configured" and the app falls back to the
 * Phase-1 local profile store — so the dev build keeps working pre-provisioning.
 */
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True once the backend env is wired (set during provisioning). */
export const isSupabaseConfigured =
  typeof SUPABASE_URL === 'string' &&
  SUPABASE_URL.length > 0 &&
  typeof SUPABASE_ANON_KEY === 'string' &&
  SUPABASE_ANON_KEY.length > 0;

// ---------------------------------------------------------------------------
// Chunked SecureStore adapter (keychain-backed session persistence)
// ---------------------------------------------------------------------------

// SecureStore warns/limits items above ~2048 bytes; chunk well under that. JWTs
// are ASCII so one char ≈ one byte. The manifest at `${key}` holds the chunk
// count; chunks live at `${key}.0 … ${key}.{n-1}`.
const CHUNK_SIZE = 1800;

const chunkedSecureStore = {
  async getItem(key: string): Promise<string | null> {
    const manifest = await SecureStore.getItemAsync(key);
    if (manifest == null) return null;
    const count = Number.parseInt(manifest, 10);
    if (!Number.isFinite(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part == null) return null; // corrupt/partial → treat as no session
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    // Clear any previous (possibly longer) chunk set first.
    await chunkedSecureStore.removeItem(key);
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let i = 0; i < count; i++) {
      await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, String(count));
  },

  async removeItem(key: string): Promise<void> {
    const manifest = await SecureStore.getItemAsync(key);
    const count = manifest == null ? 0 : Number.parseInt(manifest, 10);
    if (Number.isFinite(count)) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(`${key}.${i}`);
      }
    }
    await SecureStore.deleteItemAsync(key);
  },
};

// ---------------------------------------------------------------------------
// Lazy singleton client
// ---------------------------------------------------------------------------

let client: SupabaseClient | null = null;
let appStateBound = false;

/** Returns the shared client, or null when the backend env is not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL as string, SUPABASE_ANON_KEY as string, {
    auth: {
      storage: chunkedSecureStore,
      persistSession: true,
      autoRefreshToken: true,
      // No URL-based auth in a native app.
      detectSessionInUrl: false,
    },
  });

  // Refresh tokens only while the app is foregrounded (Supabase RN guidance).
  if (!appStateBound) {
    appStateBound = true;
    AppState.addEventListener('change', (state) => {
      if (!client) return;
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }

  return client;
}

/**
 * Ensure an anonymous session exists and return the user id (= the profile id and
 * the RLS partition key). Idempotent: reuses a persisted session across launches.
 */
export async function ensureAnonymousSession(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return sessionData.session.user.id;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(`anonymous sign-in failed: ${error?.message ?? 'unknown'}`);
  }
  return data.user.id;
}
