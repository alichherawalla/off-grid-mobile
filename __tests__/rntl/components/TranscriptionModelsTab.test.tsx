/**
 * TranscriptionModelsTab tests
 *
 * MIGRATION IN PROGRESS. The listing/presence cluster below runs the REAL
 * composition: the real tab, the real ModelCard, the real models facade and the
 * real transcriptionModelApplication over an in-memory filesystem installed at
 * the device boundary. Presence is arrived at the way the device produces it —
 * model files on disk + refreshTranscriptionModels() — and the active model is
 * chosen through the real selectTranscriptionModel() intent. Assertions read
 * only the UI the user sees.
 *
 * Every spec reaches state through the real model application. Native model
 * files, downloads, and Whisper remain controlled at the device boundary.
 */
import React from 'react';
import {
  installNativeBoundary,
  requireRTL,
} from '../../harness/nativeBoundary';
import { createWhisperPublicDownloadRequest } from '@offgrid/application';
import { WHISPER_MODELS } from '@offgrid/models';
import type { PersistedModelDownload } from '@offgrid/models';

// Card testIDs follow the tab's render order: English models first, then multilingual.
const ENGLISH_IDS = WHISPER_MODELS.filter(m => m.lang === 'en').map(m => m.id);
const MULTI_IDS = WHISPER_MODELS.filter(m => m.lang === 'multi').map(m => m.id);
const ORDER = [...ENGLISH_IDS, ...MULTI_IDS];
const cardFor = (id: string) => `transcription-model-card-${ORDER.indexOf(id)}`;
const tinyCard = cardFor('tiny.en');
const baseCard = cardFor('base.en');
const mediumCard = cardFor('medium.en');
const multilingualMediumCard = cardFor('medium');
const smallCard = cardFor('small');
const largeCard = cardFor('large-v3');

// Fakes OUTSIDE our system only: navigation, safe-area-context, vector-icons.
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
  }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: jest.fn(),
  useIsFocused: () => true,
}));

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

import { useFocusEffect } from '@react-navigation/native';

const boundary = installNativeBoundary({
  fs: true,
  download: true,
  whisper: true,
});
const RTL = requireRTL();
const { render, fireEvent, act } = RTL;
const {
  TranscriptionModelsTab,
} = require('../../../src/screens/ModelsScreen/TranscriptionModelsTab');
const {
  refreshTranscriptionModels,
  selectTranscriptionModel,
} = require('../../../src/services/transcriptionModelApplication');
const { startMobileApplicationFixture } =
  require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
const { seedMobileDownloadJournal } =
  require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
let applicationFixture:
  | Awaited<ReturnType<typeof startMobileApplicationFixture>>
  | undefined;

