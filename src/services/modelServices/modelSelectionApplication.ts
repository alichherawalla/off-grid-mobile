import { ModelSelectionApplicationService } from '@offgrid/models';
import { mobileModelSelectionProjection } from './modelSelectionProjection';

/** Mobile composition of the Shared model-selection application owner. */
export const mobileModelSelectionService = new ModelSelectionApplicationService(
  mobileModelSelectionProjection,
);
