// Composition root: the second generation queue (voice) and the sidecar classifier over Mobile's
// native adapters. The text/image queue is the workspace's own.
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../modelServices/workspace') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/workspace') as typeof import('../modelServices/workspace');

/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = once(
  () => ports2().mobileWorkspace.generationLane(),
);

export const classifierExecution = once(
  () => ports2().mobileWorkspace.classifier,
);
