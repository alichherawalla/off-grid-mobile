/**
 * The Mobile application lifecycle owns model-service bindings. Starting the application must make
 * native/persisted inventory reactive, and stopping it must release those bindings.
 */
import type { OffGridApplication } from '@offgrid/application';
import type { DownloadedModel } from '../../../src/types';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const eventually = async (assertion: () => void): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  throw lastError;
};

describe('Mobile application model-service lifecycle', () => {
  it('start projects model inventory and stop releases its reactive binding', async () => {
    const boundary = installNativeBoundary({ fs: true });
    const composition =
      require('../../../src/services/composition/application') as typeof import('../../../src/services/composition/application');
    const { commitModelsList } =
      require('../../../src/services/adapters/models/library/modelRegistryStorageAdapter') as typeof import('../../../src/services/adapters/models/library/modelRegistryStorageAdapter');
    const { createDownloadedModel } =
      require('../../utils/factories') as typeof import('../../utils/factories');

    const application: OffGridApplication = composition.getMobileApplication();
    await composition.startMobileApplication();
    let stopped = false;

    try {
      const first: DownloadedModel = createDownloadedModel({
        id: 'first',
        engine: 'llama',
        fileName: 'first.gguf',
        filePath: '/models/first.gguf',
      });
      boundary.fs!.seedFile(first.filePath, 1000);
      await commitModelsList([first]);
      await eventually(() => {
        expect(
          application.models
            .snapshot()
            .inventory.some(model => model.id === first.id),
        ).toBe(true);
      });

      await composition.stopMobileApplication();
      stopped = true;
      const second: DownloadedModel = createDownloadedModel({
        id: 'second',
        engine: 'llama',
        fileName: 'second.gguf',
        filePath: '/models/second.gguf',
      });
      boundary.fs!.seedFile(second.filePath, 1000);
      await commitModelsList([first, second]);
      await new Promise(resolve => setImmediate(resolve));

      expect(
        application.models
          .snapshot()
          .inventory.some(model => model.id === second.id),
      ).toBe(false);
    } finally {
      if (!stopped) await composition.stopMobileApplication();
    }
  });
});
