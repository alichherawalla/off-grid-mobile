import { once, queuedUniformId } from '@offgrid/models';
import { createModelDownloadRegistry } from '../composition/downloads';
import logger from '../../utils/logger';
import { coordinatedDownloads as backgroundDownloadService } from './coordinatedDownloadBridge';
import type {
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest,
  DownloadModelType,
} from './downloadTypes';

export type MobileDownloadRegistry = ReturnType<
  typeof createModelDownloadRegistry<
    ModelDownloadStartRequest,
    ModelDownloadReissueRequest
  >
>;
type RegistryArguments = Parameters<
  typeof createModelDownloadRegistry<
    ModelDownloadStartRequest,
    ModelDownloadReissueRequest
  >
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

const registry = once(
  (): MobileDownloadRegistry =>
    createModelDownloadRegistry(
      mobileDownloadRegistryLogger(),
      mobileDownloadRegistryPorts(),
    ),
);

export const modelDownloadRegistry = registry();
