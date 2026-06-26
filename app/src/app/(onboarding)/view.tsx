import { router } from 'expo-router';

import { OnboardingStep } from '@/components/onboarding/step-scaffold';
import { Button } from '@/components/ui/button';
import { OptionCard } from '@/components/ui/option-card';
import { useOnboardingDraft } from '@/contexts/onboarding-draft';
import type { SwingView } from '@/domain';

const OPTIONS: { value: SwingView; title: string; description: string; glyph: string }[] = [
  {
    value: 'face_on',
    title: 'Face-on',
    description: 'Camera faces you head-on. Best for tempo, sway, tilt and balance.',
    glyph: '🧍',
  },
  {
    value: 'dtl',
    title: 'Down-the-line',
    description: 'Camera behind, along your target line. Best for posture and swing plane.',
    glyph: '🎯',
  },
];

/**
 * Step 2 — default camera view. Stored as `preferredView`; the user can still
 * switch per recording on the capture screen (each view is its own analysis).
 */
export default function ViewStep() {
  const { preferredView, setPreferredView } = useOnboardingDraft();

  return (
    <OnboardingStep
      step={2}
      totalSteps={3}
      title="How will you film?"
      subtitle="Face-on and down-the-line are separate analyses. Pick your usual angle — you can change it anytime."
      footer={<Button label="Continue" onPress={() => router.push('/consent')} />}
    >
      {OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          glyph={opt.glyph}
          title={opt.title}
          description={opt.description}
          selected={preferredView === opt.value}
          onPress={() => setPreferredView(opt.value)}
        />
      ))}
    </OnboardingStep>
  );
}
