/**
 * Profile state for the whole app. Loads the persisted {@link UserProfile} once
 * on launch and exposes it plus the mutators the onboarding flow and capture
 * screen need. Routing decisions (onboard vs. Home) read {@link useProfile}.
 *
 * The backing store is injected as {@link ProfileStore}; Phase 2 passes the
 * Supabase implementation here and nothing else in the tree changes.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { Handedness, SwingView, UserProfile } from '@/domain';
import { secureStoreProfile, type ProfileStore } from '@/services/profile-store';
import { createId } from '@/utils/id';

/** The fields onboarding collects; the rest of the profile is derived. */
export interface ProfileDraft {
  handedness: Handedness;
  preferredView: SwingView;
  consentAcceptedAt: string;
  trainingConsentAcceptedAt: string | null;
}

interface ProfileContextValue {
  /** The complete profile, or null while loading or before onboarding finishes. */
  profile: UserProfile | null;
  /** True until the persisted profile has been read on launch. */
  isLoading: boolean;
  /** Onboarding is done iff a profile exists (we only persist complete ones). */
  isOnboarded: boolean;
  /** Commit a finished onboarding flow, minting and persisting the profile. */
  completeOnboarding(draft: ProfileDraft): Promise<UserProfile>;
  /** Merge a patch into the existing profile and persist (e.g. preferredView). */
  updateProfile(patch: Partial<UserProfile>): Promise<void>;
  /** Wipe the profile (returns the user to onboarding). */
  resetProfile(): Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({
  children,
  store = secureStoreProfile,
  mintId = createId,
}: {
  children: ReactNode;
  store?: ProfileStore;
  /**
   * Mints the id for a newly-onboarded profile. Defaults to a local UUID
   * (device-local store); Phase 2 injects the anonymous `auth.uid()` so the
   * profile id equals the Supabase RLS partition key.
   */
  mintId?: () => string | Promise<string>;
}) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Keep the latest profile in a ref so updateProfile doesn't need it as a dep.
  const profileRef = useRef<UserProfile | null>(null);
  profileRef.current = profile;

  useEffect(() => {
    let cancelled = false;
    store
      .load()
      .then((loaded) => {
        if (!cancelled) setProfile(loaded);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const completeOnboarding = useCallback(
    async (draft: ProfileDraft) => {
      const next: UserProfile = {
        id: await mintId(),
        handedness: draft.handedness,
        preferredView: draft.preferredView,
        consentAcceptedAt: draft.consentAcceptedAt,
        trainingConsentAcceptedAt: draft.trainingConsentAcceptedAt,
        createdAt: new Date().toISOString(),
      };
      await store.save(next);
      setProfile(next);
      return next;
    },
    [store, mintId],
  );

  const updateProfile = useCallback(
    async (patch: Partial<UserProfile>) => {
      const current = profileRef.current;
      if (current == null) return;
      const next = { ...current, ...patch };
      await store.save(next);
      setProfile(next);
    },
    [store],
  );

  const resetProfile = useCallback(async () => {
    await store.clear();
    setProfile(null);
  }, [store]);

  const value = useMemo<ProfileContextValue>(
    () => ({
      profile,
      isLoading,
      isOnboarded: profile != null,
      completeOnboarding,
      updateProfile,
      resetProfile,
    }),
    [profile, isLoading, completeOnboarding, updateProfile, resetProfile],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (ctx == null) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return ctx;
}
