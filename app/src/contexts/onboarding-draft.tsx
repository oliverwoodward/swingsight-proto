/**
 * In-memory state for the multi-step onboarding flow. Selections (handedness,
 * view, training-consent) accumulate here as the user moves between the
 * `(onboarding)` screens, then the consent screen commits them to the persisted
 * profile via {@link useProfile}. Nothing is written to storage until consent is
 * given — analysis is blocked until then by design.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Handedness, SwingView } from '@/domain';

interface OnboardingDraftValue {
  handedness: Handedness;
  setHandedness(h: Handedness): void;
  preferredView: SwingView;
  setPreferredView(v: SwingView): void;
  trainingConsent: boolean;
  setTrainingConsent(v: boolean): void;
}

const OnboardingDraftContext = createContext<OnboardingDraftValue | null>(null);

export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const [handedness, setHandedness] = useState<Handedness>('RH');
  const [preferredView, setPreferredView] = useState<SwingView>('face_on');
  const [trainingConsent, setTrainingConsent] = useState(false);

  const value = useMemo<OnboardingDraftValue>(
    () => ({
      handedness,
      setHandedness,
      preferredView,
      setPreferredView,
      trainingConsent,
      setTrainingConsent,
    }),
    [handedness, preferredView, trainingConsent],
  );

  return (
    <OnboardingDraftContext.Provider value={value}>{children}</OnboardingDraftContext.Provider>
  );
}

export function useOnboardingDraft(): OnboardingDraftValue {
  const ctx = useContext(OnboardingDraftContext);
  if (ctx == null) {
    throw new Error('useOnboardingDraft must be used within an OnboardingDraftProvider');
  }
  return ctx;
}
