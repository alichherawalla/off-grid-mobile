import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Clipboard,
  Modal,
  TextInput,
  Animated,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { COLORS, TYPOGRAPHY, SPACING, FONTS } from '../constants';
import { Message } from '../types';
import { stripControlTokens } from '../utils/messageContent';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from './CustomAlert';

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
}

// Parse message content to extract <think> blocks
interface ParsedContent {
  thinking: string | null;
  response: string;
  isThinkingComplete: boolean;
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
  const thinkingContent = content.slice(thinkStart, thinkEnd).trim();
  const responseContent = content.slice(thinkEnd + thinkEndMatch[0].length).trim();

  return {
    thinking: thinkingContent,
    response: responseContent,
    isThinkingComplete: true
  };
}

// Animated thinking dots component
const ThinkingIndicator: React.FC = () => {
  const dot1Anim = useRef(new Animated.Value(0.3)).current;
  const dot2Anim = useRef(new Animated.Value(0.3)).current;
  const dot3Anim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const duration = 400;
    const sequence = Animated.loop(
      Animated.sequence([
        Animated.timing(dot1Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot1Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    const sequence2 = Animated.loop(
      Animated.sequence([
        Animated.delay(150),
        Animated.timing(dot2Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot2Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    const sequence3 = Animated.loop(
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(dot3Anim, { toValue: 1, duration, useNativeDriver: true }),
        Animated.timing(dot3Anim, { toValue: 0.3, duration, useNativeDriver: true }),
      ])
    );
    sequence.start();
    sequence2.start();
    sequence3.start();

    return () => {
      sequence.stop();
      sequence2.stop();
      sequence3.stop();
    };
  }, []);

  return (
    <View style={styles.thinkingContainer}>
      <View style={styles.thinkingDots}>
        <Animated.View style={[styles.thinkingDot, { opacity: dot1Anim }]} />
        <Animated.View style={[styles.thinkingDot, { opacity: dot2Anim }]} />
        <Animated.View style={[styles.thinkingDot, { opacity: dot3Anim }]} />
      </View>
      <Text style={styles.thinkingText}>Thinking...</Text>
    </View>
  );
};

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
}) => {
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

  return (
    <>
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
                <TouchableOpacity
                  key={attachment.id}
                  testID={isUser ? `message-attachment-${index}` : `generated-image`}
                  style={styles.attachmentWrapper}
                  onPress={() => onImagePress?.(attachment.uri)}
                  activeOpacity={0.8}
                >
                  <Image
                    testID={isUser ? `message-image-${index}` : `generated-image-content`}
                    source={{ uri: attachment.uri }}
                    style={styles.attachmentImage}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Text content */}
          {message.isThinking ? (
            <View testID="thinking-indicator"><ThinkingIndicator /></View>
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
                        {parsedContent.isThinkingComplete ? 'T' : '...'}
                      </Text>
                    </View>
                    <Text testID="thinking-block-title" style={styles.thinkingHeaderText}>
                      {parsedContent.isThinkingComplete ? 'Thought process' : 'Thinking...'}
                    </Text>
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
                  {isStreaming && <Text testID="streaming-cursor" style={styles.cursor}>|</Text>}
                </Text>
              ) : isStreaming && !parsedContent.isThinkingComplete ? (
                /* Still in thinking phase, show indicator */
                <View testID="streaming-thinking-hint" style={styles.streamingThinkingHint}>
                  <ThinkingIndicator />
                </View>
              ) : isStreaming ? (
                <Text testID="message-text" style={[styles.text, styles.assistantText]}>
                  <Text testID="streaming-cursor" style={styles.cursor}>|</Text>
                </Text>
              ) : null}
            </View>
          ) : isStreaming ? (
            <Text testID="message-text" style={[styles.text, styles.assistantText]}>
              <Text testID="streaming-cursor" style={styles.cursor}>|</Text>
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
        )}
      </TouchableOpacity>

      {/* Action Menu Modal */}
      <Modal
        visible={showActionMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowActionMenu(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowActionMenu(false)}
        >
          <View testID="action-menu" style={styles.actionMenu}>
            <TouchableOpacity testID="action-copy" style={styles.actionItem} onPress={handleCopy}>
              <View style={styles.actionIconBox}>
                <Text style={styles.actionIconText}>C</Text>
              </View>
              <Text style={styles.actionText}>Copy</Text>
            </TouchableOpacity>

            {isUser && onEdit && (
              <TouchableOpacity testID="action-edit" style={styles.actionItem} onPress={handleEdit}>
                <View style={styles.actionIconBox}>
                  <Text style={styles.actionIconText}>E</Text>
                </View>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}

            {onRetry && (
              <TouchableOpacity testID="action-retry" style={styles.actionItem} onPress={handleRetry}>
                <View style={styles.actionIconBox}>
                  <Text style={styles.actionIconText}>R</Text>
                </View>
                <Text style={styles.actionText}>
                  {isUser ? 'Resend' : 'Regenerate'}
                </Text>
              </TouchableOpacity>
            )}

            {canGenerateImage && onGenerateImage && (
              <TouchableOpacity testID="action-generate-image" style={styles.actionItem} onPress={handleGenerateImage}>
                <View style={[styles.actionIconBox, styles.actionIconBoxImage]}>
                  <Text style={styles.actionIconText}>I</Text>
                </View>
                <Text style={styles.actionText}>Generate Image</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              testID="action-cancel"
              style={[styles.actionItem, styles.actionItemCancel]}
              onPress={() => setShowActionMenu(false)}
            >
              <Text style={styles.actionTextCancel}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

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
              placeholderTextColor={COLORS.textMuted}
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

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
    paddingHorizontal: 16,
  },
  userContainer: {
    alignItems: 'flex-end',
  },
  assistantContainer: {
    alignItems: 'flex-start',
  },
  systemInfoContainer: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  systemInfoText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  bubble: {
    maxWidth: '85%',
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
    backgroundColor: COLORS.primary,
    borderBottomRightRadius: 4,
  },
  assistantBubble: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  attachmentsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 8,
  },
  attachmentWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
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
    color: COLORS.background,
    fontWeight: '400',
  },
  assistantText: {
    color: COLORS.text,
    fontWeight: '400',
  },
  cursor: {
    color: COLORS.primary,
    fontWeight: '300',
  },
  thinkingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  thinkingDots: {
    flexDirection: 'row',
    marginRight: 8,
  },
  thinkingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginHorizontal: 2,
  },
  thinkingText: {
    ...TYPOGRAPHY.body,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  thinkingBlock: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    marginBottom: 8,
    overflow: 'hidden',
  },
  thinkingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    gap: 6,
  },
  thinkingHeaderIconBox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: COLORS.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thinkingHeaderIconText: {
    ...TYPOGRAPHY.label,
    fontWeight: '600',
    color: COLORS.primary,
  },
  thinkingHeaderText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  thinkingToggle: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  thinkingBlockText: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textSecondary,
    lineHeight: 18,
    padding: SPACING.sm,
    paddingTop: 0,
    fontStyle: 'italic',
  },
  streamingThinkingHint: {
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    marginHorizontal: 8,
    gap: 8,
  },
  timestamp: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
  },
  generationTime: {
    ...TYPOGRAPHY.meta,
    fontWeight: '400',
    color: COLORS.primary,
  },
  actionHint: {
    padding: 4,
  },
  actionHintText: {
    ...TYPOGRAPHY.bodySmall,
    color: COLORS.textMuted,
    letterSpacing: 1,
  },
  generationMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 2,
    marginHorizontal: 8,
    gap: 3,
  },
  generationMetaText: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    flexShrink: 1,
  },
  generationMetaSep: {
    ...TYPOGRAPHY.meta,
    color: COLORS.textMuted,
    opacity: 0.5,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionMenu: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 8,
    minWidth: 200,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
  },
  actionItemCancel: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    justifyContent: 'center',
  },
  actionIconBox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionIconBoxImage: {
    backgroundColor: COLORS.info + '30',
  },
  actionIconText: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: COLORS.primary,
  },
  actionText: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
  },
  actionTextCancel: {
    ...TYPOGRAPHY.h2,
    color: COLORS.error,
    textAlign: 'center',
  },
  editModalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  editModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  editModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  editModalTitle: {
    ...TYPOGRAPHY.h1,
    fontSize: 18,
    color: COLORS.text,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  editInput: {
    ...TYPOGRAPHY.h2,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    padding: SPACING.md,
    color: COLORS.text,
    minHeight: 100,
    maxHeight: 200,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  editButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  editButtonCancel: {
    backgroundColor: COLORS.surface,
  },
  editButtonSave: {
    backgroundColor: COLORS.primary,
  },
  editButtonTextCancel: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    fontWeight: '500',
  },
  editButtonTextSave: {
    ...TYPOGRAPHY.h2,
    color: COLORS.text,
    fontWeight: '600',
  },
});
