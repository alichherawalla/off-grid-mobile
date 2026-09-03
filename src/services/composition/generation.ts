// Composition root: the second generation queue (voice) and the sidecar classifier over Mobile's
// native adapters. The text/image queue is the workspace's own.
import { ClassifierExecutionService, GenerationService } from '@offgrid/models';
import { classifierExecutionAdapter } from '../adapters/native/classifierExecutionAdapter';
import { mobileWorkspace } from '../modelServices/workspace';
import { once } from './once';

/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = once(
  () => new GenerationService(mobileWorkspace.llm, mobileWorkspace.residency),
);

export const classifierExecution = once(
  () => new ClassifierExecutionService(classifierExecutionAdapter),
);
