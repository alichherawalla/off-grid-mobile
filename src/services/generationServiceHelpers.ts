import type { GenerationMeta } from '../types';
import { useAppStore, useRemoteServerStore } from '../stores';
import { getActiveEngineService } from './engines';
import { effectiveCacheType } from './llmHelpers';
import { liteRTService } from './litert';
import { llmService } from './llm';

export const FLUSH_INTERVAL_MS = 50;

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

export function buildGenerationMetaImpl(service: any): GenerationMeta {
  let meta: GenerationMeta;
  if (service.isUsingRemoteProvider()) {
    const activeServer = useRemoteServerStore.getState().getActiveServer();
    const tokenCount = Math.ceil((service.state.streamingContent.length + service.totalReasoningLength) / 4);
    const duration = service.state.startTime ? (Date.now() - service.state.startTime) / 1000 : 0;
    meta = {
      gpu: false,
      gpuBackend: 'Remote',
      modelName: activeServer?.name || 'Remote Model',
      tokenCount,
      tokensPerSecond: duration > 0 ? tokenCount / duration : undefined,
      timeToFirstToken: service.remoteTimeToFirstToken,
    };
  } else {
    const { downloadedModels, activeModelId, settings } = useAppStore.getState();
    const modelName = downloadedModels.find((model: any) => model.id === activeModelId)?.name;
    if (getActiveEngineService() === liteRTService) {
      meta = liteRTMeta(service, modelName);
    } else {
      const { gpu, gpuBackend, gpuLayers } = llmService.getGpuInfo();
      const performance = llmService.getPerformanceStats();
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
