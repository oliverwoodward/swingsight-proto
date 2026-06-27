import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSharedValue } from 'react-native-reanimated';
import type { VideoPlayer } from 'expo-video';

import { PhaseScrubber } from '@/components/report/phase-scrubber';
import { RecheckBanner } from '@/components/report/recheck-banner';
import { SwingStage } from '@/components/report/swing-stage';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Brand } from '@/constants/brand';
import { DRILLS, type Metric, type ScoreContribution, type SwingScore } from '@/domain';
import { useReport } from '@/hooks/use-report';

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const analysisId = typeof id === 'string' ? id : '';

  const { record, metrics, events, series, playbackUrl, recheck, loading, error } =
    useReport(analysisId);

  const time = useSharedValue(0);
  const playerRef = useRef<VideoPlayer | null>(null);
  const seek = (t: number) => {
    if (playerRef.current) playerRef.current.currentTime = t;
  };

  // Coaching arrives a beat after `complete` (a second Realtime update). If the worker's
  // coaching write never lands (e.g. a transient DB failure), don't spin "Writing your
  // feedback…" forever — bound the wait and fall back to a graceful note. setState only
  // happens inside the (async) timeout, so this doesn't trip the set-state-in-effect rule.
  const [coachingTimedOut, setCoachingTimedOut] = useState(false);
  const awaitingCoaching = record?.status === 'complete' && !record?.coaching;
  useEffect(() => {
    if (!awaitingCoaching) return;
    const timer = setTimeout(() => setCoachingTimedOut(true), 20000);
    return () => clearTimeout(timer);
  }, [awaitingCoaching]);

  const duration = series && series.frames.length > 0 ? series.frames[series.frames.length - 1].t : 0;

  // ---- non-complete states -------------------------------------------------
  if (loading && !record) {
    return (
      <Shell insets={insets}>
        <View style={styles.center}>
          <ActivityIndicator color={Brand.accent} />
        </View>
      </Shell>
    );
  }
  if (error || !record) {
    return (
      <Shell insets={insets}>
        <Centered title="We hit a snag" body={error ?? 'That analysis could not be loaded.'}>
          <Button label="Back" onPress={() => router.replace('/')} />
        </Centered>
      </Shell>
    );
  }
  if (record.status === 'unreadable') {
    return (
      <Shell insets={insets}>
        <Centered
          title="We couldn’t read that swing"
          body={
            record.quality?.guidance ??
            'Stand fully in frame, with good light and the camera steady, then record again.'
          }
        >
          <Button label="Record again" onPress={() => router.replace('/capture')} />
          <Button label="Back" variant="secondary" onPress={() => router.replace('/')} style={styles.gap} />
        </Centered>
      </Shell>
    );
  }
  if (record.status === 'failed') {
    return (
      <Shell insets={insets}>
        <Centered title="Something went wrong" body={record.errorReason ?? 'The analysis didn’t finish.'}>
          <Button label="Back" onPress={() => router.replace('/')} />
        </Centered>
      </Shell>
    );
  }
  if (record.status !== 'complete') {
    return (
      <Shell insets={insets}>
        <Centered title="Still measuring…" body="Your report will appear here in a moment.">
          <ActivityIndicator color={Brand.accent} />
        </Centered>
      </Shell>
    );
  }

  // ---- complete ------------------------------------------------------------
  const coaching = record.coaching;
  const drill = coaching?.drillId ? DRILLS[coaching.drillId] : undefined;

  return (
    <Shell insets={insets}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.replace('/')} accessibilityRole="button" style={styles.close}>
          <ThemedText style={styles.closeText}>✕</ThemedText>
        </Pressable>
        <ThemedText style={styles.topTitle}>Your swing</ThemedText>
        <View style={styles.close} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {playbackUrl && series ? (
          <SwingStage
            url={playbackUrl}
            series={series}
            events={events}
            faults={record.faults}
            handedness={record.handedness}
            highlightFaultId={
              coaching?.chosenFaultId ?? record.primaryFaultId ?? record.observationFaultId
            }
            time={time}
            playerRef={playerRef}
          />
        ) : (
          <View style={styles.noVideo}>
            <ThemedText style={styles.noVideoText}>Playback unavailable</ThemedText>
          </View>
        )}

        {events.length > 0 ? (
          <View style={styles.section}>
            <PhaseScrubber events={events} time={time} duration={duration} onSeek={seek} />
          </View>
        ) : null}

        {/* Compare-to-last-time leads the body when a recheck exists (Phase 6). */}
        {recheck ? <RecheckBanner recheck={recheck} /> : null}

        {/* Headline + why — front and centre. */}
        <View style={styles.section}>
          {coaching ? (
            <>
              {coaching.tentative ? (
                <ThemedText style={styles.tentativeKicker}>Tentative observation</ThemedText>
              ) : null}
              <ThemedText style={styles.headline}>{coaching.headline}</ThemedText>
              <ThemedText style={styles.why}>{coaching.why}</ThemedText>
              {coaching.chain ? (
                <View style={styles.chainBlock}>
                  <ThemedText style={styles.chainKicker}>How it connects</ThemedText>
                  <ThemedText style={styles.why}>{coaching.chain}</ThemedText>
                </View>
              ) : null}
              {coaching.ballFlightNote ? (
                <ThemedText style={styles.ballFlight}>{coaching.ballFlightNote}</ThemedText>
              ) : null}
            </>
          ) : coachingTimedOut ? (
            <ThemedText style={styles.why}>
              We couldn’t put written feedback together for this swing. Your measurements and
              the highlighted areas above still show what to work on.
            </ThemedText>
          ) : (
            <View style={styles.pending}>
              <ActivityIndicator color={Brand.accent} size="small" />
              <ThemedText style={styles.why}>Writing your feedback…</ThemedText>
            </View>
          )}
        </View>

        {drill ? <DrillCard title={drill.title} steps={drill.steps} /> : null}

        {record.score ? <ScoreCard score={record.score} /> : null}

        {metrics.length > 0 ? <MetricsList metrics={metrics} /> : null}

        <View style={styles.footer}>
          <Button label="Record another" onPress={() => router.replace('/capture')} />
        </View>
      </ScrollView>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Shell({ insets, children }: { insets: { top: number; bottom: number }; children: ReactNode }) {
  return <View style={[styles.root, { paddingTop: insets.top }]}>{children}</View>;
}

