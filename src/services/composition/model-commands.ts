// Composition root: shared model commands and selection over Mobile's store ports.
import {
  ModelCommandApplicationService,
  ModelSelectionApplicationService,
} from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/modelCommandApplication') =>
  require('../modelServices/modelCommandApplication') as typeof import('../modelServices/modelCommandApplication');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../modelServices/modelSelectionProjection') =>
  require('../modelServices/modelSelectionProjection') as typeof import('../modelServices/modelSelectionProjection');

export const modelCommands = once(() => new ModelCommandApplicationService(ports1().mobileModelCommandPorts()));
export const modelSelectionApplication = once(
  () => new ModelSelectionApplicationService(ports3().mobileModelSelectionProjection),
);
