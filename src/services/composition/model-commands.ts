// Composition root: shared model commands, ejection, and selection over Mobile's store ports.
import {
  ModelCommandApplicationService,
  ModelEjectionService,
  ModelSelectionApplicationService,
} from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/modelCommandApplication') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/modelCommandApplication') as typeof import('../modelServices/modelCommandApplication');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../modelServices/ejectModelsForUser') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/ejectModelsForUser') as typeof import('../modelServices/ejectModelsForUser');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../modelServices/modelSelectionProjection') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/modelSelectionProjection') as typeof import('../modelServices/modelSelectionProjection');

export const modelCommands = once(() => new ModelCommandApplicationService(ports1().mobileModelCommandPorts()));
export const modelEjection = once(() => new ModelEjectionService(ports2().mobileModelEjectionPorts()));
export const modelSelectionApplication = once(
  () => new ModelSelectionApplicationService(ports3().mobileModelSelectionProjection),
);
