import type { TextEngineApplicationService } from '@offgrid/models';
import { textEngineControl } from '../composition/text-engine';
import logger from '../../utils/logger';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { activeMobileRoute } from './mobileLLMService';

/** Native text-runtime ports. Shared owns route, capability, and lifecycle policy. */
export function mobileTextEnginePorts(): ConstructorParameters<typeof TextEngineApplicationService>[0] {
  return {
  active: () => activeMobileRoute('text'),
  engines: [
    {
      id: 'litert',
      isAvailable: () => liteRTService.isAvailable(),
      isLoaded: () => liteRTService.isModelLoaded(),
      unload: () => liteRTService.unloadModel(),
      stop: () => liteRTService.stopGeneration(),
      invalidateConversation: () => liteRTService.invalidateConversation(),
      // Every supported Mobile LiteRT bundle is a curated Gemma 4 bundle.
      requiresLeadingThinkToken: () => true,
    },
    {
      id: 'llama',
      isAvailable: () => true,
      isLoaded: () => llmService.isModelLoaded(),
      unload: () => llmService.unloadModel(),
      stop: () => llmService.stopGeneration(),
      prepareConversation: id => llmService.prepareConversationBoundary(id),
      invalidateConversation: () => llmService.clearKVCache(true),
      backendFallbackNotice: () => llmService.getBackendFallbackNotice(),
      requiresLeadingThinkToken: () => llmService.getReasoningMetadata()?.reasoningFormat === 'auto',
    },
  ],
  onBoundaryError(operation, engineId, error) {
    logger.warn(`[TextEngine] ${operation} failed for ${engineId}:`, error);
  },
  };
}

export const mobileTextEngineControl = textEngineControl();
