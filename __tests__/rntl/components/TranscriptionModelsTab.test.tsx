/**
 * TranscriptionModelsTab tests
 *
 * The Models > Transcription Models tab (speech-to-text / Whisper). Now supports
 * MULTIPLE downloaded models (presentModelIds) with one active (downloadedModelId).
 * Verifies:
 *  - the built-in ggml catalogue renders as ModelCards + the privacy banner
 *  - tapping a not-present model downloads it via the whisper store
 *  - every on-disk (present) model shows as downloaded, not just the active one
 *  - tapping a present-but-inactive model SELECTS it (selectModel), no re-download
 *  - per-model delete calls deleteModelById
 */
import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';
import { WHISPER_MODELS } from '@offgrid/models';

const tinyCard = `transcription-model-card-${WHISPER_MODELS.findIndex(model => model.id === 'tiny.en')}`;
const smallCard = `transcription-model-card-${WHISPER_MODELS.findIndex(model => model.id === 'small')}`;

const mockWhisperActions = {
  downloadModel: jest.fn(async (_modelId?: string) => {}),
  selectModel: jest.fn(async (_modelId?: string) => {}),
  deleteModel: jest.fn(),
  deleteModelById: jest.fn(async (_modelId?: string) => {}),
  refreshPresentModels: jest.fn(async () => {}),
  clearError: jest.fn(),
};
jest.mock('../../../src/services/modelServices/transcriptionRuntimePort', () => ({
  registerTranscriptionModelProjection: jest.fn(),
  transcriptionModelIntents: {
    downloadModel: (modelId: string) => mockWhisperActions.downloadModel(modelId),
    selectModel: (modelId: string) => mockWhisperActions.selectModel(modelId),
    deleteModel: (modelId: string) => mockWhisperActions.deleteModelById(modelId),
    reconcileDisk: () => mockWhisperActions.refreshPresentModels(),
  },
}));
let mockWhisperState: any;
jest.mock('../../../src/stores', () => ({
  useWhisperStore: () => mockWhisperState,
}));

jest.mock('../../../src/hooks/useActiveMobileModel', () => ({
  useActiveMobileModel: (modality: string) => ({
    modality,
    routeId: mockWhisperState?.downloadedModelId ?? null,
    model: mockWhisperState?.downloadedModelId
      ? { id: mockWhisperState.downloadedModelId, source: 'local' }
      : null,
  }),
}));

jest.mock('../../../src/components', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    ModelCard: ({ model, isDownloaded, isActive, isDownloading, isQueued, downloadBytes, onPress, onDownload, onDelete, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={!onPress}>
        <Text testID={`${testID}-name`}>{model.name}</Text>
        {isDownloaded && <Text testID={`${testID}-downloaded`}>downloaded</Text>}
        {isActive && <Text testID={`${testID}-active`}>active</Text>}
        {isDownloading && <Text testID={`${testID}-downloading`}>downloading</Text>}
        {isQueued && <Text testID={`${testID}-queued`}>queued</Text>}
        {downloadBytes && <Text testID={`${testID}-bytes`}>{`${downloadBytes.downloaded}/${downloadBytes.total}`}</Text>}
        {onDownload && <TouchableOpacity testID={`${testID}-download`} onPress={onDownload}><Text>Download</Text></TouchableOpacity>}
        {onDelete && <TouchableOpacity testID={`${testID}-delete`} onPress={onDelete}><Text>Delete</Text></TouchableOpacity>}
      </TouchableOpacity>
    ),
  };
});

const mockShowAlert = jest.fn((title: string, message: string, buttons: any[]) => ({
  visible: true, title, message, buttons,
}));
jest.mock('../../../src/components/CustomAlert', () => {
  const { View } = require('react-native');
  return {
    CustomAlert: () => <View testID="custom-alert" />,
    showAlert: (...a: any[]) => mockShowAlert(...(a as [string, string, any[]])),
    hideAlert: () => ({ visible: false }),
    initialAlertState: { visible: false },
  };
});

import { useFocusEffect } from '@react-navigation/native';
import { TranscriptionModelsTab } from '../../../src/screens/ModelsScreen/TranscriptionModelsTab';
// Real download store (NOT mocked) — the tab derives in-flight STT state from it.
import { useDownloadStore } from '../../../src/stores/downloadStore';

const seedSttDownload = (modelId: string, status: string, progress = 0) => {
  useDownloadStore.setState({
    downloads: {
      [modelId]: {
        modelKey: modelId, downloadId: `dl-${modelId}`, modelId: `whisper-${modelId}`,
        fileName: `ggml-${modelId}.bin`, quantization: '', modelType: 'stt',
        status, bytesDownloaded: 0, totalBytes: 100, combinedTotalBytes: 100,
        progress, createdAt: 0,
      } as any,
    },
  });
};

