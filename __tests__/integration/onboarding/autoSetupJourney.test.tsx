import { type AutoSetupCatalogBoundaries } from '../../../src/services/autoSetupCatalog';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';
import {
  installNativeBoundary,
  requireRTL,
  type NativeBoundary,
} from '../../harness/nativeBoundary';

const MB = 1024 * 1024;
const WHISPER_SHA256: Readonly<Record<string, string>> = {
  'ggml-large-v3.bin':
    '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2',
  'ggml-large-v3-turbo.bin':
    '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69',
};
const parameterCount = (modelId: string): number => {
  if (modelId.includes('9B')) return 9;
  if (modelId.includes('E4B')) return 4;
  if (modelId.includes('2.2B')) return 2.2;
  if (modelId.includes('2B') || modelId.includes('E2B')) return 2;
  if (modelId.includes('0.8B')) return 0.8;
  return 1;
};
const catalogBoundaries: AutoSetupCatalogBoundaries = {
  totalMemoryGB: () => 12,
  fetchTextFiles: async models =>
    Object.fromEntries(
      models.map(model => {
        const params = parameterCount(model.id);
        return [
          model.id,
          [
            {
              name: `${params}b.gguf`,
              size: params * 100 * MB,
              quantization: 'Q4_K_M',
              downloadUrl: `https://models.test/${params}b.gguf`,
            },
          ],
        ];
      }),
    ),
  imageRecommendation: async () => ({
    compatibleBackends: ['coreml'],
    recommendedModels: ['balanced image'],
    recommendedBackend: 'coreml',
    bannerText: 'Core ML is ready.',
  }),
  imageModels: async () => [
    {
      id: 'image-lean',
      name: 'Lean image',
      description: 'Lean image',
      size: 100 * MB,
      downloadUrl: 'https://models.test/image-lean',
      repo: 'offgrid/image-lean',
      coremlFiles: [
        {
          path: 'model.bin',
          relativePath: 'model.bin',
          size: 100 * MB,
          downloadUrl: 'https://models.test/image-lean/model.bin',
        },
      ],
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-balanced',
      name: 'Balanced image',
      description: 'Balanced image',
      size: 200 * MB,
      downloadUrl: 'https://models.test/image-balanced',
      repo: 'offgrid/image-balanced',
      coremlFiles: [
        {
          path: 'model.bin',
          relativePath: 'model.bin',
          size: 200 * MB,
          downloadUrl: 'https://models.test/image-balanced/model.bin',
        },
      ],
      style: 'general',
      backend: 'coreml',
    },
    {
      id: 'image-extreme',
      name: 'Extreme image',
      description: 'Extreme image',
      size: 300 * MB,
      downloadUrl: 'https://models.test/image-extreme',
      repo: 'offgrid/image-extreme',
      coremlFiles: [
        {
          path: 'model.bin',
          relativePath: 'model.bin',
          size: 300 * MB,
          downloadUrl: 'https://models.test/image-extreme/model.bin',
        },
      ],
      style: 'general',
      backend: 'coreml',
    },
  ],
};

