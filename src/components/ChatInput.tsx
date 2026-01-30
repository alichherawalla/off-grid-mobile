import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  Image,
  ScrollView,
  Text,
  Alert,
} from 'react-native';
import { launchImageLibrary, launchCamera, Asset } from 'react-native-image-picker';
import Icon from 'react-native-vector-icons/Feather';
import { COLORS } from '../constants';
import { MediaAttachment, ImageModeState } from '../types';
import { VoiceRecordButton } from './VoiceRecordButton';
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
  onOpenSettings,
  activeImageModelName,
}) => {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);
  const [imageMode, setImageMode] = useState<ImageModeState>('auto');

  const { settings } = useAppStore();

  // Track which conversation the recording was started in
  const recordingConversationIdRef = useRef<string | null>(null);

  const { downloadedModelId } = useWhisperStore();

  const {
    isRecording,
    isModelLoaded,
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
      Alert.alert(
        'No Image Model',
        'Download an image model from the Models screen to enable image generation.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Toggle between auto and force
    const newMode: ImageModeState = imageMode === 'auto' ? 'force' : 'auto';
    setImageMode(newMode);
    onImageModeChange?.(newMode);
  };

  const handleStop = () => {
    if (onStop && isGenerating) {
      onStop();
    }
  };

  const handlePickImage = () => {
    Alert.alert(
      'Add Image',
      'Choose image source',
      [
        {
          text: 'Camera',
          onPress: () => pickFromCamera(),
        },
        {
          text: 'Photo Library',
          onPress: () => pickFromLibrary(),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
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
    } catch (error) {
      console.error('Error picking image:', error);
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
    } catch (error) {
      console.error('Error taking photo:', error);
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

  const canSend = (message.trim() || attachments.length > 0) && !isGenerating;

  return (
    <View style={styles.container}>
      {/* Attachment Preview */}
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          style={styles.attachmentsContainer}
          contentContainerStyle={styles.attachmentsContent}
          showsHorizontalScrollIndicator={false}
        >
          {attachments.map(attachment => (
            <View key={attachment.id} style={styles.attachmentPreview}>
              <Image
                source={{ uri: attachment.uri }}
                style={styles.attachmentImage}
              />
              <TouchableOpacity
                style={styles.removeAttachment}
                onPress={() => removeAttachment(attachment.id)}
              >
                <Text style={styles.removeAttachmentText}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Text Input Row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={2000}
          editable={!disabled}
        />
      </View>

      {/* Toolbar Row */}
      <View style={styles.toolbarRow}>
        {/* Left side: Vision, Image Gen (manual only), Status */}
        <View style={styles.toolbarLeft}>
          {/* Image picker button - only show if vision is supported */}
          {supportsVision && (
            <TouchableOpacity
              style={styles.toolbarButton}
              onPress={handlePickImage}
              disabled={disabled || isGenerating}
            >
              <Icon name="camera" size={20} color={COLORS.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Image generation mode toggle - only show in manual mode */}
          {settings.imageGenerationMode === 'manual' && imageModelLoaded && (
            <TouchableOpacity
              style={[
                styles.imageGenButton,
                imageMode === 'force' && styles.imageGenButtonForce,
              ]}
              onPress={handleImageModeToggle}
              disabled={disabled || isGenerating}
            >
              <Icon
                name="image"
                size={18}
                color={imageMode === 'force' ? COLORS.primary : COLORS.textSecondary}
              />
              {imageMode === 'force' && (
                <Text style={styles.imageGenLabelForce}>ON</Text>
              )}
            </TouchableOpacity>
          )}

          {/* Status indicators */}
          <View style={styles.statusIndicators}>
            {supportsVision && (
              <Text style={styles.statusText}>Vision</Text>
            )}
            {activeImageModelName && settings.imageGenerationMode === 'auto' && (
              <Text style={styles.statusText} numberOfLines={1}>
                Auto: {activeImageModelName}
              </Text>
            )}
          </View>
        </View>

        {/* Right side: Send/Mic button (WhatsApp style) */}
        <View style={styles.toolbarRight}>
          {/* Show stop button when generating */}
          {isGenerating ? (
            <TouchableOpacity
              style={[styles.sendButton, styles.stopButton]}
              onPress={handleStop}
            >
              <Icon name="square" size={18} color={COLORS.text} />
            </TouchableOpacity>
          ) : canSend ? (
            /* Show send button when there's content */
            <TouchableOpacity
              style={styles.sendButton}
              onPress={handleSend}
            >
              <Icon name="send" size={18} color={COLORS.text} />
            </TouchableOpacity>
          ) : (
            /* Show mic button when input is empty (WhatsApp style) */
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
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  attachmentsContainer: {
    marginBottom: 8,
  },
  attachmentsContent: {
    gap: 8,
  },
  attachmentPreview: {
    position: 'relative',
    width: 60,
    height: 60,
    borderRadius: 8,
    overflow: 'hidden',
  },
  attachmentImage: {
    width: '100%',
    height: '100%',
  },
  removeAttachment: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: COLORS.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeAttachmentText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: -2,
  },
  inputRow: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginBottom: 8,
  },
  input: {
    color: COLORS.text,
    fontSize: 16,
    minHeight: 44,
    maxHeight: 100,
    textAlignVertical: 'top',
  },
  toolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  toolbarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toolbarButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageGenButton: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  imageGenButtonForce: {
    backgroundColor: COLORS.primary + '30',
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  imageGenLabelForce: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.primary,
  },
  statusIndicators: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 4,
    marginLeft: 4,
  },
  statusText: {
    fontSize: 11,
    color: COLORS.textMuted,
  },
  sendButton: {
    width: 44,
    height: 38,
    borderRadius: 19,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.surfaceLight,
  },
  stopButton: {
    backgroundColor: COLORS.error,
  },
});
