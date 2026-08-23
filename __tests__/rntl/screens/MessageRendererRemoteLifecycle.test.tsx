import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { MessageRenderer } from '../../../src/screens/ChatScreen/MessageRenderer';
import {
  _clearSlotsForTesting,
  registerSlot,
  SLOTS,
} from '../../../src/bootstrap/slotRegistry';
import { useUiModeStore } from '../../../src/stores/uiModeStore';

const props = {
  index: 0,
  displayMessagesLength: 1,
  animateLastN: 0,
  imageModelLoaded: false,
  isStreaming: false,
  isGeneratingImage: true,
  showGenerationDetails: false,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  onEdit: jest.fn(),
  onGenerateImage: jest.fn(),
  onImagePress: jest.fn(),
};

afterEach(() => {
  _clearSlotsForTesting();
  useUiModeStore.setState({ interfaceMode: 'chat' });
});

describe('<MessageRenderer/> remote image lifecycle', () => {
  it('shows the remote status but no audio bubble for a lifecycle-only row', () => {
    registerSlot(SLOTS.messageAudioMode, () => <Text>audio-message-bubble</Text>);
    useUiModeStore.setState({ interfaceMode: 'audio' });

    const view = render(
      <MessageRenderer
        {...props}
        item={{
          id: 'remote-stream:phone-a:image-a',
          role: 'assistant',
          content: '-',
          timestamp: 1,
          isStreaming: true,
          statusText: 'Loading image model...',
          suppressMessageBubble: true,
        }}
      />,
    );

    expect(view.getByText('Loading image model...')).toBeTruthy();
    expect(view.queryByText('audio-message-bubble')).toBeNull();
  });
});
