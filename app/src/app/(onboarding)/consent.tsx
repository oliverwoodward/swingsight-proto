import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { OnboardingStep } from '@/components/onboarding/step-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Brand } from '@/constants/brand';
import { useOnboardingDraft } from '@/contexts/onboarding-draft';
import { useProfile } from '@/contexts/profile';
import { useTheme } from '@/hooks/use-theme';

/**
 * Step 3 — consent. The required consent gates everything: the profile is not
 * written (and so analysis is not unlocked) until it is accepted. Training-data
 * consent is separate and opt-in, per spec §13/§21.
 */
export default function ConsentStep() {
  const theme = useTheme();
  const { handedness, preferredView, trainingConsent, setTrainingConsent } = useOnboardingDraft();
  const { completeOnboarding } = useProfile();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function finish() {
    if (!accepted || submitting) return;
    setSubmitting(true);
    const now = new Date().toISOString();
    try {
      await completeOnboarding({
        handedness,
        preferredView,
        consentAcceptedAt: now,
        trainingConsentAcceptedAt: trainingConsent ? now : null,
      });
      // Replace so back-swipe can't return into the onboarding flow.
      router.replace('/');
    } catch {
      setSubmitting(false);
    }
  }

  return (
    <OnboardingStep
      step={3}
      totalSteps={3}
      title="Your video, your call."
      subtitle="We need your OK to record and analyse your swing. Here’s exactly what that means."
      footer={
        <Button
          label="Agree & continue"
          onPress={finish}
          disabled={!accepted}
          loading={submitting}
        />
      }
    >
      <View style={[styles.summary, { backgroundColor: theme.backgroundElement }]}>
        <SummaryLine text="We record your swing and measure it in the cloud to coach you." />
        <SummaryLine text="The raw clip is deleted within 48 hours; the processed clip and your metrics are kept so you can track progress." />
        <SummaryLine text="No personal data is ever sent to the AI — only your measurements and frames." />
        <SummaryLine text="You can delete or export everything at any time." />
      </View>

      <ConsentRow
        checked={accepted}
        onToggle={() => setAccepted((v) => !v)}
        required
        label="I agree to SwingSight recording, processing and storing my swing video to analyse it."
      />
      <ConsentRow
        checked={trainingConsent}
        onToggle={() => setTrainingConsent(!trainingConsent)}
        label="Optional: also use my swings to improve SwingSight’s analysis. You can turn this off later."
      />
    </OnboardingStep>
  );
}

function SummaryLine({ text }: { text: string }) {
  return (
    <View style={styles.summaryLine}>
      <ThemedText style={styles.bullet}>•</ThemedText>
      <ThemedText type="small" style={styles.summaryText}>
        {text}
      </ThemedText>
    </View>
  );
}

function ConsentRow({
  checked,
  onToggle,
  label,
  required,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  required?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      onPress={onToggle}
      style={({ pressed }) => [styles.consentRow, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.checkbox,
          { borderColor: checked ? Brand.accent : theme.backgroundSelected },
          checked && { backgroundColor: Brand.accent },
        ]}
      >
        {checked ? <ThemedText style={styles.checkmark}>✓</ThemedText> : null}
      </View>
      <View style={styles.consentTextWrap}>
        <ThemedText type="small" style={styles.consentText}>
          {label}
        </ThemedText>
        {required ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.required}>
            Required
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { borderRadius: 16, padding: 16, gap: 12, marginBottom: 8 },
  summaryLine: { flexDirection: 'row', gap: 8 },
  bullet: { color: Brand.accent, fontWeight: '800', lineHeight: 20 },
  summaryText: { flex: 1 },
  consentRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 6 },
  pressed: { opacity: 0.7 },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkmark: { color: Brand.onAccent, fontSize: 16, fontWeight: '900', lineHeight: 18 },
  consentTextWrap: { flex: 1, gap: 2 },
  consentText: { flex: 1 },
  required: { fontSize: 12 },
});
