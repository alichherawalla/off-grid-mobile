import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card, Button } from '../components';
import { COLORS } from '../constants';
import { useAppStore, useChatStore, useAuthStore } from '../stores';
import { modelManager, authService, activeModelService } from '../services';
import { SettingsStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'SettingsMain'>;

export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const {
    downloadedModels,
    setOnboardingComplete,
  } = useAppStore();

  const { setEnabled: setAuthEnabled } = useAuthStore();
  const { clearAllConversations } = useChatStore();

  const handleClearConversations = () => {
    Alert.alert(
      'Clear All Conversations',
      'This will delete all your chat history. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearAllConversations();
            Alert.alert('Done', 'All conversations have been cleared.');
          },
        },
      ]
    );
  };

  const handleResetApp = () => {
    Alert.alert(
      'Reset App',
      'This will delete all data including downloaded models, conversations, and settings. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await activeModelService.unloadAllModels();
              for (const model of downloadedModels) {
                await modelManager.deleteModel(model.id).catch(() => {});
              }
              clearAllConversations();
              setOnboardingComplete(false);
              await authService.removePassphrase();
              setAuthEnabled(false);
              Alert.alert('App Reset', 'Please restart the app to complete the reset.');
            } catch (error) {
              Alert.alert('Error', 'Failed to reset app.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Settings</Text>

        {/* Navigation Items */}
        <View style={styles.navSection}>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => navigation.navigate('ModelSettings')}
          >
            <View style={styles.navItemIcon}>
              <Icon name="sliders" size={20} color={COLORS.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Model Settings</Text>
              <Text style={styles.navItemDesc}>System prompt, generation, and performance</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => navigation.navigate('VoiceSettings')}
          >
            <View style={styles.navItemIcon}>
              <Icon name="mic" size={20} color={COLORS.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Voice Transcription</Text>
              <Text style={styles.navItemDesc}>On-device speech to text</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => navigation.navigate('SecuritySettings')}
          >
            <View style={styles.navItemIcon}>
              <Icon name="lock" size={20} color={COLORS.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Security</Text>
              <Text style={styles.navItemDesc}>Passphrase and app lock</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => navigation.navigate('DeviceInfo')}
          >
            <View style={styles.navItemIcon}>
              <Icon name="smartphone" size={20} color={COLORS.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Device Information</Text>
              <Text style={styles.navItemDesc}>Hardware and compatibility</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.navItem, styles.navItemLast]}
            onPress={() => navigation.navigate('StorageSettings')}
          >
            <View style={styles.navItemIcon}>
              <Icon name="hard-drive" size={20} color={COLORS.textSecondary} />
            </View>
            <View style={styles.navItemContent}>
              <Text style={styles.navItemTitle}>Storage</Text>
              <Text style={styles.navItemDesc}>Models and data usage</Text>
            </View>
            <Icon name="chevron-right" size={20} color={COLORS.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Data Management */}
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Data Management</Text>
          <Button
            title="Clear All Conversations"
            variant="outline"
            onPress={handleClearConversations}
            style={styles.dangerButton}
          />
          <Button
            title="Reset App"
            variant="outline"
            onPress={handleResetApp}
            style={{ ...styles.dangerButton, marginBottom: 0 }}
          />
        </Card>

        {/* About */}
        <Card style={styles.section}>
          <View style={styles.aboutRow}>
            <Text style={styles.aboutLabel}>Version</Text>
            <Text style={styles.aboutValue}>1.0.0</Text>
          </View>
          <Text style={styles.aboutText}>
            Local LLM brings AI to your device without compromising your privacy.
          </Text>
        </Card>

        {/* Privacy */}
        <Card style={styles.privacyCard}>
          <View style={styles.privacyIconContainer}>
            <Icon name="shield" size={24} color={COLORS.textSecondary} />
          </View>
          <Text style={styles.privacyTitle}>Privacy First</Text>
          <Text style={styles.privacyText}>
            All your data stays on this device. No conversations, prompts, or
            personal information is ever sent to any server.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 24,
  },
  navSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    marginBottom: 16,
    overflow: 'hidden',
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navItemLast: {
    borderBottomWidth: 0,
  },
  navItemIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  navItemContent: {
    flex: 1,
  },
  navItemTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: COLORS.text,
  },
  navItemDesc: {
    fontSize: 13,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  dangerButton: {
    borderColor: COLORS.error,
    marginBottom: 12,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  aboutLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
  },
  aboutValue: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.text,
  },
  aboutText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  privacyCard: {
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
  },
  privacyIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  privacyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  privacyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});
