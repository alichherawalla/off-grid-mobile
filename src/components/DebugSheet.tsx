import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { AppSheet } from './AppSheet';
import { COLORS, TYPOGRAPHY, SPACING, APP_CONFIG } from '../constants';
import { DebugInfo, Project, Conversation } from '../types';

interface DebugSheetProps {
  visible: boolean;
  onClose: () => void;
  debugInfo: DebugInfo | null;
  activeProject: Project | null;
  settings: { systemPrompt?: string };
  activeConversation: Conversation | null;
}

export const DebugSheet: React.FC<DebugSheetProps> = ({
  visible,
  onClose,
  debugInfo,
  activeProject,
  settings,
  activeConversation,
}) => {
  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      snapPoints={['35%', '65%', '90%']}
      title="Debug Info"
    >
      <ScrollView style={styles.debugContent}>
        {/* Context Stats */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Context Stats</Text>
          <View style={styles.debugStats}>
            <View style={styles.debugStat}>
              <Text style={styles.debugStatValue}>
                {debugInfo?.estimatedTokens || 0}
              </Text>
              <Text style={styles.debugStatLabel}>Tokens Used</Text>
            </View>
            <View style={styles.debugStat}>
              <Text style={styles.debugStatValue}>
                {debugInfo?.maxContextLength || APP_CONFIG.maxContextLength}
              </Text>
              <Text style={styles.debugStatLabel}>Max Context</Text>
            </View>
            <View style={styles.debugStat}>
              <Text style={styles.debugStatValue}>
                {(debugInfo?.contextUsagePercent || 0).toFixed(1)}%
              </Text>
              <Text style={styles.debugStatLabel}>Usage</Text>
            </View>
          </View>
          <View style={styles.contextBar}>
            <View
              style={[
                styles.contextBarFill,
                { width: `${Math.min(debugInfo?.contextUsagePercent || 0, 100)}%` }
              ]}
            />
          </View>
        </View>

        {/* Message Stats */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Message Stats</Text>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>Original Messages:</Text>
            <Text style={styles.debugValue}>{debugInfo?.originalMessageCount || 0}</Text>
          </View>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>After Context Mgmt:</Text>
            <Text style={styles.debugValue}>{debugInfo?.managedMessageCount || 0}</Text>
          </View>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>Truncated:</Text>
            <Text style={[styles.debugValue, debugInfo?.truncatedCount ? styles.debugWarning : null]}>
              {debugInfo?.truncatedCount || 0}
            </Text>
          </View>
        </View>

        {/* Active Project */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Active Project</Text>
          <View style={styles.debugRow}>
            <Text style={styles.debugLabel}>Name:</Text>
            <Text style={styles.debugValue}>{activeProject?.name || 'Default'}</Text>
          </View>
        </View>

        {/* System Prompt */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>System Prompt</Text>
          <View style={styles.debugCodeBlock}>
            <Text style={styles.debugCode} selectable>
              {debugInfo?.systemPrompt || settings.systemPrompt || APP_CONFIG.defaultSystemPrompt}
            </Text>
          </View>
        </View>

        {/* Formatted Prompt (Last Sent) */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>Last Formatted Prompt</Text>
          <Text style={styles.debugHint}>
            This is the exact prompt sent to the LLM (ChatML format)
          </Text>
          <View style={styles.debugCodeBlock}>
            <Text style={styles.debugCode} selectable>
              {debugInfo?.formattedPrompt || 'Send a message to see the formatted prompt'}
            </Text>
          </View>
        </View>

        {/* Current Conversation Messages */}
        <View style={styles.debugSection}>
          <Text style={styles.debugSectionTitle}>
            Conversation Messages ({activeConversation?.messages.length || 0})
          </Text>
          {(activeConversation?.messages || []).map((msg, index) => (
            <View key={msg.id} style={styles.debugMessage}>
              <View style={styles.debugMessageHeader}>
                <Text style={[
                  styles.debugMessageRole,
                  msg.role === 'user' ? styles.debugRoleUser : styles.debugRoleAssistant
                ]}>
                  {msg.role.toUpperCase()}
                </Text>
                <Text style={styles.debugMessageIndex}>#{index + 1}</Text>
              </View>
              <Text style={styles.debugMessageContent} numberOfLines={3}>
                {msg.content}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </AppSheet>
  );
};

const styles = StyleSheet.create({
  debugContent: {
    padding: 16,
  },
  debugSection: {
    marginBottom: 20,
  },
  debugSectionTitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
    marginBottom: SPACING.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  debugStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 12,
  },
  debugStat: {
    alignItems: 'center',
  },
  debugStatValue: {
    ...TYPOGRAPHY.h1,
    fontWeight: '700',
    color: COLORS.text,
  },
  debugStatLabel: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    marginTop: 2,
  },
  contextBar: {
    height: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 4,
    overflow: 'hidden',
  },
  contextBarFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
    borderRadius: 4,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.surface,
  },
  debugLabel: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
  },
  debugValue: {
    ...TYPOGRAPHY.h3,
    color: COLORS.text,
    fontWeight: '500',
  },
  debugWarning: {
    color: COLORS.warning,
  },
  debugCodeBlock: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  debugCode: {
    ...TYPOGRAPHY.meta,
    color: COLORS.text,
    lineHeight: 16,
  },
  debugHint: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    fontStyle: 'italic',
    marginBottom: SPACING.sm,
  },
  debugMessage: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  debugMessageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  debugMessageRole: {
    ...TYPOGRAPHY.meta,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  debugRoleUser: {
    backgroundColor: COLORS.primary + '30',
    color: COLORS.primary,
  },
  debugRoleAssistant: {
    backgroundColor: COLORS.info + '30',
    color: COLORS.info,
  },
  debugMessageIndex: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  debugMessageContent: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textSecondary,
    lineHeight: 16,
  },
});
