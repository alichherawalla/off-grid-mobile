import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components';
import { AnimatedEntry } from '../components/AnimatedEntry';
import { AnimatedListItem } from '../components/AnimatedListItem';
import { COLORS, TYPOGRAPHY, SPACING } from '../constants';
import { SettingsStackParamList } from '../navigation/types';
import packageJson from '../../package.json';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SettingsMain'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>

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
              index={index}
              staggerMs={40}
              style={[styles.navItem, index === arr.length - 1 && styles.navItemLast]}
              onPress={() => navigation.navigate(item.screen)}
            >
              <View style={styles.navItemIcon}>
                <Icon name={item.icon} size={16} color={COLORS.textSecondary} />
              </View>
              <View style={styles.navItemContent}>
                <Text style={styles.navItemTitle}>{item.title}</Text>
                <Text style={styles.navItemDesc}>{item.desc}</Text>
              </View>
              <Icon name="chevron-right" size={16} color={COLORS.textMuted} />
            </AnimatedListItem>
          ))}
        </View>

        {/* About */}
        <AnimatedEntry index={5} staggerMs={40}>
          <Card style={styles.section}>
            <View style={styles.aboutRow}>
              <Text style={styles.aboutLabel}>Version</Text>
              <Text style={styles.aboutValue}>{packageJson.version}</Text>
            </View>
            <Text style={styles.aboutText}>
              Local LLM brings AI to your device without compromising your privacy.
            </Text>
          </Card>
        </AnimatedEntry>

        {/* Privacy */}
        <AnimatedEntry index={6} staggerMs={40}>
          <Card style={styles.privacyCard}>
            <View style={styles.privacyIconContainer}>
              <Icon name="shield" size={18} color={COLORS.textSecondary} />
            </View>
            <Text style={styles.privacyTitle}>Privacy First</Text>
            <Text style={styles.privacyText}>
              All your data stays on this device. No conversations, prompts, or
              personal information is ever sent to any server.
            </Text>
          </Card>
        </AnimatedEntry>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  navSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navItemLast: {
    borderBottomWidth: 0,
  },
  navItemIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  navItemContent: {
    flex: 1,
  },
  navItemTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '400',
    color: COLORS.text,
  },
  navItemDesc: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  aboutLabel: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
  },
  aboutValue: {
    ...TYPOGRAPHY.body,
    fontWeight: '400',
    color: COLORS.text,
  },
  aboutText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  privacyIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  privacyTitle: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  privacyText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
