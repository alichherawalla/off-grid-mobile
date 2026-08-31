/** Mobile composition root for the shared model-residency application service. */
import { AppState, Platform } from 'react-native';
import { ModelResidencyManager } from '@offgrid/models';
import { hardwareService } from '../hardware';
import logger from '../../utils/logger';

const memorySource = {
  current: () => ({
    totalMB: hardwareService.getTotalMemoryGB() * 1024,
    availableMB: hardwareService.getAvailableMemoryGB() * 1024,
    platform: Platform.OS,
  }),
  refresh: async () => {
    await hardwareService.refreshMemoryInfo();
    return {
      totalMB: hardwareService.getTotalMemoryGB() * 1024,
      availableMB: hardwareService.getAvailableMemoryGB() * 1024,
      platform: Platform.OS,
    };
  },
};

export const modelResidencyManager = new ModelResidencyManager(memorySource, {
  debug: (message, details) => logger.log(`[ModelResidency] ${message}`, details),
  warn: (message, details) => logger.warn(`[ModelResidency] ${message}`, details),
});

try {
  AppState.addEventListener('memoryWarning', () => {
    modelResidencyManager.handleMemoryWarning().catch(() => {});
  });
} catch {
  // Some test environments do not provide the React Native AppState boundary.
}
