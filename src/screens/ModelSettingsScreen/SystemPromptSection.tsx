import React, { useCallback } from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { useCommittedTextDraft } from '../../hooks/useCommittedTextDraft';
import { Button } from '../../components';
import { createStyles } from './styles';

const FALLBACK_PROMPT = 'You are a helpful AI assistant.';

/**
 * A LEAF draft component. Typing moves local state only: the committed prompt reaches the store
 * once, on Save, so a character can no longer trigger a settings replacement, an AsyncStorage
 * write, or a per-keystroke sync mutation. Partial text never becomes cross-device state.
 */
export const SystemPromptSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  // Narrow selectors: this section re-renders for the prompt alone, not for every setting.
  const committed = useAppStore(
    state => state.settings?.systemPrompt ?? FALLBACK_PROMPT,
  );
  const updateSettings = useAppStore(state => state.updateSettings);

  const commit = useCallback(
    (systemPrompt: string) => {
      updateSettings({ systemPrompt });
    },
    [updateSettings],
  );

  const draft = useCommittedTextDraft(committed, commit);

  return (
    <View style={styles.systemPromptContainer}>
      <Text style={styles.settingHelp}>
        Instructions given to the model before each conversation. Used when chatting without a project selected.
      </Text>
      <TextInput
        style={styles.textArea}
        value={draft.value}
        onChangeText={draft.setValue}
        multiline
        numberOfLines={4}
        placeholder="Enter system prompt..."
        placeholderTextColor={colors.textMuted}
        accessibilityLabel="System prompt"
      />
      {draft.error ? (
        <Text style={styles.draftError} accessibilityLiveRegion="polite">
          {draft.error}
        </Text>
      ) : null}
      {draft.isDirty ? (
        <View style={styles.draftActions}>
          <Button
            title="Save"
            size="medium"
            onPress={draft.save}
            loading={draft.saving}
            disabled={draft.saving}
            style={styles.flex1}
            accessibilityLabel="Save system prompt"
          />
          <Button
            title="Cancel"
            variant="secondary"
            size="medium"
            onPress={draft.revert}
            disabled={draft.saving}
            style={styles.flex1}
            accessibilityLabel="Discard system prompt changes"
          />
        </View>
      ) : null}
    </View>
  );
};
