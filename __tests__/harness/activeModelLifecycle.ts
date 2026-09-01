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
import { getCurrentlyLoadedMemoryGB } from '../../src/services/modelServices/modelMemoryAdvisory';
import { useAppStore } from '../../src/stores/appStore';
import { registerLifecycleProjectionPort } from '../../src/services/modelServices/lifecycleProjectionPort';
import { mobileModelSelectionStore } from '../../src/services/modelServices/selectionStore';

registerLifecycleProjectionPort({
  refreshInventory: async () => undefined,
  selectRoute: (modality, routeId) => mobileModelSelectionStore.write(modality, routeId),
});

function currentLoadedMemoryGB(): number {
  const ids = getLoadedModelIds();
  const state = useAppStore.getState();
  return getCurrentlyLoadedMemoryGB(
    {
      loadedTextModelId: ids.textModelId,
      loadedImageModelId: ids.imageModelId,
    },
    {
      downloadedModels: state.downloadedModels,
      downloadedImageModels: state.downloadedImageModels,
    },
  );
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
