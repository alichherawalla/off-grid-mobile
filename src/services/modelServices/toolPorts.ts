import {
  ConversationPort,
  GenerationContentPart,
  GenerationMessage,
  GenerationToolCall,
  GenerationToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutorPort,
  openAIToolToDefinition,
  toolSchemaTokenBudget,
} from '@offgrid/models';
import type { ToolRoutingService } from '@offgrid/models';
import { toolRouting } from '../composition/tools';
import { useAppStore } from '../../stores/appStore';
import { useChatStore } from '../../stores/chatStore';
import logger from '../../utils/logger';
import { executeToolCall } from '../tools';
import { getToolsAsOpenAISchema } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import { mobileTextEngineControl } from './textEngineControl';
import { isMcpEnabled } from '../mcpContextBoost';
import { executeMobileText } from '../mobileSidecarGeneration';
import {
  mobileToolEmbeddingCache,
  mobileToolEmbeddingPort,
} from '../adapters/native/toolEmbeddingAdapter';
import { clearMobileEphemeralTextState } from './generationAdapters';
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

/** Embedding engine, cache, and model-selection text ports. Shared owns routing. */
export function mobileToolRoutingPorts(): ConstructorParameters<typeof ToolRoutingService>[0] {
  return {
    embedding: mobileToolEmbeddingPort,
    embeddingCache: mobileToolEmbeddingCache,
    modelSelection: generateToolRoutingText,
  };
}

const toolRoutingService = (): ToolRoutingService => toolRouting();

/** Build one shared schema projection from Mobile's raw tool registries. */
export async function mobileToolDefinitions(
  enabledToolIds: string[],
  messages: import('../../types').Message[],
): Promise<GenerationToolDefinition[]> {
  const builtInTools = getToolsAsOpenAISchema(enabledToolIds)
    .flatMap(schema => {
      const definition = openAIToolToDefinition(schema);
      return definition ? [definition] : [];
    });
  const externalTools = getToolExtensions()
    .flatMap(extension => extension.getOpenAISchemas?.() ?? [])
    .flatMap(schema => {
      const definition = openAIToolToDefinition(schema);
      return definition ? [definition] : [];
    });
  const settings = useAppStore.getState().settings;
  const result = await toolRoutingService().select({
    messages: messages.map(message => ({
      role: message.role,
      content: message.content,
    })),
    builtInTools,
    externalTools,
    remoteModel: mobileTextEngineControl.isRemoteActive(),
    embeddingRouting: isMcpEnabled(),
    modelRouting: true,
    schemaTokenLimit: toolSchemaTokenBudget(settings.contextLength),
  });
  if (result.fallbackReason) {
    logger.warn(`[SharedTools] ${result.strategy} selection failed (${result.fallbackReason}); using all tools`);
  }
  return result.tools;
}

async function generateToolRoutingText(system: string, user: string): Promise<string> {
  try {
    return await executeMobileText([
      { role: 'system', content: system },
      { role: 'user', content: user },
    ], { maxTokens: 64 });
  } finally {
    await clearMobileEphemeralTextState();
  }
}

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
