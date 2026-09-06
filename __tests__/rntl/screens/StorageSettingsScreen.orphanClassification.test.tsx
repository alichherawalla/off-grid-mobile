/**
 * StorageSettingsScreen — orphan classification: the FALSE-POSITIVE half.
 *
 * The sibling suite (StorageSettingsScreen.test.tsx) proves an untracked file IS listed and can be
 * deleted. This suite proves the other, more dangerous half: a file the registry still OWNS must
 * NEVER be offered for deletion. A mis-classification here deletes a model the user paid GBs of
 * download for, so the assertion is on the UI the user acts through — the orphan list and its
 * "Delete All Orphaned Files" affordance.
 *
 * Real composition: the REAL screen, the REAL modelLibrary registry (AsyncStorage), the REAL orphan
 * scan (getOrphanedTextFiles / getOrphanedImageDirs), over an in-memory filesystem seeded at the
 * device boundary via installNativeBoundary({ fs: true }). No Off Grid module is mocked; the only
 * fakes are outside our system (navigation, safe-area, icons, the native filesystem, AsyncStorage).
 */

import React from 'react';
import { installNativeBoundary, requireRTL } from '../../harness/nativeBoundary';

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
      goBack: jest.fn(),
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
const MODELS_DIR = `${DOCUMENT_DIR}/models`;
const IMAGE_MODELS_DIR = `${DOCUMENT_DIR}/image_models`;
const MODELS_STORAGE_KEY = '@local_llm/downloaded_models';
const IMAGE_MODELS_STORAGE_KEY = '@local_llm/downloaded_image_models';

describe('StorageSettingsScreen — orphan classification (real scan, real registry)', () => {
  let boundary: ReturnType<typeof installNativeBoundary>;
  let RTL: ReturnType<typeof requireRTL>;
  let Screen: React.FC;
  let AsyncStorage: any;
  let useAppStore: any;
  let useChatStore: any;
  let useDownloadStore: any;

  const settle = async () => {
    await RTL.act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });
  };

  const mountAndSettle = async () => {
    const rendered = RTL.render(<Screen />);
    await settle();
    return rendered;
  };

  const textModel = (over: Partial<any> = {}) => ({
    id: 'm1',
    name: 'Model 1',
    author: 'a',
    fileName: 'm1.gguf',
    filePath: `${MODELS_DIR}/m1.gguf`,
    fileSize: 1024,
    quantization: 'Q4_K_M',
    downloadedAt: '',
    engine: 'llama',
    ...over,
  });

  const imageModel = (over: Partial<any> = {}) => ({
    id: 'i1',
    name: 'Img Model',
    description: '',
    modelPath: `${IMAGE_MODELS_DIR}/i1`,
    downloadedAt: '',
    size: 1024,
    style: '',
    backend: 'mnn',
    ...over,
  });

  /** Persist a library projection the way the app does: through the registry's storage key. */
  const seedRegistry = async (models: any[] = [], images: any[] = []) => {
    await AsyncStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models));
    await AsyncStorage.setItem(IMAGE_MODELS_STORAGE_KEY, JSON.stringify(images));
  };

  beforeEach(async () => {
    boundary = installNativeBoundary({ fs: true });

    RTL = requireRTL();
    const asyncStorageModule = require('@react-native-async-storage/async-storage');
    AsyncStorage = asyncStorageModule.default ?? asyncStorageModule;
    await AsyncStorage.multiRemove([MODELS_STORAGE_KEY, IMAGE_MODELS_STORAGE_KEY]);
    Screen = require('../../../src/screens/StorageSettingsScreen').StorageSettingsScreen;
    useAppStore = require('../../../src/stores').useAppStore;
    useChatStore = require('../../../src/stores').useChatStore;
    useDownloadStore = require('../../../src/stores/downloadStore').useDownloadStore;

    useAppStore.setState({ downloadedModels: [], downloadedImageModels: [] });
    useChatStore.setState({ conversations: [] });
    useDownloadStore.setState({ downloads: {} });
  });

  it('does not offer a file tracked as a model filePath for deletion', async () => {
    boundary.fs!.seedFile(`${MODELS_DIR}/m1.gguf`, 4 * 1024 * 1024);
    await seedRegistry([textModel()]);

    const { getByText, queryByText } = await mountAndSettle();

    expect(getByText('No orphaned files found')).toBeTruthy();
    expect(queryByText('Delete All Orphaned Files')).toBeNull();
  });

  it('does not offer a projector tracked as mmProjPath for deletion', async () => {
    boundary.fs!.seedFile(`${MODELS_DIR}/m1.gguf`, 4 * 1024 * 1024);
    boundary.fs!.seedFile(`${MODELS_DIR}/mmproj.gguf`, 512 * 1024);
    await seedRegistry([
      textModel({ mmProjPath: `${MODELS_DIR}/mmproj.gguf` }),
    ]);

    const { getByText, queryByText } = await mountAndSettle();

    expect(queryByText('mmproj.gguf')).toBeNull();
    expect(getByText('No orphaned files found')).toBeTruthy();
  });

  it('lists only the untracked file when tracked and untracked files sit side by side', async () => {
    boundary.fs!.seedFile(`${MODELS_DIR}/m1.gguf`, 4 * 1024 * 1024);
    boundary.fs!.seedFile(`${MODELS_DIR}/mmproj.gguf`, 512 * 1024);
    boundary.fs!.seedFile(`${MODELS_DIR}/leftover.gguf`, 2 * 1024 * 1024);
    await seedRegistry([
      textModel({ mmProjPath: `${MODELS_DIR}/mmproj.gguf` }),
    ]);

    const { getByText, queryByText } = await mountAndSettle();

    expect(getByText('leftover.gguf')).toBeTruthy();
    expect(queryByText('m1.gguf')).toBeNull();
    expect(queryByText('mmproj.gguf')).toBeNull();
  });

  it('does not offer an image-model directory whose tracked path is nested inside it', async () => {
    // Core ML models are tracked at a path BELOW the directory the scan reads, e.g.
    // image_models/i1/coreml/unet. The directory i1 is still owned and must not be flagged.
    boundary.fs!.seedFile(`${IMAGE_MODELS_DIR}/i1/coreml/unet.mlmodelc`, 1024 * 1024);
    await seedRegistry([], [
      imageModel({ modelPath: `${IMAGE_MODELS_DIR}/i1/coreml`, backend: 'coreml' }),
    ]);

    const { getByText, queryByText } = await mountAndSettle();

    expect(queryByText('i1')).toBeNull();
    expect(getByText('No orphaned files found')).toBeTruthy();
  });

  it('lists an untracked image-model directory alongside a tracked one', async () => {
    boundary.fs!.seedFile(`${IMAGE_MODELS_DIR}/i1/model.mnn`, 1024 * 1024);
    boundary.fs!.seedFile(`${IMAGE_MODELS_DIR}/abandoned/model.mnn`, 3 * 1024 * 1024);
    await seedRegistry([], [imageModel()]);

    const { getByText, queryByText } = await mountAndSettle();

    expect(getByText('abandoned')).toBeTruthy();
    expect(queryByText('i1')).toBeNull();
  });
});