function Centered({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <View style={styles.center}>
      <View style={styles.centeredInner}>
        <ThemedText style={styles.headline}>{title}</ThemedText>
        <ThemedText style={styles.why}>{body}</ThemedText>
        <View style={styles.centeredActions}>{children}</View>
      </View>
    </View>
  );
}

function DrillCard({ title, steps }: { title: string; steps: readonly string[] }) {
  return (
    <View style={[styles.section, styles.card]}>
      <ThemedText style={styles.cardKicker}>Try this drill</ThemedText>
      <ThemedText style={styles.cardTitle}>{title}</ThemedText>
      {steps.map((s, i) => (
        <View key={i} style={styles.step}>
          <ThemedText style={styles.stepNum}>{i + 1}</ThemedText>
          <ThemedText style={styles.stepText}>{s}</ThemedText>
        </View>
      ))}
    </View>
  );
}

function ScoreCard({ score }: { score: SwingScore }) {
  const [open, setOpen] = useState(false);
  if (score.withheld) {
    return (
      <View style={[styles.section, styles.card]}>
        <ThemedText style={styles.cardKicker}>Swing score</ThemedText>
        <ThemedText style={styles.scoreWithheld}>Paused</ThemedText>
        <ThemedText style={styles.stepText}>
          We’ll show your score once we get a clearer view of your swing.
        </ThemedText>
      </View>
    );
  }
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={[styles.section, styles.card]}>
      <ThemedText style={styles.cardKicker}>Swing score · tap to see why</ThemedText>
      <View style={styles.scoreRow}>
        <ThemedText style={styles.scoreValue}>{Math.round(score.value)}</ThemedText>
        <ThemedText style={styles.scoreOutOf}>/ 100</ThemedText>
      </View>
      {open
        ? score.contributions.map((c: ScoreContribution) => (
            <View key={c.metricKey} style={styles.contribRow}>
              <ThemedText style={styles.contribLabel}>{c.label}</ThemedText>
              <ThemedText
                style={[styles.contribPoints, { color: c.points >= 0 ? Brand.success : Brand.danger }]}
              >
                {c.points >= 0 ? '+' : ''}
                {Math.round(c.points)}
              </ThemedText>
            </View>
          ))
        : null}
    </Pressable>
  );
}

function MetricsList({ metrics }: { metrics: Metric[] }) {
  // Hide metrics we couldn't honestly measure: `unmeasurable_view` (wrong camera angle for
  // this metric) and `implausible` (a degenerate value — e.g. a motion-blurred wrist giving an
  // impossible elbow angle, or a collapsed 2D turn proxy). Per the governing law we exclude
  // those rather than show a fabricated-looking number; `low_confidence` stays (tracked, just
  // not confident this swing) and renders as '—'.
  const shown = metrics.filter(
    (m) => m.status !== 'unmeasurable_view' && m.status !== 'implausible',
  );
  if (shown.length === 0) return null;
  // When nothing measured confidently, a wall of '—' reads as a broken report. Say so
  // honestly and point at the fix, rather than silently showing dashes.
  const noneMeasurable = !shown.some((m) => m.status === 'ok');
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionTitle}>Supporting metrics</ThemedText>
      {noneMeasurable ? (
        <ThemedText style={styles.metricsHint}>
          We couldn’t measure this swing confidently. Film side-on from about 2–3 m with
          your whole body in frame and good, even light, then record again.
        </ThemedText>
      ) : null}
      {shown.map((m) => (
        <MetricRow key={m.key} metric={m} />
      ))}
    </View>
  );
}

