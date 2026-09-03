// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ImageDownloadApplicationService,
  ImageDownloadWorkflowService,
  ModelDownloadApplicationService,
  ModelDownloadCoordinator,
  ModelDownloadProjectionController,
  ModelDownloadRegistry,
} from '@offgrid/models';
import type { DownloadEntry } from '../../stores/downloadStore';
import type { MobileDownloadRegistry } from '../modelServices/downloadRegistryBootstrap';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../../stores/downloadStore') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../../stores/downloadStore') as typeof import('../../stores/downloadStore');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../modelServices/modelDownloadCoordinator') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/modelDownloadCoordinator') as typeof import('../modelServices/modelDownloadCoordinator');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../modelServices/downloadRegistryBootstrap') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../modelServices/downloadRegistryBootstrap') as typeof import('../modelServices/downloadRegistryBootstrap');

/** Stateless; one instance serves every download surface. */
export const modelDownloadApplication = once(() => new ModelDownloadApplicationService());

export const modelDownloadCoordinator = once(
  () => new ModelDownloadCoordinator(ports2().mobileModelDownloadPorts()),
);

export const modelDownloadRegistry = once(
  (): MobileDownloadRegistry =>
    new ModelDownloadRegistry(ports3().mobileDownloadRegistryLogger(), ports3().mobileDownloadRegistryPorts()),
);

export const modelDownloadProjectionController = once(
  () => new ModelDownloadProjectionController<DownloadEntry>(ports1().mobileDownloadProjectionPorts()),
);
export const imageDownloadWorkflow = once(
  () => new ImageDownloadWorkflowService<DownloadEntry>(ports1().modelDownloadProjection),
);
/** One application per image download (or restart recovery), over the ports the caller supplies. */
export function imageDownloadApplication<Owner>(
  ports: ConstructorParameters<typeof ImageDownloadApplicationService<Owner>>[0],
): ImageDownloadApplicationService<Owner> {
  return new ImageDownloadApplicationService<Owner>(ports);
}
