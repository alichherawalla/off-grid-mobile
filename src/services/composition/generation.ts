// Composition root: the second generation queue (voice) and the sidecar classifier.
//
// The CLASSIFIER now comes from the facade's `models.classification` seam - `classify` is the only
// thing its consumer calls and the only thing the seam exposes - so nothing holds
// `ClassifierExecutionService` any more.
//
// The VOICE LANE still holds the workspace, and it is not for want of trying: `ModelGenerationLane`
// exposes `generate` only, but mobile also REGISTERS ADAPTERS on this lane. The lane has its own
// adapter set (`voiceAdapterRegistrations` in modelServices/index.ts, reconciled by
// `reconcileMobileVoiceAdapters`, which requires `registerAdapter`) precisely because it is a
// separate queue from the main text one. Requested from shared as WIRING_B #10.
import { once } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { mobileWorkspace } from '../modelServices/workspace';

/** Voice has its own queue so sentence playback can run while text is still streaming. */
export const mobileVoiceGenerationService = once(
  () => mobileWorkspace.generationLane(),
);

export const classifierExecution = () =>
  applicationFacade().models.classification;
