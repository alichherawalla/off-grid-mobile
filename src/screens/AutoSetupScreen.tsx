import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card } from '../components';
import { LoadingDots } from '../components/LoadingDots';
import { SLOTS, useSlot } from '../bootstrap/slotRegistry';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { RootStackParamList } from '../navigation/types';
import { loadAutoSetupCompatibleCatalog } from '../services/autoSetupCatalog';
import { selectAutoSetupPlans, type AutoSetupPlan, type AutoSetupTier } from '../services/autoSetupPlan';
import { completeAutoSetupPlan, startAutoSetupPlan } from '../services/autoSetupService';
import { useModelDownloads } from '../services/modelDownloadService/useModelDownloads';
import { uniformDownloadId } from '../services/modelDownloadService/uniformId';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList, 'AutoSetup'> };

const idForItem = (item: AutoSetupPlan['items'][number]) => {
  if (item.kind === 'text') return uniformDownloadId('text', item.id);
  if (item.kind === 'image') return uniformDownloadId('image', item.id);
  return uniformDownloadId('stt', item.id);
};

const labelForItem = (item: AutoSetupPlan['items'][number]) => {
  if (item.kind === 'text') return 'TEXT + VISION';
  if (item.kind === 'image') return 'IMAGE';
  return 'SPEECH INPUT';
};

export const AutoSetupScreen: React.FC<Props> = ({ navigation }) => {
  const [plans, setPlans] = useState<AutoSetupPlan[]>([]);
  const [selectedTier, setSelectedTier] = useState<AutoSetupTier>('balanced');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const downloads = useModelDownloads();
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const VoiceIndicator = useSlot(SLOTS.autoSetupVoiceIndicator);

  const load = () => {
    setLoading(true);
    setError(null);
    loadAutoSetupCompatibleCatalog()
      .then(catalog => setPlans(selectAutoSetupPlans(catalog)))
      .catch(() => setError('Auto Setup could not load the model catalog.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const selected = plans.find(plan => plan.tier === selectedTier) ?? plans[0];
  const planDownloads = useMemo(() => selected
    ? selected.items.map(item => downloads.find(download => download.id === idForItem(item))).filter(Boolean)
    : [], [downloads, selected]);
  const failed = planDownloads.find(download => download?.status === 'error');
  const isComplete = selected != null && selected.items.every(item =>
    downloads.some(download => download.id === idForItem(item) && download.status === 'completed'));
  const progress = planDownloads.length === 0 ? 0
    : planDownloads.reduce((sum, download) => sum + (download?.progress ?? 0), 0) / selected.items.length;

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setError(null);
    const completedIds = new Set(downloads.filter(download => download.status === 'completed').map(download => download.id));
    try { await startAutoSetupPlan(selected, completedIds); }
    catch { setError('One or more downloads could not start. Try again.'); }
    finally { setStarting(false); }
  };

  if (loading) return <SafeAreaView style={styles.container}><View style={styles.center}><LoadingDots color={colors.primary} /><Text style={styles.secondary}>Finding the best models for this device...</Text></View></SafeAreaView>;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} testID="auto-setup-screen">
        <Text style={styles.eyebrow}>AUTO SETUP</Text>
        <Text style={styles.title}>Your private AI, ready in one step.</Text>
        <Text style={styles.secondary}>Choose how much capability you want. Every option is safe for this device.</Text>

        {error && <Card style={styles.errorCard}><Text style={styles.error}>{error}</Text><Button title="Try Again" onPress={plans.length ? start : load} variant="outline" testID="auto-setup-retry" /></Card>}

        <View style={[styles.planGrid, width >= 700 && styles.planGridWide]}>
          {plans.map(plan => (
            <Card key={plan.tier} onPress={() => setSelectedTier(plan.tier)} style={{ ...styles.planCard, ...(width >= 700 ? styles.planCardWide : {}), ...(selected?.tier === plan.tier ? styles.selectedCard : {}) }} testID={`auto-setup-plan-${plan.tier}`}>
              <View style={styles.detailHeader}><Text style={styles.planTitle}>{plan.title}</Text>{selected?.tier === plan.tier && VoiceIndicator ? <VoiceIndicator /> : null}</View>
              <Text style={styles.secondary}>{plan.summary}</Text>
              {selected?.tier === plan.tier && (
                <View style={styles.expandedPlan} testID="auto-setup-selected-plan">
                  <Text style={styles.includesLabel}>INCLUDES</Text>
                  {plan.items.map(item => (
                    <View key={`${plan.tier}:${item.kind}:${item.id}`} style={styles.planItem}>
                      <Text style={styles.itemKind}>{labelForItem(item)}</Text>
                      <Text style={styles.planItemName}>{item.name}</Text>
                      <Text style={styles.itemSize}>{formatBytes(item.sizeBytes)}</Text>
                    </View>
                  ))}
                  <Text style={styles.total}>{formatBytes(plan.totalBytes)} download</Text>
                  {(starting || planDownloads.length > 0) && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%` }]} /></View>}
                  {failed && <Text style={styles.error}>{failed.error ?? 'A download failed.'}</Text>}
                  {isComplete
                    ? <Button title="Continue" onPress={() => { completeAutoSetupPlan(plan); navigation.replace('Main'); }} testID="auto-setup-continue" />
                    : <Button title={failed ? 'Retry Downloads' : `Download ${formatBytes(plan.totalBytes)}`} onPress={start} loading={starting} testID="auto-setup-download" />}
                </View>
              )}
            </Card>
          ))}
        </View>

        {!selected && <Card style={styles.errorCard}><Text style={styles.error}>No complete model set is safe for this device.</Text></Card>}

        <Button title="Configure it yourself" variant="ghost" onPress={() => navigation.navigate('AdvancedSetup')} testID="auto-setup-advanced" />
        <Button title="Skip for Now" variant="ghost" onPress={() => navigation.replace('Main')} testID="auto-setup-skip" />
      </ScrollView>
    </SafeAreaView>
  );
};

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xxl, gap: SPACING.lg },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: SPACING.md, padding: SPACING.xl },
  eyebrow: { ...TYPOGRAPHY.label, color: colors.primary },
  title: { ...TYPOGRAPHY.h2, color: colors.text },
  secondary: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  planGrid: { gap: SPACING.md },
  planGridWide: { flexDirection: 'row' as const },
  planCard: { borderWidth: 1, borderColor: colors.border, gap: SPACING.sm },
  planCardWide: { flex: 1 },
  selectedCard: { borderColor: colors.primary },
  planTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  expandedPlan: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACING.md, gap: SPACING.md },
  includesLabel: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted },
  planItem: { gap: SPACING.xs },
  planItemName: { ...TYPOGRAPHY.body, color: colors.text },
  itemSize: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
  total: { ...TYPOGRAPHY.meta, color: colors.primary },
  detailHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  itemKind: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted },
  progressTrack: { height: SPACING.xs, backgroundColor: colors.surfaceLight, overflow: 'hidden' as const },
  progressFill: { height: SPACING.xs, backgroundColor: colors.primary },
  errorCard: { gap: SPACING.md, borderWidth: 1, borderColor: colors.error },
  error: { ...TYPOGRAPHY.body, color: colors.error },
});
