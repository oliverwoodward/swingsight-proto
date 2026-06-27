import { Redirect, router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { SwingHistoryCard } from '@/components/history/swing-history-card';
import { TempoTrend } from '@/components/history/tempo-trend';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Brand } from '@/constants/brand';
import { useProfile } from '@/contexts/profile';
import { useHistory } from '@/hooks/use-history';
import { tempoSeries } from '@/utils/history';

/**
 * Entry gate + Home. While the persisted profile loads we hold on a spinner; if
 * onboarding hasn't completed we redirect into it; otherwise we show Home — the record
 * CTA plus, once there's history, a tempo trend and the most recent swings (Phase 6).
 */
export default function Index() {
  const { profile, isLoading, isOnboarded } = useProfile();
  const { items, reload } = useHistory(profile?.id ?? null);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.loader}>
          <ActivityIndicator color={Brand.accent} />
        </View>
      </Screen>
    );
  }

  if (!isOnboarded || profile == null) {
    return <Redirect href="/welcome" />;
  }

  const viewLabel = profile.preferredView === 'face_on' ? 'Face-on' : 'Down-the-line';
  const tempo = tempoSeries(items);
  const recent = items.slice(0, 3);

  return (
    <Screen padded={false} background={Brand.surfaceDark}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.badge}>
            <ThemedText style={styles.badgeText}>SwingSight</ThemedText>
          </View>
          <ThemedText type="subtitle" style={styles.heading}>
            Record a swing,{'\n'}get coached.
          </ThemedText>
          <ThemedText type="default" style={styles.sub}>
            Film your swing {viewLabel.toLowerCase()}. We measure it and explain the one thing to
            work on.
          </ThemedText>
          <View style={styles.cta}>
            <ThemedText type="small" style={styles.handed}>
              {profile.handedness === 'RH' ? 'Right-handed' : 'Left-handed'} · {viewLabel}
            </ThemedText>
            <Button label="Record a swing" onPress={() => router.push('/capture')} />
            <Button
              label="Upload a swing"
              variant="secondary"
              onPress={() => router.push({ pathname: '/capture', params: { pick: '1' } })}
            />
          </View>
        </View>

        {tempo.length >= 2 ? <TempoTrend values={tempo} /> : null}

        {recent.length > 0 ? (
          <View style={styles.recent}>
            <View style={styles.recentHeader}>
              <ThemedText style={styles.sectionTitle}>Recent swings</ThemedText>
              <Pressable onPress={() => router.push('/history')} accessibilityRole="button">
                <ThemedText style={styles.seeAll}>See all</ThemedText>
              </Pressable>
            </View>
            {recent.map((item) => (
              <SwingHistoryCard key={item.id} item={item} />
            ))}
          </View>
        ) : null}

        <Pressable
          onPress={() => router.push('/privacy')}
          accessibilityRole="button"
          style={styles.privacyLink}
        >
          <ThemedText style={styles.privacyLabel}>Privacy & data</ThemedText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingTop: 8, paddingBottom: 32, gap: 20 },

  hero: { paddingHorizontal: 20, paddingTop: 24, gap: 14 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: Brand.accent,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  badgeText: { color: Brand.onAccent, fontWeight: '800', fontSize: 13 },
  heading: { color: '#fff' },
  sub: { color: 'rgba(255,255,255,0.7)', maxWidth: 320 },
  handed: { color: 'rgba(255,255,255,0.55)' },
  cta: { paddingTop: 6, gap: 12 },

  recent: { paddingHorizontal: 20, gap: 10 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  seeAll: { color: Brand.accent, fontSize: 14, fontWeight: '700' },

  privacyLink: { alignSelf: 'center', paddingVertical: 12, marginTop: 4 },
  privacyLabel: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '600' },
});
