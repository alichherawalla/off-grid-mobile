// Composition root: the workspace-owned runtime services - the model lifecycle and the memory
// advisory. They belong to the workspace, not to the model library, so they compose here over
// `mobileWorkspace`.
import { once } from '@offgrid/models';
import { mobileWorkspace } from '../modelServices/workspace';

export const modelLifecycle = once(() => mobileWorkspace.lifecycle);
export const modelMemoryAdvisory = once(() => mobileWorkspace.memoryAdvisory);
