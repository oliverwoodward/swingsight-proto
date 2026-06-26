import { router } from 'expo-router';

import { OnboardingStep } from '@/components/onboarding/step-scaffold';
import { Button } from '@/components/ui/button';
import { OptionCard } from '@/components/ui/option-card';
import { useOnboardingDraft } from '@/contexts/onboarding-draft';
import type { Handedness } from '@/domain';

const OPTIONS: { value: Handedness; title: string; description: string; glyph: string }[] = [
  {
    value: 'RH',
    title: 'Right-handed',
    description: 'You swing with your left arm leading.',
    glyph: '🏌️',
  },
  {
    value: 'LH',
    title: 'Left-handed',
    description: 'You swing with your right arm leading.',
    glyph: '🏌️‍♂️',
  },
];

/** Step 1 — handedness. Drives lead-arm selection and which limb the overlay highlights. */
export default function HandednessStep() {
  const { handedness, setHandedness } = useOnboardingDraft();

  return (
    <OnboardingStep
      step={1}
      totalSteps={3}
      title="Which way do you swing?"
      subtitle="This decides which arm we track and highlight. Getting it right matters."
      footer={<Button label="Continue" onPress={() => router.push('/view')} />}
    >
      {OPTIONS.map((opt) => (
        <OptionCard
          key={opt.value}
          glyph={opt.glyph}
          title={opt.title}
          description={opt.description}
          selected={handedness === opt.value}
          onPress={() => setHandedness(opt.value)}
        />
      ))}
    </OnboardingStep>
  );
}
