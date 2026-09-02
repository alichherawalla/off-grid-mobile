/** Test-only aggregate for legacy journeys while production uses named SRP modules. */
import {
  ejectAllModels,
  loadImageModel,
  loadTextModel,
  unloadAllModels,
  unloadImageModel,
  unloadTextModel,
} from '../../src/services/modelServices/modelLifecycleBootstrap';
import {
  checkMemoryForDualModel,
  checkMemoryForModel,
  clearTextModelCache,
  getActiveModels,
  getLoadedModelIds,
  getPerformanceStats,
  getResourceUsage,
  hasAnyModelLoaded,
  resolveSelectedTextModel,
  selectedTextModelId,
  selectTextModel,
  subscribeToModelState,
  supportsAudioInput,
  syncWithNativeState,
} from '../../src/services/modelServices/modelState';
import { modelResidencyManager } from '../../src/services/modelServices/residencyBootstrap';
import { registerLifecycleProjectionPort } from '../../src/services/modelServices/lifecycleProjectionPort';
import { mobileModelSelectionStore } from '../../src/services/modelServices/selectionStore';

registerLifecycleProjectionPort({
  refreshInventory: async () => undefined,
  selectRoute: async (modality, routeId) => {
    await mobileModelSelectionStore.write(modality, routeId);
  },
});

function currentLoadedMemoryGB(): number {
  return modelResidencyManager.getResidents()
    .reduce((total, resident) => total + resident.sizeMB, 0) / 1024;
}

export const activeModelService = {
  checkMemoryForDualModel,
  checkMemoryForModel,
  clearTextModelCache,
  ejectAll: ejectAllModels,
  getActiveModels,
  getLoadedModelIds,
  getCurrentlyLoadedMemoryGB: currentLoadedMemoryGB,
  getPerformanceStats,
  getResourceUsage,
  hasAnyModelLoaded,
  loadImageModel,
  loadTextModel,
  resolveSelectedTextModel,
  selectedTextModelId,
  selectTextModel,
  subscribe: subscribeToModelState,
  supportsAudioInput,
  syncWithNativeState,
  unloadAllModels,
  unloadImageModel,
  unloadTextModel,
};
