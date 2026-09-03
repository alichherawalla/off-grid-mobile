// Composition root: shared text-engine control over Mobile's native runtimes.
import { TextEngineApplicationService } from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/textEngineControl') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/textEngineControl') as typeof import('../modelServices/textEngineControl');

export const textEngineControl = once(() => new TextEngineApplicationService(ports1().mobileTextEnginePorts()));
