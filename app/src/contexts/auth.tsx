/**
 * Anonymous-auth bootstrap (Phase 2).
 *
 * On first launch the app signs in anonymously; the session is persisted in the
 * keychain so the same device user (and therefore the same RLS partition) is
 * reused across launches. The resulting `auth.uid()` becomes the profile id and
 * the partition key for every swing.
 *
 * When the backend env is not configured (pre-provisioning), this provider is a
 * no-op: it reports `isConfigured = false` and the app falls back to the Phase-1
 * device-local profile store, so the dev build keeps running.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { ensureAnonymousSession, isSupabaseConfigured } from '@/services/supabase';

interface AuthContextValue {
  /** The anonymous user id (= profile id / RLS key), or null until ready/unconfigured. */
  userId: string | null;
  /** True once the anonymous session is established (or immediately if unconfigured). */
  isReady: boolean;
  /** Whether the Supabase backend env is wired. */
  isConfigured: boolean;
  /** Set if anonymous sign-in failed (network/misconfig); surfaced for diagnostics. */
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(!isSupabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let cancelled = false;
    ensureAnonymousSession()
      .then((uid) => {
        if (!cancelled) setUserId(uid);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setIsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ userId, isReady, isConfigured: isSupabaseConfigured, error }),
    [userId, isReady, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx == null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
