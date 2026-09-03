// Compatibility name during the vertical cutover. This is the global application's closed facade.
import { once } from '@offgrid/models';

const application = (): typeof import('./application') =>
  require('./application') as typeof import('./application');

export const sharedRag = once(() => application().mobileApplication.rag);
