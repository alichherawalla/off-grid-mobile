import React, { useState } from 'react';
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
          {message.content ? (
            <Text
              style={[styles.text, isUser ? styles.userText : styles.assistantText]}
              selectable
            >
              {message.content}
              {isStreaming && <Text style={styles.cursor}>|</Text>}
            </Text>
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
              <Text style={styles.actionIcon}>📋</Text>
              <Text style={styles.actionText}>Copy</Text>
            </TouchableOpacity>

            {isUser && onEdit && (
              <TouchableOpacity style={styles.actionItem} onPress={handleEdit}>
                <Text style={styles.actionIcon}>✏️</Text>
                <Text style={styles.actionText}>Edit</Text>
              </TouchableOpacity>
            )}

            {onRetry && (
              <TouchableOpacity style={styles.actionItem} onPress={handleRetry}>
                <Text style={styles.actionIcon}>🔄</Text>
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
  actionIcon: {
    fontSize: 18,
    marginRight: 12,
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
