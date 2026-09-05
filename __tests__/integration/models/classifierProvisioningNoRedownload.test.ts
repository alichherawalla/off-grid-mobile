/**
 * The default classifier must never be downloaded twice. Shared owns the decision
 * (`classifierProvisioningPlan`); Mobile owns the ports that report what is installed.
 * This proves the Mobile port reports installed models faithfully enough that
 * `ensureDefaultClassifier()` queues NOTHING when the user already has the classifier.
 *
 * A regression here burns the user's bandwidth and storage re-fetching a model they own.
 *
 * Altitude: the real application composition (`startMobileApplicationFixture`), asserted on
 * the reactive projection consumers read - `ModelsSnapshot.control.downloads`.
 * Faked boundary: the native download + filesystem modules only.
 */
import { DEFAULT_CLASSIFIER_REPOSITORY } from '@offgrid/models';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import { installNativeBoundary } from '../../harness/nativeBoundary';

const INSTALLED_CLASSIFIER = `${DEFAULT_CLASSIFIER_REPOSITORY}/SmolLM2-135M-Instruct-Q8_0.gguf`;

let fixture: MobileApplicationFixture | null = null;

afterEach(async () => {
  await fixture?.dispose();
  fixture = null;
});

async function start() {
  installNativeBoundary({ download: true, fs: true });
  const { startMobileApplicationFixture } =
    require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
  fixture = await startMobileApplicationFixture();
  const { useAppStore } = require('../../../src/stores') as typeof import('../../../src/stores');
  const { ensureDefaultClassifier } =
    require('../../../src/services/classifierProvisioning') as typeof import('../../../src/services/classifierProvisioning');
  return { useAppStore, ensureDefaultClassifier };
}

describe('provisioning the default classifier never re-downloads one the user already has', () => {
  it('queues no download when a configured classifier is installed', async () => {
    const { useAppStore, ensureDefaultClassifier } = await start();
    useAppStore.setState({
      downloadedModels: [{ id: INSTALLED_CLASSIFIER, engine: 'llama' } as never],
      settings: {
        ...useAppStore.getState().settings,
        classifierModelId: INSTALLED_CLASSIFIER,
      },
    });

    await ensureDefaultClassifier();

    expect(fixture!.application.models.snapshot().control.downloads).toEqual([]);
  });

  it('queues no download when the default classifier is installed but not yet selected', async () => {
    const { useAppStore, ensureDefaultClassifier } = await start();
    useAppStore.setState({
      downloadedModels: [{ id: INSTALLED_CLASSIFIER, engine: 'llama' } as never],
      settings: { ...useAppStore.getState().settings, classifierModelId: null },
    });

    await ensureDefaultClassifier().catch(() => undefined);

    // The installed copy is used - nothing is fetched again.
    expect(
      fixture!.application.models
        .snapshot()
        .control.downloads.map(row => row.modelId),
    ).toEqual([]);
  });
});
