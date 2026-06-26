import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Brand } from '@/constants/brand';
import { useTheme } from '@/hooks/use-theme';

type OptionCardProps = {
  title: string;
  description?: string;
  /** Optional leading glyph (emoji/sf-symbol-as-text) shown large above the title. */
  glyph?: string;
  selected: boolean;
  onPress: () => void;
  style?: ViewStyle;
};

/** A large, tappable selection card used by the onboarding pickers. */
export function OptionCard({
  title,
  description,
  glyph,
  selected,
  onPress,
  style,
}: OptionCardProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: theme.backgroundElement, borderColor: 'transparent' },
        selected && { borderColor: Brand.accent, backgroundColor: theme.backgroundSelected },
        pressed && styles.pressed,
        style,
      ]}
    >
      {glyph ? <ThemedText style={styles.glyph}>{glyph}</ThemedText> : null}
      <View style={styles.text}>
        <ThemedText type="smallBold" style={styles.title}>
          {title}
        </ThemedText>
        {description ? (
          <ThemedText type="small" themeColor="textSecondary">
            {description}
          </ThemedText>
        ) : null}
      </View>
      <View style={[styles.radio, { borderColor: selected ? Brand.accent : theme.backgroundSelected }]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 16,
    borderWidth: 2,
    padding: 18,
  },
  pressed: { opacity: 0.85 },
  glyph: { fontSize: 30 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 17 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Brand.accent,
  },
});
