import { ModelDownloadRegistry, queuedUniformId } from '@offgrid/models';
import logger from '../../utils/logger';
import { backgroundDownloadService } from '../backgroundDownloadService';
import type {
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest,
  ModelDownloadType,
} from './downloadTypes';

export const modelDownloadRegistry = new ModelDownloadRegistry<
  ModelDownloadStartRequest,
  ModelDownloadReissueRequest
>(
  {
    transition: message => logger.log(`[DL-SM] ${message}`),
    error: (message, error) => logger.log(
      `[DL-SM] ${message}: ${error instanceof Error ? error.message : String(error)}`,
    ),
  },
  {
    cancel(id) {
      const queued = backgroundDownloadService.getQueuedItems().find(item =>
        queuedUniformId({
          modelType: item.modelType as ModelDownloadType,
          modelId: item.modelId,
          modelKey: item.modelKey,
        }) === id,
      );
      return queued ? backgroundDownloadService.cancelQueued(queued.modelKey) : false;
    },
  },
);
