import { classifyToolsNeeded, type GenerationIntent } from '@offgrid/models';
import { generationIntent } from './composition/chat';
import type { DownloadedModel } from '../types';
import logger from '../utils/logger';
import { executeMobileClassification } from './mobileSidecarGeneration';
import { mobileRouteId } from './modelServices/mobileRoute';

interface ClassifyOptions {
  useLLM: boolean;
  classifierModel?: DownloadedModel | null;
  onStatusChange?: (status: string) => void;
}


/** Mobile supplies classifier I/O. Shared owns patterns, fallback, and caching. */
class MobileIntentClassifier {
  async classifyIntent(
    message: string,
    options: ClassifyOptions | boolean = true,
  ): Promise<GenerationIntent> {
    const opts = typeof options === 'boolean' ? { useLLM: options } : options;
    const intent = await generationIntent().classify(message, {
      useModel: opts.useLLM,
      classifyWithModel: async query => {
        opts.onStatusChange?.('Analyzing request...');
        const classifierModel = opts.classifierModel;
        return executeMobileClassification(
          query,
          classifierModel
            ? mobileRouteId({
                source: 'local',
                hostId: classifierModel.engine,
                modality: 'classifier',
                modelId: classifierModel.id,
              })
            : undefined,
        );
      },
    });
    logger.log(`[ROUTE-SM] classify intent=${intent} msg="${message.trim().slice(0, 60)}"`);
    return intent;
  }

  quickCheck(message: string): GenerationIntent {
    return generationIntent().quickCheck(message);
  }

  clearCache(): void {
    generationIntent().clear();
  }
}

export const intentClassifier = new MobileIntentClassifier();
export { classifyToolsNeeded };
