import { useMemo, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import { useProjectStore } from '../../stores/projectStore';
import { useActiveMobileModel } from '../../hooks/useActiveMobileModel';
import { useMobileModelInventory } from '../../hooks/useMobileModelInventory';
import { useTheme } from '../../theme';
import type { OnboardingStep, ChecklistTheme } from './types';

export function useOnboardingSteps() {
  const onboardingChecklist = useAppStore(s => s.onboardingChecklist);
  const conversations = useChatStore(s => s.conversations);
  const projects = useProjectStore(s => s.projects);
  const availableModels = useMobileModelInventory();
  const activeText = useActiveMobileModel('text');
  const activeImage = useActiveMobileModel('image');
  const hasAnyModel = availableModels.length > 0;
  const hasActiveModel = activeText.model !== null || activeImage.model !== null;

  const steps: OnboardingStep[] = useMemo(() => [
    { id: 'downloadedModel', title: 'Download a model', subtitle: 'Browse and download an AI model', completed: hasAnyModel },
    { id: 'loadedModel', title: 'Load a model', subtitle: 'Select a model to activate it', completed: hasActiveModel },
    { id: 'sentMessage', title: 'Send your first message', subtitle: 'Start a conversation with AI', completed: conversations.some(c => c.messages.length > 0) },
    { id: 'triedImageGen', title: 'Try image generation', subtitle: 'Generate your first image', completed: onboardingChecklist.triedImageGen, disabled: activeText.model === null },
    { id: 'exploredSettings', title: 'Explore settings', subtitle: 'Configure your experience', completed: onboardingChecklist.exploredSettings },
    { id: 'createdProject', title: 'Create a project', subtitle: 'Organize chats by topic', completed: projects.length > 4 },
  ], [hasAnyModel, hasActiveModel, conversations, onboardingChecklist.exploredSettings, onboardingChecklist.triedImageGen, projects.length, activeText.model]);

  const completedCount = steps.filter(s => s.completed).length;

  return { steps, completedCount, totalCount: steps.length };
}

export function useChecklistTheme(): ChecklistTheme {
  const { colors } = useTheme();
  return useMemo(() => ({
    progressTrackColor: colors.border,
    progressFillColor: colors.primary,
    progressHeight: 4,
    progressBorderRadius: 2,
    progressTextColor: colors.textSecondary,
    progressTextFontSize: 11,
    itemSpacing: 2,
    itemTitleColor: colors.text,
    itemTitleCompletedColor: colors.textMuted,
    itemTitleFontSize: 13,
    itemSubtitleColor: colors.textSecondary,
    itemSubtitleFontSize: 12,
    itemPressedOpacity: 0.6,
    checkboxSize: 18,
    checkboxBorderColor: colors.border,
    checkboxBorderWidth: 1.5,
    checkboxBorderRadius: 9,
    checkboxCompletedBackground: colors.primary,
    checkboxCompletedBorderColor: colors.primary,
    checkmarkColor: '#FFFFFF',
    strikethroughColor: colors.textMuted,
    strikethroughHeight: 1.5,
    springDamping: 24,
    springStiffness: 140,
  }), [colors]);
}

export function useAutoDismiss(completedCount: number, totalCount: number) {
  const dismissChecklist = useAppStore(s => s.dismissChecklist);

  useEffect(() => {
    if (completedCount === totalCount && totalCount > 0) {
      const timeout = setTimeout(dismissChecklist, 3000);
      return () => clearTimeout(timeout);
    }
  }, [completedCount, totalCount, dismissChecklist]);
}
