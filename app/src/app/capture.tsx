import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useMicrophonePermission,
  useVideoOutput,
  type Recorder,
} from 'react-native-vision-camera';

import { CapturePreview } from '@/components/capture/capture-preview';
import { FramingOverlay } from '@/components/capture/framing-overlay';
import { RecordButton } from '@/components/capture/record-button';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Brand } from '@/constants/brand';
import { CAPTURE } from '@/constants/capture';
import { useProfile } from '@/contexts/profile';
import type { SwingView } from '@/domain';

type Flow = 'ready' | 'countdown' | 'recording' | 'review';

/** The clip we hold after recording, ready for upload (wired in Phase 4). */
interface Captured {
  uri: string;
  durationSec: number;
  sizeBytes: number | null;
}

export default function CaptureScreen() {
  const insets = useSafeAreaInsets();
  const { profile, updateProfile } = useProfile();

  const cameraPerm = useCameraPermission();
  const micPerm = useMicrophonePermission();
  const device = useCameraDevice('back');

  // The view is the profile default but switchable per recording; switching also
  // persists the new default (spec: the user picks the view per recording).
  const [view, setView] = useState<SwingView>(profile?.preferredView ?? 'face_on');
  const handedness = profile?.handedness ?? 'RH';

  const [flow, setFlow] = useState<Flow>('ready');
  const [count, setCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(true);

  const recorderRef = useRef<Recorder | null>(null);
  const recordStartRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A single video output, recreated only if audio availability changes.
  const videoOutput = useVideoOutput({
    targetResolution: CAPTURE.targetResolution,
    enableAudio: micPerm.hasPermission,
  });
  const outputs = useMemo(() => [videoOutput], [videoOutput]);
  const constraints = useMemo(() => [{ fps: CAPTURE.targetFps }], []);

  const isActive = focused && cameraPerm.hasPermission && flow !== 'review';

  // Request permissions on first mount (camera required, mic optional for audio).
  useEffect(() => {
    if (!cameraPerm.hasPermission && cameraPerm.canRequestPermission) {
      cameraPerm.requestPermission();
    }
    if (!micPerm.hasPermission && micPerm.canRequestPermission) {
      micPerm.requestPermission();
    }
    // Run once; the permission hooks re-read status on AppState changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const abortRecording = useCallback(() => {
    clearTimer();
    if (recorderRef.current) {
      recorderRef.current.cancelRecording().catch(() => {});
      recorderRef.current = null;
    }
    recordStartRef.current = null;
  }, [clearTimer]);

  // Stop everything when the screen loses focus or unmounts.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        abortRecording();
      };
    }, [abortRecording]),
  );

  const onRecordingFinished = useCallback(
    (filePath: string) => {
      clearTimer();
      const uri = filePath.startsWith('file://') ? filePath : `file://${filePath}`;
      const rawDuration = recordStartRef.current
        ? (Date.now() - recordStartRef.current) / 1000
        : 0;
      const durationSec = Math.min(rawDuration, CAPTURE.maxDurationSeconds);
      let sizeBytes: number | null = null;
      try {
        sizeBytes = new File(uri).size ?? null;
      } catch {
        sizeBytes = null;
      }
      recorderRef.current = null;
      recordStartRef.current = null;
      setCaptured({ uri, durationSec, sizeBytes });
      setFlow('review');
    },
    [clearTimer],
  );

  const onRecordingError = useCallback(
    (_e: Error) => {
      abortRecording();
      setError('Recording failed. Please try again.');
      setFlow('ready');
    },
    [abortRecording],
  );

  const startRecording = useCallback(async () => {
    try {
      const recorder = await videoOutput.createRecorder({
        maxDuration: CAPTURE.maxDurationSeconds,
      });
      recorderRef.current = recorder;
      await recorder.startRecording(onRecordingFinished, onRecordingError);
      // Flip to the recording state only once it has truly started.
      recordStartRef.current = Date.now();
      setElapsedMs(0);
      setFlow('recording');
      timerRef.current = setInterval(() => {
        if (recordStartRef.current != null) {
          setElapsedMs(Date.now() - recordStartRef.current);
        }
      }, 100);
    } catch {
      abortRecording();
      setError('Could not start the camera recording. Try again.');
      setFlow('ready');
    }
  }, [videoOutput, onRecordingFinished, onRecordingError, abortRecording]);

  // Drive the pre-record countdown, then kick off recording at zero.
  useEffect(() => {
    if (flow !== 'countdown') return;
    if (count <= 0) {
      startRecording();
      return;
    }
    const t = setTimeout(() => setCount((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [flow, count, startRecording]);

  const beginCountdown = useCallback(() => {
    setError(null);
    setElapsedMs(0);
    setCount(CAPTURE.countdownSeconds);
    setFlow('countdown');
  }, []);

  const stopRecording = useCallback(() => {
    recorderRef.current?.stopRecording().catch(() => {});
  }, []);

  const retake = useCallback(() => {
    setCaptured(null);
    setError(null);
    setFlow('ready');
  }, []);

  const switchView = useCallback(
    (next: SwingView) => {
      if (next === view) return;
      setView(next);
      updateProfile({ preferredView: next }).catch(() => {});
    },
    [view, updateProfile],
  );

  // ---- Permission / device gates -----------------------------------------

  if (!cameraPerm.hasPermission) {
    return (
      <PermissionGate
        canRequest={cameraPerm.canRequestPermission}
        onRequest={() => cameraPerm.requestPermission()}
      />
    );
  }

  if (device == null) {
    // Permission is granted but the device list is still enumerating.
    return (
      <Centered>
        <ActivityIndicator color={Brand.accent} />
      </Centered>
    );
  }

  // ---- Live capture -------------------------------------------------------

  const recording = flow === 'recording';
  const counting = flow === 'countdown';
  const reviewing = flow === 'review';
  const progress = Math.min(elapsedMs / (CAPTURE.maxDurationSeconds * 1000), 1);

  return (
    <View style={styles.root}>
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        outputs={outputs}
        constraints={constraints}
        resizeMode="cover"
      />

      {!reviewing ? <FramingOverlay view={view} handedness={handedness} /> : null}

      {reviewing && captured ? <CapturePreview uri={captured.uri} /> : null}

      {/* Top bar: close + view switcher (hidden mid-capture), or recording timer. */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        {recording ? (
          <RecordingTimer elapsedMs={elapsedMs} progress={progress} />
        ) : !reviewing && !counting ? (
          <View style={styles.topRow}>
            <IconButton label="✕" onPress={() => router.back()} />
            <ViewSwitcher view={view} onChange={switchView} />
            <View style={styles.iconSpacer} />
          </View>
        ) : null}
      </View>

      {counting && count > 0 ? (
        <View style={styles.countdownWrap} pointerEvents="none">
          <ThemedText style={styles.countdown}>{count}</ThemedText>
        </View>
      ) : null}

      {/* Bottom controls. */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 18 }]}>
        {reviewing && captured ? (
          <ReviewControls
            captured={captured}
            view={view}
            handedness={handedness}
            onRetake={retake}
            onAnalyze={() =>
              router.replace({
                pathname: '/processing',
                params: { uri: captured.uri, view, handedness },
              })
            }
          />
        ) : (
          <>
            {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
            <RecordButton
              recording={recording}
              disabled={counting}
              onPress={recording ? stopRecording : beginCountdown}
            />
            <ThemedText style={styles.recordHint}>
              {recording
                ? 'Recording… tap to stop'
                : counting
                  ? 'Get set…'
                  : 'Tap to record your swing'}
            </ThemedText>
          </>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PermissionGate({
  canRequest,
  onRequest,
}: {
  canRequest: boolean;
  onRequest: () => void;
}) {
  return (
    <Centered>
      <ThemedText style={styles.white} type="subtitle">
        Camera access
      </ThemedText>
      <ThemedText style={styles.dim}>
        SwingSight needs your camera to record your swing. Your video stays private and you control
        what’s kept.
      </ThemedText>
      <View style={styles.gap}>
        {canRequest ? (
          <Button label="Allow camera" onPress={onRequest} />
        ) : (
          <Button label="Open Settings" onPress={() => Linking.openSettings()} />
        )}
        <Button label="Back" variant="secondary" onPress={() => router.back()} style={styles.gap} />
      </View>
    </Centered>
  );
}

function RecordingTimer({ elapsedMs, progress }: { elapsedMs: number; progress: number }) {
  return (
    <View style={styles.timerWrap}>
      <View style={styles.timerPill}>
        <View style={styles.recDot} />
        <ThemedText style={styles.timerText}>{formatClock(elapsedMs)}</ThemedText>
        <ThemedText style={styles.timerMax}>
          {' / '}
          {formatClock(CAPTURE.maxDurationSeconds * 1000)}
        </ThemedText>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
      </View>
    </View>
  );
}

function ViewSwitcher({
  view,
  onChange,
}: {
  view: SwingView;
  onChange: (v: SwingView) => void;
}) {
  return (
    <View style={styles.switcher}>
      <SwitcherTab label="Face-on" active={view === 'face_on'} onPress={() => onChange('face_on')} />
      <SwitcherTab label="Down-the-line" active={view === 'dtl'} onPress={() => onChange('dtl')} />
    </View>
  );
}

function SwitcherTab({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.switcherTab, active && styles.switcherTabActive]}
    >
      <ThemedText style={[styles.switcherText, active && styles.switcherTextActive]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function ReviewControls({
  captured,
  view,
  handedness,
  onRetake,
  onAnalyze,
}: {
  captured: Captured;
  view: SwingView;
  handedness: string;
  onRetake: () => void;
  onAnalyze: () => void;
}) {
  const viewLabel = view === 'face_on' ? 'Face-on' : 'Down-the-line';
  return (
    <View style={styles.review}>
      <View style={styles.reviewMeta}>
        <ThemedText style={styles.reviewTitle}>Swing captured</ThemedText>
        <ThemedText style={styles.reviewStats}>
          {captured.durationSec.toFixed(1)}s · {formatSize(captured.sizeBytes)} · 1080p target ·{' '}
          {CAPTURE.targetFps} fps
        </ThemedText>
        <ThemedText style={styles.reviewStats}>
          {viewLabel} · {handedness === 'RH' ? 'Right-handed' : 'Left-handed'}
        </ThemedText>
        <ThemedText style={styles.reviewNote}>
          We’ll upload it, measure your swing, and explain the one thing to work on.
        </ThemedText>
      </View>
      <View style={styles.reviewButtons}>
        <Button label="Retake" variant="secondary" onPress={onRetake} style={styles.flex} />
        <Button label="Analyze swing" onPress={onAnalyze} style={styles.flex} />
      </View>
    </View>
  );
}

function IconButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
    >
      <ThemedText style={styles.iconText}>{label}</ThemedText>
    </Pressable>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <View style={[styles.root, styles.centered]}>
      <View style={styles.centeredInner}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return '— MB';
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  centeredInner: { gap: 10, alignItems: 'flex-start', maxWidth: 360 },
  white: { color: '#fff' },
  dim: { color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 22 },
  gap: { marginTop: 16, alignSelf: 'stretch' },

  topBar: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Brand.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconPressed: { opacity: 0.6 },
  iconText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  iconSpacer: { width: 40 },

  switcher: {
    flexDirection: 'row',
    backgroundColor: Brand.scrim,
    borderRadius: 999,
    padding: 4,
    gap: 4,
  },
  switcherTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999 },
  switcherTabActive: { backgroundColor: Brand.accent },
  switcherText: { color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' },
  switcherTextActive: { color: Brand.onAccent },

  timerWrap: { alignItems: 'center', gap: 8 },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Brand.scrim,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  recDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Brand.danger, marginRight: 8 },
  timerText: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerMax: { color: 'rgba(255,255,255,0.6)', fontSize: 15, fontVariant: ['tabular-nums'] },
  progressTrack: {
    width: 180,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: Brand.danger },

  countdownWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countdown: {
    color: '#fff',
    fontSize: 120,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 16,
  },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  recordHint: { color: 'rgba(255,255,255,0.85)', fontSize: 13 },
  error: { color: Brand.danger, fontSize: 13, fontWeight: '600' },

  review: { alignSelf: 'stretch', gap: 16 },
  reviewMeta: {
    backgroundColor: Brand.scrim,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  reviewTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  reviewStats: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontVariant: ['tabular-nums'] },
  reviewNote: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 6 },
  reviewButtons: { flexDirection: 'row', gap: 12 },
  flex: { flex: 1 },
});
