import type { AutoSetupCatalog, AutoSetupPlan as SharedAutoSetupPlan } from '@offgrid/models';
import type { ModelFile } from '../types';
import type { ImageModelDescriptor } from './imageModelDownloadTypes';

export {
  selectAutoSetupPlans,
  type AutoSetupCandidate,
  type AutoSetupTier,
} from '@offgrid/models';

export type AutoSetupTextPayload = { modelId: string; file: ModelFile };
export type AutoSetupImagePayload = ImageModelDescriptor;
export type AutoSetupSttPayload = { modelId: string };

export type AutoSetupCompatibleCatalog = AutoSetupCatalog<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload
>;

export type AutoSetupPlan = SharedAutoSetupPlan<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload
>;
