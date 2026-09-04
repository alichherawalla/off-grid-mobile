import { modelSelectionApplication } from '../composition/model-selection';

/** The shared model-selection application owner, composed in `../composition/model-selection`. */
export const mobileModelSelectionService = modelSelectionApplication();
