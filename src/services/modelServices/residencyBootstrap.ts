import { AppState } from 'react-native';
import { mobileWorkspace } from './workspace';

/** The workspace owns residency (memory source and logger are its ports, see workspace.ts);
 *  this is the same instance, kept for its many readers. */
export const modelResidencyManager = mobileWorkspace.residency;

try {
  AppState.addEventListener('memoryWarning', () => {
    modelResidencyManager.handleMemoryWarning().catch(() => {});
  });
} catch {
  // Some test environments do not provide the React Native AppState boundary.
}
