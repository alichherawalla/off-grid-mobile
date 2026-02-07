/**
 * ChatInput Component Tests
 *
 * Tests for the message input component including:
 * - Text input and send
 * - Attachment handling (images, documents)
 * - Image generation mode toggle
 * - Voice recording
 * - Vision capabilities
 * - Disabled states
 */

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChatInput } from '../../../src/components/ChatInput';

// Mock image picker
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
  launchCamera: jest.fn(),
}));

// Mock document picker if used
jest.mock('react-native-document-picker', () => ({
  pick: jest.fn(),
}), { virtual: true });

// Mock the stores
const mockUseWhisperStore = jest.fn();
const mockUseAppStore = jest.fn();

jest.mock('../../../src/stores', () => ({
  useWhisperStore: () => mockUseWhisperStore(),
  useAppStore: () => mockUseAppStore(),
}));

// Mock the whisper hook
const mockUseWhisperTranscription = jest.fn();
jest.mock('../../../src/hooks/useWhisperTranscription', () => ({
  useWhisperTranscription: () => mockUseWhisperTranscription(),
}));

// Mock VoiceRecordButton component
jest.mock('../../../src/components/VoiceRecordButton', () => ({
  VoiceRecordButton: ({ testID, onStartRecording, onStopRecording, isRecording, isAvailable, disabled }: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity
        testID="voice-record-button"
        onPress={isRecording ? onStopRecording : onStartRecording}
        disabled={disabled || !isAvailable}
      >
        <Text>{isRecording ? 'Stop' : 'Mic'}</Text>
      </TouchableOpacity>
    );
  },
}));

