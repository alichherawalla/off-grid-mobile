import {
  type GenerationToolDefinition,
  openAIToolToDefinition,
  toolSchemaTokenBudget,
} from '@offgrid/models';
import type { ToolRoutingService } from '@offgrid/models';
import { toolRouting } from '../composition/tools';
import { useAppStore } from '../../stores/appStore';
import logger from '../../utils/logger';
import { getToolsAsOpenAISchema } from '../tools';
import { getToolExtensions } from '../tools/extensions';
import { mobileTextEngineControl } from './textEngineControl';
import { isMcpEnabled } from '../mcpContextBoost';

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

