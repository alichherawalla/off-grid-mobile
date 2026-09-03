// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ModelDownloadApplicationService,
  ModelDownloadCoordinator,
  ModelDownloadRegistry,
} from '@offgrid/models';
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
