// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ImageDownloadApplicationService,
  ImageDownloadWorkflowService,
  ModelDownloadApplicationService,
  ModelDownloadCoordinator,
  ModelDownloadProjectionController,
  ModelDownloadRegistry,
  type DownloadModelType,
  type DownloadProjectionEntry,
} from '@offgrid/models';
import { once } from '@offgrid/models';

/** Stateless; one instance serves every download surface. */
export const modelDownloadApplication = once(() => new ModelDownloadApplicationService());

export const createModelDownloadCoordinator = (
  ports: ConstructorParameters<typeof ModelDownloadCoordinator>[0],
): ModelDownloadCoordinator => new ModelDownloadCoordinator(ports);

export const createModelDownloadRegistry = <
  Start extends { modelType: DownloadModelType },
  Reissue extends { modelType: DownloadModelType } = Start,
>(
  ...ports: ConstructorParameters<typeof ModelDownloadRegistry<Start, Reissue>>
): ModelDownloadRegistry<Start, Reissue> =>
  new ModelDownloadRegistry<Start, Reissue>(...ports);

export const createModelDownloadProjection = <Entry extends DownloadProjectionEntry>(
  ...ports: ConstructorParameters<typeof ModelDownloadProjectionController<Entry>>
): ModelDownloadProjectionController<Entry> =>
  new ModelDownloadProjectionController<Entry>(...ports);

export const createImageDownloadWorkflow = <Entry extends DownloadProjectionEntry>(
  ...ports: ConstructorParameters<typeof ImageDownloadWorkflowService<Entry>>
): ImageDownloadWorkflowService<Entry> =>
  new ImageDownloadWorkflowService<Entry>(...ports);
/** One application per image download (or restart recovery), over the ports the caller supplies. */
export function imageDownloadApplication<Owner>(
  ports: ConstructorParameters<typeof ImageDownloadApplicationService<Owner>>[0],
): ImageDownloadApplicationService<Owner> {
  return new ImageDownloadApplicationService<Owner>(ports);
}
