import { AppState } from 'react-native';
import { modelsFailureMessage } from '@offgrid/application';
import { lazyInstance } from '../composition/lazy';
import type { ModelResidencyManager } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { reportModelFailure } from '../modelFailureHandler';
import logger from '../../utils/logger';

/** The workspace owns residency (memory source and logger are its ports, see workspace.ts);
 *  this is the same instance, kept for its many readers. */
export const modelResidencyManager: ModelResidencyManager = lazyInstance(
  () => (require('./workspace') as typeof import('./workspace')).mobileWorkspace.residency,
);

function reportMemoryWarningFailure(error: unknown): void {
  reportModelFailure('text', error, {
    id: 'mobile-model-memory-warning',
    title: 'Model memory recovery failed',
    message: error instanceof Error ? error.message : 'Off Grid could not release model memory.',
    memoryPressure: true,
  });
}

async function handleMemoryWarning(): Promise<void> {
  const outcome = await applicationFacade().models.handleMemoryWarning();
  if (!outcome.ok) reportMemoryWarningFailure(new Error(modelsFailureMessage(outcome.failure)));
}

try {
  AppState.addEventListener('memoryWarning', () => {
    handleMemoryWarning().catch(error => {
      logger.error('[ModelServices] memory warning recovery failed', error);
      reportMemoryWarningFailure(error);
    });
  });
} catch {
  // Some test environments do not provide the React Native AppState boundary.
}