function MetricRow({ metric: m }: { metric: Metric }) {
  const approx = m.reliabilityTag === 'approximate';
  const measurable = m.status === 'ok';
  const dot = !measurable ? 'rgba(255,255,255,0.3)' : m.inRange ? Brand.success : Brand.highlight;
  // Approximate metrics are shown qualitatively (never an exact degree); reliable ones
  // show the measured value. Either way the friendly target range gives context.
  const value = !measurable
    ? '—'
    : approx
      ? m.inRange
        ? 'On track'
        : 'Worth a look'
      : formatValue(m.value, m.unit);
  return (
    <View style={styles.metricRow}>
      <View style={[styles.metricDot, { backgroundColor: dot }]} />
      <View style={styles.metricBody}>
        <ThemedText style={styles.metricLabel}>{m.label}</ThemedText>
        <ThemedText style={styles.metricRange}>
          target {formatRange(m.friendlyRange.min, m.friendlyRange.max, m.unit)}
        </ThemedText>
      </View>
      <ThemedText style={styles.metricValue}>{value}</ThemedText>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Formatting (friendly readouts; never raw degrees for approximate metrics)
// ---------------------------------------------------------------------------

function formatValue(v: number, unit: Metric['unit']): string {
  switch (unit) {
    case 'deg':
      return `${Math.round(v)}°`;
    case 'cm':
      return `${Math.round(v)} cm`;
    case 'ratio':
      return `${v.toFixed(1)}:1`;
    case 'fraction':
      return `${Math.round(v * 100)}%`;
    case 'seconds':
      return `${v.toFixed(2)}s`;
    case 'count':
      return `${Math.round(v)}`;
    default:
      return `${v}`;
  }
}

function formatRange(min: number, max: number, unit: Metric['unit']): string {
  if (unit === 'fraction') return `${Math.round(min * 100)}–${Math.round(max * 100)}%`;
  if (unit === 'ratio') return `${min.toFixed(1)}–${max.toFixed(1)}:1`;
  if (unit === 'seconds') return `${min.toFixed(2)}–${max.toFixed(2)}s`;
  const suffix = unit === 'deg' ? '°' : unit === 'cm' ? ' cm' : '';
  return `${Math.round(min)}–${Math.round(max)}${suffix}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.surfaceDark },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  centeredInner: { gap: 12, alignItems: 'center', maxWidth: 360 },
  centeredActions: { marginTop: 12, alignSelf: 'stretch', gap: 8 },
  gap: { marginTop: 8 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  topTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },

  scroll: { paddingBottom: 48 },
  section: { paddingHorizontal: 20, paddingTop: 18, gap: 8 },
  sectionTitle: { color: 'rgba(255,255,255,0.6)', fontSize: 13, fontWeight: '700', textTransform: 'uppercase' },

  noVideo: { width: '100%', aspectRatio: 9 / 16, maxHeight: 360, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  noVideoText: { color: 'rgba(255,255,255,0.6)' },

  headline: { color: '#fff', fontSize: 24, fontWeight: '800', lineHeight: 30 },
  why: { color: 'rgba(255,255,255,0.82)', fontSize: 16, lineHeight: 24 },
  tentativeKicker: {
    color: Brand.highlight,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  chainBlock: { marginTop: 10, gap: 4 },
  chainKicker: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  ballFlight: { color: Brand.highlight, fontSize: 14, lineHeight: 21, fontStyle: 'italic', marginTop: 2 },
  pending: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  card: { backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 20, borderRadius: 16, padding: 16, paddingTop: 14 },
  cardKicker: { color: Brand.accent, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  cardTitle: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 4 },
  step: { flexDirection: 'row', gap: 10, marginTop: 6 },
  stepNum: {
    color: Brand.onAccent,
    backgroundColor: Brand.accent,
    width: 20,
    height: 20,
    borderRadius: 10,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    overflow: 'hidden',
    lineHeight: 20,
  },
  stepText: { color: 'rgba(255,255,255,0.82)', fontSize: 14, lineHeight: 20, flex: 1 },

  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 },
  scoreValue: { color: '#fff', fontSize: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scoreOutOf: { color: 'rgba(255,255,255,0.5)', fontSize: 16, fontWeight: '700' },
  scoreWithheld: { color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 2 },
  contribRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  contribLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 14 },
  contribPoints: { fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] },

  metricRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.10)' },
  metricDot: { width: 9, height: 9, borderRadius: 5 },
  metricBody: { flex: 1 },
  metricLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  metricRange: { color: 'rgba(255,255,255,0.5)', fontSize: 12 },
  metricValue: { color: '#fff', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  metricsHint: { color: 'rgba(255,255,255,0.55)', fontSize: 13, lineHeight: 19 },

  footer: { paddingHorizontal: 20, paddingTop: 24 },
});
