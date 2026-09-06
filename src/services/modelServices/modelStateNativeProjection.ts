/**
 * Standalone utility helpers for ActiveModelService.
 */

import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from './activeRoute';
import { hardwareService } from '../hardware';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import { localDreamGeneratorService as onnxImageGeneratorService } from '../localDreamGenerator';
import { ResourceUsage } from './modelStateTypes';

export async function getResourceUsage(): Promise<ResourceUsage> {
  const info = await hardwareService.refreshMemoryInfo();
  const store = useAppStore.getState();
  let estimatedModelMemory = 0;

  const activeTextId = activeLocalModelId('text');
  const activeImageId = activeLocalModelId('image');
  if (activeTextId) {
    const tm = store.downloadedModels.find(m => m.id === activeTextId);
    if (tm?.fileSize) {
      estimatedModelMemory += tm.fileSize * 1.2;
    }
  }
  if (activeImageId) {
    const im = store.downloadedImageModels.find(m => m.id === activeImageId);
    if (im?.size) {
      estimatedModelMemory += im.size * 1.3;
    }
  }

  return {
    memoryUsed: info.usedMemory,
    memoryTotal: info.totalMemory,
    memoryAvailable: info.availableMemory,
    memoryUsagePercent: (info.usedMemory / info.totalMemory) * 100,
    estimatedModelMemory,
  };
}

export interface SyncStateTarget {
  setLoadedTextModelId: (id: string | null) => void;
  setLoadedImageModelId: (id: string | null) => void;
  setLoadedImageModelThreads: (n: number | null) => void;
  loadedTextModelId: string | null;
  loadedImageModelId: string | null;
}

export async function syncWithNativeState(target: SyncStateTarget): Promise<void> {
  const activeTextId = activeLocalModelId('text');
  const activeImageId = activeLocalModelId('image');

  const textModelLoaded = llmService.isModelLoaded() || liteRTService.isModelLoaded();
  if (!textModelLoaded) {
    target.setLoadedTextModelId(null);
  } else if (!target.loadedTextModelId && activeTextId) {
    target.setLoadedTextModelId(activeTextId);
  }

  const imageModelLoaded = await onnxImageGeneratorService.isModelLoaded();
  if (!imageModelLoaded) {
    target.setLoadedImageModelId(null);
    target.setLoadedImageModelThreads(null);
  } else if (!target.loadedImageModelId && activeImageId) {
    target.setLoadedImageModelId(activeImageId);
  }
}
