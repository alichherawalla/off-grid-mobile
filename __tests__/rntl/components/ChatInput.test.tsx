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
import { voiceSession } from '../../../src/services/voiceSession';
import { recordingController } from '../../../src/services/recordingController';
import { Keyboard, Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ChatInput } from '../../../src/components/ChatInput';

const mockSelectMobileModel = jest.fn((_facts: unknown) => Promise.resolve());
jest.mock('../../../src/services/modelServices', () => ({
  selectMobileModel: (facts: any) => mockSelectMobileModel(facts),
}));

// Mock image picker
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(),
  launchCamera: jest.fn(),
}));

// Mock document picker — define mocks outside factory, use getter pattern
const mockPick = jest.fn();
const mockIsErrorWithCode = jest.fn(() => false);
jest.mock('@react-native-documents/picker', () => ({
  get pick() { return mockPick; },
  get isErrorWithCode() { return mockIsErrorWithCode; },
  types: { allFiles: '*/*' },
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

// Mock document service
const mockIsSupported = jest.fn(() => true);
const mockProcessDocument = jest.fn(() => Promise.resolve({
  id: 'doc-1',
  type: 'document' as const,
  uri: 'file:///mock/document.txt',
  fileName: 'document.txt',
  textContent: 'File content here',
  fileSize: 1234,
}));
jest.mock('../../../src/services/documentService', () => ({
  documentService: {
    get isSupported() { return mockIsSupported; },
    get processDocumentFromPath() { return mockProcessDocument; },
  },
}));

// Mock the stores
const mockUseWhisperStore = jest.fn();
const mockUseAppStore = jest.fn();
const mockRemoteServerState = { servers: [], activeServerId: null };
const mockUseUiModeStore = jest.fn((selector?: (s: { interfaceMode: string }) => unknown) => {
  const state = { interfaceMode: 'chat' };
  return selector ? selector(state) : state;
});

jest.mock('../../../src/stores', () => {
  const useUiModeStore = (selector?: (s: { interfaceMode: string }) => unknown) => mockUseUiModeStore(selector);
  useUiModeStore.getState = () => ({ interfaceMode: 'chat' });
  // activeModelService.supportsAudioInput() reads useAppStore.getState(), so the
  // mocked store needs getState too (mirrors the hook return).
  const useAppStore = () => mockUseAppStore();
  useAppStore.getState = () => mockUseAppStore();
  const useRemoteServerStore = (selector?: (state: typeof mockRemoteServerState) => unknown) =>
    selector ? selector(mockRemoteServerState) : mockRemoteServerState;
  useRemoteServerStore.getState = () => mockRemoteServerState;
  return {
    useWhisperStore: () => mockUseWhisperStore(),
    useAppStore,
    useRemoteServerStore,
    useUiModeStore,
  };
});

// Mock the whisper hook
const mockUseWhisperTranscription = jest.fn();
jest.mock('../../../src/hooks/useWhisperTranscription', () => ({
  useWhisperTranscription: () => mockUseWhisperTranscription(),
}));

// Mock VoiceRecordButton component
jest.mock('../../../src/components/VoiceRecordButton', () => ({
  VoiceRecordButton: ({ _testID, onStartRecording, onStopRecording, onCancelRecording, isRecording, isAvailable, disabled }: any) => {
    const { TouchableOpacity, Text, View } = require('react-native');
    return (
      <View>
        <TouchableOpacity
          testID="voice-record-button"
          onPress={isRecording ? onStopRecording : onStartRecording}
          disabled={disabled || !isAvailable}
        >
          <Text>{isRecording ? 'Stop' : 'Mic'}</Text>
        </TouchableOpacity>
        {onCancelRecording && (
          <TouchableOpacity
            testID="voice-cancel-button"
            onPress={onCancelRecording}
          >
            <Text>Cancel Recording</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  },
}));

describe('ChatInput', () => {
  const defaultProps = {
    onSend: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // The voice session and recording controller are module singletons; without a reset one test's
    // session state (a turn left mid-listen) leaks into the next, so a later tap is refused and the
    // test fails only WHEN RUN AFTER another - green in isolation, red in the suite.
    voiceSession._resetForTesting();
    recordingController._reset();
    jest.spyOn(Keyboard, 'dismiss');
    Object.defineProperty(Platform, 'OS', {
      configurable: true,
      value: 'android',
    });

    // Set up default mock implementations
    mockUseWhisperStore.mockReturnValue({
      downloadedModelId: null,
    });

    mockUseAppStore.mockReturnValue({
      settings: { thinkingEnabled: false },
      updateSettings: jest.fn(),
      downloadedModels: [],
      activeModelId: null,
      // handleImageModeToggle now gates on whether an image model is DOWNLOADED.
      // With no downloaded image models, toggling shows the 'No Image Model' alert.
      downloadedImageModels: [],
      setActiveImageModelId: jest.fn(),
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

  // Helpers for popover-based UI
  const openAttachPicker = (fns: { getByTestId: any }) => {
    fireEvent.press(fns.getByTestId('attach-button'));
  };
  const pressAttachDocument = (fns: { getByTestId: any }) => {
    openAttachPicker(fns);
    fireEvent.press(fns.getByTestId('attach-document'));
  };
  const pressAttachPhoto = (fns: { getByTestId: any }) => {
    openAttachPicker(fns);
    fireEvent.press(fns.getByTestId('attach-photo'));
  };
  const openQuickSettings = (fns: { getByTestId: any }) => {
    fireEvent.press(fns.getByTestId('quick-settings-button'));
  };
  const pressImageModeToggle = (fns: { getByTestId: any }) => {
    openQuickSettings(fns);
    fireEvent.press(fns.getByTestId('quick-image-mode'));
  };
  const renderRealAttachmentInput = async (
    props: Partial<React.ComponentProps<typeof ChatInput>> = {},
  ) => {
    jest.unmock('../../../src/services/modelServices');
    jest.unmock('../../../src/services/documentService');
    jest.unmock('../../../src/stores');
    jest.unmock('../../../src/hooks/useWhisperTranscription');
    jest.unmock('../../../src/components/VoiceRecordButton');
    const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
    const harness = await setupChatScreen({
      engine: 'llama',
      platform: 'android',
    });
    const RealChatInput = require('../../../src/components/ChatInput')
      .ChatInput as typeof ChatInput;
    const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
      supportsVision: true,
      onSend: jest.fn(),
      ...props,
    }));
    return { harness, view };
  };

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

      expect(getByPlaceholderText('Message')).toBeTruthy();
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
        'auto'
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

    it('handles long text input with no character limit', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      const longText = 'a'.repeat(5000);
      fireEvent.changeText(input, longText);

      // No maxLength prop - input should accept unlimited text
      expect(input.props.maxLength).toBeUndefined();
    });

    it('has multiline enabled with scrolling for expandable input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      expect(input.props.multiline).toBe(true);
      expect(input.props.scrollEnabled).toBe(true);
    });

    it('does not blur on submit to keep keyboard open for multiline', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      expect(input.props.blurOnSubmit).toBe(false);
    });

    it('keeps input focused after sending a message', () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Test message');

      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // Message should be sent and input cleared
      expect(onSend).toHaveBeenCalledWith('Test message', undefined, 'auto');
      expect(input.props.value).toBe('');

      // Keyboard.dismiss should NOT have been called (keyboard stays open)
      expect(Keyboard.dismiss).not.toHaveBeenCalled();
    });

    it('accepts text longer than 2000 characters', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      const veryLongText = 'a'.repeat(10000);
      fireEvent.changeText(input, veryLongText);

      // Input should accept the full text with no truncation
      expect(input.props.value).toBe(veryLongText);
      expect(input.props.value.length).toBe(10000);
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
    it('shows stop button next to input when isGenerating is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} onStop={jest.fn()} />
      );

      expect(getByTestId('stop-button')).toBeTruthy();
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

    it('shows send button (not stop) during generation when text entered for queuing', () => {
      const { getByTestId, queryByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} onStop={jest.fn()} />
      );

      fireEvent.changeText(getByTestId('chat-input'), 'queued message');
      // Send button takes priority over stop — allows queuing while generating
      expect(getByTestId('send-button')).toBeTruthy();
      expect(queryByTestId('stop-button')).toBeNull();
    });

    it('hides voice button during generation', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} onStop={jest.fn()} />
      );

      // Voice button hidden during generation — stop button takes its place (when no text entered)
      expect(queryByTestId('voice-record-button')).toBeNull();
    });
  });

  // ============================================================================
  // Image Generation Mode
  // ============================================================================
  describe('image generation mode', () => {
    it('shows quick settings button when imageModelLoaded is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} />
      );

      expect(getByTestId('quick-settings-button')).toBeTruthy();
    });

    it('shows quick settings button even when imageModelLoaded is false', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={false} />
      );

      expect(getByTestId('quick-settings-button')).toBeTruthy();
    });

    it('toggles image mode when toggle is pressed via quick settings', () => {
      const onImageModeChange = jest.fn();
      const result = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={true}
          onImageModeChange={onImageModeChange}
        />
      );

      pressImageModeToggle(result);

      expect(onImageModeChange).toHaveBeenCalledWith('force');
    });

    it('shows ON badge when image mode is forced', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} />
      );

      // Toggle to force mode via quick settings
      openQuickSettings({ getByTestId });
      fireEvent.press(getByTestId('quick-image-mode'));

      expect(getByTestId('image-mode-force-badge')).toBeTruthy();
    });

    it('passes imageMode=force to onSend when in force mode', () => {
      const onSend = jest.fn();
      const result = render(
        <ChatInput
          {...defaultProps}
          onSend={onSend}
          imageModelLoaded={true}
        />
      );

      // Enable force mode
      pressImageModeToggle(result);

      // Type and send
      const input = result.getByTestId('chat-input');
      fireEvent.changeText(input, 'Generate an image');

      const sendButton = result.getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        'Generate an image',
        undefined,
        'force'
      );
    });

    it('resets to auto mode after sending with force mode', () => {
      const onImageModeChange = jest.fn();
      const result = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={true}
          onImageModeChange={onImageModeChange}
        />
      );

      // Enable force mode
      pressImageModeToggle(result);
      expect(onImageModeChange).toHaveBeenCalledWith('force');

      // Send message
      const input = result.getByTestId('chat-input');
      fireEvent.changeText(input, 'Test');
      const sendButton = result.getByTestId('send-button');
      fireEvent.press(sendButton);

      // Should have reset to auto
      expect(onImageModeChange).toHaveBeenCalledWith('auto');
    });

    it('shows alert when toggling without image model loaded', () => {
      const { getByTestId, getByText } = render(
        <ChatInput {...defaultProps} imageModelLoaded={false} />
      );

      openQuickSettings({ getByTestId });
      fireEvent.press(getByTestId('quick-image-mode'));

      expect(getByText('No Image Model')).toBeTruthy();
    });

    it('cycles through auto -> force -> disabled -> auto', () => {
      const onImageModeChange = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} onImageModeChange={onImageModeChange} />
      );

      openQuickSettings({ getByTestId });
      const toggle = getByTestId('quick-image-mode');

      // Start at auto, toggle to force
      fireEvent.press(toggle);
      expect(onImageModeChange).toHaveBeenCalledWith('force');

      // Toggle to disabled
      fireEvent.press(toggle);
      expect(onImageModeChange).toHaveBeenCalledWith('disabled');

      // Toggle back to auto
      fireEvent.press(toggle);
      expect(onImageModeChange).toHaveBeenCalledWith('auto');
    });

    it('quick settings button is always visible regardless of props', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} imageModelLoaded={true} />
      );

      expect(getByTestId('quick-settings-button')).toBeTruthy();
    });
  });

  // ============================================================================
  // Vision Capabilities
  // ============================================================================
  describe('vision capabilities', () => {
    it('shows attach button when supportsVision is true', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      expect(getByTestId('attach-button')).toBeTruthy();
    });

    it('shows attach button even when supportsVision is false', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={false} />
      );

      expect(getByTestId('attach-button')).toBeTruthy();
    });

    it('shows alert when pressing photo without vision support', () => {
      const result = render(
        <ChatInput {...defaultProps} supportsVision={false} />
      );

      pressAttachPhoto(result);

      expect(result.getByText('Vision Not Supported')).toBeTruthy();
    });

    it('opens image picker when pressing photo with vision support', () => {
      const result = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      pressAttachPhoto(result);

      // Should show the Add Image alert with camera/library options
      expect(result.getByText('Add Image')).toBeTruthy();
    });

    it('attach button is present when vision is supported', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      expect(getByTestId('attach-button')).toBeTruthy();
    });
  });

  // ============================================================================
  // Attachments
  // ============================================================================
  describe('attachments', () => {
    it('shows custom alert when photo is pressed via attach picker', async () => {
      const result = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      pressAttachPhoto(result);

      // Should show CustomAlert with camera/library options
      await waitFor(() => {
        expect(result.getByText('Add Image')).toBeTruthy();
        expect(result.getByText('Choose image source')).toBeTruthy();
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

      const result = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      pressAttachPhoto(result);

      // Wait for CustomAlert to appear and press Photo Library button
      await waitFor(() => {
        expect(result.getByText('Photo Library')).toBeTruthy();
      });

      fireEvent.press(result.getByText('Photo Library'));

      await waitFor(() => {
        expect(result.queryByTestId('attachments-container')).toBeTruthy();
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
      const result = render(
        <ChatInput {...defaultProps} onSend={onSend} supportsVision={true} />
      );

      // Add attachment via attach picker → photo
      pressAttachPhoto(result);

      await waitFor(() => {
        expect(result.getByText('Photo Library')).toBeTruthy();
      });

      fireEvent.press(result.getByText('Photo Library'));

      await waitFor(() => {
        expect(result.getByTestId('attachments-container')).toBeTruthy();
      });

      const sendButton = result.getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        '',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'image',
            uri: 'file:///test-image.jpg',
          }),
        ]),
        'auto'
      );
    });

    it('renders attach button always', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} supportsVision={false} />
      );

      expect(getByTestId('attach-button')).toBeTruthy();
    });

    it('opens document picker when document is pressed via attach picker', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/document.txt',
        name: 'document.txt',
        type: 'text/plain',
        size: 1234,
      }]);

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(mockPick).toHaveBeenCalled();
        expect(result.queryByTestId('attachments-container')).toBeTruthy();
      });
    });

    it('shows error alert for unsupported file types', async () => {
      mockIsSupported.mockReturnValue(false);
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/file.docx',
        name: 'file.docx',
        type: 'application/vnd.openxmlformats',
        size: 5000,
      }]);

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(result.getByText('Unsupported File')).toBeTruthy();
      });

      mockIsSupported.mockReturnValue(true);
    });

    it('does nothing when document picker is cancelled', async () => {
      const cancelError = new Error('User cancelled');
      (cancelError as any).code = 'OPERATION_CANCELED';
      mockPick.mockRejectedValue(cancelError);
      mockIsErrorWithCode.mockReturnValue(true);

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(mockPick).toHaveBeenCalled();
      });

      expect(result.queryByTestId('attachments-container')).toBeNull();

      mockIsErrorWithCode.mockReturnValue(false);
    });

    it('shows document preview with file icon after picking document', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/data.csv',
        name: 'data.csv',
        type: 'text/csv',
        size: 2048,
      }]);
      mockProcessDocument.mockResolvedValue({
        id: 'doc-csv',
        type: 'document' as const,
        uri: 'file:///mock/data.csv',
        fileName: 'data.csv',
        textContent: 'col1,col2\nval1,val2',
        fileSize: 2048,
      });

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(result.getByText('data.csv')).toBeTruthy();
      });
    });

    it('sends message with document attachment', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/notes.txt',
        name: 'notes.txt',
        type: 'text/plain',
        size: 500,
      }]);
      mockProcessDocument.mockResolvedValue({
        id: 'doc-notes',
        type: 'document' as const,
        uri: 'file:///mock/notes.txt',
        fileName: 'notes.txt',
        textContent: 'My notes content',
        fileSize: 500,
      });

      const onSend = jest.fn();
      const result = render(
        <ChatInput {...defaultProps} onSend={onSend} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(result.getByTestId('attachments-container')).toBeTruthy();
      });

      const sendButton = result.getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        '',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'document',
            fileName: 'notes.txt',
          }),
        ]),
        'auto'
      );
    });

    it('shows error alert when processDocumentFromPath fails', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/bad-file.txt',
        name: 'bad-file.txt',
        type: 'text/plain',
        size: 100,
      }]);
      mockProcessDocument.mockRejectedValue(new Error('File is too large. Maximum size is 5MB'));

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(result.getByText('Error')).toBeTruthy();
        expect(result.getByText('File is too large. Maximum size is 5MB')).toBeTruthy();
      });

      mockProcessDocument.mockResolvedValue({
        id: 'doc-1',
        type: 'document' as const,
        uri: 'file:///mock/document.txt',
        fileName: 'document.txt',
        textContent: 'File content here',
        fileSize: 1234,
      });
    });

    it('handles processDocumentFromPath returning null', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/null-result.txt',
        name: 'null-result.txt',
        type: 'text/plain',
        size: 100,
      }]);
      mockProcessDocument.mockResolvedValue(null as any);

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(mockPick).toHaveBeenCalled();
      });

      expect(result.queryByTestId('attachments-container')).toBeNull();

      mockProcessDocument.mockResolvedValue({
        id: 'doc-1',
        type: 'document' as const,
        uri: 'file:///mock/document.txt',
        fileName: 'document.txt',
        textContent: 'File content here',
        fileSize: 1234,
      });
    });

    it('keeps attach button enabled during generation', () => {
      const { getByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} />
      );

      const button = getByTestId('attach-button');
      expect(button.props.accessibilityState?.disabled).toBeFalsy();
    });

    it('can remove a document attachment from preview', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/removable.txt',
        name: 'removable.txt',
        type: 'text/plain',
        size: 100,
      }]);
      mockProcessDocument.mockResolvedValue({
        id: 'doc-remove',
        type: 'document' as const,
        uri: 'file:///mock/removable.txt',
        fileName: 'removable.txt',
        textContent: 'remove me',
        fileSize: 100,
      });

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(result.getByTestId('attachments-container')).toBeTruthy();
      });

      const removeButton = result.getByTestId('remove-attachment-doc-remove');
      fireEvent.press(removeButton);

      expect(result.queryByTestId('attachments-container')).toBeNull();
    });

    it('handles empty name from document picker', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/unnamed',
        name: null,
        type: 'application/octet-stream',
        size: 100,
      }]);

      const result = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument(result);

      await waitFor(() => {
        expect(mockIsSupported).toHaveBeenCalledWith('document');
      });
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

      // Add attachment via attach picker
      pressAttachPhoto({ getByTestId });

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
      expect(onSend).toHaveBeenCalledWith('Hello', undefined, 'auto');
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
        'auto'
      );
    });

    it('handles emoji input', () => {
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, '👋 Hello 🌍 World');

      expect(input.props.value).toBe('👋 Hello 🌍 World');
    });
  });

  // ============================================================================
  // Additional branch coverage tests
  // ============================================================================
  describe('camera flow', () => {
    it('shows Camera option in alert when photo is pressed via attach picker', async () => {
      const result = render(
        <ChatInput {...defaultProps} supportsVision={true} />
      );

      pressAttachPhoto(result);

      await waitFor(() => {
        expect(result.getByText('Camera')).toBeTruthy();
        expect(result.getByText('Photo Library')).toBeTruthy();
      });
    });
  });

  describe('queue indicator', () => {
    it('shows queue indicator when sending during generation', async () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput
          {...defaultProps}
          onSend={onSend}
          isGenerating={true}
          onStop={jest.fn()}
        />
      );

      // Type a message during generation
      fireEvent.changeText(getByTestId('chat-input'), 'Queued message');

      // Send button should be visible
      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      // onSend should be called (message is queued)
      expect(onSend).toHaveBeenCalledWith('Queued message', undefined, 'auto');
    });
  });

  describe('image mode toggle without loaded model', () => {
    it('shows alert when toggling image mode via quick settings without model', () => {
      const result = render(
        <ChatInput {...defaultProps} imageModelLoaded={false} />
      );

      pressImageModeToggle(result);

      expect(result.getByText('No Image Model')).toBeTruthy();
    });

    it('selects the first downloaded image model and cycles mode when one is available', () => {
      // Gating is now on DOWNLOADED (not loaded) image models. With a downloaded
      // model present, toggling selects it and proceeds without the alert.
      mockUseAppStore.mockReturnValue({
        settings: { thinkingEnabled: false },
        updateSettings: jest.fn(),
        downloadedModels: [],
        activeModelId: null,
        downloadedImageModels: [{ id: 'img-1', backend: 'coreml' }],
      });

      const onImageModeChange = jest.fn();
      const result = render(
        <ChatInput
          {...defaultProps}
          imageModelLoaded={false}
          onImageModeChange={onImageModeChange}
        />
      );

      pressImageModeToggle(result);

      expect(mockSelectMobileModel).toHaveBeenCalledWith({
        source: 'local',
        hostId: 'coreml',
        modality: 'image',
        modelId: 'img-1',
      });
      expect(result.queryByText('No Image Model')).toBeNull();
      expect(onImageModeChange).toHaveBeenCalledWith('force');
    });
  });

  describe('queue indicator with queuedTexts', () => {
    it('shows queue count and preview text', () => {
      const { getByTestId, getByText } = render(
        <ChatInput
          {...defaultProps}
          queueCount={2}
          queuedTexts={['Hello world', 'Another message']}
          onClearQueue={jest.fn()}
        />
      );

      expect(getByTestId('queue-indicator')).toBeTruthy();
      expect(getByText('2 queued')).toBeTruthy();
      expect(getByText('Hello world')).toBeTruthy();
    });

    it('truncates long queued text preview', () => {
      const longText = 'This is a very long queued message that should be truncated after thirty characters';
      const { getByTestId } = render(
        <ChatInput
          {...defaultProps}
          queueCount={1}
          queuedTexts={[longText]}
          onClearQueue={jest.fn()}
        />
      );

      expect(getByTestId('queue-indicator')).toBeTruthy();
      // The text should be truncated to 30 chars + '...'
    });

    it('shows clear queue button', () => {
      const onClearQueue = jest.fn();
      const { getByTestId } = render(
        <ChatInput
          {...defaultProps}
          queueCount={1}
          queuedTexts={['Test']}
          onClearQueue={onClearQueue}
        />
      );

      const clearButton = getByTestId('clear-queue-button');
      fireEvent.press(clearButton);

      expect(onClearQueue).toHaveBeenCalled();
    });

    it('hides queue indicator when queueCount is 0', () => {
      const { queryByTestId } = render(
        <ChatInput
          {...defaultProps}
          queueCount={0}
          queuedTexts={[]}
        />
      );

      expect(queryByTestId('queue-indicator')).toBeNull();
    });
  });

  describe('handleStop guard', () => {
    it('does not render stop button when onStop callback is not provided', () => {
      const { queryByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} />
      );

      // Stop button should not render when onStop is not provided
      expect(queryByTestId('stop-button')).toBeNull();
    });

    it('renders and handles stop button when onStop is provided', () => {
      const onStop = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} isGenerating={true} onStop={onStop} />
      );

      const stopButton = getByTestId('stop-button');
      fireEvent.press(stopButton);
      expect(onStop).toHaveBeenCalled();
    });
  });

  describe('send with attachment but no text', () => {
    it('shows send button when only attachments are present', async () => {
      const { launchImageLibrary } = require('react-native-image-picker');
      launchImageLibrary.mockResolvedValue({
        assets: [{
          uri: 'file:///attachment-only.jpg',
          type: 'image/jpeg',
          width: 512,
          height: 512,
        }],
      });

      const onSend = jest.fn();
      const { getByTestId, getByText } = render(
        <ChatInput {...defaultProps} onSend={onSend} supportsVision={true} />
      );

      // Add attachment via attach picker
      pressAttachPhoto({ getByTestId });
      await waitFor(() => expect(getByText('Photo Library')).toBeTruthy());
      fireEvent.press(getByText('Photo Library'));

      await waitFor(() => {
        expect(getByTestId('attachments-container')).toBeTruthy();
      });

      // Send button should be visible even without text
      const sendButton = getByTestId('send-button');
      fireEvent.press(sendButton);

      expect(onSend).toHaveBeenCalledWith(
        '',
        expect.arrayContaining([
          expect.objectContaining({ type: 'image' }),
        ]),
        'auto'
      );
    });
  });

  describe('disabled does not send with attachment', () => {
    it('does not call onSend when disabled even with attachments', async () => {
      const onSend = jest.fn();
      const { getByTestId } = render(
        <ChatInput {...defaultProps} onSend={onSend} disabled={true} />
      );

      const input = getByTestId('chat-input');
      fireEvent.changeText(input, 'Disabled');

      // Even with text, disabled should prevent send
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Voice recording integration (covers lines 87-88, 95-96, 104-111, 442-443)
  // ============================================================================
  // ============================================================================
  // RESTORED COVERAGE (previously deleted). These run on the file's pre-existing
  // module mocks, so they MUST stay above the first real-composition test - once a
  // test calls jest.unmock()/resetModules the mocked graph is gone for the rest of
  // the file.
  // ============================================================================
  describe('restored coverage', () => {
    // RESTORED (was silently dropped): dictation must APPEND into a composer that
    // already has text, never overwrite it. Kept on the file's pre-existing mocked
    // path because the real-composition path cannot reach this state - the mic
    // button is hidden as soon as the composer has text (see 'hides mic button when
    // input has text'), and the composer is unmounted while recording runs, so no
    // real gesture sequence produces a non-empty composer plus an arriving
    // transcript. See report: appendTranscript (src/components/ChatInput/index.tsx:205).
    it('appends transcribed text to existing message', () => {
      const mockClearResult = jest.fn();
      mockUseWhisperTranscription.mockReturnValue({
        isRecording: false,
        isModelLoaded: true,
        isModelLoading: false,
        isTranscribing: false,
        partialResult: '',
        finalResult: null,
        error: null,
        startRecording: jest.fn().mockResolvedValue(undefined),
        stopRecording: jest.fn(),
        clearResult: mockClearResult,
      });
      mockUseWhisperStore.mockReturnValue({
        downloadedModelId: 'whisper-model-1',
      });

      const { getByTestId, rerender } = render(
        <ChatInput {...defaultProps} conversationId="conv-123" />
      );

      // Type some text first
      fireEvent.changeText(getByTestId('chat-input'), 'Existing text');

      // Simulate finalResult arriving
      mockUseWhisperTranscription.mockReturnValue({
        isRecording: false,
        isModelLoaded: true,
        isModelLoading: false,
        isTranscribing: false,
        partialResult: '',
        finalResult: 'appended words',
        error: null,
        startRecording: jest.fn().mockResolvedValue(undefined),
        stopRecording: jest.fn(),
        clearResult: mockClearResult,
      });

      rerender(<ChatInput {...defaultProps} conversationId="conv-123" />);

      const input = getByTestId('chat-input');
      expect(input.props.value).toBe('Existing text appended words');
    });

    // RULING on the two dropped Animated.timing tests: the surviving pointer-events
    // tests below ('disables pointer events on pill icons when text is present' /
    // 're-enables pointer events on pill icons when text is cleared') do NOT subsume
    // them. Those assert ComposerIconsRow.tsx:35, `pointerEvents={hasText ? 'none' :
    // 'auto'}`, which is derived straight from `hasText` and never touches iconsAnim.
    // The width/opacity collapse itself is driven by the Animated.timing in
    // ChatInput/index.tsx:180; delete that effect and the pointer-events tests stay
    // green while the icons never collapse. So both are restored here, spying only on
    // React Native's Animated (an external leaf), not on any Off Grid module.
    it('starts Animated.timing to collapse when text is entered', () => {
      const timingSpy = jest.spyOn(require('react-native').Animated, 'timing');
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      fireEvent.changeText(getByTestId('chat-input'), 'a');

      expect(timingSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ toValue: 1 }),
      );
      timingSpy.mockRestore();
    });

    it('starts Animated.timing to expand when text is cleared', () => {
      const timingSpy = jest.spyOn(require('react-native').Animated, 'timing');
      const { getByTestId } = render(<ChatInput {...defaultProps} />);

      fireEvent.changeText(getByTestId('chat-input'), 'a');
      timingSpy.mockClear();
      fireEvent.changeText(getByTestId('chat-input'), '');

      expect(timingSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ toValue: 0 }),
      );
      timingSpy.mockRestore();
    });

  });

  // ============================================================================
  // Attachment preview with document without fileName (covers branch 34[1])
  // ============================================================================
  describe('document preview without fileName', () => {
    // RESTORED (was silently dropped): the attachment chip must still name the
    // file ("Document") when the processed attachment carries no fileName
    // (src/components/ChatInput/Attachments.tsx:287). Kept on the file's
    // pre-existing mocked documentService because the real service always names
    // the file (documentService.ts:232 falls back to 'document'), so the empty
    // fileName state is not reachable through the real composition path.
    it('shows Document fallback text when fileName is missing', async () => {
      mockPick.mockResolvedValue([{
        uri: 'file:///mock/unnamed-doc',
        name: 'somefile.txt',
        type: 'text/plain',
        size: 100,
      }]);
      mockProcessDocument.mockResolvedValue({
        id: 'doc-no-name',
        type: 'document' as const,
        uri: 'file:///mock/unnamed-doc',
        fileName: '',
        textContent: 'content',
        fileSize: 100,
      });

      const { getByTestId, getByText } = render(
        <ChatInput {...defaultProps} />
      );

      pressAttachDocument({ getByTestId });

      await waitFor(() => {
        expect(getByText('Document')).toBeTruthy();
      });
    });
  });

  describe('voice recording integration', () => {
    it('starts one real native microphone session from the voice button', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
        whisper: true,
      });
      await harness.setupWhisperModel();
      harness.render();

      try {
        await harness.tapMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(true);
        });
        const context = await (harness.boundary.whisper!.module.initWhisper as jest.Mock)
          .mock.results[0].value;
        expect(context.transcribeRealtime).toHaveBeenCalledTimes(1);
        expect(harness.view!.getByTestId('voice-record-button')).toBeTruthy();
      } finally {
        harness.view?.unmount();
        await harness.settle(300);
      }
      expect(harness.boundary.whisper?.realtimeActive()).toBe(false);
    });

    it('inserts a standalone chat-mode dictation into the composer (does NOT auto-send)', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
        whisper: true,
      });
      await harness.setupWhisperModel();
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const onSend = jest.fn();
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        onSend,
        conversationId: 'conv-123',
      }));
      harness.view = view;

      try {
        await harness.tapMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(true);
        });
        await harness.releaseMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(false);
        });
        harness.boundary.whisper?.emitRealtime({
          text: 'Hello from voice',
          isCapturing: false,
        });

        await harness.rtl.waitFor(() => {
          expect(view.getByTestId('chat-input').props.value).toBe('Hello from voice');
        });
        expect(onSend).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('clears pending transcription when conversation changes', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
        whisper: true,
      });
      await harness.setupWhisperModel();
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const onSend = jest.fn();
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        onSend,
        conversationId: 'conv-1',
      }));
      harness.view = view;

      try {
        await harness.tapMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(true);
        });

        view.rerender(harness.React.createElement(RealChatInput, {
          onSend,
          conversationId: 'conv-2',
        }));
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(false);
          expect(view.getByTestId('chat-input')).toBeTruthy();
          expect(
            view.getByTestId('voice-record-button').props.accessibilityLabel,
          ).toBe('Start voice recording');
        });
        harness.boundary.whisper?.emitRealtime({
          text: 'words from the previous chat',
          isCapturing: false,
        });
        await harness.settle(50);

        expect(view.queryByText('words from the previous chat')).toBeNull();
        expect(onSend).not.toHaveBeenCalled();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('cancels recording when the microphone gesture is interrupted', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
        whisper: true,
      });
      await harness.setupWhisperModel();
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        conversationId: 'conv-123',
      }));
      harness.view = view;

      try {
        await harness.tapMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(true);
        });
        const button = view.getByTestId('voice-record-button');
        harness.rtl.fireEvent(button, 'responderTerminate', {
          nativeEvent: { timestamp: 500 },
          touchHistory: {
            touchBank: [],
            numberActiveTouches: 0,
            indexOfSingleActiveTouch: -1,
            mostRecentTimeStamp: 500,
          },
        });

        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(false);
          expect(view.getByTestId('chat-input')).toBeTruthy();
          expect(
            view.getByTestId('voice-record-button').props.accessibilityLabel,
          ).toBe('Start voice recording');
        });
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Image mode toggle without loaded model (covers lines 136-141)
  // ============================================================================
  describe('image mode toggle alert when no model loaded', () => {
    it('shows alert when toggling image mode without a downloaded model', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
      });
      harness.render();

      try {
        await harness.cycleImageMode();
        await harness.rtl.waitFor(() => {
          expect(harness.view!.getByText('No Image Model')).toBeTruthy();
          expect(
            harness.view!.getByText(
              'Download an image generation model from the Models screen to enable this feature.',
            ),
          ).toBeTruthy();
        });
        expect(harness.view!.queryByTestId('image-mode-force-badge')).toBeNull();
      } finally {
        harness.view?.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Camera flow - pick from camera (covers lines 165-167, 204-216)
  // ============================================================================
  describe('camera capture flow', () => {
    it('picks image from camera when Camera option is pressed', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
      });
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const { launchCamera } = require('react-native-image-picker') as {
        launchCamera: jest.Mock;
      };
      launchCamera.mockResolvedValue({
        assets: [{
          uri: 'file:///camera-photo.jpg',
          type: 'image/jpeg',
          width: 1024,
          height: 768,
          fileName: 'camera-photo.jpg',
        }],
      });
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        supportsVision: true,
        onSend: jest.fn(),
      }));

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Camera')),
        );

        await harness.rtl.waitFor(() => {
          expect(view.getByTestId('attachments-container')).toBeTruthy();
          expect(view.getAllByTestId(/^attachment-image-/)).toHaveLength(1);
        });
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('handles camera error gracefully', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
      });
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const { launchCamera } = require('react-native-image-picker') as {
        launchCamera: jest.Mock;
      };
      launchCamera.mockRejectedValue(new Error('Camera permission denied'));
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        supportsVision: true,
        onSend: jest.fn(),
      }));

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Camera')),
        );

        await harness.rtl.waitFor(() => {
          expect(launchCamera).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('handles camera returning no assets', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
      });
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const { launchCamera } = require('react-native-image-picker') as {
        launchCamera: jest.Mock;
      };
      launchCamera.mockResolvedValue({ assets: [] });
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        supportsVision: true,
        onSend: jest.fn(),
      }));

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Camera')),
        );

        await harness.rtl.waitFor(() => {
          expect(launchCamera).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Photo library error (covers line 199)
  // ============================================================================
  describe('photo library error', () => {
    it('handles photo library error gracefully', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      const { launchImageLibrary } = require('react-native-image-picker') as {
        launchImageLibrary: jest.Mock;
      };
      launchImageLibrary.mockRejectedValue(new Error('Library access denied'));

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Photo Library')),
        );
        await harness.rtl.waitFor(() => {
          expect(launchImageLibrary).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Document picker error with message fallback (covers line 270)
  // ============================================================================
  describe('document picker error without message', () => {
    it('shows fallback error message when error has no message', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      const errorObj: any = {};
      mockPick.mockRejectedValue(errorObj);
      mockIsErrorWithCode.mockReturnValue(false);

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-document'));

        await harness.rtl.waitFor(() => {
          expect(view.getByText('Error')).toBeTruthy();
          expect(view.getByText('Failed to read document')).toBeTruthy();
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Voice recording with no conversationId (covers branch 5[1]: null fallback)
  // ============================================================================
  describe('voice recording without conversationId', () => {
    it('starts recording in a new chat before a conversation exists', async () => {
      jest.unmock('../../../src/services/modelServices');
      jest.unmock('../../../src/services/documentService');
      jest.unmock('../../../src/stores');
      jest.unmock('../../../src/hooks/useWhisperTranscription');
      jest.unmock('../../../src/components/VoiceRecordButton');
      const { setupChatScreen } = require('../../harness/chatHarness') as typeof import('../../harness/chatHarness');
      const harness = await setupChatScreen({
        engine: 'llama',
        platform: 'android',
        whisper: true,
      });
      await harness.setupWhisperModel();
      const RealChatInput = require('../../../src/components/ChatInput')
        .ChatInput as typeof ChatInput;
      const view = harness.rtl.render(harness.React.createElement(RealChatInput, {
        onSend: jest.fn(),
      }));
      harness.view = view;

      try {
        expect(harness.conversationId).toBeNull();
        await harness.tapMic();
        await harness.rtl.waitFor(() => {
          expect(harness.boundary.whisper?.realtimeActive()).toBe(true);
          expect(
            view.getByTestId('voice-record-button').props.accessibilityLabel,
          ).toBe('Stop voice recording');
        });
        const context = await (harness.boundary.whisper!.module.initWhisper as jest.Mock)
          .mock.results[0].value;
        expect(context.transcribeRealtime).toHaveBeenCalledTimes(1);
      } finally {
        view.unmount();
        await harness.settle(300);
      }

      expect(harness.boundary.whisper?.realtimeActive()).toBe(false);
    });
  });

  // ============================================================================
  // Document picker returns empty result (covers branch 24[0]: !file return)
  // ============================================================================
  describe('document picker returns empty array', () => {
    it('does nothing when picker returns no files', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      mockPick.mockResolvedValue([]);

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-document'));

        await harness.rtl.waitFor(() => {
          expect(mockPick).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Photo library returning empty assets (covers branch 18[1])
  // ============================================================================
  describe('photo library returning no assets', () => {
    it('does not add attachments when library returns empty assets', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      const { launchImageLibrary } = require('react-native-image-picker') as {
        launchImageLibrary: jest.Mock;
      };
      launchImageLibrary.mockResolvedValue({ assets: [] });

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Photo Library')),
        );
        await harness.rtl.waitFor(() => {
          expect(launchImageLibrary).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('does not add attachments when library returns null assets', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      const { launchImageLibrary } = require('react-native-image-picker') as {
        launchImageLibrary: jest.Mock;
      };
      launchImageLibrary.mockResolvedValue({ assets: null });

      try {
        harness.rtl.fireEvent.press(view.getByTestId('attach-button'));
        harness.rtl.fireEvent.press(view.getByTestId('attach-photo'));
        harness.rtl.fireEvent.press(
          await harness.rtl.waitFor(() => view.getByText('Photo Library')),
        );
        await harness.rtl.waitFor(() => {
          expect(launchImageLibrary).toHaveBeenCalledTimes(1);
        });
        expect(view.queryByTestId('attachments-container')).toBeNull();
        expect(view.getByTestId('chat-input')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });

  // ============================================================================
  // Icon collapse animation (triggered by text content)
  // ============================================================================
  describe('icon collapse animation', () => {
    it('disables pointer events on pill icons when text is present', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      try {
        expect(view.getByTestId('attach-button')).toBeTruthy();
        harness.rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'hello');
        expect(
          view.UNSAFE_queryAllByProps({ pointerEvents: 'none' }).length,
        ).toBeGreaterThan(0);
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('re-enables pointer events on pill icons when text is cleared', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      try {
        harness.rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'hello');
        harness.rtl.fireEvent.changeText(view.getByTestId('chat-input'), '');
        expect(
          view.UNSAFE_queryAllByProps({ pointerEvents: 'none' }),
        ).toHaveLength(0);
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('icons remain accessible when input is empty', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      try {
        expect(view.getByTestId('attach-button')).toBeTruthy();
        expect(view.getByTestId('quick-settings-button')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('send button remains visible when text is entered', async () => {
      const { harness, view } = await renderRealAttachmentInput();
      try {
        harness.rtl.fireEvent.changeText(view.getByTestId('chat-input'), 'Hello');
        expect(view.getByTestId('send-button')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });

    it('stop button remains visible when generating with no text', async () => {
      const { harness, view } = await renderRealAttachmentInput({
        isGenerating: true,
        onStop: jest.fn(),
      });
      try {
        expect(view.getByTestId('stop-button')).toBeTruthy();
      } finally {
        view.unmount();
        await harness.settle(300);
      }
    });
  });
});
