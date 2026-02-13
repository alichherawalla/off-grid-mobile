import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Clipboard,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  useReducedMotion,
  FadeIn,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { Message } from '../types';
import { stripControlTokens } from '../utils/messageContent';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from './CustomAlert';
import { ThinkingIndicator } from './ThinkingIndicator';
import { triggerHaptic } from '../utils/haptics';
import { AnimatedEntry } from './AnimatedEntry';
import { AnimatedPressable } from './AnimatedPressable';
import { AppSheet } from './AppSheet';


// Animated blinking cursor for streaming state
function BlinkingCursor() {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reducedMotion) return;
    opacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 400 }),
        withTiming(1, { duration: 400 }),
      ),
      -1,
      false,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.Text testID="streaming-cursor" style={[{ color: colors.primary, fontFamily: FONTS.mono, fontWeight: '300' as const }, style]}>
      _
    </Animated.Text>
  );
}

// Image with fade-in on load
function FadeInImage({
  uri,
  imageStyle,
  testID,
  wrapperTestID,
  onPress,
}: {
  uri: string;
  imageStyle: any;
  testID?: string;
  wrapperTestID?: string;
  onPress?: () => void;
}) {
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[fadeInImageStyles.wrapper, fadeStyle]}>
      <TouchableOpacity
        testID={wrapperTestID}
        style={fadeInImageStyles.wrapper}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Image
          testID={testID}
          source={{ uri }}
          style={imageStyle}
          resizeMode="cover"
          onLoad={() => { opacity.value = withTiming(1, { duration: 300 }); }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const fadeInImageStyles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
});

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onImagePress?: (uri: string) => void;
  onCopy?: (content: string) => void;
  onRetry?: (message: Message) => void;
  onEdit?: (message: Message, newContent: string) => void;
  onGenerateImage?: (prompt: string) => void;
  showActions?: boolean;
  canGenerateImage?: boolean;
  showGenerationDetails?: boolean;
  animateEntry?: boolean;
}

// Parse message content to extract <think> blocks
interface ParsedContent {
  thinking: string | null;
  response: string;
  isThinkingComplete: boolean;
  thinkingLabel?: string;
}

function parseThinkingContent(content: string): ParsedContent {
  // Check for <think> tags
  const thinkStartMatch = content.match(/<think>/i);
  const thinkEndMatch = content.match(/<\/think>/i);

  if (!thinkStartMatch) {
    // No thinking block
    return { thinking: null, response: content, isThinkingComplete: true };
  }

  const thinkStart = thinkStartMatch.index! + thinkStartMatch[0].length;

  if (!thinkEndMatch) {
    // Still thinking (no closing tag yet)
    const thinkingContent = content.slice(thinkStart);
    return {
      thinking: thinkingContent,
      response: '',
      isThinkingComplete: false
    };
  }

  const thinkEnd = thinkEndMatch.index!;
  let thinkingContent = content.slice(thinkStart, thinkEnd).trim();
  const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();

  // Check for custom label marker: __LABEL:Custom Label__
  let thinkingLabel: string | undefined;
  const labelMatch = thinkingContent.match(/^__LABEL:(.+?)__\n*/);
  if (labelMatch) {
    thinkingLabel = labelMatch[1];
    thinkingContent = thinkingContent.slice(labelMatch[0].length).trim();
  }

  return {
    thinking: thinkingContent,
    response: responseContent,
    isThinkingComplete: true,
    thinkingLabel
  };
}


