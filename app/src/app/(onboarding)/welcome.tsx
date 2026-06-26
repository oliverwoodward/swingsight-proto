import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { OnboardingStep } from '@/components/onboarding/step-scaffold';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';

/** Step 0 — welcome. Sets up the two-tap promise before collecting setup. */
export default function OnboardingWelcome() {
  return (
    <OnboardingStep
      title={'Let’s set up\nyour swing analysis.'}
      subtitle="Three quick questions so every measurement and tip is right for you. About 20 seconds."
      footer={<Button label="Get started" onPress={() => router.push('/handedness')} />}
    >
      <View style={styles.points}>
        <Point glyph="📐" text="We measure your swing — tempo, angles, balance — from the video." />
        <Point glyph="💬" text="A coach-style note explains the one thing to work on, plus a drill." />
        <Point glyph="🔒" text="Your videos stay private. You choose what’s kept and for how long." />
      </View>
    </OnboardingStep>
  );
}

function Point({ glyph, text }: { glyph: string; text: string }) {
  return (
    <View style={styles.point}>
      <ThemedText style={styles.glyph}>{glyph}</ThemedText>
      <ThemedText style={styles.pointText}>{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  points: { gap: 18 },
  point: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  glyph: { fontSize: 26, width: 32, textAlign: 'center' },
  pointText: { flex: 1, fontSize: 16, lineHeight: 22 },
});
