import React from 'react';
import { Text } from 'react-native';
import { render, within } from '@testing-library/react-native';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { formatTime } from '../../../src/components/ChatMessage/utils';
import { MessageRenderer } from '../../../src/screens/ChatScreen/MessageRenderer';
import { getDisplayMessages } from '../../../src/screens/ChatScreen/types';
import type { Message } from '../../../src/types';

afterEach(_clearSlotsForTesting);

describe('<ChatMessage/> supporting context', () => {
  const renderItem = (item: Message) =>
    render(
      <MessageRenderer
        item={item}
        index={0}
        displayMessagesLength={1}
        animateLastN={0}
        imageModelLoaded={false}
        isStreaming={false}
        isGeneratingImage={false}
        showGenerationDetails={false}
        onCopy={jest.fn()}
        onRetry={jest.fn()}
        onEdit={jest.fn()}
        onGenerateImage={jest.fn()}
        onImagePress={jest.fn()}
      />,
    );

  const enhancedPrompt: Message = {
    id: 'enhanced-prompt',
    role: 'assistant',
    content:
      '<think>__LABEL:Enhanced prompt__\nA cinematic lighthouse in a winter storm.</think>',
    timestamp: Date.UTC(2026, 7, 13, 9, 0, 0),
  };

  it('keeps an enhanced prompt inside an assistant bubble before the image result exists', () => {
    const view = renderItem(enhancedPrompt);

    expect(view.getByTestId('message-bubble')).toBeTruthy();
    expect(view.getByText('Enhanced prompt')).toBeTruthy();
    expect(view.queryByText('•••')).toBeNull();
  });

  it('renders the enhanced prompt, image, and caption in one result bubble', () => {
    registerSlot(SLOTS.messageSpeakButton, () => <Text>Speak</Text>);
    const imageResult: Message = {
      id: 'image-result',
      role: 'assistant',
      content: 'Generated image for: a lighthouse in a winter storm',
      timestamp: Date.UTC(2026, 7, 13, 9, 1, 0),
      attachments: [
        {
          id: 'generated-image-1',
          type: 'image',
          uri: 'file:///generated-image.png',
          width: 1024,
          height: 1024,
        },
      ],
    };
    const [item] = getDisplayMessages([enhancedPrompt, imageResult], {
      isThinking: false,
      streamingMessage: '',
      streamingReasoningContent: '',
      isStreamingForThisConversation: false,
    });

    const view = renderItem(item);

    const bubble = view.getByTestId('message-bubble');
    const result = within(bubble);
    expect(result.getByText('Enhanced prompt')).toBeTruthy();
    expect(result.getByTestId('generated-image')).toBeTruthy();
    expect(
      result.getByText('Generated image for: a lighthouse in a winter storm'),
    ).toBeTruthy();
    expect(view.getAllByTestId('assistant-message')).toHaveLength(1);
    expect(view.getAllByText('•••')).toHaveLength(1);
    expect(view.getAllByText('Speak')).toHaveLength(1);
    expect(view.getAllByText(formatTime(imageResult.timestamp))).toHaveLength(
      1,
    );

    const tree = JSON.stringify(view.toJSON());
    expect(tree.indexOf('Enhanced prompt')).toBeLessThan(
      tree.indexOf('generated-image'),
    );
    expect(tree.indexOf('generated-image')).toBeLessThan(
      tree.indexOf('Generated image for: a lighthouse in a winter storm'),
    );
  });

  it('shows an image loader in the result bubble until synced image bytes arrive', () => {
    const imageResult: Message = {
      id: 'image-result',
      uuid: 'image-result-uuid',
      role: 'assistant',
      content: 'Generated image for: a lighthouse in a winter storm',
      timestamp: Date.UTC(2026, 7, 13, 9, 1, 0),
    };
    const [item] = getDisplayMessages([enhancedPrompt, imageResult], {
      isThinking: false,
      streamingMessage: '',
      streamingReasoningContent: '',
      isStreamingForThisConversation: false,
    });

    const view = renderItem(item);
    const result = within(view.getByTestId('message-bubble'));

    expect(result.getByText('Enhanced prompt')).toBeTruthy();
    expect(result.getByTestId('attachment-pending-0')).toBeTruthy();
    expect(
      result.getByText('Generated image for: a lighthouse in a winter storm'),
    ).toBeTruthy();
    expect(view.getAllByTestId('assistant-message')).toHaveLength(1);
  });
});