describe('Auto Setup release journey', () => {
  const originalFetch = global.fetch;
  let fixture: MobileApplicationFixture;
  let boundary: NativeBoundary;
  type Navigation = import('react').ComponentProps<
    typeof import('../../../src/screens/AutoSetupScreen').AutoSetupScreen
  >['navigation'];
  let navigation: Navigation;
  let React: typeof import('react');
  let rtl: typeof import('@testing-library/react-native');
  let AutoSetupScreen: typeof import('../../../src/screens/AutoSetupScreen').AutoSetupScreen;
  let createAutoSetupSession: typeof import('../../../src/services/composition/guided-setup').createAutoSetupSession;

  const downloads = () =>
    fixture.application.models.snapshot().control.downloads;
  const sessionFactory = () =>
    createAutoSetupSession({ catalog: catalogBoundaries });
  const renderScreen = () =>
    rtl.render(
      React.createElement(AutoSetupScreen, { navigation, sessionFactory }),
    );
  const nextNativeTransfer = async (completedIds = new Set<string>()) => {
    try {
      await rtl.waitFor(() =>
        expect(
          boundary
            .download!.active()
            .some(
              row =>
                row.status === 'running' && !completedIds.has(row.downloadId),
            ),
        ).toBe(true),
      );
    } catch {
      throw new Error(
        `No next native transfer: ${JSON.stringify({
          native: boundary.download!.active(),
          downloads: downloads(),
        })}`,
      );
    }
    return boundary
      .download!.active()
      .find(
        row => row.status === 'running' && !completedIds.has(row.downloadId),
      )!;
  };
  const completeNativeTransfer = (transfer: {
    downloadId: string;
    fileName?: string;
  }) => {
    const artifactName = transfer.fileName?.replace(/^\d+-/, '');
    const sha256 = artifactName ? WHISPER_SHA256[artifactName] : undefined;
    boundary.download!.complete(
      transfer.downloadId,
      sha256 ? { sha256 } : undefined,
    );
  };
  const completeSelectedPlan = async () => {
    const completedTransferIds = new Set<string>();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (
        downloads().length === 3 &&
        downloads().every(download => download.status === 'completed')
      ) {
        return;
      }
      const transfer = await nextNativeTransfer(completedTransferIds);
      completeNativeTransfer(transfer);
      completedTransferIds.add(transfer.downloadId);
      await rtl.waitFor(() =>
        expect(
          boundary
            .download!.active()
            .find(row => row.downloadId === transfer.downloadId)?.status,
        ).toBe('completed'),
      );
    }
    throw new Error(
      `Selected setup plan did not complete: ${JSON.stringify(downloads())}`,
    );
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    boundary = installNativeBoundary({ download: true, fs: true });
    await require('@react-native-async-storage/async-storage').clear();
    const repositoryFacts: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          siblings: [
            { rfilename: '4b.gguf', lfs: { size: 4 * 100 * MB } },
            { rfilename: '9b.gguf', lfs: { size: 9 * 100 * MB } },
            {
              rfilename: 'ggml-large-v3.bin',
              lfs: {
                size: 3_095_033_483,
                sha256: WHISPER_SHA256['ggml-large-v3.bin'],
              },
            },
            {
              rfilename: 'ggml-large-v3-turbo.bin',
              lfs: {
                size: 1_624_555_275,
                sha256: WHISPER_SHA256['ggml-large-v3-turbo.bin'],
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    global.fetch = jest.fn(repositoryFacts);
    React = require('react') as typeof import('react');
    rtl = requireRTL();
    ({ AutoSetupScreen } =
      require('../../../src/screens/AutoSetupScreen') as typeof import('../../../src/screens/AutoSetupScreen'));
    ({ createAutoSetupSession } =
      require('../../../src/services/composition/guided-setup') as typeof import('../../../src/services/composition/guided-setup'));
    const { startMobileApplicationFixture } =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    fixture = await startMobileApplicationFixture();
    navigation = {
      navigate: jest.fn(),
      push: jest.fn(),
      replace: jest.fn(),
    } as unknown as Navigation;
  });

  afterEach(async () => {
    await fixture.dispose();
    global.fetch = originalFetch;
  });

  it('selects a device-fit plan, starts all model downloads, and activates it', async () => {
    const ui = renderScreen();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    expect(ui.getAllByText('INCLUDES')).toHaveLength(1);
    expect(ui.getByText('Gemma 4 E4B')).toBeTruthy();
    rtl.fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));
    expect(ui.getByText('Qwen 3.5 9B')).toBeTruthy();
    expect(ui.queryByText('Gemma 4 E4B')).toBeNull();
    rtl.fireEvent.press(ui.getByTestId('auto-setup-download'));
    await completeSelectedPlan();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-continue')).toBeTruthy(),
    );
    expect(downloads().map(item => item.modelType)).toEqual(
      expect.arrayContaining(['text', 'image', 'stt']),
    );

    rtl.fireEvent.press(ui.getByTestId('auto-setup-continue'));
    await rtl.waitFor(() => {
      expect(fixture.selectedModelId('text')).toContain(
        'unsloth/Qwen3.5-9B-GGUF',
      );
      expect(navigation.replace).toHaveBeenCalledWith('Main');
    });
  });

  it('keeps manual model and remote server setup in Advanced Setup', async () => {
    const ui = renderScreen();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-advanced')).toBeTruthy(),
    );
    rtl.fireEvent.press(ui.getByTestId('auto-setup-advanced'));
    expect(navigation.push).toHaveBeenCalledWith('AdvancedSetup');
  });

  it('shows the failed model and cancels the other downloads as one session', async () => {
    const ui = renderScreen();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );

    rtl.fireEvent.press(ui.getByTestId('auto-setup-download'));
    const completedIds = new Set<string>();
    let image = await nextNativeTransfer(completedIds);
    while (!image.modelId?.includes('image')) {
      completeNativeTransfer(image);
      completedIds.add(image.downloadId);
      image = await nextNativeTransfer(completedIds);
    }
    boundary.download!.fail(
      image.downloadId,
      'Image model download could not start.',
    );

    await rtl.waitFor(() =>
      expect(
        ui.getByText('Image model download could not start.'),
      ).toBeTruthy(),
    );
    expect(ui.getByText(/FAILED/)).toBeTruthy();
    await rtl.waitFor(() => {
      const active = downloads().filter(
        download => download.status === 'downloading',
      );
      expect(active).toEqual([]);
    });
  });

  it('keeps central download records alive after setup unmounts', async () => {
    const ui = renderScreen();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-download')).toBeTruthy(),
    );
    rtl.fireEvent.press(ui.getByTestId('auto-setup-download'));
    await rtl.waitFor(() =>
      expect(ui.getAllByText(/STARTING|0%/).length).toBeGreaterThan(0),
    );
    const completedIds = new Set<string>();
    while (downloads().length < 3) {
      const transfer = await nextNativeTransfer(completedIds);
      completeNativeTransfer(transfer);
      completedIds.add(transfer.downloadId);
      await rtl.waitFor(() =>
        expect(
          downloads().some(download => download.status === 'completed'),
        ).toBe(true),
      );
    }

    const beforeUnmount = downloads();
    expect(beforeUnmount).toHaveLength(3);

    ui.unmount();

    await rtl.waitFor(() => {
      const afterUnmount = downloads();
      expect(afterUnmount.map(download => download.downloadId)).toEqual(
        beforeUnmount.map(download => download.downloadId),
      );
      expect(afterUnmount.map(download => download.status)).toEqual(
        beforeUnmount.map(download => download.status),
      );
    });

    const activeTransfer = await nextNativeTransfer();
    const progressBefore = downloads().map(download => ({
      downloadId: download.downloadId,
      bytesDownloaded: download.bytesDownloaded,
    }));
    const expectedTotalBytes = activeTransfer.totalBytes ?? 0;
    expect(expectedTotalBytes).toBeGreaterThan(0);
    boundary.download!.progress(
      activeTransfer.downloadId,
      Math.floor(expectedTotalBytes * 0.42),
      expectedTotalBytes,
    );
    await rtl.waitFor(() => {
      expect(
        downloads().some(download => {
          const previous = progressBefore.find(
            candidate => candidate.downloadId === download.downloadId,
          );
          return download.bytesDownloaded > (previous?.bytesDownloaded ?? 0);
        }),
      ).toBe(true);
    });

    const completedBefore = downloads().filter(
      download => download.status === 'completed',
    ).length;
    completeNativeTransfer(activeTransfer);
    await rtl.waitFor(
      () =>
        expect(
          downloads().filter(download => download.status === 'completed'),
        ).toHaveLength(completedBefore + 1),
      { timeout: 4_000 },
    );
  });

  it('keeps the selected plan fixed after its download session starts', async () => {
    const ui = renderScreen();
    await rtl.waitFor(() =>
      expect(ui.getByTestId('auto-setup-plan-balanced')).toBeTruthy(),
    );

    rtl.fireEvent.press(ui.getByTestId('auto-setup-download'));
    await rtl.waitFor(() =>
      expect(ui.getAllByText(/STARTING|0%/).length).toBeGreaterThan(0),
    );
    rtl.fireEvent.press(ui.getByTestId('auto-setup-plan-extreme'));

    expect(ui.getByText('Gemma 4 E4B')).toBeTruthy();
    expect(ui.queryByText('Qwen 3.5 9B')).toBeNull();
    ui.unmount();
  });

  it('ends a stalled catalog request at its deadline', async () => {
    const stalledCatalog: AutoSetupCatalogBoundaries = {
      ...catalogBoundaries,
      fetchTextFiles: () => new Promise(() => undefined),
    };
    const ui = rtl.render(
      React.createElement(AutoSetupScreen, {
        navigation,
        sessionFactory: () =>
          createAutoSetupSession({
            catalog: stalledCatalog,
            catalogDeadlineMs: 5,
          }),
      }),
    );

    expect(
      await ui.findByText('The model catalog did not respond in time.'),
    ).toBeTruthy();
    ui.unmount();
  });
});
