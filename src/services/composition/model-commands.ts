// Composition root: shared model commands, ejection, and selection over Mobile's store ports.
import {
  ModelCommandApplicationService,
  ModelEjectionService,
  ModelSelectionApplicationService,
} from '@offgrid/models';
import { mobileModelCommandPorts } from '../modelServices/modelCommandApplication';
import { mobileModelEjectionPorts } from '../modelServices/ejectModelsForUser';
import { mobileModelSelectionProjection } from '../modelServices/modelSelectionProjection';
import { once } from './once';

export const modelCommands = once(() => new ModelCommandApplicationService(mobileModelCommandPorts()));
export const modelEjection = once(() => new ModelEjectionService(mobileModelEjectionPorts()));
export const modelSelectionApplication = once(
  () => new ModelSelectionApplicationService(mobileModelSelectionProjection),
);
