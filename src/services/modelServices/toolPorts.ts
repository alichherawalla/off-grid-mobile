import {
  ConversationPort,
  GenerationContentPart,
  GenerationMessage,
  GenerationToolCall,
  GenerationToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutorPort,
} from '@offgrid/models';
import { useChatStore } from '../../stores/chatStore';
import { Platform } from 'react-native';
import logger from '../../utils/logger';
import { executeToolCall } from '../tools';
import { getToolsAsOpenAISchema } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import { getActiveEngineService, isRemoteTextModelActive } from '../engines';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { isMcpEnabled } from '../mcpContextBoost';
import { executeMobileToolSelection } from '../mobileSidecarGeneration';
import { selectRelevantTools } from '../litertToolSelector';
import type { ToolCall, ToolResult } from '../tools/types';

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

function openAISchemaDefinition(schema: any): GenerationToolDefinition | null {
  const fn = schema?.function;
  if (!fn?.name || typeof fn.name !== 'string') return null;
  return {
    name: fn.name,
    description: typeof fn.description === 'string' ? fn.description : undefined,
    inputSchema: fn.parameters && typeof fn.parameters === 'object'
      ? fn.parameters
      : { type: 'object', properties: {} },
  };
}

/** Build one shared schema projection from Mobile's raw tool registries. */
export async function mobileToolDefinitions(
  enabledToolIds: string[],
  messages: import('../../types').Message[],
): Promise<GenerationToolDefinition[]> {
  const schemas = await mobileEffectiveToolSchemas(messages, enabledToolIds);
  return schemas.flatMap(schema => {
    const definition = openAISchemaDefinition(schema);
    return definition ? [definition] : [];
  });
}

function lastUserQuery(messages: import('../../types').Message[]): string {
  return [...messages].reverse().find(message => message.role === 'user' && message.content.trim())?.content.trim() ?? '';
}

async function mobileEffectiveToolSchemas(
  messages: import('../../types').Message[],
  enabledToolIds: string[],
): Promise<any[]> {
  const builtIn = getToolsAsOpenAISchema(enabledToolIds);
  const extensions = getToolExtensions().flatMap(extension => extension.getOpenAISchemas?.() ?? []);
  const all = [...builtIn, ...extensions];
  if (extensions.length === 0 || all.length <= 5 || isRemoteTextModelActive()) return all;
  const query = lastUserQuery(messages);
  try {
    const selected = isMcpEnabled()
      ? await executeMobileToolSelection(query, extensions, 12)
      : await selectRelevantTools(
          query,
          extensions,
          getActiveEngineService() === liteRTService || Platform.OS !== 'ios'
            ? undefined
            : (system, user) => llmService.generateToolSelection(system, user),
        );
    if (!selected?.length) return builtIn;
    return [...builtIn, ...extensions.filter(schema => selected.includes(schema.function.name))];
  } catch (error) {
    logger.warn(`[SharedTools] tool selection failed; using all tools: ${String(error)}`);
    return all;
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

export function mobileToolResult(result: ToolExecutionResult, call: GenerationToolCall): ToolResult {
  const metadata = result.metadata?.toolResult;
  const shared = metadata && typeof metadata === 'object'
    ? metadata as Partial<ToolResult>
    : {};
  return {
    toolCallId: typeof shared.toolCallId === 'string' ? shared.toolCallId : call.id,
    name: typeof shared.name === 'string' ? shared.name : call.name,
    content: typeof shared.content === 'string' ? shared.content : contentText(result.content),
    error: typeof shared.error === 'string' ? shared.error : undefined,
    errorCategory: typeof shared.errorCategory === 'string'
      ? shared.errorCategory as ToolResult['errorCategory']
      : undefined,
    status: shared.status === 'ok' || shared.status === 'empty' || shared.status === 'error'
      ? shared.status
      : result.isError ? 'error' : 'ok',
    durationMs: typeof shared.durationMs === 'number' ? shared.durationMs : 0,
    terminal: shared.terminal,
  };
}
