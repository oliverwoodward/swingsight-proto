import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Brand } from '@/constants/brand';
import { useProfile } from '@/contexts/profile';
import { deleteMyData, exportMyData } from '@/services/privacy';

/**
 * Privacy & data screen (spec §21). The user can export everything we hold, or delete
 * their account and all data (DB rows + R2 objects). Both run server-side, RLS-scoped to
 * this device's anonymous user. Also states plainly what we keep and what reaches the AI.
 */
export default function PrivacyScreen() {
  const { profile, resetProfile } = useProfile();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const trainingOn = profile?.trainingConsentAcceptedAt != null;

  async function onExport() {
    setExporting(true);
    try {
      const { swings } = await exportMyData();
      Alert.alert('Export ready', `Exported ${swings} swing${swings === 1 ? '' : 's'} and your analysis.`);
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  }

  function onDeletePress() {
    Alert.alert(
      'Delete all your data?',
      'This permanently deletes your account, every swing, and all stored video. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete everything', style: 'destructive', onPress: runDelete },
      ],
    );
  }

  async function runDelete() {
    setDeleting(true);
    try {
      await deleteMyData();
      await resetProfile();
      Alert.alert('Data deleted', 'Your account and data have been removed.');
      router.replace('/welcome');
    } catch (e) {
      Alert.alert('Delete failed', e instanceof Error ? e.message : 'Please try again.');
      setDeleting(false);
    }
  }

  return (
    <Screen padded={false} background={Brand.surfaceDark}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <ThemedText style={styles.close}>✕</ThemedText>
          </Pressable>
          <ThemedText type="subtitle" style={styles.title}>
            Privacy & data
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>What we keep</ThemedText>
          <ThemedText style={styles.body}>
            Your swing videos and the measurements we compute from them, tied to this device only —
            we use anonymous accounts, so there is no name or email on your data.
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>What the AI sees</ThemedText>
          <ThemedText style={styles.body}>
            The coaching is written by an AI from your swing&apos;s measurements and a few annotated
            still frames only. No account identifier ever reaches it.
          </ThemedText>
        </View>

        <View style={styles.card}>
          <ThemedText style={styles.cardTitle}>Training use</ThemedText>
          <ThemedText style={styles.body}>
            {trainingOn
              ? 'You opted in to let your swings help improve SwingSight. We only use consented swings for that.'
              : 'Your swings are not used to improve SwingSight — only to coach you. (You can opt in later.)'}
          </ThemedText>
        </View>

        <View style={styles.actions}>
          <Button label="Export my data" variant="secondary" onPress={onExport} loading={exporting} />
          <Pressable
            onPress={onDeletePress}
            disabled={deleting}
            accessibilityRole="button"
            style={({ pressed }) => [styles.delete, pressed && styles.deletePressed, deleting && styles.deleteDisabled]}
          >
            <ThemedText style={styles.deleteLabel}>
              {deleting ? 'Deleting…' : 'Delete my data'}
            </ThemedText>
          </Pressable>
          <ThemedText type="small" style={styles.fine}>
            Deleting removes your account, every swing, and all stored video. This can&apos;t be undone.
          </ThemedText>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 8, paddingBottom: 4 },
  close: { color: 'rgba(255,255,255,0.8)', fontSize: 22, fontWeight: '600' },
  title: { color: '#fff' },

  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  body: { color: 'rgba(255,255,255,0.7)', lineHeight: 20 },

  actions: { gap: 14, paddingTop: 8 },
  delete: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Brand.danger,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deletePressed: { backgroundColor: 'rgba(229,72,77,0.12)' },
  deleteDisabled: { opacity: 0.5 },
  deleteLabel: { color: Brand.danger, fontWeight: '800', fontSize: 16 },
  fine: { color: 'rgba(255,255,255,0.45)', textAlign: 'center' },
});
