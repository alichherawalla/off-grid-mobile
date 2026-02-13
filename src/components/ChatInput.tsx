import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Keyboard,
  Image,
  ScrollView,
  Text,
} from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { FONTS, SPACING } from '../constants';
import { MediaAttachment, ImageModeState } from '../types';
import { documentService } from '../services/documentService';
import { VoiceRecordButton } from './VoiceRecordButton';
import { triggerHaptic } from '../utils/haptics';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from './CustomAlert';
import { useWhisperTranscription } from '../hooks/useWhisperTranscription';
import { useWhisperStore, useAppStore } from '../stores';

interface ChatInputProps {
  onSend: (message: string, attachments?: MediaAttachment[], forceImageMode?: boolean) => void;
  onStop?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  supportsVision?: boolean;
  conversationId?: string | null;
  imageModelLoaded?: boolean;
  onImageModeChange?: (mode: ImageModeState) => void;
  onOpenSettings?: () => void;
  activeImageModelName?: string | null;
  queueCount?: number;
  queuedTexts?: string[];
  onClearQueue?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled,
  isGenerating,
  placeholder = 'Type a message...',
  supportsVision = false,
  conversationId,
  imageModelLoaded = false,
  onImageModeChange,
  onOpenSettings: _onOpenSettings,
  activeImageModelName,
  queueCount = 0,
  queuedTexts = [],
  onClearQueue,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);

  const { settings } = useAppStore();

  // Track which conversation the recording was started in
  const recordingConversationIdRef = useRef<string | null>(null);

  const { downloadedModelId } = useWhisperStore();

  const {
    isRecording,
    isModelLoading,
    isTranscribing,
    partialResult,
    finalResult,
    error,
    startRecording: startRecordingBase,
    stopRecording,
    clearResult,
  } = useWhisperTranscription();

  // Voice is available if whisper model is downloaded and loaded
  const voiceAvailable = !!downloadedModelId;

  // Wrap startRecording to track conversation ID
  const startRecording = async () => {
    recordingConversationIdRef.current = conversationId || null;
    await startRecordingBase();
  };

  // Clear pending transcription when conversation changes
  useEffect(() => {
    // If conversation changed while we had a pending result, clear it
    if (recordingConversationIdRef.current && recordingConversationIdRef.current !== conversationId) {
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [conversationId, clearResult]);

  // Insert transcribed text into message - only if same conversation
  useEffect(() => {
    if (finalResult) {
      // Only apply if we're still in the same conversation where recording started
      if (!recordingConversationIdRef.current || recordingConversationIdRef.current === conversationId) {
        setMessage(prev => {
          const prefix = prev.trim() ? prev.trim() + ' ' : '';
          return prefix + finalResult;
        });
      }
      clearResult();
      recordingConversationIdRef.current = null;
    }
  }, [finalResult, clearResult, conversationId]);

  const handleSend = () => {
    if ((message.trim() || attachments.length > 0) && !disabled) {
      triggerHaptic('impactMedium');
      const forceImage = imageMode === 'force';
      onSend(message.trim(), attachments.length > 0 ? attachments : undefined, forceImage);
      setMessage('');
      setAttachments([]);
      Keyboard.dismiss();
      // Reset to auto mode after sending with force mode
      if (forceImage) {
        setImageMode('auto');
        onImageModeChange?.('auto');
      }
    }
  };

  const handleImageModeToggle = () => {
    if (!imageModelLoaded) {
      setAlertState(showAlert(
        'No Image Model',
        'Download an image model from the Models screen to enable image generation.',
        [{ text: 'OK' }]
      ));
      return;
    }

    // Toggle between auto and force
    const newMode: ImageModeState = imageMode === 'auto' ? 'force' : 'auto';
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleStop = () => {
    if (onStop && isGenerating) {
      triggerHaptic('impactLight');
      onStop();
    }
  };

  const handlePickImage = () => {
    setAlertState(showAlert(
      'Add Image',
      'Choose image source',
      [
        {
          text: 'Camera',
          onPress: () => {
            setAlertState(hideAlert());
            // Delay picker launch to allow AppSheet modal close animation to finish
            setTimeout(pickFromCamera, 300);
          },
        },
        {
          text: 'Photo Library',
          onPress: () => {
            setAlertState(hideAlert());
            // Delay picker launch to allow AppSheet modal close animation to finish
            setTimeout(pickFromLibrary, 300);
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    ));
  };

  const pickFromLibrary = async () => {
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      });

      if (result.assets && result.assets.length > 0) {
        addAttachments(result.assets);
      }
    } catch (pickError) {
      console.error('Error picking image:', pickError);
    }
  };

  const pickFromCamera = async () => {
    try {
      const result = await launchCamera({
        mediaType: 'photo',
        quality: 0.8,
        maxWidth: 1024,
        maxHeight: 1024,
      });

      if (result.assets && result.assets.length > 0) {
        addAttachments(result.assets);
      }
    } catch (cameraError) {
      console.error('Error taking photo:', cameraError);
    }
  };

  const addAttachments = (assets: Asset[]) => {
    const newAttachments: MediaAttachment[] = assets
      .filter(asset => asset.uri)
      .map(asset => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'image' as const,
        uri: asset.uri!,
        mimeType: asset.type,
        width: asset.width,
        height: asset.height,
        fileName: asset.fileName,
      }));

    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const handlePickDocument = async () => {
    try {
      const result = await pick({
        type: [types.allFiles],
        allowMultiSelection: false,
      });

      const file = result[0];
      if (!file) return;

      const fileName = file.name || 'document';

      if (!documentService.isSupported(fileName)) {
        setAlertState(showAlert(
          'Unsupported File',
          `"${fileName}" is not supported. Supported types: txt, md, csv, json, pdf, and code files.`,
          [{ text: 'OK' }]
        ));
        return;
      }

      const attachment = await documentService.processDocumentFromPath(file.uri, fileName);
      if (attachment) {
        setAttachments(prev => [...prev, attachment]);
      }
    } catch (error: any) {
      if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return;
      console.error('Error picking document:', error);
      setAlertState(showAlert(
        'Error',
        error.message || 'Failed to read document',
        [{ text: 'OK' }]
      ));
    }
  };

  const canSend = (message.trim() || attachments.length > 0) && !disabled;

  return (
    <View style={styles.container}>
      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <ScrollView
          testID="attachments-container"
          horizontal
          style={styles.attachmentsContainer}
          contentContainerStyle={styles.attachmentsContent}
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map(attachment => (
            <View key={attachment.id} testID={`attachment-preview-${attachment.id}`} style={styles.attachmentPreview}>
              {attachment.type === 'image' ? (
                <Image
                  testID={`attachment-image-${attachment.id}`}
                  source={{ uri: attachment.uri }}
                  style={styles.attachmentImage}
                />
              ) : (
                <View testID={`document-preview-${attachment.id}`} style={styles.documentPreview}>
                  <Icon name="file-text" size={24} color={colors.primary} />
                  <Text style={styles.documentName} numberOfLines={2}>
                    {attachment.fileName || 'Document'}
                  </Text>
                </View>
              )}
              <TouchableOpacity
                testID={`remove-attachment-${attachment.id}`}
                style={styles.removeAttachment}
                onPress={() => removeAttachment(attachment.id)}
              >
                <Text style={styles.removeAttachmentText}>&times;</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      {/* Toolbar Row */}
      <View style={styles.toolbarRow}>
        {/* Left side: Vision, Image Gen (manual only), Status */}
        <View style={styles.toolbarLeft}>
          {/* Document picker button - always visible (works with any text model) */}
          <TouchableOpacity
            testID="document-picker-button"
            style={styles.toolbarButton}
            onPress={handlePickDocument}
            disabled={disabled}
          >
            <Icon name="paperclip" size={20} color={colors.textSecondary} />
          </TouchableOpacity>

          {/* Image picker button - only show if vision is supported */}
          {supportsVision && (
            <TouchableOpacity
              testID="camera-button"
              style={styles.toolbarButton}
              onPress={handlePickImage}
              disabled={disabled}
            >
              <Icon name="camera" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          )}


          {/* Image generation mode toggle - only show in manual mode */}
          {settings.imageGenerationMode === 'manual' && imageModelLoaded && (
            <TouchableOpacity
              testID="image-mode-toggle"
              style={[
                styles.imageGenButton,
                imageMode === 'force' && styles.imageGenButtonForce,
              ]}
              onPress={handleImageModeToggle}
              disabled={disabled}
            >
              <Icon
                name="zap"
                size={18}
                color={imageMode === 'force' ? colors.primary : colors.textSecondary}
              />
              {imageMode === 'force' && (
                <Text testID="image-mode-on-badge" style={styles.imageGenLabelForce}>ON</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Status indicators */}
          <View testID="status-indicators" style={styles.statusIndicators}>
            {supportsVision && (
              <Text testID="vision-indicator" style={styles.statusText}>Vision</Text>
            )}
            {activeImageModelName && settings.imageGenerationMode === 'auto' && (
              <Text testID="auto-image-model-indicator" style={styles.statusText} numberOfLines={1}>
                Auto: {activeImageModelName}
              </Text>
            )}
          </View>

          {/* Queue indicator */}
          {queueCount > 0 && (
            <View testID="queue-indicator" style={styles.queueBadge}>
              <Text style={styles.queueBadgeText}>
                {queueCount} queued
              </Text>
              {queuedTexts.length > 0 && (
                <Text style={styles.queuePreview} numberOfLines={1}>
                  {queuedTexts[0].length > 30
                    ? queuedTexts[0].substring(0, 30) + '...'
                    : queuedTexts[0]}
                </Text>
              )}
              <TouchableOpacity
                testID="clear-queue-button"
                onPress={onClearQueue}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon name="x" size={12} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
      {/* Text Input Row - Input + Send Button */}
      <View style={styles.inputRow}>
        <TextInput
          testID="chat-input"
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={2000}
          editable={!disabled}
        />
        {/* Action buttons on the right side of input */}
        <View style={styles.inputActions}>
          {isGenerating && onStop && (
            <TouchableOpacity
              testID="stop-button"
              style={[styles.sendButton, styles.stopButton]}
              onPress={handleStop}
            >
              <Icon name="square" size={16} color={colors.error} />
            </TouchableOpacity>
          )}
          {canSend ? (
            <TouchableOpacity
              testID="send-button"
              style={styles.sendButton}
              onPress={handleSend}
            >
              <Icon name="send" size={18} color={colors.text} />
            </TouchableOpacity>
          ) : !isGenerating ? (
            <VoiceRecordButton
              isRecording={isRecording}
              isAvailable={voiceAvailable}
              isModelLoading={isModelLoading}
              isTranscribing={isTranscribing}
              partialResult={partialResult}
              error={error}
              disabled={disabled}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onCancelRecording={() => {
                stopRecording();
                clearResult();
              }}
              asSendButton
            />
          ) : null}
        </View>
      </View>
      <CustomAlert
        visible={alertState.visible}
        title={alertState.title}
        message={alertState.message}
        buttons={alertState.buttons}
        onClose={() => setAlertState(hideAlert())}
      />
    </View>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  attachmentsContainer: {
    marginBottom: 8,
  },
  attachmentsContent: {
    gap: 8,
  },
  attachmentPreview: {
    position: 'relative' as const,
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  attachmentImage: {
    width: '100%' as const,
    height: '100%' as const,
  },
  documentPreview: {
    width: '100%' as const,
    height: '100%' as const,
    backgroundColor: colors.surface,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    padding: 4,
  },
  documentName: {
    fontSize: 10,
    fontFamily: FONTS.mono,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: 4,
  },
  removeAttachment: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.error,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  removeAttachmentText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold' as const,
    marginTop: -2,
  },
  inputRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    marginTop: SPACING.sm,
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontFamily: FONTS.mono,
    minHeight: 40,
    maxHeight: 100,
    textAlignVertical: 'top' as const,
  },
  inputActions: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 6,
    paddingBottom: 3,
  },
  toolbarRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  toolbarLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  toolbarRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  toolbarButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'transparent',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  imageGenButton: {
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    flexDirection: 'row' as const,
    gap: 4,
  },
  imageGenButtonForce: {
    backgroundColor: colors.surface,
    borderColor: colors.textSecondary,
  },
  imageGenLabelForce: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
  statusIndicators: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 4,
    marginLeft: 4,
  },
  statusText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    color: colors.textMuted,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  sendButtonDisabled: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    opacity: 0.5,
  },
  stopButton: {
    backgroundColor: colors.surface,
    borderColor: colors.textMuted,
  },
  queueBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.primary + '20',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  queueBadgeText: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '500' as const,
    color: colors.primary,
  },
  queuePreview: {
    fontSize: 11,
    fontFamily: FONTS.mono,
    fontWeight: '300' as const,
    color: colors.textMuted,
    maxWidth: 140,
  },
});
