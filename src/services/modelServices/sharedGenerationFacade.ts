import type { GenerationContentPart, GenerationMessage } from '@offgrid/models';
import type { MediaAttachment, Message } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import logger from '../../utils/logger';
import { FLUSH_INTERVAL_MS } from '../generationServiceHelpers';
import { mobileGenerationService } from './index';

function attachmentPart(attachment: MediaAttachment): GenerationContentPart {
  if (attachment.type === 'image') {
    return { type: 'image', uri: attachment.uri, mimeType: attachment.mimeType };
  }
  if (attachment.type === 'audio') {
    return { type: 'audio', uri: attachment.uri, mimeType: attachment.mimeType };
  }
  return {
    type: 'file',
    uri: attachment.uri,
    mimeType: attachment.mimeType,
    name: attachment.fileName,
  };
}

function sharedMessages(messages: Message[]): GenerationMessage[] {
  return messages.map(message => {
    const attachments = message.attachments?.map(attachmentPart) ?? [];
    const content = attachments.length
      ? [{ type: 'text' as const, text: message.content }, ...attachments]
      : message.content;
    return {
      role: message.role,
      content,
      name: message.toolName,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls?.map((call, index) => ({
        id: call.id ?? `${message.id}-tool-${index}`,
        name: call.name,
        arguments: call.arguments,
      })),
    };
  });
}

/** Keep the existing Mobile presentation state while shared owns generation orchestration. */
export async function generateSharedChatResponse(
  service: any,
  request: {
    conversationId: string;
    messages: Message[];
    onFirstToken?: () => void;
  },
): Promise<void> {
  const { conversationId, messages, onFirstToken } = request;
  if (service.state.isGenerating) return;
  const attempt = ++service.generationAttempt;
  const controller = new AbortController();
  service.currentSharedAbortController = controller;
  service.abortRequested = false;
  service.updateState({
    isGenerating: true,
    isThinking: true,
    conversationId,
    streamingContent: '',
    startTime: Date.now(),
  });
  const store = useChatStore.getState();
  store.startStreaming(conversationId);
  service.tokenBuffer = '';
  service.reasoningBuffer = '';
  service.totalReasoningLength = 0;
  let firstContent = true;

  try {
    const result = await mobileGenerationService.generate(
      {
        operation: { type: 'text' },
        messages: sharedMessages(messages),
        identity: {
          conversationId,
          turnId: messages.at(-1)?.uuid ?? messages.at(-1)?.id ?? `${conversationId}-${attempt}`,
        },
        signal: controller.signal,
      },
      {
        chunk: chunk => {
          if (controller.signal.aborted || service.generationAttempt !== attempt) return;
          if (chunk.content) {
            if (firstContent) {
              firstContent = false;
              service.updateState({ isThinking: false });
              onFirstToken?.();
            }
            service.state.streamingContent += chunk.content;
            service.tokenBuffer += chunk.content;
          }
          if (chunk.reasoning) {
            service.reasoningBuffer += chunk.reasoning;
            service.totalReasoningLength += chunk.reasoning.length;
          }
          if ((chunk.content || chunk.reasoning) && !service.flushTimer) {
            service.flushTimer = setTimeout(
              () => service.flushTokenBuffer(),
              FLUSH_INTERVAL_MS,
            );
          }
        },
      },
    );
    if (controller.signal.aborted || service.generationAttempt !== attempt) return;
    service.forceFlushTokens();
    if (!service.state.streamingContent && result.content) {
      store.appendToStreamingMessage(result.content);
    }
    const generationTime = service.state.startTime
      ? Date.now() - service.state.startTime
      : undefined;
    store.finalizeStreamingMessage(
      conversationId,
      generationTime,
      service.buildGenerationMeta(),
    );
    service.checkSharePrompt();
    service.resetState();
  } catch (error) {
    if (controller.signal.aborted || service.generationAttempt !== attempt) return;
    logger.error('[GenerationService] Shared generation error:', error);
    service.keepShownPartialOrClear();
    service.resetState();
    throw error;
  } finally {
    if (service.currentSharedAbortController === controller) {
      service.currentSharedAbortController = null;
    }
  }
}
