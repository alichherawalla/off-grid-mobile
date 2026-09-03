import type {
  VisionRepairApplicationIntent,
  VisionRepairApplicationResult,
  VisionRepairApplicationService,
} from '@offgrid/models';
import { visionRepairApplication } from '../../../composition/model-library';
import { useAppStore } from '../../../../stores/appStore';
import type { DownloadedModel, ModelFile } from '../../../../types';
import * as visionRepair from './visionRepairAdapter';
import type { VisionRepairContext } from './visionRepairAdapter';

export type MobileVisionRepairApplication = VisionRepairApplicationService<
  DownloadedModel,
  ModelFile,
  DownloadedModel[]
>;

/** Projector repair and store refresh ports. Shared owns the repair intents. */
export function mobileVisionRepairPorts(
  context: VisionRepairContext,
  getDownloadedModels: () => Promise<DownloadedModel[]>,
): ConstructorParameters<typeof VisionRepairApplicationService<DownloadedModel, ModelFile, DownloadedModel[]>>[0] {
  return {
    repairModel: model => visionRepair.repairVision(context, model),
    repairProjector: (modelId, file) =>
      visionRepair.repairMmProj(context, { modelId, file }, {}),
    refresh: async () => {
      const models = await getDownloadedModels();
      useAppStore.getState().setDownloadedModels(models);
      return models;
    },
  };
}

export function executeVisionRepairIntent(
  context: VisionRepairContext,
  getDownloadedModels: () => Promise<DownloadedModel[]>,
  intent: VisionRepairApplicationIntent<DownloadedModel, ModelFile>,
): Promise<VisionRepairApplicationResult<DownloadedModel[]>> {
  return visionRepairApplication(mobileVisionRepairPorts(context, getDownloadedModels)).execute(intent);
}
