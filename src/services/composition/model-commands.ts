// Composition root: shared model commands over Mobile's store ports. Selection lives in
// `model-selection.ts` (re-exported here, so every existing import path resolves unchanged) because
// the selection store reads it from below these command ports.
import { ModelCommandApplicationService, once } from '@offgrid/models';
import { mobileModelCommandPorts } from '../modelServices/modelCommandPorts';

export { modelSelectionApplication } from './model-selection';

export const modelCommands = once(() => new ModelCommandApplicationService(mobileModelCommandPorts()));
