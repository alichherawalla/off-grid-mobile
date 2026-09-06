import { arrangeLocalSelection } from '../../utils/testHelpers';
/**
 * GUARD (UI integration) — reasoning survives a tool-call turn: when a LiteRT model streams reasoning,
 * calls a tool, then answers, the user sees BOTH the thinking and the final answer in the bubble
 * (relevant to the parse-once reasoning work). Real generationService + toolLoop + real calculator +
 * liteRTService over the faked LiteRTModule; renders the REAL ChatMessage the pipeline produced.
 */
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';
import type { Message } from '../../../src/types';

describe('thinking across a tool-call turn (guard)', () => {
  it('shows the streamed reasoning AND the final answer after a tool call', async () => {
    const boundary = installNativeBoundary({
      ram: {
        platform: 'android',
        totalBytes: 12 * 1024 ** 3,
        availBytes: 8 * 1024 ** 3,
      },
    });
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    const fixture = await startMobileApplicationFixture();

    try {
      const React = require('react');
      const { render } = requireRTL();
      const { liteRTService } = require('../../../src/services/litert');
      const {
        mobileChatSession,
      } = require('../../../src/screens/ChatScreen/mobileChatSession');
      const { useAppStore, useChatStore } = require('../../../src/stores');
      const { ChatMessage } = require('../../../src/components/ChatMessage');

      await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', {
        maxNumTokens: 4096,
      });
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel({ id: 'lrt', engine: 'litert' }),
        ],
        settings: {
          ...useAppStore.getState().settings,
          enabledTools: ['calculator'],
        },
      });
      arrangeLocalSelection('text', 'lrt');
      const {
        refreshMobileModelServices,
      } = require('../../../src/services/modelServices');
      await refreshMobileModelServices();
      const conversationId = useChatStore.getState().createConversation('lrt');
      const user = useChatStore.getState().addMessage(conversationId, {
        role: 'user',
        content: 'what is 2+2',
        turnKind: 'text',
      });

      boundary.litert.scriptTurn({
        reasoning: 'Let me compute this with the calculator.',
        toolCalls: [{ name: 'calculator', arguments: { expression: '2+2' } }],
        content: 'The answer is 4.',
      });

      await mobileChatSession.sendPersisted(conversationId, user.id);

      const messages: Message[] = useChatStore
        .getState()
        .getConversationMessages(conversationId);
      const assistant = [...messages]
        .reverse()
        .find(m => m.role === 'assistant');
      const { queryByText } = render(
        React.createElement(ChatMessage, {
          message: assistant as Message,
          showGenerationDetails: false,
        }),
      );

      // The reasoning is preserved + shown, and the final answer renders — the thinking isn't lost across
      // the tool call.
      expect(
        queryByText(/Let me compute this with the calculator/),
      ).not.toBeNull();
      expect(queryByText(/The answer is 4\./)).not.toBeNull();
    } finally {
      await fixture.dispose();
    }
  });
});
