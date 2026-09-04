import type { TextEngineApplicationService } from '@offgrid/models';
import logger from '../../utils/logger';
import { liteRTService } from '../litert';
import { llmService } from '../llm';
import { activeMobileRoute } from './mobileLLMService';

/**
 * Native text-runtime ports. Shared owns route, capability, and lifecycle policy.
 *
 * On `unload`: these two are the TEXT-ENGINE port, not a residency handler, so `ResidentReclaim`
 * is not their contract - `TextEngineApplicationService` declares `unload(): Promise<void>` and
 * reports through `onBoundaryError`. What they must not do is DISCARD the engine's answer, and they
 * no longer do: both engine wrappers now return a `NativeRelease` and it is passed straight
 * through, so the moment shared's text-engine contract carries it, this side already does.
 *
 * The residency path for these same engines is `modelLifecyclePorts`, where the answer IS mapped to
 * `ResidentReclaim` and does gate admission. What is still lost is inside shared's `unloadAll`,
 * which drops a returned refusal - WIRING_B #14.
 */
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