describe('TranscriptionModelsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useDownloadStore.setState({ downloads: {} });
    mockWhisperState = {
      downloadedModelId: null,
      presentModelIds: [],
      downloadProgressById: {},
      error: null,
      ...mockWhisperActions,
    };
  });

  it('renders the built-in whisper catalogue and privacy banner', () => {
    const { getByTestId, getByText } = render(<TranscriptionModelsTab />);
    expect(getByTestId(`${tinyCard}-name`)).toHaveTextContent('Tiny');
    expect(getByTestId(`${smallCard}-name`)).toHaveTextContent('Small');
    expect(getByText(/audio is never sent anywhere/)).toBeTruthy();
  });

  it('downloads a not-present model when its card is tapped', () => {
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId(tinyCard));
    expect(mockWhisperActions.downloadModel).toHaveBeenCalledWith('tiny.en');
    expect(mockWhisperActions.selectModel).not.toHaveBeenCalled();
  });

  it('marks every on-disk model as downloaded, and the active one as active', () => {
    // Both models present on disk; only `small` is the active/selected one.
    mockWhisperState.presentModelIds = ['tiny.en', 'small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId, queryByTestId } = render(<TranscriptionModelsTab />);
    // Both show as downloaded...
    expect(getByTestId(`${tinyCard}-downloaded`)).toBeTruthy();
    expect(getByTestId(`${smallCard}-downloaded`)).toBeTruthy();
    // ...but only `small` is active.
    expect(queryByTestId(`${tinyCard}-active`)).toBeNull();
    expect(getByTestId(`${smallCard}-active`)).toBeTruthy();
  });

  it('selects a present-but-inactive model without re-downloading', () => {
    // `tiny.en` is on disk but `small` is the active one.
    mockWhisperState.presentModelIds = ['tiny.en', 'small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId(tinyCard));
    expect(mockWhisperActions.selectModel).toHaveBeenCalledWith('tiny.en');
    expect(mockWhisperActions.downloadModel).not.toHaveBeenCalled();
  });

  it('does nothing when the already-active model card is tapped', () => {
    mockWhisperState.presentModelIds = ['small'];
    mockWhisperState.downloadedModelId = 'small';
    const { getByTestId } = render(<TranscriptionModelsTab />);
    fireEvent.press(getByTestId(smallCard));
    expect(mockWhisperActions.selectModel).not.toHaveBeenCalled();
    expect(mockWhisperActions.downloadModel).not.toHaveBeenCalled();
  });

  it('deletes a specific present model via per-model delete', () => {
    mockWhisperState.presentModelIds = ['tiny.en'];
    const { getByTestId } = render(<TranscriptionModelsTab />);
    // Per-model delete is only offered for present models.
    fireEvent.press(getByTestId(`${tinyCard}-delete`));
    // Delete is confirmed via CustomAlert; press the destructive button.
    const remove = (mockShowAlert.mock.results.at(-1)?.value.buttons ?? []).find(
      (b: any) => b.style === 'destructive',
    );
    act(() => remove.onPress());
    expect(mockWhisperActions.deleteModelById).toHaveBeenCalledWith('tiny.en');
  });

  it('shows a model as downloadable (not stuck downloading) when its STT download FAILED in the download store', () => {
    // The bug: the Download Manager marked the STT download failed, but this tab kept
    // showing progress. Deriving from the canonical store, a failed entry is not active.
    seedSttDownload('tiny.en', 'failed', 0.4);
    const { getByTestId } = render(<TranscriptionModelsTab />);
    // Not stuck "downloading" → the download affordance is offered again.
    fireEvent.press(getByTestId(`${tinyCard}-download`));
    expect(mockWhisperActions.downloadModel).toHaveBeenCalledWith('tiny.en');
  });

  it('treats an active STT download-store entry as downloading (no re-download affordance)', () => {
    seedSttDownload('tiny.en', 'running', 0.6);
    const { queryByTestId } = render(<TranscriptionModelsTab />);
    // Downloading → no download button and the card is not tappable to re-download.
    expect(queryByTestId(`${tinyCard}-download`)).toBeNull();
  });

  it('shows a QUEUED (pending) STT download as Queued, not as a 0% download', () => {
    // The bug: a pending STT entry rendered "0%" instead of "Queued".
    seedSttDownload('tiny.en', 'pending', 0);
    const { getByTestId, queryByTestId } = render(<TranscriptionModelsTab />);
    expect(getByTestId(`${tinyCard}-queued`)).toBeTruthy();
    expect(queryByTestId(`${tinyCard}-downloading`)).toBeNull();
    // Bytes are still surfaced ("0 B / size") so it matches the Text/Image cards.
    expect(getByTestId(`${tinyCard}-bytes`)).toHaveTextContent(/^0\/\d+$/);
  });

  // NOTE: the whisper-store FALLBACK cases moved to a real rendered test
  // (__tests__/integration/models/whisperPickerCanonicalDownloadProgress.rendered.test.tsx). They
  // used to seed the MOCKED store (mockWhisperState.downloadProgressById) and assert, but the
  // derivation now lives in the useSttDownloadState owner which reads the REAL stores — a mock of
  // our own store proves nothing there, so they're deleted rather than repaired (test doctrine).

  it('re-derives present models from disk when the screen regains focus', () => {
    // Disk is the source of truth: returning from the Download Manager (where a
    // model may have been downloaded or deleted) must re-probe, not show stale state.
    let focusCb: (() => void) | undefined;
    (useFocusEffect as jest.Mock).mockImplementation((cb: () => void) => { focusCb = cb; });
    render(<TranscriptionModelsTab />);
    mockWhisperActions.refreshPresentModels.mockClear(); // drop the mount-effect call
    act(() => { focusCb?.(); });
    expect(mockWhisperActions.refreshPresentModels).toHaveBeenCalledTimes(1);
  });
});
