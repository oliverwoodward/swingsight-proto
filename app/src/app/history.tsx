import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SwingHistoryCard } from '@/components/history/swing-history-card';
import { TempoTrend } from '@/components/history/tempo-trend';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Brand } from '@/constants/brand';
import { useProfile } from '@/contexts/profile';
import { useHistory } from '@/hooks/use-history';
import { tempoSeries } from '@/utils/history';

/**
 * Full swing history + the tempo-over-time trend (Phase 6 / spec §11.2 item 7). Newest
 * first; each card taps into its report. Re-fetches on focus so a swing recorded after
 * landing here appears without a manual refresh.
 */
export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { profile } = useProfile();
  const { items, loading, error, reload } = useHistory(profile?.id ?? null);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const tempo = tempoSeries(items);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.close}>
          <ThemedText style={styles.closeText}>‹</ThemedText>
        </Pressable>
        <ThemedText style={styles.topTitle}>Your swings</ThemedText>
        <View style={styles.close} />
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={Brand.accent} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <ThemedText style={styles.emptyTitle}>No swings yet</ThemedText>
          <ThemedText style={styles.emptyBody}>
            {error ?? 'Record your first swing and it’ll show up here with your trends.'}
          </ThemedText>
          <Button label="Record a swing" onPress={() => router.replace('/capture')} style={styles.emptyBtn} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            tempo.length >= 2 ? (
              <View style={styles.trendWrap}>
                <TempoTrend values={tempo} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <SwingHistoryCard item={item} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.surfaceDark },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 30, fontWeight: '700' },
  topTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
  emptyTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  emptyBody: { color: 'rgba(255,255,255,0.7)', fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 320 },
  emptyBtn: { marginTop: 12, alignSelf: 'stretch' },

  list: { paddingTop: 6 },
  trendWrap: { paddingBottom: 14 },
  cardWrap: { paddingHorizontal: 20, paddingBottom: 10 },
});