describe('ChatInput', () => {
  const defaultProps = {
    onSend: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Set up default mock implementations
    mockUseWhisperStore.mockReturnValue({
      downloadedModelId: null,
    });

    mockUseAppStore.mockReturnValue({
      settings: {
        imageGenerationMode: 'manual',
      },
    });

    mockUseWhisperTranscription.mockReturnValue({
      isRecording: false,
      isModelLoaded: false,
      isModelLoading: false,
      isTranscribing: false,
      partialResult: '',
      finalResult: null,
      error: null,
      startRecording: jest.fn(),
      stopRecording: jest.fn(),
      clearResult: jest.fn(),
    });
  });

  // ============================================================================
  // Basic Input
  // ============================================================================
  describe('basic input', () => {
    it('renders text input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      expect(getByTestId('chat-input')).toBeTruthy();
    });

    it('renders text input with default placeholder', () => {
      const { getByPlaceholderText } = render(<ChatInput {...defaultProps} />);

      expect(getByPlaceholderText('Type a message...')).toBeTruthy();
    });

    it('updates input value on text change', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Hello world');

      expect(input.props.value).toBe('Hello world');
    });

    it('shows send button when text is entered', () => {
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} />
      );

      const input = getByTestId('chat-input');

      // Initially no send button (mic button shown instead)
      expect(queryByTestId('send-button')).toBeNull();

      // Enter text
      fireEvent.changeText(input, 'Message');

      // Send button should be visible
      expect(getByTestId('send-button')).toBeTruthy();
    });

    it('calls onSend with message content when send is pressed', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Test message');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        'Test message',
        undefined,
        false
      );
    });

    it('clears input after sending', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Test message');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // Input should be cleared
      expect(input.props.value).toBe('');
    });

    it('uses custom placeholder when provided', () => {
      const { getByPlaceholderText } = render(
        <ChatInput {...defaultProps} placeholder="Ask anything..." />
      );

      expect(getByPlaceholderText('Ask anything...')).toBeTruthy();
    });

    it('handles multiline input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Line 1\nLine 2\nLine 3');

      expect(input.props.value).toContain('Line 1');
      expect(input.props.value).toContain('Line 2');
      expect(input.props.value).toContain('Line 3');
    });

    it('handles long text input up to maxLength', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      const longText = 'a'.repeat(2000);
      fireEvent.changeText(input, longText);

      // Component has maxLength=2000
      expect(input.props.maxLength).toBe(2000);
    });
  });

  // ============================================================================
  // Disabled State
  // ============================================================================
  describe('disabled state', () => {
    it('disables input when disabled prop is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} disabled={true} />
      );

      const input = getByTestId('chat-input');
      expect(input.props.editable).toBe(false);
    });

    it('does not call onSend when disabled', () => {
      const onSend = jest.fn();
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} disabled={true} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Test');

      // Even if send button appears, pressing it shouldn't send
      const sendButton = queryByTestId('send-button');
      if (sendButton) {
        fireEvent.press(sendButton);
      }

      expect(onSend).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Generation State
  // ============================================================================
  describe('generation state', () => {
    it('shows stop button when isGenerating is true', () => {
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} />
      );

      // Stop button should be visible
      expect(getByTestId('stop-button')).toBeTruthy();
      // Send button should not be visible
      expect(queryByTestId('send-button')).toBeNull();
    });

    it('calls onStop when stop button is pressed', () => {
      const onStop = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} onStop={onStop} />
      );

      const stopButton = getByTestId('stop-button');
      fireEvent.press(stopButton);

      expect(onStop).toHaveBeenCalled();
    });

    it('hides mic button during generation', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} />
      );

      // Mic/voice button should not be visible
      expect(queryByTestId('voice-record-button')).toBeNull();
    });
  });

  // ============================================================================
  // Image Generation Mode
  // ============================================================================
  describe('image generation mode', () => {
    it('shows image mode toggle when imageModelLoaded is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} />
      );

      // Image toggle button should be visible (when settings.imageGenerationMode === 'manual')
      expect(getByTestId('image-mode-toggle')).toBeTruthy();
    });

    it('hides image mode toggle when imageModelLoaded is false', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={false} />
      );

      // Image toggle should be hidden
      expect(queryByTestId('image-mode-toggle')).toBeNull();
    });

    it('toggles image mode when toggle is pressed', () => {
      const onImageModeChange = jest.fn();
      const { getByTestId, queryByTestId } = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={true}
          onImageModeChange={onImageModeChange}
        />
      );

      const toggle = getByTestId('image-mode-toggle');
      fireEvent.press(toggle);

      expect(onImageModeChange).toHaveBeenCalledWith('force');

      // ON badge should appear
      expect(queryByTestId('image-mode-on-badge')).toBeTruthy();
    });

    it('shows ON badge when image mode is forced', () => {
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} />
      );

      // Toggle to force mode
      const toggle = getByTestId('image-mode-toggle');
      fireEvent.press(toggle);

      // Should show "ON" badge
      expect(queryByTestId('image-mode-on-badge')).toBeTruthy();
    });

    it('passes forceImageMode=true to onSend when in force mode', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput
          {...defaultProps}
          onSend={onSend}
          imageModelLoaded={true}
        />
      );

      // Enable force mode
      const toggle = getByTestId('image-mode-toggle');
      fireEvent.press(toggle);

      // Type and send
      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Generate an image');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // onSend should receive true for forceImageMode
      expect(onSend).toHaveBeenCalledWith(
        'Generate an image',
        undefined,
        true
      );
    });

    it('resets to auto mode after sending with force mode', () => {
      const onImageModeChange = jest.fn();
      const { getByTestId, queryByTestId } = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={true}
          onImageModeChange={onImageModeChange}
        />
      );

      // Enable force mode
      const toggle = getByTestId('image-mode-toggle');
      fireEvent.press(toggle);
      expect(onImageModeChange).toHaveBeenCalledWith('force');

      // Send message
      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Test');
      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // Should have reset to auto
      expect(onImageModeChange).toHaveBeenCalledWith('auto');
      // ON badge should be gone
      expect(queryByTestId('image-mode-on-badge')).toBeNull();
    });

    it('hides toggle when no image model is loaded', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={false} />
      );

      // Toggle is hidden when no model loaded
      expect(queryByTestId('image-mode-toggle')).toBeNull();
    });
  });

  // ============================================================================
  // Vision Capabilities
  // ============================================================================
  describe('vision capabilities', () => {
    it('shows camera button when supportsVision is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      // Camera button should be visible
      expect(getByTestId('camera-button')).toBeTruthy();
    });

    it('hides camera button when supportsVision is false', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={false} />
      );

      // Camera button should be hidden
      expect(queryByTestId('camera-button')).toBeNull();
    });

    it('shows Vision indicator when vision is supported', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      // Should show "Vision" badge
      expect(getByTestId('vision-indicator')).toBeTruthy();
    });
  });

  // ============================================================================
  // Attachments
  // ============================================================================
  describe('attachments', () => {
    it('shows custom alert when camera button is pressed', async () => {
      const { getByTestId, getByText } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      // Should show CustomAlert with camera/library options
      await waitFor(() => {
        expect(getByText('Add Image')).toBeTruthy();
        expect(getByText('Choose image source')).toBeTruthy();
      });
    });

    it('shows attachment preview after selecting image', async () => {
      const { launchImageLibrary } = require('react-native-image-picker');
      launchImageLibrary.mockResolvedValue({
        assets: [{
          uri: 'file:///selected-image.jpg',
          type: 'image/jpeg',
          width: 1024,
          height: 768,
        }],
      });

      const { getByTestId, getByText, queryByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      // Press camera button to show CustomAlert
      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      // Wait for CustomAlert to appear and press Photo Library button
      await waitFor(() => {
        expect(getByText('Photo Library')).toBeTruthy();
      });

      fireEvent.press(getByText('Photo Library'));

      await waitFor(() => {
        expect(queryByTestId('attachments-container')).toBeTruthy();
      });
    });

    it('can send message with attachment', async () => {
      const { launchImageLibrary } = require('react-native-image-picker');
      launchImageLibrary.mockResolvedValue({
        assets: [{
          uri: 'file:///test-image.jpg',
          type: 'image/jpeg',
          width: 512,
          height: 512,
          fileName: 'test-image.jpg',
        }],
      });

      const onSend = jest.fn();
      const { getByTestId, getByText } = render(
        <ChatInput {...defaultProps} onSend={onSend} supportsVision={true} />
      );

      // Add attachment via library
      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      // Wait for CustomAlert and press Photo Library
      await waitFor(() => {
        expect(getByText('Photo Library')).toBeTruthy();
      });

      fireEvent.press(getByText('Photo Library'));

      await waitFor(() => {
        expect(getByTestId('attachments-container')).toBeTruthy();
      });

      // Send button should be visible (can send with just attachment)
      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        '',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'image',
            uri: 'file:///test-image.jpg',
          }),
        ]),
        false
      );
    });

    it('clears attachments after sending', async () => {
      const { launchImageLibrary } = require('react-native-image-picker');
      launchImageLibrary.mockResolvedValue({
        assets: [{
          uri: 'file:///test-image.jpg',
          type: 'image/jpeg',
        }],
      });

      const onSend = jest.fn();
      const { getByTestId, getByText, queryByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} supportsVision={true} />
      );

      // Add attachment
      const cameraButton = getByTestId('camera-button');
      fireEvent.press(cameraButton);

      // Wait for CustomAlert and press Photo Library
      await waitFor(() => {
        expect(getByText('Photo Library')).toBeTruthy();
      });

      fireEvent.press(getByText('Photo Library'));

      await waitFor(() => {
        expect(queryByTestId('attachments-container')).toBeTruthy();
      });

      // Send
      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // Attachments should be cleared
      expect(queryByTestId('attachments-container')).toBeNull();
    });
  });

  // ============================================================================
  // Voice Recording
  // ============================================================================
  describe('voice recording', () => {
    it('shows mic button when input is empty and not generating', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={false} />
      );

      // Mic button should be visible when input is empty
      expect(getByTestId('voice-record-button')).toBeTruthy();
    });

    it('hides mic button when input has text', () => {
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Some text');

      // Mic button should be hidden, send button shown
      expect(queryByTestId('voice-record-button')).toBeNull();
      expect(getByTestId('send-button')).toBeTruthy();
    });
  });

  // ============================================================================
  // Status Indicators
  // ============================================================================
  describe('status indicators', () => {
    it('shows auto image model name when in auto mode', () => {
      // Override mock for auto mode
      mockUseAppStore.mockReturnValue({
        settings: {
          imageGenerationMode: 'auto',
        },
      });

      const { getByTestId } = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={true}
          activeImageModelName="SDXL Turbo"
        />
      );

      const indicator = getByTestId('auto-image-model-indicator');
      expect(indicator.props.children).toContain('SDXL Turbo');
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('edge cases', () => {
    it('handles rapid text input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');

      // Rapidly change text
      for (let i = 0; i < 100; i++) {
        fireEvent.changeText(input, `Text ${i}`);
      }

      // Should handle without crashing, final value is last input
      expect(input.props.value).toBe('Text 99');
    });

    it('does not send empty message', () => {
      const onSend = jest.fn();
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      // Send button shouldn't even be visible when empty
      expect(queryByTestId('send-button')).toBeNull();
      expect(onSend).not.toHaveBeenCalled();
    });

    it('does not send whitespace-only message', () => {
      const onSend = jest.fn();
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, '   \n   ');

      // Send button shouldn't be visible for whitespace-only
      expect(queryByTestId('send-button')).toBeNull();
    });

    it('trims whitespace from message', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, '  Hello  ');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // onSend should receive trimmed message
      expect(onSend).toHaveBeenCalledWith('Hello', undefined, false);
    });

    it('handles special characters', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, '<script>alert("test")</script>');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // Should handle safely, message passed as-is
      expect(onSend).toHaveBeenCalledWith(
        '<script>alert("test")</script>',
        undefined,
        false
      );
    });

    it('handles emoji input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, '👋 Hello 🌍 World');

      expect(input.props.value).toBe('👋 Hello 🌍 World');
    });
  });
});
