import type {
  VisionRepairApplicationIntent,
  VisionRepairApplicationResult,
} from '@offgrid/models';
import { visionRepairApplication } from '../../../composition/model-library-services';
import type { DownloadedModel, ModelFile } from '../../../../types';
import type { VisionRepairContext } from './visionRepairAdapter';
import { mobileVisionRepairPorts } from './visionRepairPorts';

export type { MobileVisionRepairApplication } from './visionRepairPorts';

export function executeVisionRepairIntent(
  context: VisionRepairContext,
  getDownloadedModels: () => Promise<DownloadedModel[]>,
  intent: VisionRepairApplicationIntent<DownloadedModel, ModelFile>,
): Promise<VisionRepairApplicationResult<DownloadedModel[]>> {
  return visionRepairApplication(mobileVisionRepairPorts(context, getDownloadedModels)).execute(intent);
}
