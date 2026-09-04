// Composition root: the shared model-selection application over Mobile's selection projection.
// Selection needs nothing from the model COMMAND ports, and its consumer (`modelSelectionApplication`,
// read by the selection store) sits below them, so it composes here rather than in `model-commands`.
import { ModelSelectionApplicationService, once } from '@offgrid/models';
import { mobileModelSelectionProjection } from '../modelServices/modelSelectionProjection';

export const modelSelectionApplication = once(
  () => new ModelSelectionApplicationService(mobileModelSelectionProjection),
);
