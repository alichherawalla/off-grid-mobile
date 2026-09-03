import { queuedUniformId } from '@offgrid/models';
import type { ModelDownloadRegistry } from '@offgrid/models';
import { modelDownloadRegistry as composedRegistry } from '../composition/downloads';
import logger from '../../utils/logger';
import { coordinatedDownloads as backgroundDownloadService } from './coordinatedDownloadBridge';
import type {
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest,
  DownloadModelType,
} from './downloadTypes';

export type MobileDownloadRegistry = ModelDownloadRegistry<
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest
>;
type RegistryArguments = ConstructorParameters<
  typeof ModelDownloadRegistry<ModelDownloadStartRequest, ModelDownloadReissueRequest>
>;

export function mobileDownloadRegistryLogger(): RegistryArguments[0] {
  return {
    transition: message => logger.log(`[DL-SM] ${message}`),
    error: (message, error) =>
      logger.log(
        `[DL-SM] ${message}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ),
  };
}

/** Queue cancellation through the native bridge. */
export function mobileDownloadRegistryPorts(): RegistryArguments[1] {
  return {
    cancel(id) {
      const queued = backgroundDownloadService.getQueuedItems().find(
        item =>
          queuedUniformId({
            modelType: item.modelType as DownloadModelType,
            modelId: item.modelId,
            modelKey: item.modelKey,
          }) === id,
      );
      return queued
        ? backgroundDownloadService.cancelQueued(queued.modelKey)
        : false;
    },
  };
}

export const modelDownloadRegistry: MobileDownloadRegistry = composedRegistry();
