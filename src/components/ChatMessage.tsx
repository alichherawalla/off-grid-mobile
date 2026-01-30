import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  Clipboard,
  Alert,
  Modal,
  TextInput,
  Animated,
} from 'react-native';
import { COLORS } from '../constants';
import { Message } from '../types';

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onImagePress?: (uri: string) => void;
  onCopy?: (content: string) => void;
  onRetry?: (message: Message) => void;
  onEdit?: (message: Message, newContent: string) => void;
  showActions?: boolean;
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
    const animateDots = () => {
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
    };
    animateDots();
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
  showActions = true,
}) => {
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(message.content);
  const [showThinking, setShowThinking] = useState(false);

  // Parse content for <think> blocks (only for assistant messages)
  const parsedContent = message.role === 'assistant'
    ? parseThinkingContent(message.content)
    : { thinking: null, response: message.content, isThinkingComplete: true };

  const isUser = message.role === 'user';
  const hasAttachments = message.attachments && message.attachments.length > 0;

  const handleCopy = () => {
    Clipboard.setString(message.content);
    if (onCopy) {
      onCopy(message.content);
    }
    setShowActionMenu(false);
    Alert.alert('Copied', 'Message copied to clipboard');
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

  return (
    <>
      <TouchableOpacity
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
            <View style={styles.attachmentsContainer}>
              {message.attachments!.map((attachment) => (
                <TouchableOpacity
                  key={attachment.id}
                  style={styles.attachmentWrapper}
                  onPress={() => onImagePress?.(attachment.uri)}
                  activeOpacity={0.8}
                >
                  <Image
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
            <ThinkingIndicator />
          ) : message.content ? (
            <View>
              {/* Thinking block for assistant messages */}
              {parsedContent.thinking && (
                <View style={styles.thinkingBlock}>
                  <TouchableOpacity
                    style={styles.thinkingHeader}
                    onPress={() => setShowThinking(!showThinking)}
                  >
                    <View style={styles.thinkingHeaderIconBox}>
                      <Text style={styles.thinkingHeaderIconText}>
                        {parsedContent.isThinkingComplete ? 'T' : '...'}
                      </Text>
                    </View>
                    <Text style={styles.thinkingHeaderText}>
                      {parsedContent.isThinkingComplete ? 'Thought process' : 'Thinking...'}
                    </Text>
                    <Text style={styles.thinkingToggle}>
                      {showThinking ? '▼' : '▶'}
                    </Text>
                  </TouchableOpacity>
                  {showThinking && (
                    <Text style={styles.thinkingBlockText} selectable>
                      {parsedContent.thinking}
                    </Text>
                  )}
                </View>
              )}

              {/* Main response */}
              {parsedContent.response ? (
                <Text
                  style={[styles.text, isUser ? styles.userText : styles.assistantText]}
                  selectable
                >
                  {parsedContent.response}
                  {isStreaming && <Text style={styles.cursor}>|</Text>}
                </Text>
              ) : isStreaming && !parsedContent.isThinkingComplete ? (
                /* Still in thinking phase, show indicator */
                <View style={styles.streamingThinkingHint}>
                  <ThinkingIndicator />
                </View>
              ) : isStreaming ? (
                <Text style={[styles.text, styles.assistantText]}>
                  <Text style={styles.cursor}>|</Text>
                </Text>
              ) : null}
            </View>
          ) : isStreaming ? (
            <Text style={[styles.text, styles.assistantText]}>
              <Text style={styles.cursor}>|</Text>
            </Text>
          ) : null}
        </View>

        <View style={styles.metaRow}>
          <Text style={styles.timestamp}>{formatTime(message.timestamp)}</Text>
          {showActions && !isStreaming && (
            <TouchableOpacity
              style={styles.actionHint}
              onPress={() => setShowActionMenu(true)}
            >
              <Text style={styles.actionHintText}>•••</Text>
            </TouchableOpacity>
          )}
        </View>
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
          <View style={styles.actionMenu}>
            <TouchableOpacity style={styles.actionItem} onPress={handleCopy}>
              <View style={styles.actionIconBox}>
                <Text style={styles.actionIconText}>C</Text>
              </View>
              <Text style={styles.actionText}>Copy</Text>
            </TouchableOpacity>

            {isUser && onEdit && (
              <TouchableOpacity style={styles.actionItem} onPress={handleEdit}>
                <View style={styles.actionIconBox}>
                  <Text style={styles.actionIconText}>E</Text>
                </View>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}

            {onRetry && (
              <TouchableOpacity style={styles.actionItem} onPress={handleRetry}>
                <View style={styles.actionIconBox}>
                  <Text style={styles.actionIconText}>R</Text>
                </View>
                <Text style={styles.actionText}>
                  {isUser ? 'Resend' : 'Regenerate'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
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
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModal}>
            <Text style={styles.editModalTitle}>Edit Message</Text>
            <TextInput
              style={styles.editInput}
              value={editedContent}
              onChangeText={setEditedContent}
              multiline
              autoFocus
              placeholder="Enter message..."
              placeholderTextColor={COLORS.textMuted}
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
        </View>
      </Modal>
    </>
  );
};

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  bubble: {
    maxWidth: '85%',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    width: 200,
    height: 150,
    borderRadius: 12,
  },
  text: {
    fontSize: 16,
    lineHeight: 22,
    paddingHorizontal: 0,
  },
  userText: {
    color: COLORS.text,
  },
  assistantText: {
    color: COLORS.text,
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
    color: COLORS.textSecondary,
    fontSize: 14,
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
    fontSize: 10,
    fontWeight: '600',
    color: COLORS.primary,
  },
  thinkingHeaderText: {
    flex: 1,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  thinkingToggle: {
    fontSize: 10,
    color: COLORS.textMuted,
  },
  thinkingBlockText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    lineHeight: 18,
    padding: 8,
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
    fontSize: 11,
    color: COLORS.textMuted,
  },
  actionHint: {
    padding: 4,
  },
  actionHintText: {
    fontSize: 12,
    color: COLORS.textMuted,
    letterSpacing: 1,
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
  actionIconText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
  },
  actionText: {
    fontSize: 16,
    color: COLORS.text,
  },
  actionTextCancel: {
    fontSize: 16,
    color: COLORS.error,
    textAlign: 'center',
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  editModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  editModalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  editInput: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    color: COLORS.text,
    fontSize: 16,
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
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '500',
  },
  editButtonTextSave: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
