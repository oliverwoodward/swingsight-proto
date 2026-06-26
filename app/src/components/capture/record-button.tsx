import { Pressable, StyleSheet, View } from 'react-native';

import { Brand } from '@/constants/brand';

type RecordButtonProps = {
  recording: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/**
 * The capture shutter. A white ring with an inner shape that morphs from a green
 * disc (idle → start) to a red rounded square (recording → stop).
 */
export function RecordButton({ recording, disabled = false, onPress }: RecordButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.ring, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      <View
        style={[
          styles.inner,
          recording ? styles.innerRecording : styles.innerIdle,
        ]}
      />
    </Pressable>
  );
}

const SIZE = 78;

const styles = StyleSheet.create({
  ring: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 5,
    borderColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
  inner: { alignItems: 'center', justifyContent: 'center' },
  innerIdle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: Brand.accent,
  },
  innerRecording: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: Brand.danger,
  },
});
