import type { ChatTurn } from '@offgrid/models';
import type { GenerationMeta } from '../types';
import { useAppStore } from '../stores';
import { mobileTextEngineControl } from './modelServices/textEngineControl';
import { effectiveCacheType } from './llmHelpers';
import { liteRTService } from './litert';
import { llmService } from './llm';
import { activeMobileRoute } from './modelServices/mobileLLMService';

export const FLUSH_INTERVAL_MS = 50; // ~20 updates/sec

function liteRTMeta(service: any, modelName: string | undefined): GenerationMeta {
  const backend = liteRTService.getActiveBackend() ?? 'cpu';
  const stats = service.liteRTBenchmarkStats ?? liteRTService.getLastBenchmarkStats();
  if (stats) {
    return {
      gpu: backend !== 'cpu',
      gpuBackend: backend.toUpperCase(),
      modelName,
      decodeTokensPerSecond: stats.decodeTokensPerSecond,
      prefillTokensPerSecond: stats.prefillTokensPerSecond,
      timeToFirstToken: stats.ttft,
      tokenCount: stats.prefillTokenCount,
      modelLoadTimeSeconds: stats.initTimeSeconds > 0 ? stats.initTimeSeconds : undefined,
    };
  }
  const tokenCount = Math.ceil((service.state.streamingContent?.length ?? 0) / 4);
  const duration = service.state.startTime ? (Date.now() - service.state.startTime) / 1000 : 0;
  return {
    gpu: backend !== 'cpu',
    gpuBackend: backend.toUpperCase(),
    modelName,
    tokenCount,
    tokensPerSecond: duration > 0 && tokenCount > 0 ? tokenCount / duration : undefined,
  };
}

/**
 * The meta line names the model that answered. Shared records it on the finished turn; when a
 * fallback answered, that differs from the active route, so the turn wins and the route is the
 * fallback only for turns that never reached a result (stop, failure).
 */
export function buildGenerationMetaImpl(service: any, turn?: ChatTurn): GenerationMeta {
  let meta: GenerationMeta;
  const active = turn?.result?.model ?? activeMobileRoute('text').model;
  if (active?.source === 'remote') {
    const tokenCount = Math.ceil((service.state.streamingContent.length + service.totalReasoningLength) / 4);
    const duration = service.state.startTime ? (Date.now() - service.state.startTime) / 1000 : 0;
    meta = {
      gpu: false,
      gpuBackend: 'Remote',
      modelName: active.name,
      tokenCount,
      tokensPerSecond: duration > 0 ? tokenCount / duration : undefined,
      timeToFirstToken: service.remoteTimeToFirstToken,
    };
  } else {
    const { settings } = useAppStore.getState();
    const modelName = active?.name;
    if (mobileTextEngineControl.activeLocalProviderId() === 'litert') {
      meta = liteRTMeta(service, modelName);
    } else {
      const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo() ?? {};
      const performance = llmService.getPerformanceStats() ?? {};
      meta = {
        gpu,
        gpuBackend,
        gpuLayers,
        modelName,
        tokensPerSecond: performance.lastTokensPerSecond,
        decodeTokensPerSecond: performance.lastDecodeTokensPerSecond,
        timeToFirstToken: performance.lastTimeToFirstToken,
        tokenCount: performance.lastTokenCount,
        cacheType: effectiveCacheType(settings.inferenceBackend, settings.cacheType),
        truncated: performance.lastTruncated,
      };
    }
  }
  const routed = service.state?.routedToolNames;
  if (Array.isArray(routed) && routed.length > 0) meta.routedToolNames = routed;
  return meta;
}