const DOCS = boundary.fs!.DocumentDirectoryPath;
const queuedLargeDownload: PersistedModelDownload = {
  manifest: {
    id: 'whisper-large-v3/ggml-large-v3.bin',
    modelId: 'large-v3',
    kind: 'transcription',
    revision: 'main',
    artifacts: [
      {
        id: 'primary',
        name: 'ggml-large-v3.bin',
        role: 'primary',
        required: true,
        localName: 'ggml-large-v3.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin',
        sizeBytes: 1550 * 1024 * 1024,
      },
    ],
  },
  phase: 'queued',
  artifacts: [
    {
      artifactId: 'primary',
      phase: 'queued',
      bytesDownloaded: 0,
      totalBytes: 1550 * 1024 * 1024,
    },
  ],
  createdAt: 1,
  updatedAt: 1,
  attempt: 1,
};
const failedMediumDownload: PersistedModelDownload = {
  manifest: {
    id: 'whisper-medium/ggml-medium.bin',
    modelId: 'medium',
    kind: 'transcription',
    revision: 'main',
    artifacts: [
      {
        id: 'primary',
        name: 'ggml-medium.bin',
        role: 'primary',
        required: true,
        localName: 'ggml-medium.bin',
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
        sizeBytes: 1550 * 1024 * 1024,
      },
    ],
  },
  phase: 'failed',
  artifacts: [
    {
      artifactId: 'primary',
      phase: 'failed',
      bytesDownloaded: 620 * 1024 * 1024,
      totalBytes: 1550 * 1024 * 1024,
      error: 'The native transfer failed.',
    },
  ],
  createdAt: 5,
  updatedAt: 5,
  attempt: 1,
};
const activeDownloads: PersistedModelDownload[] = [
  'saturation-a',
  'saturation-b',
  'saturation-c',
].map((modelId, index) => {
  const fileName = `ggml-${modelId}.bin`;
  const transferId = `native-whisper-${modelId}`;
  boundary.download!.seedActive({
    downloadId: transferId,
    modelId,
    fileName,
    modelType: 'stt',
    status: 'running',
    bytesDownloaded: 1,
    totalBytes: 100,
  });
  return {
    manifest: {
      id: `whisper-${modelId}/${fileName}`,
      modelId,
      kind: 'transcription',
      revision: 'main',
      artifacts: [
        {
          id: 'primary',
          name: fileName,
          role: 'primary',
          required: true,
          localName: fileName,
          url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${fileName}`,
          sizeBytes: 100,
        },
      ],
    },
    phase: 'downloading',
    artifacts: [
      {
        artifactId: 'primary',
        phase: 'downloading',
        transferId,
        bytesDownloaded: 1,
        totalBytes: 100,
      },
    ],
    createdAt: index + 1,
    updatedAt: index + 1,
    attempt: 1,
  };
});
/** Put a model on disk the way a finished download does, then reconcile from disk. */
const installOnDisk = async (...ids: string[]) => {
  for (const id of ids) {
    boundary.fs!.seedFile(
      `${DOCS}/whisper-models/ggml-${id}.bin`,
      75 * 1024 * 1024,
    );
  }
  await act(async () => {
    await refreshTranscriptionModels();
  });
};

describe('TranscriptionModelsTab — listing & presence (real composition)', () => {
  beforeAll(async () => {
    await seedMobileDownloadJournal([
      ...activeDownloads,
      queuedLargeDownload,
      failedMediumDownload,
    ]);
    applicationFixture = await startMobileApplicationFixture();
  });

  it('renders the built-in whisper catalogue and the on-device privacy banner', () => {
    const { getByTestId, getByText, getAllByText } = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    const nameOf = (id: string) => WHISPER_MODELS.find(m => m.id === id)!.name;
    expect(getByTestId(tinyCard)).toBeTruthy();
    expect(getByTestId(smallCard)).toBeTruthy();
    expect(getAllByText(nameOf('tiny.en')).length).toBeGreaterThan(0);
    expect(getAllByText(nameOf('small')).length).toBeGreaterThan(0);
    expect(getByText(/audio is never sent anywhere/)).toBeTruthy();
  });

  it('offers a download for a model that is not on disk', () => {
    const { getByTestId, queryByTestId } = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    // Nothing on disk → the download affordance is offered, and there is no
    // "use this model" / "delete this model" affordance to speak of.
    expect(getByTestId(`${tinyCard}-download`)).toBeTruthy();
    expect(queryByTestId(`${tinyCard}-select`)).toBeNull();
    expect(queryByTestId(`${tinyCard}-delete`)).toBeNull();
  });

  it('shows a queued transcription download as queued with zero downloaded bytes', async () => {
    const view = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    expect(view.getByText('Queued')).toBeTruthy();
    expect(view.getByText(/0 B \/ 1\.5 GB/)).toBeTruthy();
    expect(view.queryByTestId(`${largeCard}-download`)).toBeNull();

    await act(async () => {
      await applicationFixture!.application.models.control({
        type: 'cancel-download',
        modelId: queuedLargeDownload.manifest.id,
      });
      await applicationFixture!.application.models.control({
        type: 'clear-download',
        modelId: queuedLargeDownload.manifest.id,
      });
      for (const download of activeDownloads) {
        await applicationFixture!.application.models.control({
          type: 'cancel-download',
          modelId: download.manifest.id,
        });
        await applicationFixture!.application.models.control({
          type: 'clear-download',
          modelId: download.manifest.id,
        });
      }
    });
  });

  it('downloads a not-present model when its card is tapped', async () => {
    boundary.download!.module.startDownload.mockClear();
    const tiny = WHISPER_MODELS.find(model => model.id === 'tiny.en')!;
    const request = createWhisperPublicDownloadRequest(tiny);
    const selectedBefore =
      applicationFixture!.application.models.snapshot().active.transcription
        ?.model?.id;
    const view = render(<TranscriptionModelsTab />);

    fireEvent.press(view.getByTestId(tinyCard));

    await RTL.waitFor(() => {
      expect(boundary.download!.module.startDownload).toHaveBeenCalledWith(
        expect.objectContaining({
          fileName: `0-${request.fileName}`,
          modelId: 'model-download:stt:stt:tiny.en:artifact:0',
          totalBytes: request.totalBytes,
          url: request.url,
        }),
      );
      expect(view.queryByTestId(`${tinyCard}-download`)).toBeNull();
    });
    expect(
      applicationFixture!.application.models.snapshot().active.transcription
        ?.model?.id,
    ).toBe(selectedBefore);
    const published = applicationFixture!.application.models
      .snapshot()
      .control.downloads.find(row => row.modelId === 'tiny.en');
    expect(published).toBeDefined();

    await act(async () => {
      await applicationFixture!.application.models.cancelDownload({
        downloadId: published!.downloadId,
      });
      await applicationFixture!.application.models.removeDownload({
        downloadId: published!.downloadId,
      });
    });
  });

  it('returns a failed transcription download to the downloadable state', () => {
    const view = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );

    expect(view.getByTestId(`${multilingualMediumCard}-download`)).toBeTruthy();
    expect(view.queryByText('40%')).toBeNull();
  });

  it('shows every on-disk model as downloaded, with the selected one active', async () => {
    await installOnDisk('tiny.en', 'small');
    await act(async () => {
      await selectTranscriptionModel('small');
    });

    const view = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    await act(async () => {});

    // Both are downloaded: neither offers a download, and both can be deleted.
    expect(view.queryByTestId(`${tinyCard}-download`)).toBeNull();
    expect(view.queryByTestId(`${smallCard}-download`)).toBeNull();
    expect(view.getByTestId(`${tinyCard}-delete`)).toBeTruthy();
    expect(view.getByTestId(`${smallCard}-delete`)).toBeTruthy();

    // The inactive card is selectable; the active card is not. Selecting the
    // inactive card moves that state through the real application facade.
    expect(view.getByTestId(tinyCard).props.accessibilityState.disabled).toBe(
      false,
    );
    expect(view.getByTestId(smallCard).props.accessibilityState.disabled).toBe(
      true,
    );
    fireEvent.press(view.getByTestId(tinyCard));
    await RTL.waitFor(() => {
      expect(view.getByTestId(tinyCard).props.accessibilityState.disabled).toBe(
        true,
      );
      expect(
        view.getByTestId(smallCard).props.accessibilityState.disabled,
      ).toBe(false);
    });

    // A screen reader can address both per-model delete actions.
    expect(view.getAllByLabelText('Delete this model').length).toBe(2);
  });

  it('reconciles a model added on disk when the screen regains focus', async () => {
    let focusCallback: (() => void) | undefined;
    (useFocusEffect as jest.Mock).mockImplementation((callback: () => void) => {
      focusCallback = callback;
    });

    const view = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    expect(view.getByTestId(`${baseCard}-download`)).toBeTruthy();

    boundary.fs!.seedFile(
      `${DOCS}/whisper-models/ggml-base.en.bin`,
      142 * 1024 * 1024,
    );
    await act(async () => {
      focusCallback?.();
    });

    await RTL.waitFor(() => {
      expect(view.queryByTestId(`${baseCard}-download`)).toBeNull();
      expect(view.getByTestId(`${baseCard}-delete`)).toBeTruthy();
    });
  });

  it('removes one downloaded model after the user confirms', async () => {
    await installOnDisk('medium.en');
    const view = render(
      <TranscriptionModelsTab
        showLanguageSelector={false}
        showRemoteModels={false}
      />,
    );
    expect(view.getByTestId(`${mediumCard}-delete`)).toBeTruthy();

    fireEvent.press(view.getByTestId(`${mediumCard}-delete`));
    expect(view.getByText('Remove Transcription Model')).toBeTruthy();
    expect(
      view.getByText('This deletes the model files for this language/size.'),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('Remove'));
    });

    await RTL.waitFor(() => {
      expect(view.queryByTestId(`${mediumCard}-delete`)).toBeNull();
      expect(view.getByTestId(`${mediumCard}-download`)).toBeTruthy();
    });
  });
});

describe('TranscriptionModelsTab — model intents (real composition)', () => {
  it('does nothing when the already-active model card is tapped', async () => {
    await installOnDisk('small');
    await act(async () => {
      await selectTranscriptionModel('small');
    });
    boundary.download!.module.startDownload.mockClear();
    const view = render(<TranscriptionModelsTab />);

    expect(view.getByTestId(smallCard).props.accessibilityState.disabled).toBe(
      true,
    );
    fireEvent.press(view.getByTestId(smallCard));

    expect(
      applicationFixture!.application.models.snapshot().active.transcription
        ?.model?.id,
    ).toBe('small');
    expect(boundary.download!.module.startDownload).not.toHaveBeenCalled();
  });

  it('shows a native STT transfer as downloading without a second download action', async () => {
    boundary.download!.module.startDownload.mockClear();
    const view = render(<TranscriptionModelsTab />);
    fireEvent.press(view.getByTestId(largeCard));

    await RTL.waitFor(() => {
      expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(1);
    });
    await RTL.waitFor(() => {
      expect(view.queryByTestId(`${largeCard}-download`)).toBeNull();
    });

    const published = applicationFixture!.application.models
      .snapshot()
      .control.downloads.find(row => row.modelId === 'large-v3');
    expect(published).toBeDefined();
    fireEvent.press(view.getByTestId(largeCard));
    expect(boundary.download!.module.startDownload).toHaveBeenCalledTimes(1);

    await act(async () => {
      await applicationFixture!.application.models.cancelDownload({
        downloadId: published!.downloadId,
      });
      await applicationFixture!.application.models.removeDownload({
        downloadId: published!.downloadId,
      });
    });
  });
});

afterAll(async () => {
  RTL.cleanup();
  await applicationFixture?.dispose();
});
