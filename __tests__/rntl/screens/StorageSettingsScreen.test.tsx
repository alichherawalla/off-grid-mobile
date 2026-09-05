/**
 * StorageSettingsScreen — real composition.
 *
 * Mounts the REAL screen over the REAL app/chat/download stores, the REAL
 * components (Card, CustomAlert), the REAL hardwareService/modelLibrary and the
 * REAL orphan scan running against an in-memory filesystem seeded at the device
 * boundary (installNativeBoundary({ fs: true })).
 *
 * No Off Grid module is mocked. The only fakes are outside our system:
 * navigation, safe-area-context, vector-icons and the native filesystem.
 * Every assertion reads the UI the user sees.
 */

import React from 'react';
import { TouchableOpacity } from 'react-native';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: mockGoBack,
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name }: any) => <Text>{name}</Text>;
});

const DOCUMENT_DIR = '/docs';

type Rendered = ReturnType<ReturnType<typeof requireRTL>['render']>;

describe('StorageSettingsScreen (real composition)', () => {
  let boundary: ReturnType<typeof installNativeBoundary>;
  let RTL: ReturnType<typeof requireRTL>;
  let Screen: React.FC;
  let useAppStore: any;
  let useChatStore: any;
  let useDownloadStore: any;

  const mount = (): Rendered => RTL.render(<Screen />);

  const settle = async () => {
    await RTL.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  };

  const mountAndSettle = async (): Promise<Rendered> => {
    const r = mount();
    await settle();
    return r;
  };

  beforeEach(() => {
    mockGoBack.mockClear();
    boundary = installNativeBoundary({ fs: true });

    RTL = requireRTL();
    Screen = require('../../../src/screens/StorageSettingsScreen')
      .StorageSettingsScreen;
    useAppStore = require('../../../src/stores').useAppStore;
    useChatStore = require('../../../src/stores').useChatStore;
    useDownloadStore =
      require('../../../src/stores/downloadStore').useDownloadStore;

    useAppStore.setState({ downloadedModels: [], downloadedImageModels: [] });
    useChatStore.setState({ conversations: [] });
    useDownloadStore.setState({ downloads: {} });
  });

  const textModel = (over: Partial<any> = {}) => ({
    id: 'm1',
    name: 'Model 1',
    author: 'a',
    fileName: 'm1.gguf',
    filePath: `${DOCUMENT_DIR}/models/m1.gguf`,
    fileSize: 1024,
    quantization: 'Q4_K_M',
    downloadedAt: '',
    ...over,
  });

  const imageModel = (over: Partial<any> = {}) => ({
    id: 'i1',
    name: 'Img Model',
    description: '',
    modelPath: `${DOCUMENT_DIR}/image_models/i1`,
    downloadedAt: '',
    size: 1024,
    style: '',
    backend: 'mnn',
    ...over,
  });

  const staleEntry = (over: Partial<any> = {}) => ({
    modelKey: 'stale-key-1',
    downloadId: 'dl-123',
    modelId: '',
    fileName: '',
    combinedTotalBytes: 0,
    status: 'failed',
    ...over,
  });

  // ---- Chrome ----

  it('renders "Storage" title', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText('Storage')).toBeTruthy();
  });

  it('back button calls goBack', async () => {
    const { UNSAFE_getAllByType } = await mountAndSettle();
    RTL.fireEvent.press(UNSAFE_getAllByType(TouchableOpacity)[0]);
    expect(mockGoBack).toHaveBeenCalled();
  });

  it('shows storage info sections', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText('Storage Usage')).toBeTruthy();
    expect(getByText('Breakdown')).toBeTruthy();
  });

  it('shows hint text at the bottom', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText(/To free up space/)).toBeTruthy();
  });

  it('shows Used and Free labels in storage legend', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText(/Used:/)).toBeTruthy();
    expect(getByText(/Free:/)).toBeTruthy();
  });

  // ---- Breakdown ----

  it('shows LLM Models count in breakdown', async () => {
    useAppStore.setState({
      downloadedModels: [textModel({ id: 'm1' }), textModel({ id: 'm2', name: 'Model 2' })],
    });
    const { getAllByText } = await mountAndSettle();
    expect(getAllByText('LLM Models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('2').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Image Models count in breakdown', async () => {
    useAppStore.setState({ downloadedImageModels: [imageModel()] });
    const { getAllByText } = await mountAndSettle();
    expect(getAllByText('Image Models').length).toBeGreaterThanOrEqual(1);
    expect(getAllByText('1').length).toBeGreaterThanOrEqual(1);
  });

  it('shows Conversations count from the real chat store', async () => {
    useChatStore.setState({
      conversations: [
        { id: 'c1', title: 'Conv 1', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
        { id: 'c2', title: 'Conv 2', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
        { id: 'c3', title: 'Conv 3', messages: [], modelId: 'm1', createdAt: '', updatedAt: '' },
      ],
    });
    const { getByText } = await mountAndSettle();
    expect(getByText('Conversations')).toBeTruthy();
    expect(getByText('3')).toBeTruthy();
  });

  it('shows Model Storage label in breakdown', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText('Model Storage')).toBeTruthy();
  });

  it('folds image-model bytes into the reported Used total', async () => {
    const withoutImages = await mountAndSettle();
    const baseline = withoutImages.getAllByText(/^Used: /)[0].props.children.join('');
    withoutImages.unmount();

    useAppStore.setState({ downloadedImageModels: [imageModel({ size: 2 * 1024 * 1024 * 1024 })] });
    const withImages = await mountAndSettle();
    const withImagesText = withImages.getAllByText(/^Used: /)[0].props.children.join('');

    expect(withImagesText).not.toBe(baseline);
    expect(withImagesText).toMatch(/2\.0+ GB/);
  });

  // ---- LLM model listing ----

  it('shows LLM Models section when models exist', async () => {
    useAppStore.setState({ downloadedModels: [textModel({ name: 'Llama 3' })] });
    const { getAllByText } = await mountAndSettle();
    expect(getAllByText('LLM Models').length).toBeGreaterThanOrEqual(2);
  });

  it('renders model name and quantization', async () => {
    useAppStore.setState({
      downloadedModels: [textModel({ name: 'Phi-3 Mini', quantization: 'Q5_K_M' })],
    });
    const { getByText } = await mountAndSettle();
    expect(getByText('Phi-3 Mini')).toBeTruthy();
    expect(getByText('Q5_K_M')).toBeTruthy();
  });

  it('does not show LLM Models section when no models', async () => {
    const { queryAllByText } = await mountAndSettle();
    expect(queryAllByText('LLM Models').length).toBe(1);
  });

  it('renders multiple LLM models', async () => {
    useAppStore.setState({
      downloadedModels: [
        textModel({ id: 'm1', name: 'Model A', quantization: 'Q4_K_M' }),
        textModel({ id: 'm2', name: 'Model B', quantization: 'Q8_0' }),
      ],
    });
    const { getByText } = await mountAndSettle();
    expect(getByText('Model A')).toBeTruthy();
    expect(getByText('Model B')).toBeTruthy();
    expect(getByText('Q4_K_M')).toBeTruthy();
    expect(getByText('Q8_0')).toBeTruthy();
  });

  // ---- Image model listing ----

  it('shows Image Models section when image models exist', async () => {
    useAppStore.setState({ downloadedImageModels: [imageModel({ name: 'SD Turbo' })] });
    const { getAllByText } = await mountAndSettle();
    expect(getAllByText('Image Models').length).toBeGreaterThanOrEqual(2);
  });

  it('renders image model with Core ML backend', async () => {
    useAppStore.setState({
      downloadedImageModels: [imageModel({ name: 'CoreML SD', backend: 'coreml', style: 'realistic' })],
    });
    const { getByText } = await mountAndSettle();
    expect(getByText('CoreML SD')).toBeTruthy();
    expect(getByText(/Core ML/)).toBeTruthy();
  });

  it('renders image model with MNN backend as GPU', async () => {
    useAppStore.setState({ downloadedImageModels: [imageModel({ name: 'MNN Model' })] });
    const { getByText } = await mountAndSettle();
    expect(getByText('MNN Model')).toBeTruthy();
    expect(getByText('GPU')).toBeTruthy();
  });

  it('renders image model with QNN backend as NPU (no "Qualcomm NPU" drift)', async () => {
    useAppStore.setState({
      downloadedImageModels: [imageModel({ name: 'QNN Model', backend: 'qnn', style: 'artistic' })],
    });
    const { getByText, queryByText } = await mountAndSettle();
    expect(getByText('QNN Model')).toBeTruthy();
    expect(getByText(/NPU/)).toBeTruthy();
    expect(queryByText(/Qualcomm NPU/)).toBeNull();
  });

  it('renders image model with style info', async () => {
    useAppStore.setState({ downloadedImageModels: [imageModel({ style: 'anime' })] });
    const { getByText } = await mountAndSettle();
    expect(getByText(/anime/)).toBeTruthy();
  });

  it('renders image model without style', async () => {
    useAppStore.setState({ downloadedImageModels: [imageModel({ name: 'No Style' })] });
    const { getByText } = await mountAndSettle();
    expect(getByText('No Style')).toBeTruthy();
    expect(getByText('GPU')).toBeTruthy();
  });

  // ---- Stale downloads (real download store) ----

  it('shows stale downloads when the real store holds an incomplete entry', async () => {
    useDownloadStore.setState({ downloads: { 'stale-key-1': staleEntry() } });
    const { getByText } = await mountAndSettle();
    expect(getByText('Stale Downloads')).toBeTruthy();
    expect(getByText('Clear All')).toBeTruthy();
  });

  it('shows a stale download with a missing modelId', async () => {
    useDownloadStore.setState({
      downloads: {
        'stale-key-456': staleEntry({
          modelKey: 'stale-key-456',
          downloadId: 'dl-456',
          fileName: 'partial.gguf',
        }),
      },
    });
    const { getByText } = await mountAndSettle();
    expect(getByText('Stale Downloads')).toBeTruthy();
    expect(getByText(/Download #dl-456/)).toBeTruthy();
  });

  it('does not show the stale downloads section when none exist', async () => {
    const { queryByText } = await mountAndSettle();
    expect(queryByText('Stale Downloads')).toBeNull();
  });

  it('clearing a stale download removes it from the real store and from the UI', async () => {
    useDownloadStore.setState({
      downloads: { 'stale-key-789': staleEntry({ modelKey: 'stale-key-789', downloadId: 'dl-789' }) },
    });
    const { getByText, queryByText } = await mountAndSettle();
    expect(getByText(/Download #dl-789/)).toBeTruthy();

    // The row's dismiss control renders the Feather "x" icon.
    RTL.fireEvent.press(getByText('x'));

    expect(useDownloadStore.getState().downloads['stale-key-789']).toBeUndefined();
    expect(queryByText(/Download #dl-789/)).toBeNull();
  });

  it('clear all stale downloads confirms, then empties the real store', async () => {
    useDownloadStore.setState({
      downloads: {
        'stale-1': staleEntry({ modelKey: 'stale-1', downloadId: 'dl-100' }),
        'stale-2': staleEntry({ modelKey: 'stale-2', downloadId: 'dl-200' }),
      },
    });
    const { getByText, getAllByText, queryByText } = await mountAndSettle();

    RTL.fireEvent.press(getByText('Clear All'));

    // Real CustomAlert, real copy.
    expect(getByText('Clear Stale Downloads')).toBeTruthy();
    expect(getByText(/2 stale download entry/)).toBeTruthy();

    const confirmButtons = getAllByText('Clear All');
    await RTL.act(async () => {
      RTL.fireEvent.press(confirmButtons[confirmButtons.length - 1]);
    });

    expect(Object.keys(useDownloadStore.getState().downloads)).toHaveLength(0);
    expect(queryByText('Stale Downloads')).toBeNull();
  });

  // ---- Orphaned files (real scan over the seeded in-memory disk) ----

  it('shows "No orphaned files found" when the disk is clean', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText('No orphaned files found')).toBeTruthy();
  });

  it('lists an untracked file on disk as orphaned', async () => {
    boundary.fs!.seedFile(`${DOCUMENT_DIR}/models/stale-model.gguf`, 1024 * 1024);
    const { getByText } = await mountAndSettle();
    expect(getByText('stale-model.gguf')).toBeTruthy();
    expect(getByText('Delete All Orphaned Files')).toBeTruthy();
  });

  it('shows the warning copy when orphaned files exist', async () => {
    boundary.fs!.seedFile(`${DOCUMENT_DIR}/models/orphan.gguf`, 512);
    const { getByText } = await mountAndSettle();
    expect(getByText(/files\/folders exist on disk but aren't tracked/)).toBeTruthy();
  });

  it('does not offer "Delete All Orphaned Files" when there are none', async () => {
    const { queryByText } = await mountAndSettle();
    expect(queryByText('Delete All Orphaned Files')).toBeNull();
  });

  it('Orphaned Files section is present', async () => {
    const { getByText } = await mountAndSettle();
    expect(getByText('Orphaned Files')).toBeTruthy();
  });

  it('confirming a single orphaned-file delete removes the file from disk and from the list', async () => {
    const path = `${DOCUMENT_DIR}/models/orphan.gguf`;
    boundary.fs!.seedFile(path, 1024 * 1024);
    const { getByText, getAllByText, queryByText, UNSAFE_getAllByType } = await mountAndSettle();
    expect(getByText('orphan.gguf')).toBeTruthy();

    // The per-file trash button sits in the orphaned row, before "Delete All".
    const touchables = UNSAFE_getAllByType(TouchableOpacity);
    for (const btn of touchables) {
      RTL.fireEvent.press(btn);
      if (queryByText('Delete Orphaned File')) break;
    }

    expect(getByText('Delete Orphaned File')).toBeTruthy();
    expect(getAllByText(/orphan\.gguf/).length).toBeGreaterThan(1);

    await RTL.act(async () => {
      RTL.fireEvent.press(getByText('Delete'));
    });
    await settle();

    expect(queryByText('orphan.gguf')).toBeNull();
    expect(getByText('No orphaned files found')).toBeTruthy();
  });

  it('deletes every orphaned file when "Delete All" is confirmed', async () => {
    boundary.fs!.seedFile(`${DOCUMENT_DIR}/models/orphan1.gguf`, 1024);
    boundary.fs!.seedFile(`${DOCUMENT_DIR}/models/orphan2.gguf`, 2048);
    const { getByText, queryByText } = await mountAndSettle();

    RTL.fireEvent.press(getByText('Delete All Orphaned Files'));
    await RTL.act(async () => {
      RTL.fireEvent.press(getByText('Delete All'));
    });
    await settle();

    expect(queryByText('orphan1.gguf')).toBeNull();
    expect(queryByText('orphan2.gguf')).toBeNull();
    expect(getByText('No orphaned files found')).toBeTruthy();
  });
});
