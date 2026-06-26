import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Screen } from '@/components/ui/screen';
import { Brand } from '@/constants/brand';
import { useTheme } from '@/hooks/use-theme';

type OnboardingStepProps = {
  /** 1-based index of this step. Omit on the welcome screen to hide the dots. */
  step?: number;
  totalSteps?: number;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  /** Pinned to the bottom (typically the primary continue button). */
  footer: ReactNode;
};

/** Shared layout for the onboarding steps: progress dots, heading, body, footer. */
export function OnboardingStep({
  step,
  totalSteps,
  title,
  subtitle,
  children,
  footer,
}: OnboardingStepProps) {
  const theme = useTheme();
  return (
    <Screen>
      {step != null && totalSteps != null ? (
        <View style={styles.dots} accessibilityLabel={`Step ${step} of ${totalSteps}`}>
          {Array.from({ length: totalSteps }, (_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i < step ? Brand.accent : theme.backgroundSelected },
              ]}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.header}>
        <ThemedText type="subtitle">{title}</ThemedText>
        {subtitle ? (
          <ThemedText themeColor="textSecondary" style={styles.subtitle}>
            {subtitle}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.body}>{children}</View>

      <View style={styles.footer}>{footer}</View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  dots: { flexDirection: 'row', gap: 6, paddingTop: 8, paddingBottom: 24 },
  dot: { height: 4, flex: 1, borderRadius: 2 },
  header: { gap: 10 },
  subtitle: { fontSize: 16 },
  body: { flex: 1, justifyContent: 'center', gap: 12 },
  footer: { paddingBottom: 12, gap: 12 },
});
