// Composition root: the shared image generation application over Mobile's image ports.
import { ImageGenerationApplicationService } from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../modelServices/imageGenerationApplication') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/imageGenerationApplication') as typeof import('../modelServices/imageGenerationApplication');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../modelServices/workspace') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/workspace') as typeof import('../modelServices/workspace');

export const imageGenerationApplication = once(
  () => new ImageGenerationApplicationService(ports2().mobileWorkspace.llm, ports1().mobileImageGenerationApplicationPorts()),
);
