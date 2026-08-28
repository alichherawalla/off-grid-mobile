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
import { startAutoSetupPlan } from '../services/autoSetupService';
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
  const progress = planDownloads.length === 0 ? 0
    : planDownloads.reduce((sum, download) => sum + (download?.progress ?? 0), 0) / selected.items.length;

  const start = async () => {
    if (!selected) return;
    setStarting(true);
    setError(null);
    try { await startAutoSetupPlan(selected); }
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
              <Text style={styles.planTitle}>{plan.title}</Text>
              <Text style={styles.secondary}>{plan.summary}</Text>
              <Text style={styles.total}>{formatBytes(plan.totalBytes)} download</Text>
            </Card>
          ))}
        </View>

        {selected ? <Card style={styles.details} testID="auto-setup-selected-plan">
          <View style={styles.detailHeader}><Text style={styles.planTitle}>{selected.title} includes</Text>{VoiceIndicator ? <VoiceIndicator /> : null}</View>
          {selected.items.map(item => <View key={`${item.kind}:${item.id}`} style={styles.item}><Text style={styles.itemKind}>{item.kind === 'text' ? 'TEXT + VISION' : item.kind === 'image' ? 'IMAGE' : 'SPEECH INPUT'}</Text><Text style={styles.itemName}>{item.name}</Text><Text style={styles.itemSize}>{formatBytes(item.sizeBytes)}</Text></View>)}
          {(starting || planDownloads.length > 0) && <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.max(2, progress * 100)}%` }]} /></View>}
          {failed && <Text style={styles.error}>{failed.error ?? 'A download failed.'}</Text>}
          <Button title={failed ? 'Retry Downloads' : `Download ${formatBytes(selected.totalBytes)}`} onPress={start} loading={starting} testID="auto-setup-download" />
        </Card> : <Card style={styles.errorCard}><Text style={styles.error}>No complete model set is safe for this device.</Text></Card>}

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
  title: { ...TYPOGRAPHY.h1, color: colors.text },
  secondary: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  planGrid: { gap: SPACING.md },
  planGridWide: { flexDirection: 'row' as const },
  planCard: { borderWidth: 1, borderColor: colors.border, gap: SPACING.sm },
  planCardWide: { flex: 1 },
  selectedCard: { borderColor: colors.primary },
  planTitle: { ...TYPOGRAPHY.h2, color: colors.text },
  total: { ...TYPOGRAPHY.meta, color: colors.primary },
  details: { gap: SPACING.md },
  detailHeader: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: SPACING.md },
  itemKind: { ...TYPOGRAPHY.labelSmall, color: colors.textMuted },
  itemName: { ...TYPOGRAPHY.body, color: colors.text, marginTop: SPACING.xs },
  itemSize: { ...TYPOGRAPHY.meta, color: colors.textSecondary, marginTop: SPACING.xs },
  progressTrack: { height: SPACING.xs, backgroundColor: colors.surfaceLight, overflow: 'hidden' as const },
  progressFill: { height: SPACING.xs, backgroundColor: colors.primary },
  errorCard: { gap: SPACING.md, borderWidth: 1, borderColor: colors.error },
  error: { ...TYPOGRAPHY.body, color: colors.error },
});
