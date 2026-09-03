// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ImageDownloadApplicationService,
  ImageDownloadWorkflowService,
  ModelDownloadApplicationService,
  ModelDownloadCoordinator,
  ModelDownloadProjectionController,
  ModelDownloadRegistry,
} from '@offgrid/models';
import {
  mobileDownloadProjectionPorts,
  modelDownloadProjection,
} from '../../stores/downloadStore';
import type { DownloadEntry } from '../../stores/downloadStore';
import { mobileModelDownloadPorts } from '../modelServices/modelDownloadCoordinator';
import {
  mobileDownloadRegistryLogger,
  mobileDownloadRegistryPorts,
  type MobileDownloadRegistry,
} from '../modelServices/downloadRegistryBootstrap';
import { once } from './once';

/** Stateless; one instance serves every download surface. */
export const modelDownloadApplication = once(() => new ModelDownloadApplicationService());

export const modelDownloadCoordinator = once(
  () => new ModelDownloadCoordinator(mobileModelDownloadPorts()),
);

export const modelDownloadRegistry = once(
  (): MobileDownloadRegistry =>
    new ModelDownloadRegistry(mobileDownloadRegistryLogger(), mobileDownloadRegistryPorts()),
);

export const modelDownloadProjectionController = once(
  () => new ModelDownloadProjectionController<DownloadEntry>(mobileDownloadProjectionPorts()),
);
export const imageDownloadWorkflow = once(
  () => new ImageDownloadWorkflowService<DownloadEntry>(modelDownloadProjection),
);
/** One application per image download (or restart recovery), over the ports the caller supplies. */
export function imageDownloadApplication<Owner>(
  ports: ConstructorParameters<typeof ImageDownloadApplicationService<Owner>>[0],
): ImageDownloadApplicationService<Owner> {
  return new ImageDownloadApplicationService<Owner>(ports);
}
