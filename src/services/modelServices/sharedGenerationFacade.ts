import type {
  GenerationContentPart,
  GenerationMessage,
  GenerationToolCall,
} from '@offgrid/models';
import type { MediaAttachment, Message } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import logger from '../../utils/logger';
import { FLUSH_INTERVAL_MS } from '../generationServiceHelpers';
import { mobileToolPromptMessages } from '../generationToolLoop';
import type { ToolResult } from '../tools/types';
import { mobileGenerationService } from './index';
import {
  mobileToolDefinitions,
  mobileToolResult,
} from './toolPorts';

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

function decodedToolArguments(call: GenerationToolCall): Record<string, any> {
  try {
    const value: unknown = JSON.parse(call.arguments || '{}');
    return value && !Array.isArray(value) && typeof value === 'object'
      ? value as Record<string, any>
      : {};
  } catch {
    return {};
  }
}

/** Keep Mobile's chat presentation callbacks while shared owns all tool rounds. */
export async function generateSharedToolResponse(
  service: any,
  request: {
    conversationId: string;
    messages: Message[];
    enabledToolIds: string[];
    projectId?: string;
    onToolCallStart?: (name: string, args: Record<string, any>) => void;
    onToolCallComplete?: (name: string, result: ToolResult) => void;
    onFirstToken?: () => void;
  },
): Promise<{ interrupted: boolean } | void> {
  if (service.state.isGenerating) return;
  const attempt = ++service.generationAttempt;
  const controller = new AbortController();
  service.currentSharedAbortController = controller;
  service.abortRequested = false;
  service.updateState({
    isGenerating: true,
    isThinking: true,
    conversationId: request.conversationId,
    streamingContent: '',
    startTime: Date.now(),
  });
  const store = useChatStore.getState();
  store.startStreaming(request.conversationId);
  service.tokenBuffer = '';
  service.reasoningBuffer = '';
  service.totalReasoningLength = 0;
  let firstContent = true;

  try {
    const tools = await mobileToolDefinitions(request.enabledToolIds, request.messages);
    const messages = mobileToolPromptMessages(
      request.messages,
      request.enabledToolIds,
      tools.length > 0,
    );
    service.state.routedToolNames = tools.map(tool => tool.name);
    const configuredMax = useAppStore.getState().settings.maxToolCalls;
    const maxToolRounds = Number.isInteger(configuredMax) && configuredMax >= 1 && configuredMax <= 100
      ? configuredMax
      : 25;
    const result = await mobileGenerationService.generate(
      {
        operation: { type: 'text' },
        messages: sharedMessages(messages),
        identity: {
          conversationId: request.conversationId,
          turnId: request.messages.at(-1)?.uuid
            ?? request.messages.at(-1)?.id
            ?? `${request.conversationId}-${attempt}`,
          projectId: request.projectId,
        },
        tools,
        maxToolRounds,
        signal: controller.signal,
      },
      {
        chunk: chunk => {
          if (controller.signal.aborted || service.generationAttempt !== attempt) return;
          if (chunk.content) {
            if (firstContent) {
              firstContent = false;
              service.updateState({ isThinking: false });
              request.onFirstToken?.();
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
        toolStarted: call => {
          request.onToolCallStart?.(call.name, decodedToolArguments(call));
        },
        toolCompleted: (call, toolExecution) => {
          request.onToolCallComplete?.(call.name, mobileToolResult(toolExecution, call));
        },
      },
    );
    if (controller.signal.aborted || service.generationAttempt !== attempt) {
      return { interrupted: true };
    }
    service.forceFlushTokens();
    if (!service.state.streamingContent && result.content) {
      store.appendToStreamingMessage(result.content);
    }
    const generationTime = service.state.startTime
      ? Date.now() - service.state.startTime
      : undefined;
    store.finalizeStreamingMessage(
      request.conversationId,
      generationTime,
      service.buildGenerationMeta(),
    );
    service.checkSharePrompt();
    service.resetState();
    return { interrupted: false };
  } catch (error) {
    if (controller.signal.aborted || service.generationAttempt !== attempt) {
      return { interrupted: true };
    }
    logger.error('[GenerationService] Shared tool generation error:', error);
    service.keepShownPartialOrClear();
    service.resetState();
    throw error;
  } finally {
    if (service.currentSharedAbortController === controller) {
      service.currentSharedAbortController = null;
    }
  }
}
