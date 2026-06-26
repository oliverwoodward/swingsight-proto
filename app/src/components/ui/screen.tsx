import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

type ScreenProps = {
  children: ReactNode;
  /** Horizontal padding on the content. Default true (20px). */
  padded?: boolean;
  /** Which safe-area edges to inset. Default top + bottom. */
  edges?: readonly Edge[];
  /** Override background (e.g. a dark capture screen). */
  background?: string;
  style?: ViewStyle;
};

export function Screen({
  children,
  padded = true,
  edges = ['top', 'bottom'],
  background,
  style,
}: ScreenProps) {
  const theme = useTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.root, { backgroundColor: background ?? theme.background }]}
    >
      <View style={[styles.content, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  padded: { paddingHorizontal: 20 },
});
