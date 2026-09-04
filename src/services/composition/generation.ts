// Composition root: the second generation queue (voice) and the sidecar classifier over Mobile's
// native adapters. The text/image queue is the workspace's own.
import { once } from '@offgrid/models';
import { mobileWorkspace } from '../modelServices/workspace';

/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = once(
  () => mobileWorkspace.generationLane(),
);

export const classifierExecution = once(
  () => mobileWorkspace.classifier,
);
