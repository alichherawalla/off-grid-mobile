// Composition root: shared download services over Mobile's native transfer, file, and store ports.
import {
  ModelDownloadApplicationService,
  ModelDownloadProjectionController,
  type DownloadProjectionEntry,
} from '@offgrid/models';
import { once } from '@offgrid/models';

/** Stateless; one instance serves every download surface. */
export const modelDownloadApplication = once(() => new ModelDownloadApplicationService());

export const createModelDownloadProjection = <Entry extends DownloadProjectionEntry>(
  ...ports: ConstructorParameters<typeof ModelDownloadProjectionController<Entry>>
): ModelDownloadProjectionController<Entry> =>
  new ModelDownloadProjectionController<Entry>(...ports);
