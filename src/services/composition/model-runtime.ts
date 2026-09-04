// Composition root. The memory advisory is GONE from here: its consumer reads the facade's
// `models.memoryAdvice` seam directly, so nothing holds that service any more.
//
// `lifecycle` remains, for EJECT ONLY, and it is not an oversight. The facade's `models.eject()` is
// a different capability from the workspace's `lifecycle.eject({localUnloads, remoteModalities})`:
// mobile registers `ejectAll: ejectAllModels` as the facade's ejection PORT, so `ejectAllModels`
// is the implementation behind `models.eject()` and calling the facade from inside it would
// recurse. Load and unload have adopted the facade commands. See WIRING_B #9.
import { once } from '@offgrid/models';
import { mobileWorkspace } from '../modelServices/workspace';

export const modelLifecycle = once(() => mobileWorkspace.lifecycle);