export const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  isStreaming,
  onImagePress,
  onCopy,
  onRetry,
  onEdit,
  onGenerateImage,
  showActions = true,
  canGenerateImage = false,
  showGenerationDetails = false,
  animateEntry = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [showThinking, setShowThinking] = useState(false);
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const displayContent = message.role === 'assistant'
    ? stripControlTokens(message.content)
    : message.content;

  // Parse content for <think> blocks (only for assistant messages)
  const parsedContent = message.role === 'assistant'
    ? parseThinkingContent(displayContent)
    : { thinking: null, response: message.content, isThinkingComplete: true };


  const isUser = message.role === 'user';
  const hasAttachments = message.attachments && message.attachments.length > 0;

  const handleCopy = () => {
    Clipboard.setString(displayContent);
    triggerHaptic('notificationSuccess');
    if (onCopy) {
      onCopy(displayContent);
    }
    setShowActionMenu(false);
    setAlertState(showAlert('Copied', 'Message copied to clipboard'));
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry(message);
    }
    setShowActionMenu(false);
  };

  const handleEdit = () => {
    setEditedContent(message.content);
    setIsEditing(true);
    setShowActionMenu(false);
  };

  const handleSaveEdit = () => {
    if (onEdit && editedContent.trim() !== message.content) {
      onEdit(message, editedContent.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedContent(message.content);
    setIsEditing(false);
  };

  const handleLongPress = () => {
    if (showActions && !isStreaming) {
      triggerHaptic('impactMedium');
      setShowActionMenu(true);
    }
  };

  const handleGenerateImage = () => {
    if (onGenerateImage) {
      // Extract a prompt from the message - use the main response without thinking blocks
      const prompt = message.role === 'assistant'
        ? parsedContent.response.trim()
        : message.content.trim();
      // Limit prompt length for image generation
      const truncatedPrompt = prompt.slice(0, 500);
      onGenerateImage(truncatedPrompt);
    }
    setShowActionMenu(false);
  };

  // Render system info messages (model loaded/unloaded) differently
  if (message.isSystemInfo) {
    return (
      <>
        <View testID="system-info-message" style={styles.systemInfoContainer}>
          <Text style={styles.systemInfoText}>{displayContent}</Text>
        </View>
        <CustomAlert
          visible={alertState.visible}
          title={alertState.title}
          message={alertState.message}
          buttons={alertState.buttons}
          onClose={() => setAlertState(hideAlert())}
        />
      </>
    );
  }

  const messageBody = (
      <TouchableOpacity
        testID={isUser ? 'user-message' : 'assistant-message'}
        style={[
          styles.container,
          isUser ? styles.userContainer : styles.assistantContainer,
        ]}
        onLongPress={handleLongPress}
        activeOpacity={0.8}
        delayLongPress={300}
      >
        <View
          style={[
            styles.bubble,
            isUser ? styles.userBubble : styles.assistantBubble,
            hasAttachments && styles.bubbleWithAttachments,
          ]}
        >
          {/* Attachments */}
          {hasAttachments && (
            <View testID="message-attachments" style={styles.attachmentsContainer}>
              {message.attachments!.map((attachment, index) => (
                <FadeInImage
                  key={attachment.id}
                  uri={attachment.uri}
                  imageStyle={styles.attachmentImage}
                  wrapperTestID={isUser ? `message-attachment-${index}` : `generated-image`}
                  testID={isUser ? `message-image-${index}` : `generated-image-content`}
                  onPress={() => onImagePress?.(attachment.uri)}
                />
              ))}
            </View>
          )}

          {/* Text content */}
          {message.isThinking ? (
            <View testID="thinking-indicator"><ThinkingIndicator text={message.content} /></View>
          ) : message.content ? (
            <View>
              {/* Thinking block for assistant messages */}
              {parsedContent.thinking && (
                <View testID="thinking-block" style={styles.thinkingBlock}>
                  <TouchableOpacity
                    testID="thinking-block-toggle"
                    style={styles.thinkingHeader}
                    onPress={() => setShowThinking(!showThinking)}
                  >
                    <View style={styles.thinkingHeaderIconBox}>
                      <Text style={styles.thinkingHeaderIconText}>
                        {parsedContent.thinkingLabel?.includes('Enhanced')
                          ? 'E'
                          : parsedContent.isThinkingComplete ? 'T' : '...'}
                      </Text>
                    </View>
                    <View style={styles.thinkingHeaderTextContainer}>
                      <Text testID="thinking-block-title" style={styles.thinkingHeaderText}>
                        {parsedContent.thinkingLabel || (parsedContent.isThinkingComplete ? 'Thought process' : 'Thinking...')}
                      </Text>
                      {!showThinking && parsedContent.thinking && (
                        <Text style={styles.thinkingPreview} numberOfLines={2} ellipsizeMode="tail">
                          {parsedContent.thinking.slice(0, 80)}
                          {parsedContent.thinking.length > 80 ? '...' : ''}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.thinkingToggle}>
                      {showThinking ? '▼' : '▶'}
                    </Text>
                  </TouchableOpacity>
                  {showThinking && (
                    <Text testID="thinking-block-content" style={styles.thinkingBlockText} selectable>
                      {parsedContent.thinking}
                    </Text>
                  )}
                </View>
              )}

              {/* Main response */}
              {parsedContent.response ? (
                <Text
                  testID="message-text"
                  style={[styles.text, isUser ? styles.userText : styles.assistantText]}
                  selectable
                >
                  {parsedContent.response}
                  {isStreaming && <BlinkingCursor />}
                </Text>
              ) : isStreaming && !parsedContent.isThinkingComplete ? (
                /* Still in thinking phase, show indicator */
                <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
                  <ThinkingIndicator />
                </View>
              ) : isStreaming ? (
                <Text testID="message-text" style={[styles.text, styles.assistantText]}>
                  <BlinkingCursor />
                </Text>
              ) : null}
            </View>
          ) : isStreaming ? (
            <Text testID="message-text" style={[styles.text, styles.assistantText]}>
              <BlinkingCursor />
            </Text>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
          {message.generationTimeMs && message.role === 'assistant' && (
            <Text style={styles.generationTime}>
              {formatDuration(message.generationTimeMs)}
            </Text>
          )}
          {showActions && !isStreaming && (
            <TouchableOpacity
              style={styles.actionHint}
              onPress={() => setShowActionMenu(true)}
            >
              <Text style={styles.actionHintText}>•••</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Generation details */}
        {showGenerationDetails && message.generationMeta && message.role === 'assistant' && (
          <Animated.View
            entering={FadeIn.duration(250)}
          >
          <View testID="generation-meta" style={styles.generationMetaRow}>
            <Text style={styles.generationMetaText}>
              {message.generationMeta.gpuBackend || (message.generationMeta.gpu ? 'GPU' : 'CPU')}
              {message.generationMeta.gpuLayers != null && message.generationMeta.gpuLayers > 0
                ? ` (${message.generationMeta.gpuLayers}L)`
                : ''}
            </Text>
            {message.generationMeta.modelName && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText} numberOfLines={1}>
                  {message.generationMeta.modelName}
                </Text>
              </>
            )}
            {(message.generationMeta.decodeTokensPerSecond ?? message.generationMeta.tokensPerSecond) != null &&
              (message.generationMeta.decodeTokensPerSecond ?? message.generationMeta.tokensPerSecond)! > 0 && (
                <>
                  <Text style={styles.generationMetaSep}>·</Text>
                  <Text style={styles.generationMetaText}>
                    {(message.generationMeta.decodeTokensPerSecond ?? message.generationMeta.tokensPerSecond)!.toFixed(1)} tok/s
                  </Text>
                </>
              )}
            {message.generationMeta.timeToFirstToken != null && message.generationMeta.timeToFirstToken > 0 && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText}>
                  TTFT {message.generationMeta.timeToFirstToken.toFixed(1)}s
                </Text>
              </>
            )}
            {message.generationMeta.tokenCount != null && message.generationMeta.tokenCount > 0 && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText}>
                  {message.generationMeta.tokenCount} tokens
                </Text>
              </>
            )}
            {message.generationMeta.steps != null && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText}>
                  {message.generationMeta.steps} steps
                </Text>
              </>
            )}
            {message.generationMeta.guidanceScale != null && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText}>
                  cfg {message.generationMeta.guidanceScale}
                </Text>
              </>
            )}
            {message.generationMeta.resolution && (
              <>
                <Text style={styles.generationMetaSep}>·</Text>
                <Text style={styles.generationMetaText}>
                  {message.generationMeta.resolution}
                </Text>
              </>
            )}
          </View>
          </Animated.View>
        )}
      </TouchableOpacity>
  );

  return (
    <>
      {animateEntry ? <AnimatedEntry index={0}>{messageBody}</AnimatedEntry> : messageBody}

      {/* Action Sheet */}
      <AppSheet
        visible={showActionMenu}
        onClose={() => setShowActionMenu(false)}
        enableDynamicSizing
        title="Actions"
      >
        <View testID="action-menu" style={styles.actionSheetContent}>
          <AnimatedPressable
            testID="action-copy"
            hapticType="selection"
            style={styles.actionSheetItem}
            onPress={handleCopy}
          >
            <Icon name="copy" size={18} color={colors.textSecondary} />
            <Text style={styles.actionSheetText}>Copy</Text>
          </AnimatedPressable>

          {isUser && onEdit && (
            <AnimatedPressable
              testID="action-edit"
              hapticType="selection"
              style={styles.actionSheetItem}
              onPress={handleEdit}
            >
              <Icon name="edit-2" size={18} color={colors.textSecondary} />
              <Text style={styles.actionSheetText}>Edit</Text>
            </AnimatedPressable>
          )}

          {onRetry && (
            <AnimatedPressable
              testID="action-retry"
              hapticType="selection"
              style={styles.actionSheetItem}
              onPress={handleRetry}
            >
              <Icon name="refresh-cw" size={18} color={colors.textSecondary} />
              <Text style={styles.actionSheetText}>
                {isUser ? 'Resend' : 'Regenerate'}
              </Text>
            </AnimatedPressable>
          )}

          {canGenerateImage && onGenerateImage && (
            <AnimatedPressable
              testID="action-generate-image"
              hapticType="selection"
              style={styles.actionSheetItem}
              onPress={handleGenerateImage}
            >
              <Icon name="image" size={18} color={colors.textSecondary} />
              <Text style={styles.actionSheetText}>Generate Image</Text>
            </AnimatedPressable>
          )}
        </View>
      </AppSheet>

      {/* Edit Modal */}
      <Modal
        visible={isEditing}
        transparent
        animationType="slide"
        onRequestClose={handleCancelEdit}
        statusBarTranslucent
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.editModalOverlay}
        >
          <TouchableOpacity
            style={styles.editModalBackdrop}
            activeOpacity={1}
            onPress={handleCancelEdit}
          />
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Message</Text>
            <TextInput
              style={styles.editInput}
              defaultValue={message.content}
              onChangeText={setEditedContent}
              multiline
              autoFocus
              placeholder="Enter message..."
              placeholderTextColor={colors.textMuted}
              textAlignVertical="top"
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={[styles.editButton, styles.editButtonCancel]}
                onPress={handleCancelEdit}
              >
                <Text style={styles.editButtonTextCancel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.editButton, styles.editButtonSave]}
                onPress={handleSaveEdit}
              >
                <Text style={styles.editButtonTextSave}>Save & Resend</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* CustomAlert */}
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </>
  );
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  userContainer: {
    alignItems: 'flex-end' as const,
  },
  assistantContainer: {
    alignItems: 'flex-start' as const,
  },
  systemInfoContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center' as const,
  },
  systemInfoText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    textAlign: 'center' as const,
  },
  bubble: {
    maxWidth: '85%' as const,
    borderRadius: 8,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  bubbleWithAttachments: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 12,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 4,
  },
  attachmentsContainer: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 4,
    marginBottom: 8,
  },
  attachmentWrapper: {
    borderRadius: 12,
    overflow: 'hidden' as const,
  },
  attachmentImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
  },
  text: {
    ...TYPOGRAPHY.body,
    lineHeight: 20,
    paddingHorizontal: 0,
  },
  userText: {
    color: colors.background,
    fontWeight: '400' as const,
  },
  assistantText: {
    color: colors.text,
    fontWeight: '400' as const,
  },
  cursor: {
    color: colors.primary,
    fontWeight: '300' as const,
  },
  thinkingContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 4,
  },
  thinkingDots: {
    flexDirection: 'row' as const,
    marginRight: 8,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginHorizontal: 2,
  },
  thinkingText: {
    ...TYPOGRAPHY.body,
    color: colors.textSecondary,
    fontStyle: 'italic' as const,
  },
  thinkingBlock: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden' as const,
    minWidth: 260,
  },
  thinkingHeader: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    padding: 8,
    gap: 6,
  },
  thinkingHeaderIconBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: colors.primary + '30',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  thinkingHeaderIconText: {
    ...TYPOGRAPHY.label,
    fontWeight: '600' as const,
    color: colors.primary,
  },
  thinkingHeaderTextContainer: {
    flex: 1,
    marginRight: SPACING.xs,
  },
  thinkingHeaderText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    fontWeight: '500' as const,
  },
  thinkingPreview: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.text,
    marginTop: 6,
    lineHeight: 18,
    opacity: 0.8,
  },
  thinkingToggle: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  thinkingBlockText: {
    ...TYPOGRAPHY.h3,
    color: colors.textSecondary,
    lineHeight: 18,
    padding: SPACING.sm,
    paddingTop: 0,
    fontStyle: 'italic' as const,
  },
  streamingThinkingHint: {
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginTop: 4,
    marginHorizontal: 8,
    gap: 8,
  },
  timestamp: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
  },
  generationTime: {
    ...TYPOGRAPHY.meta,
    fontWeight: '400' as const,
    color: colors.primary,
  },
  actionHint: {
    padding: 4,
  },
  actionHintText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    letterSpacing: 1,
  },
  generationMetaRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    alignItems: 'center' as const,
    marginTop: 2,
    marginHorizontal: 8,
    gap: 3,
  },
  generationMetaText: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    flexShrink: 1,
  },
  generationMetaSep: {
    ...TYPOGRAPHY.meta,
    color: colors.textMuted,
    opacity: 0.5,
  },
  actionSheetContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  actionSheetItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionSheetText: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  editModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end' as const,
  },
  editModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  editModal: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  editModalTitle: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    color: colors.text,
    marginBottom: SPACING.lg,
    textAlign: 'center' as const,
  },
  editInput: {
    ...TYPOGRAPHY.h2,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    color: colors.text,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top' as const,
  },
  editActions: {
    flexDirection: 'row' as const,
    gap: 12,
    marginTop: 16,
  },
  editButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center' as const,
  },
  editButtonCancel: {
    backgroundColor: colors.surface,
  },
  editButtonSave: {
    backgroundColor: 'transparent' as const,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  editButtonTextCancel: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '500' as const,
  },
  editButtonTextSave: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '600' as const,
  },
});
