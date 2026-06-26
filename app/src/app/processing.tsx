import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Brand } from '@/constants/brand';
import { useProfile } from '@/contexts/profile';
import type { Handedness, SwingView } from '@/domain';
import { useAnalysisRunner } from '@/hooks/use-analysis-runner';

const STAGE_LABELS = [
  'Finding your swing…',
  'Measuring your tempo…',
  'Checking your positions…',
  'Writing your feedback…',
];

/**
 * The processing screen: renders the upload → queued → processing → terminal state
 * machine. `complete` redirects to the report; `unreadable` shows the worker's specific
 * re-record guidance (never a fabricated analysis); `failed` offers a retry.
 */
export default function ProcessingScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useProfile();
  const params = useLocalSearchParams<{ uri: string; view: SwingView; handedness: Handedness }>();

  const fileUri = typeof params.uri === 'string' ? params.uri : '';
  const view: SwingView = params.view === 'dtl' ? 'dtl' : 'face_on';
  const handedness: Handedness = params.handedness === 'LH' ? 'LH' : 'RH';

  const { phase, uploadProgress, record, error, retry } = useAnalysisRunner({
    profileId: profile?.id ?? null,
    fileUri,
    view,
    handedness,
  });

  // Rotate the encouraging stage labels while the worker runs.
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (phase !== 'processing' && phase !== 'queued') return;
    const t = setInterval(() => setStage((s) => (s + 1) % STAGE_LABELS.length), 2200);
    return () => clearInterval(t);
  }, [phase]);

  // Hand off to the report the moment the measurement lands.
  useEffect(() => {
    if (phase === 'complete' && record) {
      router.replace(`/report/${record.id}`);
    }
  }, [phase, record]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.badge}>
        <ThemedText style={styles.badgeText}>SwingSight</ThemedText>
      </View>

      <View style={styles.center}>
        {phase === 'uploading' ? (
          <Uploading progress={uploadProgress} />
        ) : phase === 'unreadable' ? (
          <Unreadable guidance={record?.quality?.guidance} />
        ) : phase === 'failed' ? (
          <Failed error={error ?? record?.errorReason ?? null} />
        ) : (
          // queued / processing / (complete, briefly before redirect)
          <Working label={STAGE_LABELS[stage]} />
        )}
      </View>

      {phase === 'unreadable' ? (
        <View style={styles.actions}>
          <Button label="Record again" onPress={() => router.replace('/capture')} />
          <Button label="Back" variant="secondary" onPress={() => router.replace('/')} style={styles.gap} />
        </View>
      ) : phase === 'failed' ? (
        <View style={styles.actions}>
          <Button label="Try again" onPress={retry} />
          <Button label="Back" variant="secondary" onPress={() => router.replace('/')} style={styles.gap} />
        </View>
      ) : null}
    </View>
  );
}

function Uploading({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <View style={styles.block}>
      <ThemedText style={styles.title}>Uploading your swing</ThemedText>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(4, pct)}%` }]} />
      </View>
      <ThemedText style={styles.pct}>{pct}%</ThemedText>
      <ThemedText style={styles.sub}>Sent securely — analysis starts automatically.</ThemedText>
    </View>
  );
}

function Working({ label }: { label: string }) {
  return (
    <View style={styles.block}>
      <ActivityIndicator color={Brand.accent} size="large" />
      <ThemedText style={styles.title}>{label}</ThemedText>
      <ThemedText style={styles.sub}>This usually takes under a minute.</ThemedText>
    </View>
  );
}

function Unreadable({ guidance }: { guidance?: string }) {
  return (
    <View style={styles.block}>
      <ThemedText style={styles.emoji}>🎥</ThemedText>
      <ThemedText style={styles.title}>We couldn’t read that swing</ThemedText>
      <ThemedText style={styles.sub}>
        {guidance ??
          'Stand fully in frame, with good light and the camera steady, then record again.'}
      </ThemedText>
    </View>
  );
}

function Failed({ error }: { error: string | null }) {
  return (
    <View style={styles.block}>
      <ThemedText style={styles.emoji}>⚠️</ThemedText>
      <ThemedText style={styles.title}>Something went wrong</ThemedText>
      <ThemedText style={styles.sub}>{error ?? 'The analysis didn’t finish. Please try again.'}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.surfaceDark, paddingHorizontal: 24 },
  badge: {
    alignSelf: 'center',
    backgroundColor: Brand.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: { color: Brand.onAccent, fontWeight: '800', fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  block: { alignItems: 'center', gap: 14, maxWidth: 340 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  sub: { color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 22, textAlign: 'center' },
  pct: { color: Brand.accent, fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  emoji: { fontSize: 44 },
  progressTrack: {
    width: 260,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: Brand.accent },
  actions: { gap: 12 },
  gap: { marginTop: 4 },
});
