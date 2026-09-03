import {
  decodeModelRouteId,
  type ModelSelectionStore,
} from '@offgrid/models';

/**
 * Shared LLMService calls this single persisted-selection adapter. It is a pure write: the Mac's own
 * selection is the Mac's to change, and only an explicit pick in this app's UI (selectMobileModel)
 * asks it to. A write here used to activate the route on the paired Desktop as a side effect, so
 * every hydrate, refresh, or recovery that re-wrote the phone's selection silently moved the Mac's.
 */
// The selection application composes the projection port, which reaches the stores; resolved at
// call time so the workspace can be built first.
const selection = (): typeof import('./modelSelectionApplication') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./modelSelectionApplication') as typeof import('./modelSelectionApplication');

export const mobileModelSelectionStore: ModelSelectionStore = {
  read: modality => selection().mobileModelSelectionService.read(modality),
  async write(modality, canonicalId) {
    const route = canonicalId ? decodeModelRouteId(canonicalId) : null;
    if (canonicalId && !route) throw new Error('The selected model route is invalid');
    await selection().mobileModelSelectionService.write(modality, canonicalId);
  },
};
