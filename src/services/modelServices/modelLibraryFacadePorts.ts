import RNFS from 'react-native-fs';
import { WHISPER_MODELS, type ModelLibraryPort } from '@offgrid/application';
import { useAppStore } from '../../stores/appStore';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';
import * as whisperModelFiles from '../whisperModelFiles';
import type { MobileManagedArtifactIO } from './modelDownloadArtifactIO';

function fileName(path: string): string {
  const value = path.split('/').pop();
  if (!value) throw new Error('The imported model path has no file name.');
  return decodeURIComponent(value);
}

async function removeWhisper(modelId: string): Promise<boolean> {
  if (!WHISPER_MODELS.some(model => model.id === modelId)) return false;
  const path = whisperModelFiles.getModelPath(modelId);
  if (await RNFS.exists(path)) await RNFS.unlink(path);
  return true;
}

/** Device library I/O. The Models facade owns selection, unload ordering, and typed outcomes. */
export function createMobileModelLibraryFacadePorts(
  managed?: MobileManagedArtifactIO,
): ModelLibraryPort {
  return {
  async importFile(path, modality) {
    if (modality && modality !== 'text') {
      throw new Error(`Local ${modality} model import is not supported by this file picker.`);
    }
    const model = await modelLibrary.importLocalModel({
      sourceUri: path,
      fileName: fileName(path),
    });
    useAppStore.getState().addDownloadedModel(model);
    return { modelId: model.id };
  },

  async removeFiles(modelId) {
    if (managed?.ownsModel(modelId)) {
      await managed.removeModel(modelId);
      return;
    }
    if (await removeWhisper(modelId)) return;
    const state = useAppStore.getState();
    if (state.downloadedModels.some(model => model.id === modelId)) {
      await modelLibrary.deleteModel(modelId);
      state.removeDownloadedModel(modelId);
      return;
    }
    if (state.downloadedImageModels.some(model => model.id === modelId)) {
      await modelLibrary.deleteImageModel(modelId);
      state.removeDownloadedImageModel(modelId);
      return;
    }
    throw new Error(`Model files are not installed: ${modelId}`);
  },
  };
}
