/**
 * ChatMessage Component Tests
 *
 * Tests for the message rendering component including:
 * - Message display by role (user/assistant/system)
 * - Streaming state and cursor animation
 * - Thinking blocks (<think> tags)
 * - Attachments and images
 * - Action menu (copy, edit, retry, generate image)
 * - Generation metadata display
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ChatMessage } from '../../../src/components/ChatMessage';
import {
  createMessage,
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createImageAttachment,
  createDocumentAttachment,
  createGenerationMeta,
} from '../../utils/factories';

// The Clipboard warning is expected (deprecated in RN). No additional mock needed
// as the tests will still work with the deprecated API.

// Mock the stripControlTokens utility
jest.mock('../../../src/utils/messageContent', () => ({
  stripControlTokens: (content: string) => content,
}));

describe('ChatMessage', () => {
  const _defaultProps = {
    message: createUserMessage('Hello world'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================================
  // Basic Rendering
  // ============================================================================
  describe('basic rendering', () => {
    it('renders user message', () => {
      const { getByText } = render(
        <ChatMessage message={createUserMessage('Hello from user')} />
      );

      expect(getByText('Hello from user')).toBeTruthy();
    });

    it('renders assistant message', () => {
      const { getByText } = render(
        <ChatMessage message={createAssistantMessage('Hello from assistant')} />
      );

      expect(getByText('Hello from assistant')).toBeTruthy();
    });

    it('renders system message', () => {
      const { getByText } = render(
        <ChatMessage message={createSystemMessage('System notification')} />
      );

      expect(getByText('System notification')).toBeTruthy();
    });

    it('renders system info message with special styling', () => {
      const message = createMessage({
        role: 'system',
        content: 'Model loaded successfully',
        isSystemInfo: true,
      });

      const { getByTestId, getByText } = render(<ChatMessage message={message} />);

      expect(getByTestId('system-info-message')).toBeTruthy();
      expect(getByText('Model loaded successfully')).toBeTruthy();
    });

    it('renders empty content gracefully', () => {
      const message = createMessage({ content: '' });
      const { queryByText, getByTestId } = render(<ChatMessage message={message} />);

      // Should not crash and should render container
      const containerId = message.role === 'user' ? 'user-message' : 'assistant-message';
      expect(getByTestId(containerId)).toBeTruthy();
      // Should not show "undefined" or "null" as text
      expect(queryByText('undefined')).toBeNull();
      expect(queryByText('null')).toBeNull();
    });

    it('renders long content without truncation', () => {
      const longContent = 'A'.repeat(5000);
      const message = createUserMessage(longContent);

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(longContent)).toBeTruthy();
    });

    it('renders user message with right alignment container', () => {
      const message = createUserMessage('User message');

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('user-message')).toBeTruthy();
    });

    it('renders assistant message with left alignment container', () => {
      const message = createAssistantMessage('Assistant message');

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('assistant-message')).toBeTruthy();
    });
  });

  // ============================================================================
  // Streaming State
  // ============================================================================
  describe('streaming state', () => {
    it('shows streaming cursor when isStreaming is true', () => {
      const message = createAssistantMessage('Generating...');

      const { getByTestId } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      expect(getByTestId('streaming-cursor')).toBeTruthy();
    });

    it('hides streaming cursor when isStreaming is false', () => {
      const message = createAssistantMessage('Complete response');

      const { queryByTestId } = render(
        <ChatMessage message={message} isStreaming={false} />
      );

      expect(queryByTestId('streaming-cursor')).toBeNull();
    });

    it('renders partial content during streaming', () => {
      const message = createAssistantMessage('Partial cont');

      const { getByText } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      expect(getByText(/Partial cont/)).toBeTruthy();
    });

    it('shows cursor when streaming empty content', () => {
      const message = createAssistantMessage('');

      const { getByTestId } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      expect(getByTestId('streaming-cursor')).toBeTruthy();
    });
  });

  // ============================================================================
  // Thinking Blocks
  // ============================================================================
  describe('thinking blocks', () => {
    it('renders thinking block from <think> tags', () => {
      const message = createAssistantMessage(
        '<think>Let me analyze this problem step by step...</think>The answer is 42.'
      );

      const { getByText, getByTestId } = render(<ChatMessage message={message} />);

      // Main content should be visible
      expect(getByText(/The answer is 42/)).toBeTruthy();
      // Thinking block should exist
      expect(getByTestId('thinking-block')).toBeTruthy();
    });

    it('shows Thought process header when thinking is complete', () => {
      const message = createAssistantMessage(
        '<think>Internal reasoning here</think>Final answer.'
      );

      const { getByTestId, getByText } = render(<ChatMessage message={message} />);

      expect(getByTestId('thinking-block-title')).toBeTruthy();
      expect(getByText('Thought process')).toBeTruthy();
    });

    it('expands thinking block when toggle is pressed', () => {
      const message = createAssistantMessage(
        '<think>Step 1: Check input\nStep 2: Process</think>Done!'
      );

      const { getByTestId, queryByTestId } = render(<ChatMessage message={message} />);

      // Initially collapsed
      expect(queryByTestId('thinking-block-content')).toBeNull();

      // Press toggle
      fireEvent.press(getByTestId('thinking-block-toggle'));

      // Content should be visible
      expect(getByTestId('thinking-block-content')).toBeTruthy();
    });

    it('shows Thinking... header when thinking is incomplete', () => {
      const message = createAssistantMessage(
        '<think>Thinking in progress...'
      );

      const { getByTestId, getAllByText } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      // Thinking block exists and shows "Thinking..." in the title
      expect(getByTestId('thinking-block')).toBeTruthy();
      // At least one element shows "Thinking..." (may be multiple due to indicator)
      expect(getAllByText('Thinking...').length).toBeGreaterThan(0);
    });

    it('shows thinking indicator when message.isThinking is true', () => {
      const message = createMessage({
        role: 'assistant',
        content: '',
        isThinking: true,
      });

      const { getByTestId } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      expect(getByTestId('thinking-indicator')).toBeTruthy();
    });

    it('handles unclosed think tag gracefully', () => {
      const message = createAssistantMessage('<think>Still thinking about this...');

      // Should not crash
      const { getByTestId } = render(
        <ChatMessage message={message} isStreaming={true} />
      );

      expect(getByTestId('thinking-block')).toBeTruthy();
    });

    it('handles empty think tags', () => {
      const message = createAssistantMessage('<think></think>Here is the answer.');

      const { getByText, queryByTestId: _queryByTestId } = render(<ChatMessage message={message} />);

      // Should show the response
      expect(getByText(/Here is the answer/)).toBeTruthy();
      // Empty thinking block may or may not be shown depending on implementation
    });

    it('handles multiple think tags by using first one', () => {
      const message = createAssistantMessage(
        '<think>First thought</think>Response<think>Second thought</think>'
      );

      const { getByText } = render(<ChatMessage message={message} />);

      // Should show the response between tags
      expect(getByText(/Response/)).toBeTruthy();
    });
  });

  // ============================================================================
  // Attachments
  // ============================================================================
  describe('attachments', () => {
    it('renders image attachment', () => {
      const attachment = createImageAttachment({
        uri: 'file:///test/image.jpg',
      });
      const message = createUserMessage('Check this image', {
        attachments: [attachment],
      });

      const { getByTestId } = render(<ChatMessage message={message} />);

      expect(getByTestId('message-attachments')).toBeTruthy();
      expect(getByTestId('message-image-0')).toBeTruthy();
    });

    it('renders multiple image attachments', () => {
      const attachments = [
        createImageAttachment({ uri: 'file:///image1.jpg' }),
        createImageAttachment({ uri: 'file:///image2.jpg' }),
        createImageAttachment({ uri: 'file:///image3.jpg' }),
      ];
      const message = createUserMessage('Multiple images', { attachments });

      const { getByTestId, getByText } = render(<ChatMessage message={message} />);

      expect(getByText('Multiple images')).toBeTruthy();
      expect(getByTestId('message-image-0')).toBeTruthy();
      expect(getByTestId('message-image-1')).toBeTruthy();
      expect(getByTestId('message-image-2')).toBeTruthy();
    });

    it('calls onImagePress when image is tapped', () => {
      const onImagePress = jest.fn();
      const attachment = createImageAttachment({
        uri: 'file:///test/image.jpg',
      });
      const message = createUserMessage('Image', { attachments: [attachment] });

      const { getByTestId } = render(
        <ChatMessage message={message} onImagePress={onImagePress} />
      );

      fireEvent.press(getByTestId('message-attachment-0'));

      expect(onImagePress).toHaveBeenCalledWith('file:///test/image.jpg');
    });

    it('renders document attachment as badge (not image)', () => {
      const attachment = createDocumentAttachment({
        fileName: 'report.pdf',
        fileSize: 1024 * 512, // 512KB
        textContent: 'PDF content here',
      });
      const message = createUserMessage('See this report', {
        attachments: [attachment],
      });

      const { getByTestId, getByText, queryByTestId } = render(
        <ChatMessage message={message} />
      );

      expect(getByTestId('message-attachments')).toBeTruthy();
      // Should render as badge, not as FadeInImage
      expect(getByTestId('document-badge-0')).toBeTruthy();
      expect(getByText('report.pdf')).toBeTruthy();
      expect(getByText('512KB')).toBeTruthy();
      // Should NOT render an image element for documents
      expect(queryByTestId('message-image-0')).toBeNull();
    });

    it('renders document badge in assistant message', () => {
      const attachment = createDocumentAttachment({
        fileName: 'data.csv',
        fileSize: 2048,
      });
      const message = createAssistantMessage('Here is the analysis', {
        attachments: [attachment],
      });

      const { getByTestId, getByText } = render(
        <ChatMessage message={message} />
      );

      expect(getByTestId('document-badge-0')).toBeTruthy();
      expect(getByText('data.csv')).toBeTruthy();
    });

    it('renders mixed image and document attachments', () => {
      const imageAttachment = createImageAttachment({
        uri: 'file:///test/image.jpg',
      });
      const docAttachment = createDocumentAttachment({
        fileName: 'notes.txt',
        fileSize: 256,
      });
      const message = createUserMessage('Image and doc', {
        attachments: [imageAttachment, docAttachment],
      });

      const { getByTestId } = render(<ChatMessage message={message} />);

      // Image renders as FadeInImage
      expect(getByTestId('message-image-0')).toBeTruthy();
      // Document renders as badge
      expect(getByTestId('document-badge-1')).toBeTruthy();
    });

    it('renders document with missing fileSize (no size badge)', () => {
      const attachment: import('../../../src/types').MediaAttachment = {
        id: 'doc-no-size',
        type: 'document',
        uri: '/path/to/readme.md',
        fileName: 'readme.md',
        textContent: 'content',
        // fileSize intentionally omitted
      };
      const message = createUserMessage('Read this', {
        attachments: [attachment],
      });

      const { getByTestId, getByText, queryByText } = render(
        <ChatMessage message={message} />
      );

      expect(getByTestId('document-badge-0')).toBeTruthy();
      expect(getByText('readme.md')).toBeTruthy();
      // No size should be displayed
      expect(queryByText(/KB|MB|B$/)).toBeNull();
    });

    it('renders document with missing fileName (shows "Document")', () => {
      const attachment: import('../../../src/types').MediaAttachment = {
        id: 'doc-no-name',
        type: 'document',
        uri: '/path/to/file',
        fileSize: 512,
        textContent: 'content',
        // fileName intentionally omitted
      };
      const message = createUserMessage('Check this', {
        attachments: [attachment],
      });

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText('Document')).toBeTruthy();
    });

    it('renders multiple document attachments', () => {
      const doc1 = createDocumentAttachment({ fileName: 'file1.txt', fileSize: 100 });
      const doc2 = createDocumentAttachment({ fileName: 'file2.csv', fileSize: 2048 });
      const message = createUserMessage('Two docs', {
        attachments: [doc1, doc2],
      });

      const { getByTestId, getByText } = render(<ChatMessage message={message} />);

      expect(getByTestId('document-badge-0')).toBeTruthy();
      expect(getByTestId('document-badge-1')).toBeTruthy();
      expect(getByText('file1.txt')).toBeTruthy();
      expect(getByText('file2.csv')).toBeTruthy();
    });

    it('formats file sizes correctly at boundaries', () => {
      // 0 bytes
      const doc0 = createDocumentAttachment({ fileName: 'a.txt', fileSize: 0 });
      const msg0 = createUserMessage('', { attachments: [doc0] });
      const { getByText: getText0 } = render(<ChatMessage message={msg0} />);
      expect(getText0('0B')).toBeTruthy();
    });

    it('formats KB file sizes', () => {
      const doc = createDocumentAttachment({ fileName: 'b.txt', fileSize: 1024 });
      const msg = createUserMessage('', { attachments: [doc] });
      const { getByText } = render(<ChatMessage message={msg} />);
      expect(getByText('1KB')).toBeTruthy();
    });

    it('formats MB file sizes', () => {
      const doc = createDocumentAttachment({ fileName: 'c.txt', fileSize: 1024 * 1024 });
      const msg = createUserMessage('', { attachments: [doc] });
      const { getByText } = render(<ChatMessage message={msg} />);
      expect(getByText('1.0MB')).toBeTruthy();
    });

    it('formats sub-KB file sizes as bytes', () => {
      const doc = createDocumentAttachment({ fileName: 'd.txt', fileSize: 500 });
      const msg = createUserMessage('', { attachments: [doc] });
      const { getByText } = render(<ChatMessage message={msg} />);
      expect(getByText('500B')).toBeTruthy();
    });

    it('formats fractional MB correctly', () => {
      const doc = createDocumentAttachment({ fileName: 'e.txt', fileSize: 2.5 * 1024 * 1024 });
      const msg = createUserMessage('', { attachments: [doc] });
      const { getByText } = render(<ChatMessage message={msg} />);
      expect(getByText('2.5MB')).toBeTruthy();
    });

    it('renders generated image in assistant message', () => {
      const attachment = createImageAttachment({
        uri: 'file:///generated/sunset.png',
        width: 512,
        height: 512,
      });
      const message = createAssistantMessage('Here is your image:', {
        attachments: [attachment],
      });

      const { getByText, getByTestId } = render(<ChatMessage message={message} />);

      expect(getByText(/Here is your image/)).toBeTruthy();
      expect(getByTestId('generated-image')).toBeTruthy();
    });
  });

  // ============================================================================
  // Action Menu
  // ============================================================================
  describe('action menu', () => {
    it('shows action menu on long press when showActions is true', () => {
      const message = createAssistantMessage('Long press me');

      const { getByTestId, getByText } = render(
        <ChatMessage message={message} showActions={true} />
      );

      fireEvent(getByTestId('assistant-message'), 'longPress');

      // Action menu should appear
      expect(getByTestId('action-menu')).toBeTruthy();
      expect(getByText('Copy')).toBeTruthy();
    });

    it('does not show action menu when showActions is false', () => {
      const message = createAssistantMessage('No actions');

      const { getByTestId, queryByTestId } = render(
        <ChatMessage message={message} showActions={false} />
      );

      fireEvent(getByTestId('assistant-message'), 'longPress');

      // No menu should appear
      expect(queryByTestId('action-menu')).toBeNull();
    });

    it('does not show action menu during streaming', () => {
      const message = createAssistantMessage('Streaming...');

      const { getByTestId, queryByTestId } = render(
        <ChatMessage message={message} showActions={true} isStreaming={true} />
      );

      fireEvent(getByTestId('assistant-message'), 'longPress');

      expect(queryByTestId('action-menu')).toBeNull();
    });

    it('calls onCopy when copy is pressed', () => {
      const onCopy = jest.fn();
      const message = createAssistantMessage('Copy this text');

      const { getByTestId } = render(
        <ChatMessage message={message} onCopy={onCopy} showActions={true} />
      );

      // Open menu
      fireEvent(getByTestId('assistant-message'), 'longPress');

      // Press copy
      fireEvent.press(getByTestId('action-copy'));

      // onCopy callback is called with the message content
      expect(onCopy).toHaveBeenCalledWith('Copy this text');
    });

    it('calls onRetry when retry is pressed', () => {
      const onRetry = jest.fn();
      const message = createAssistantMessage('Retry this');

      const { getByTestId } = render(
        <ChatMessage message={message} onRetry={onRetry} showActions={true} />
      );

      // Open menu
      fireEvent(getByTestId('assistant-message'), 'longPress');

      // Press retry
      fireEvent.press(getByTestId('action-retry'));

      expect(onRetry).toHaveBeenCalledWith(message);
    });

    it('shows edit option for user messages', () => {
      const onEdit = jest.fn();
      const message = createUserMessage('Edit me');

      const { getByTestId } = render(
        <ChatMessage message={message} onEdit={onEdit} showActions={true} />
      );

      // Open menu
      fireEvent(getByTestId('user-message'), 'longPress');

      // Edit should be available
      expect(getByTestId('action-edit')).toBeTruthy();
    });

    it('does not show edit option for assistant messages', () => {
      const onEdit = jest.fn();
      const message = createAssistantMessage('Cannot edit me');

      const { getByTestId, queryByTestId } = render(
        <ChatMessage message={message} onEdit={onEdit} showActions={true} />
      );

      // Open menu
      fireEvent(getByTestId('assistant-message'), 'longPress');

      // Edit option should not be available
      expect(queryByTestId('action-edit')).toBeNull();
    });

    it('shows generate image option when canGenerateImage is true', () => {
      const onGenerateImage = jest.fn();
      const message = createUserMessage('A beautiful sunset over mountains');

      const { getByTestId } = render(
        <ChatMessage
          message={message}
          onGenerateImage={onGenerateImage}
          canGenerateImage={true}
          showActions={true}
        />
      );

      // Open menu
      fireEvent(getByTestId('user-message'), 'longPress');

      expect(getByTestId('action-generate-image')).toBeTruthy();
    });

    it('hides generate image action when canGenerateImage is false', () => {
      const onGenerateImage = jest.fn();
      const message = createUserMessage('Some text');

      const { getByTestId, queryByTestId } = render(
        <ChatMessage
          message={message}
          onGenerateImage={onGenerateImage}
          canGenerateImage={false}
          showActions={true}
        />
      );

      // Open menu
      fireEvent(getByTestId('user-message'), 'longPress');

      expect(queryByTestId('action-generate-image')).toBeNull();
    });

    it('calls onGenerateImage with truncated prompt', () => {
      const onGenerateImage = jest.fn();
      const message = createUserMessage('A beautiful sunset');

      const { getByTestId } = render(
        <ChatMessage
          message={message}
          onGenerateImage={onGenerateImage}
          canGenerateImage={true}
          showActions={true}
        />
      );

      // Open menu and generate
      fireEvent(getByTestId('user-message'), 'longPress');
      fireEvent.press(getByTestId('action-generate-image'));

      expect(onGenerateImage).toHaveBeenCalledWith('A beautiful sunset');
    });

    it('shows action sheet with Done button instead of cancel', () => {
      const message = createAssistantMessage('Test');

      const { getByTestId, getByText } = render(
        <ChatMessage message={message} showActions={true} />
      );

      // Open menu
      fireEvent(getByTestId('assistant-message'), 'longPress');
      expect(getByTestId('action-menu')).toBeTruthy();

      // AppSheet has a Done button for dismissal (no cancel button)
      expect(getByText('Done')).toBeTruthy();
    });
  });

  // ============================================================================
  // Generation Metadata
  // ============================================================================
  describe('generation metadata', () => {
    it('displays generation metadata when showGenerationDetails is true', () => {
      const meta = createGenerationMeta({
        gpu: true,
        gpuBackend: 'Metal',
        tokensPerSecond: 25.5,
        modelName: 'Llama-3.2-3B',
      });
      const message = createAssistantMessage('Response with metadata', {
        generationTimeMs: 1500,
        generationMeta: meta,
      });

      const { getByTestId, getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByTestId('generation-meta')).toBeTruthy();
      expect(getByText('Metal')).toBeTruthy();
    });

    it('shows GPU backend when GPU was used', () => {
      const meta = createGenerationMeta({
        gpu: true,
        gpuBackend: 'Metal',
        gpuLayers: 32,
      });
      const message = createAssistantMessage('GPU response', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText(/Metal.*32L/)).toBeTruthy();
    });

    it('shows CPU when GPU was not used', () => {
      const meta = createGenerationMeta({
        gpu: false,
        gpuBackend: 'CPU',
      });
      const message = createAssistantMessage('CPU response', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText('CPU')).toBeTruthy();
    });

    it('displays tokens per second', () => {
      const meta = createGenerationMeta({
        tokensPerSecond: 18.7,
        decodeTokensPerSecond: 22.3,
      });
      const message = createAssistantMessage('Fast response', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText('22.3 tok/s')).toBeTruthy();
    });

    it('displays time to first token', () => {
      const meta = createGenerationMeta({
        timeToFirstToken: 0.45,
      });
      const message = createAssistantMessage('Quick start', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText(/TTFT.*0.5s/)).toBeTruthy();
    });

    it('displays model name', () => {
      const meta = createGenerationMeta({
        modelName: 'Phi-3-mini-Q4_K_M',
      });
      const message = createAssistantMessage('Phi response', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText('Phi-3-mini-Q4_K_M')).toBeTruthy();
    });

    it('displays image generation metadata', () => {
      const meta = createGenerationMeta({
        steps: 20,
        guidanceScale: 7.5,
        resolution: '512x512',
      });
      const message = createAssistantMessage('Generated image', {
        generationMeta: meta,
      });

      const { getByText } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      expect(getByText('20 steps')).toBeTruthy();
      expect(getByText('cfg 7.5')).toBeTruthy();
      expect(getByText('512x512')).toBeTruthy();
    });

    it('hides metadata when showGenerationDetails is false', () => {
      const meta = createGenerationMeta({
        gpu: true,
        tokensPerSecond: 20,
      });
      const message = createAssistantMessage('No details shown', {
        generationMeta: meta,
      });

      const { queryByTestId } = render(
        <ChatMessage message={message} showGenerationDetails={false} />
      );

      expect(queryByTestId('generation-meta')).toBeNull();
    });

    it('handles missing generation metadata gracefully', () => {
      const message = createAssistantMessage('No metadata');

      const { getByText, queryByTestId } = render(
        <ChatMessage message={message} showGenerationDetails={true} />
      );

      // Should not crash, just show message without metadata
      expect(getByText('No metadata')).toBeTruthy();
      expect(queryByTestId('generation-meta')).toBeNull();
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('edge cases', () => {
    it('handles special characters in content', () => {
      const message = createUserMessage('Test <script>alert("xss")</script>');

      const { getByText } = render(<ChatMessage message={message} />);

      // Should render safely
      expect(getByText(/Test/)).toBeTruthy();
    });

    it('handles unicode and emoji', () => {
      const message = createUserMessage('Hello 👋 World 🌍 日本語');

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Hello.*World/)).toBeTruthy();
    });

    it('handles markdown-like content', () => {
      const message = createAssistantMessage('**Bold** and *italic* text');

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Bold.*italic/)).toBeTruthy();
    });

    it('handles code blocks', () => {
      const message = createAssistantMessage('```javascript\nconst x = 1;\n```');

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/const x = 1/)).toBeTruthy();
    });

    it('handles very long single words', () => {
      const longWord = 'a'.repeat(500);
      const message = createUserMessage(longWord);

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(longWord)).toBeTruthy();
    });

    it('handles newlines and whitespace', () => {
      const message = createAssistantMessage('Line 1\n\nLine 2\n\n\nLine 3');

      const { getByText } = render(<ChatMessage message={message} />);

      expect(getByText(/Line 1.*Line 2.*Line 3/s)).toBeTruthy();
    });
  });
});
