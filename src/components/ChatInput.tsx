import React, { useState } from 'react';
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
import { COLORS } from '../constants';
import { MediaAttachment } from '../types';

interface ChatInputProps {
  onSend: (message: string, attachments?: MediaAttachment[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isGenerating?: boolean;
  placeholder?: string;
  supportsVision?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  onStop,
  disabled,
  isGenerating,
  placeholder = 'Type a message...',
  supportsVision = false,
}) => {
  const [message, setMessage] = useState('');
  const [attachments, setAttachments] = useState<MediaAttachment[]>([]);

  const handleSend = () => {
    if ((message.trim() || attachments.length > 0) && !disabled) {
      onSend(message.trim(), attachments.length > 0 ? attachments : undefined);
      setMessage('');
      setAttachments([]);
      Keyboard.dismiss();
    }
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

      <View style={styles.inputContainer}>
        {/* Image picker button - only show if vision is supported */}
        {supportsVision && (
          <TouchableOpacity
            style={styles.attachButton}
            onPress={handlePickImage}
            disabled={disabled || isGenerating}
          >
            <View style={styles.attachIcon}>
              <View style={styles.attachIconPlus} />
              <View style={[styles.attachIconPlus, styles.attachIconPlusVertical]} />
            </View>
          </TouchableOpacity>
        )}

        <TextInput
          style={[styles.input, !supportsVision && styles.inputNoAttach]}
          value={message}
          onChangeText={setMessage}
          placeholder={placeholder}
          placeholderTextColor={COLORS.textMuted}
          multiline
          maxLength={2000}
          editable={!disabled && !isGenerating}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />

        <TouchableOpacity
          style={[
            styles.sendButton,
            isGenerating ? styles.stopButton : null,
            !canSend && styles.sendButtonDisabled,
          ]}
          onPress={isGenerating ? handleStop : handleSend}
          disabled={!canSend && !isGenerating}
        >
          <View
            style={[
              styles.sendIcon,
              isGenerating ? styles.stopIcon : null,
            ]}
          />
        </TouchableOpacity>
      </View>

      {/* Vision support indicator */}
      {supportsVision && (
        <Text style={styles.visionHint}>This model supports images</Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
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
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: COLORS.surface,
    borderRadius: 24,
    paddingLeft: 4,
    paddingRight: 4,
    paddingVertical: 4,
    minHeight: 48,
  },
  attachButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  attachIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachIconPlus: {
    position: 'absolute',
    width: 12,
    height: 2,
    backgroundColor: COLORS.textSecondary,
    borderRadius: 1,
  },
  attachIconPlusVertical: {
    transform: [{ rotate: '90deg' }],
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: 16,
    maxHeight: 100,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  inputNoAttach: {
    paddingLeft: 12,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  sendIcon: {
    width: 0,
    height: 0,
    marginLeft: 4,
    borderLeftWidth: 10,
    borderLeftColor: COLORS.text,
    borderTopWidth: 6,
    borderTopColor: 'transparent',
    borderBottomWidth: 6,
    borderBottomColor: 'transparent',
  },
  stopIcon: {
    marginLeft: 0,
    borderLeftWidth: 0,
    width: 12,
    height: 12,
    backgroundColor: COLORS.text,
    borderRadius: 2,
  },
  visionHint: {
    fontSize: 11,
    color: COLORS.secondary,
    textAlign: 'center',
    marginTop: 4,
  },
});
