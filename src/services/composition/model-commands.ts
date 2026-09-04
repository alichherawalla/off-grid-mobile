// Composition root: shared model commands and selection over Mobile's store ports.
import {
  ModelCommandApplicationService,
  ModelSelectionApplicationService,
} from '@offgrid/models';
import { once } from '@offgrid/models';
import { mobileModelCommandPorts } from '../modelServices/modelCommandPorts';
import { mobileModelSelectionProjection } from '../modelServices/modelSelectionProjection';

export const modelCommands = once(() => new ModelCommandApplicationService(mobileModelCommandPorts()));
export const modelSelectionApplication = once(
  () => new ModelSelectionApplicationService(mobileModelSelectionProjection),
);
