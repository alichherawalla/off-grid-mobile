import { AppState } from 'react-native';
import { lazyInstance } from '../composition/lazy';
import type { ModelResidencyManager } from '@offgrid/models';

/** The workspace owns residency (memory source and logger are its ports, see workspace.ts);
 *  this is the same instance, kept for its many readers. */
export const modelResidencyManager: ModelResidencyManager = lazyInstance(
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  () => (require('./workspace') as typeof import('./workspace')).mobileWorkspace.residency,
);

try {
  AppState.addEventListener('memoryWarning', () => {
    modelResidencyManager.handleMemoryWarning().catch(() => {});
  });
} catch {
  // Some test environments do not provide the React Native AppState boundary.
}
