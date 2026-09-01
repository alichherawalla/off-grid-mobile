import {
  ConversationPort,
  GenerationContentPart,
  GenerationMessage,
  GenerationToolCall,
  GenerationToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolExecutorPort,
  normalizeToolResult,
  toolErrorResult,
  toolResultModelContent,
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

function decodeArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Tool arguments must be a JSON object');
  }
  return value as Record<string, unknown>;
}

function toolCall(
  call: GenerationToolCall,
  context: ToolExecutionContext,
): ToolCall {
  return {
    id: call.id,
    name: call.name,
    arguments: decodeArguments(call.arguments),
    context: {
      conversationId: context.identity?.conversationId,
      projectId: context.projectId,
    },
  };
}

function toolResultMetadata(result: ToolResult): Record<string, unknown> {
  return {
    toolCallId: result.toolCallId,
    name: result.name,
    content: result.content,
    error: result.error,
    errorCategory: result.errorCategory,
    status: result.status,
    durationMs: result.durationMs,
  };
}

/** Adapt Mobile built-in and extension tools to the shared raw tool boundary. */
export const mobileToolExecutor: ToolExecutorPort = {
  async execute(call, context): Promise<ToolExecutionResult> {
    const start = Date.now();
    let mobileCall: ToolCall;
    try {
      mobileCall = toolCall(call, context);
    } catch (error) {
      const invalidCall: ToolCall = { id: call.id, name: call.name, arguments: {} };
      const result = toolErrorResult(invalidCall, error, start);
      return {
        content: toolResultModelContent(result),
        isError: true,
        metadata: toolResultMetadata(result),
      };
    }

    let result: ToolResult;
    try {
      const extension = getToolExtensions().find(item => item.canHandle(mobileCall.name));
      const raw = extension
        ? await extension.execute(mobileCall)
        : await executeToolCall(mobileCall);
      result = normalizeToolResult(mobileCall, raw);
    } catch (error) {
      logger.error(`[SharedTools] Tool "${mobileCall.name}" failed`, error);
      result = toolErrorResult(mobileCall, error, start);
    }
    return {
      content: toolResultModelContent(result),
      isError: result.status === 'error',
      metadata: toolResultMetadata(result),
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
  const metadata = result.metadata ?? {};
  return {
    toolCallId: typeof metadata.toolCallId === 'string' ? metadata.toolCallId : call.id,
    name: typeof metadata.name === 'string' ? metadata.name : call.name,
    content: typeof metadata.content === 'string' ? metadata.content : contentText(result.content),
    error: typeof metadata.error === 'string' ? metadata.error : undefined,
    errorCategory: typeof metadata.errorCategory === 'string'
      ? metadata.errorCategory as ToolResult['errorCategory']
      : undefined,
    status: metadata.status === 'ok' || metadata.status === 'empty' || metadata.status === 'error'
      ? metadata.status
      : result.isError ? 'error' : 'ok',
    durationMs: typeof metadata.durationMs === 'number' ? metadata.durationMs : 0,
  };
}
