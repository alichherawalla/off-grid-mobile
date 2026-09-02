import {
  VisionRepairApplicationService,
  type VisionRepairApplicationIntent,
  type VisionRepairApplicationResult,
} from '@offgrid/models';
import { useAppStore } from '../../../../stores/appStore';
import type { DownloadedModel, ModelFile } from '../../../../types';
import * as visionRepair from './visionRepairAdapter';
import type { VisionRepairContext } from './visionRepairAdapter';

export function executeVisionRepairIntent(
  context: VisionRepairContext,
  getDownloadedModels: () => Promise<DownloadedModel[]>,
  intent: VisionRepairApplicationIntent<DownloadedModel, ModelFile>,
): Promise<VisionRepairApplicationResult<DownloadedModel[]>> {
  return new VisionRepairApplicationService<
    DownloadedModel,
    ModelFile,
    DownloadedModel[]
  >({
    repairModel: model => visionRepair.repairVision(context, model),
    repairProjector: (modelId, file) =>
      visionRepair.repairMmProj(context, { modelId, file }, {}),
    refresh: async () => {
      const models = await getDownloadedModels();
      useAppStore.getState().setDownloadedModels(models);
      return models;
    },
  }).execute(intent);
}
