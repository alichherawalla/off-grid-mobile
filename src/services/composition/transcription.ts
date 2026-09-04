// Composition root: the shared transcription workflow over Mobile's native, filesystem, route,
// and UI projection ports.
import { TranscriptionModelWorkflow } from '@offgrid/models';
import {
  mobileTranscriptionRuntime,
  mobileTranscriptionWorkflowPorts,
} from '../modelServices/transcriptionRuntimePort';

export const transcriptionModelIntents = new TranscriptionModelWorkflow({
  state: () => mobileTranscriptionWorkflowPorts.state(),
  project: patch => mobileTranscriptionWorkflowPorts.project(patch),
  modelPath: modelId => mobileTranscriptionRuntime.modelPath(modelId),
  loadedModelPath: () => mobileTranscriptionRuntime.loadedModelPath(),
  download: (modelId, onProgress) =>
    mobileTranscriptionRuntime.download(modelId, onProgress),
  ensureLoaded: modelId => mobileTranscriptionRuntime.ensureLoaded(modelId),
  unload: modelId => mobileTranscriptionRuntime.unload(modelId),
  delete: modelId => mobileTranscriptionRuntime.delete(modelId),
  listDownloaded: () => mobileTranscriptionRuntime.listDownloaded(),
  isDownloaded: modelId => mobileTranscriptionRuntime.isDownloaded(modelId),
  selectRoute: (...args) => mobileTranscriptionWorkflowPorts.selectRoute(...args),
  refreshInventory: () => mobileTranscriptionWorkflowPorts.refreshInventory(),
});
