/**
 * OD8 — voice-mode thinking must STREAM token-by-token in the DISPLAY.
 *
 * In TEXT mode the assistant's reasoning streams live: every reasoning token
 * updates `streamingReasoningContent` in the REAL chatStore, `getDisplayMessages`
 * rebuilds the in-progress `streaming` message (carrying the live reasoning), and
 * the message UI re-renders it. VOICE mode renders the same in-progress message
 * through the `message.audioMode` slot (MessageAudioMode).
 *
 * The bug (OD8): while streaming, MessageAudioMode showed only a loading audio
 * bubble and threw the live reasoning away — the thinking text appeared all at
 * once at completion, not per-token.
 *
 * This test drives the REAL chatStore with a DYNAMIC sequence of reasoning-token
 * appends, and at each step builds the in-progress message via the REAL
 * getDisplayMessages and renders the REAL MessageAudioMode. It asserts the
 * DISPLAYED thinking text reflects each increment ('' → partial → more), not
 * only the final complete string. A static mock cannot prove per-token streaming,
 * so the sequence is genuinely incremental and driven through the real store.
 */
import React from 'react';
import type { MessageAudioModeProps } from '@offgrid/pro/audio/ui/MessageAudioMode';
import type { Message } from '@offgrid/core/types';
import type { MobileApplicationFixture } from '../../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
} from '../../../harness/nativeBoundary';

const baseProps: Omit<MessageAudioModeProps, 'msg'> = {
  isStreamingThis: true,
  shouldAnimate: false,
  showGenerationDetails: false,
  onCopy: jest.fn(),
  onRetry: jest.fn(),
  onEdit: jest.fn(),
  onGenerateImage: jest.fn(),
  onImagePress: jest.fn(),
};

let applicationFixture: MobileApplicationFixture | undefined;
let MessageAudioMode: typeof import('@offgrid/pro/audio/ui/MessageAudioMode').MessageAudioMode;
let useChatStore: typeof import('@offgrid/core/stores/chatStore').useChatStore;
let getDisplayMessages: typeof import('../../../../src/screens/ChatScreen/types').getDisplayMessages;
let rtl: typeof import('@testing-library/react-native');

beforeAll(async () => {
  installNativeBoundary();
  rtl = requireRTL();
  ({ MessageAudioMode } =
    require('@offgrid/pro/audio/ui/MessageAudioMode') as typeof import('@offgrid/pro/audio/ui/MessageAudioMode'));
  ({ useChatStore } =
    require('@offgrid/core/stores/chatStore') as typeof import('@offgrid/core/stores/chatStore'));
  ({ getDisplayMessages } =
    require('../../../../src/screens/ChatScreen/types') as typeof import('../../../../src/screens/ChatScreen/types'));
  const { startMobileApplicationFixture } =
    require('../../../harness/mobileApplicationFixture') as typeof import('../../../harness/mobileApplicationFixture');
  applicationFixture = await startMobileApplicationFixture({ pro: true });
});

afterAll(async () => {
  await applicationFixture?.dispose();
});

afterEach(() => {
  rtl.cleanup();
  jest.clearAllMocks();
});

/** Build the in-progress `streaming` message the UI renders, from live store state. */
function currentStreamingMessage(conversationId: string): Message {
  const s = useChatStore.getState();
  const items = getDisplayMessages([], {
    isThinking: s.isThinking,
    streamingMessage: s.streamingMessage,
    streamingReasoningContent: s.streamingReasoningContent,
    isStreamingForThisConversation:
      s.streamingForConversationId === conversationId,
  });
  return items[items.length - 1] as Message;
}

describe('MessageAudioMode — voice thinking streams per token (OD8)', () => {
  it('reflects each reasoning increment in the displayed thinking, not only the final string', () => {
    const conversationId = 'conv-od8';
    const store = useChatStore.getState();
    store.startStreaming(conversationId);
    // A separate-channel model streams reasoning via streamingReasoningContent.
    store.appendToStreamingReasoningContent('Let me');

    // Renders the in-progress message and returns the live thinking text shown
    // inside the (expanded-while-streaming) thinking block.
    const renderThinking = () => {
      const msg = currentStreamingMessage(conversationId);
      const utils = rtl.render(<MessageAudioMode {...baseProps} msg={msg} />);
      const block = utils.getByTestId('thinking-block-content');
      return { utils, block };
    };

    // Step 1: partial reasoning is already visible while streaming.
    const step1 = renderThinking();
    expect(rtl.within(step1.block).getByText(/Let me/)).toBeTruthy();
    expect(rtl.within(step1.block).queryByText(/think about/)).toBeNull();
    step1.utils.unmount();

    // Step 2: another token arrives — the DISPLAY grows to include it.
    useChatStore.getState().appendToStreamingReasoningContent(' think about');
    const step2 = renderThinking();
    expect(
      rtl.within(step2.block).getByText(/Let me think about/),
    ).toBeTruthy();
    expect(rtl.within(step2.block).queryByText(/the weather/)).toBeNull();
    step2.utils.unmount();

    // Step 3: more tokens — still growing, still mid-stream (not gated on completion).
    useChatStore.getState().appendToStreamingReasoningContent(' the weather');
    const step3 = renderThinking();
    expect(
      rtl.within(step3.block).getByText(/Let me think about the weather/),
    ).toBeTruthy();
    step3.utils.unmount();
  });
});
