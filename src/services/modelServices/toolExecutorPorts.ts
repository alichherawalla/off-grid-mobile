import type {
  ConversationPort,
  GenerationContentPart,
  GenerationMessage,
  GenerationToolCall,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutorPort,
} from '@offgrid/models';
import { useChatStore } from '../../stores/chatStore';
import { executeToolCall } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import type { ToolCall } from '../tools/types';

function toolCall(
  call: GenerationToolCall,
  context: ToolExecutionContext,
): ToolCall {
  return {
    id: call.id,
    name: call.name,
    // Shared executeGenerationTool has already decoded and schema-validated this
    // JSON object before the platform boundary is called.
    arguments: JSON.parse(call.arguments || '{}') as Record<string, unknown>,
    context: {
      conversationId: context.identity?.conversationId,
      projectId: context.projectId,
    },
  };
}

/** Invoke Mobile built-in and extension tools. Shared owns all result policy. */
export const mobileToolExecutor: ToolExecutorPort = {
  async execute(call, context): Promise<ToolExecutionResult> {
    const mobileCall = toolCall(call, context);
    const extension = getToolExtensions().find(item => item.canHandle(mobileCall.name));
    const result = extension
      ? await extension.execute(mobileCall)
      : await executeToolCall(mobileCall);
    return {
      content: result.error || result.content,
      isError: !!result.error,
      terminal: result.terminal,
      metadata: { platformResult: result },
    };
  },
};

function contentText(content: string | GenerationContentPart[]): string {
  if (typeof content === 'string') return content;
  return content.map(part => part.type === 'text' ? part.text : `[${part.type} result]`).join('\n');
}

/** Persist shared tool-loop context without duplicating the final streamed assistant reply. */
export const mobileConversationPort: ConversationPort = {
  async append(identity, message: GenerationMessage): Promise<void> {
    if (message.role === 'assistant' && !message.toolCalls?.length) return;
    useChatStore.getState().addMessage(identity.conversationId, {
      role: message.role,
      content: contentText(message.content),
      reasoningContent: message.reasoning,
      toolCallId: message.toolCallId,
      toolName: message.name,
      toolCalls: message.toolCalls,
    });
  },
};
