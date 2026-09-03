// Composition root: the shared transcription workflow over Mobile's native, filesystem, route,
// and UI projection ports.
import { TranscriptionModelWorkflow } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/transcriptionRuntimePort') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/transcriptionRuntimePort') as typeof import('../modelServices/transcriptionRuntimePort');

export const transcriptionModelIntents = new TranscriptionModelWorkflow({
  state: () => ports1().mobileTranscriptionWorkflowPorts.state(),
  project: patch => ports1().mobileTranscriptionWorkflowPorts.project(patch),
  modelPath: modelId => ports1().mobileTranscriptionRuntime.modelPath(modelId),
  loadedModelPath: () => ports1().mobileTranscriptionRuntime.loadedModelPath(),
  download: (modelId, onProgress) =>
    ports1().mobileTranscriptionRuntime.download(modelId, onProgress),
  ensureLoaded: modelId => ports1().mobileTranscriptionRuntime.ensureLoaded(modelId),
  unload: modelId => ports1().mobileTranscriptionRuntime.unload(modelId),
  delete: modelId => ports1().mobileTranscriptionRuntime.delete(modelId),
  listDownloaded: () => ports1().mobileTranscriptionRuntime.listDownloaded(),
  isDownloaded: modelId => ports1().mobileTranscriptionRuntime.isDownloaded(modelId),
  selectRoute: (...args) => ports1().mobileTranscriptionWorkflowPorts.selectRoute(...args),
  refreshInventory: () => ports1().mobileTranscriptionWorkflowPorts.refreshInventory(),
});
