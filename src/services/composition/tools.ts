// Composition root: shared tool routing over Mobile's embedding ports.
import { ToolRoutingService } from '@offgrid/models';
import { once } from './once';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/toolPorts') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/toolPorts') as typeof import('../modelServices/toolPorts');

export const toolRouting = once(() => new ToolRoutingService(ports1().mobileToolRoutingPorts()));
