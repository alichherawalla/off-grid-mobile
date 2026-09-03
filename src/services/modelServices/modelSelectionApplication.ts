import { modelSelectionApplication } from '../composition/model-commands';

/** The shared model-selection application owner, composed in `../composition/model-commands`. */
export const mobileModelSelectionService = modelSelectionApplication();
