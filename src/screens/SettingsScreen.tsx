import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { useFocusTrigger } from '../hooks/useFocusTrigger';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { SettingsStackParamList } from '../navigation/types';
import packageJson from '../../package.json';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SettingsMain'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const focusTrigger = useFocusTrigger();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const themeMode = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);

  const handleResetOnboarding = () => {
    setOnboardingComplete(false);
    // Navigate to root stack and reset to Onboarding
    navigation.getParent()?.getParent()?.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Onboarding' }],
      })
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

        {/* Dark Mode Toggle */}
        <AnimatedEntry index={0} staggerMs={40} trigger={focusTrigger}>
          <View style={styles.themeToggleRow}>
            <View style={styles.themeToggleInfo}>
              <Icon name="moon" size={16} color={colors.textSecondary} />
              <Text style={styles.themeToggleLabel}>Dark Mode</Text>
            </View>
            <Switch
              value={themeMode === 'dark'}
              onValueChange={(val) => setThemeMode(val ? 'dark' : 'light')}
              trackColor={{ false: colors.surfaceLight, true: colors.primary + '60' }}
              thumbColor={themeMode === 'dark' ? colors.primary : colors.textMuted}
            />
          </View>
        </AnimatedEntry>

        {/* Navigation Items */}
        <View style={styles.navSection}>
          {[
            { icon: 'sliders', title: 'Model Settings', desc: 'System prompt, generation, and performance', screen: 'ModelSettings' as const },
            { icon: 'mic', title: 'Voice Transcription', desc: 'On-device speech to text', screen: 'VoiceSettings' as const },
            { icon: 'lock', title: 'Security', desc: 'Passphrase and app lock', screen: 'SecuritySettings' as const },
            { icon: 'smartphone', title: 'Device Information', desc: 'Hardware and compatibility', screen: 'DeviceInfo' as const },
            { icon: 'hard-drive', title: 'Storage', desc: 'Models and data usage', screen: 'StorageSettings' as const },
          ].map((item, index, arr) => (
            <AnimatedListItem
              key={item.screen}
              index={index + 1}
              staggerMs={40}
              trigger={focusTrigger}
              style={[styles.navItem, index === arr.length - 1 && styles.navItemLast]}
              onPress={() => navigation.navigate(item.screen)}
            >
              <View style={styles.navItemIcon}>
                <Icon name={item.icon} size={16} color={colors.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>{item.title}</Text>
                <Text style={styles.navItemDesc}>{item.desc}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={colors.textMuted} />
            </AnimatedListItem>
          ))}
        </View>

        {/* About */}
        <AnimatedEntry index={6} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.section}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>{packageJson.version}</Text>
            </View>
            <Text style={styles.aboutText}>
              Off Grid brings AI to your device without compromising your privacy.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Privacy */}
        <AnimatedEntry index={7} staggerMs={40} trigger={focusTrigger}>
          <Card style={styles.privacyCard}>
            <View style={styles.privacyIconContainer}>
              <Icon name="shield" size={18} color={colors.textSecondary} />
            </View>
            <Text style={styles.privacyTitle}>Privacy First</Text>
            <Text style={styles.privacyText}>
              All your data stays on this device. No conversations, prompts, or
              personal information is ever sent to any server.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Dev-only: Reset Onboarding */}
        {__DEV__ && (
          <AnimatedEntry index={8} staggerMs={40} trigger={focusTrigger}>
            <TouchableOpacity style={styles.devButton} onPress={handleResetOnboarding}>
              <Icon name="rotate-ccw" size={14} color={colors.textMuted} />
              <Text style={styles.devButtonText}>Reset Onboarding</Text>
            </TouchableOpacity>
          </AnimatedEntry>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    lineHeight: 36,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  themeToggleRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  themeToggleInfo: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
  },
  themeToggleLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  navSection: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden' as const,
    ...shadows.small,
  },
  navItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navItemLast: {
    borderBottomWidth: 0,
  },
  navItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: SPACING.md,
  },
  navItemContent: {
    flex: 1,
  },
  navItemTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  navItemDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  aboutRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: SPACING.sm,
  },
  aboutLabel: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
  },
  aboutValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
    color: colors.text,
  },
  aboutText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    lineHeight: 18,
  },
  privacyCard: {
    alignItems: 'center' as const,
    backgroundColor: colors.surface,
  },
  privacyIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: SPACING.md,
  },
  privacyTitle: {
    ...TYPOGRAPHY.h3,
    color: colors.text,
    marginBottom: SPACING.sm,
  },
  privacyText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
  },
  devButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginTop: SPACING.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed' as const,
    borderRadius: 6,
  },
  devButtonText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
});
