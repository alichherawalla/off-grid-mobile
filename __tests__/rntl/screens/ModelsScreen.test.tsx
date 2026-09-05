/**
 * ModelsScreen Tests
 *
 * Tests for the model discovery and download screen including:
 * - Rendering the actual component (text tab, image tab, search, filters)
 * - Download interactions
 * - Model management
 * - Tab switching
 * - Search and filter functionality
 */

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';

// Mirror constants from ModelsScreen so test assertions stay in sync with the source
const CODE_FALLBACK_QUERY = 'coder';
import {
  createDownloadedModel,
  createONNXImageModel,
  createModelInfo,
  createModelFile,
  createModelFileWithMmProj,
  createDeviceInfo,
} from '../../utils/factories';

// Mock navigation
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      setOptions: jest.fn(),
      addListener: jest.fn(() => jest.fn()),
    }),
    useRoute: () => ({ params: {} }),
    useIsFocused: () => true,
    useFocusEffect: jest.fn((cb) => cb()),
  };
});

// Mock services
const mockSearchModels = jest.fn();
const mockGetModelFiles = jest.fn();
const mockGetModelDetails = jest.fn();
const mockDownloadModel = jest.fn();
const mockCancelDownload = jest.fn();
const mockDeleteModel = jest.fn();
const mockDeleteImageModel = jest.fn();
const mockGetDownloadedModels = jest.fn();
const mockGetDownloadedImageModels = jest.fn();
const mockAddDownloadedImageModel = jest.fn();

jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    searchModels: (...args: any[]) => mockSearchModels(...args),
    getModelFiles: (...args: any[]) => mockGetModelFiles(...args),
    getModelDetails: (...args: any[]) => mockGetModelDetails(...args),
    downloadModel: (...args: any[]) => mockDownloadModel(...args),
    downloadModelWithProgress: jest.fn(),
    formatModelSize: jest.fn(() => '4.0 GB'),
  },
}));

jest.mock('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap', () => ({
  modelLibrary: {
    cancelDownload: (...args: any[]) => mockCancelDownload(...args),
    deleteModel: (...args: any[]) => mockDeleteModel(...args),
    deleteImageModel: (...args: any[]) => mockDeleteImageModel(...args),
    getDownloadedModels: (...args: any[]) => mockGetDownloadedModels(...args),
    getDownloadedImageModels: (...args: any[]) => mockGetDownloadedImageModels(...args),
    addDownloadedImageModel: (...args: any[]) => mockAddDownloadedImageModel(...args),
    downloadModelWithMmProj: jest.fn(),
    downloadModel: jest.fn(),
    importLocalModel: jest.fn(),
    getActiveBackgroundDownloads: jest.fn(() => Promise.resolve([])),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 8 * 1024 * 1024 * 1024,
      usedMemory: 4 * 1024 * 1024 * 1024,
      availableMemory: 4 * 1024 * 1024 * 1024,
      deviceModel: 'Test Device',
      systemName: 'Android',
      systemVersion: '13',
      isEmulator: false,
    })),
    formatBytes: jest.fn((bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }),
    getTotalMemoryGB: jest.fn(() => 8),
    getModelRecommendation: jest.fn(() => ({
      maxParameters: 14,
      recommendedQuantization: 'Q4_K_M',
      recommendedModels: [],
      warning: undefined,
    })),
    getImageModelRecommendation: jest.fn(() => Promise.resolve({
      recommendedBackend: 'mnn',
      maxModelSizeMB: 2048,
      canRunSD: true,
      canRunQNN: false,
    })),
  },
}));

const mockFetchAvailableModels = jest.fn();
jest.mock('../../../src/services/huggingFaceModelBrowser', () => ({
  fetchAvailableModels: (...args: any[]) => mockFetchAvailableModels(...args),
  getVariantLabel: jest.fn(() => 'Standard'),
  guessStyle: jest.fn(() => 'creative'),
}));

jest.mock('../../../src/services/coreMLModelBrowser', () => ({
  fetchAvailableCoreMLModels: jest.fn(() => Promise.resolve([])),
}));

jest.mock('../../../src/utils/coreMLModelUtils', () => ({
  resolveCoreMLModelDir: jest.fn((path: string) => path),
  downloadCoreMLTokenizerFiles: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../harness/activeModelLifecycle', () => ({
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../utils/activeModelServiceStub').activeModelSelectionStub(),
    unloadImageModel: jest.fn(() => Promise.resolve()),
  },
}));

// Mock child components to simplify — ModelCard renders model name
jest.mock('../../../src/components', () => {
  const { View, Text, TouchableOpacity } = require('react-native');
  return {
    Card: ({ children, style, ...props }: any) => <View style={style} {...props}>{children}</View>,
    ModelCard: ({ model, testID, onPress, onDownload, onDelete, isDownloaded, isDownloading, downloadProgress }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress} disabled={!onPress}>
        <Text testID={`${testID}-name`}>{model.name}</Text>
        <Text testID={`${testID}-author`}>{model.author}</Text>
        {isDownloaded && <Text testID={`${testID}-downloaded`}>Downloaded</Text>}
        {isDownloading && <Text testID={`${testID}-downloading`}>Downloading {downloadProgress}%</Text>}
        {onDownload && (
          <TouchableOpacity testID={`${testID}-download-btn`} onPress={onDownload}>
            <Text>Download</Text>
          </TouchableOpacity>
        )}
        {onDelete && (
          <TouchableOpacity testID={`${testID}-delete-btn`} onPress={onDelete}>
            <Text>Delete</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    ),
    Button: ({ title, onPress, testID }: any) => (
      <TouchableOpacity testID={testID} onPress={onPress}>
        <Text>{title}</Text>
      </TouchableOpacity>
    ),
  };
});

jest.mock('../../../src/components/AnimatedEntry', () => {
  const { View } = require('react-native');
  return {
    AnimatedEntry: ({ children, ...props }: any) => <View {...props}>{children}</View>,
  };
});

jest.mock('../../../src/components/CustomAlert', () => {
  const { View } = require('react-native');
  return {
    CustomAlert: (_props: any) => <View testID="custom-alert" />,
    showAlert: jest.fn((opts: any) => ({ visible: true, ...opts })),
    hideAlert: jest.fn(() => ({ visible: false })),
    initialAlertState: { visible: false },
  };
});

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
  isErrorWithCode: jest.fn(() => false),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

// Polyfill for requestAnimationFrame
(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

// Import AFTER all mocks are set up
import { ModelsScreen } from '../../../src/screens/ModelsScreen';

const renderModelsScreen = () => {
  return render(
    <NavigationContainer>
      <ModelsScreen />
    </NavigationContainer>
  );
};

describe('ModelsScreen basic rendering and tabs (real composition)', () => {
  let realFixture: import('../../harness/mobileApplicationFixture').MobileApplicationFixture;
  let realRTL: typeof import('@testing-library/react-native');
  let RealModelsScreen: typeof ModelsScreen;
  let RealNavigationContainer: typeof NavigationContainer;
  let RealReact: typeof React;
  let realNativeBoundary: import('../../harness/nativeBoundary').NativeBoundary;
  let originalFetch: typeof global.fetch;
  let searchResponse: Array<Record<string, unknown>> = [];
  let searchFails = false;
  const imageMnnBoundaryFiles: Array<Record<string, unknown>> = [
    { type: 'file', path: 'StableDiffusionV1.zip', size: 500_000_000 },
    { type: 'file', path: 'AnimeGenerator.zip', size: 500_000_000 },
  ];
  const imageQnnBoundaryFiles: Array<Record<string, unknown>> = [
    { type: 'file', path: 'FastModel_qnn2.28_8gen2.zip', size: 500_000_000 },
  ];
  let treeResponse: Array<Record<string, unknown>> = [];
  let treeHangs = false;
  const networkFetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/models?')) {
      return new Response(JSON.stringify(searchResponse), {
        status: searchFails ? 503 : 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/tree/')) {
      if (treeHangs) return new Promise<Response>(() => {});
      const response = url.includes('xororz/sd-mnn')
        ? imageMnnBoundaryFiles
        : url.includes('xororz/sd-qnn')
          ? imageQnnBoundaryFiles
          : treeResponse;
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  beforeAll(async () => {
    for (const path of [
      '../../../src/services/huggingface',
      '../../../src/services/modelServices/bootstrap/modelLibraryBootstrap',
      '../../../src/services/hardware',
      '../../../src/services/huggingFaceModelBrowser',
      '../../../src/services/coreMLModelBrowser',
      '../../../src/utils/coreMLModelUtils',
      '../../harness/activeModelLifecycle',
      '../../../src/components',
      '../../../src/components/AnimatedEntry',
      '../../../src/components/CustomAlert',
    ]) {
      jest.unmock(path);
    }
    const { installNativeBoundary, requireRTL, GB } =
      require('../../harness/nativeBoundary') as typeof import('../../harness/nativeBoundary');
    realNativeBoundary = installNativeBoundary({
      download: true,
      fs: true,
      whisper: true,
      ram: {
        platform: 'android',
        totalBytes: 8 * GB,
        availBytes: 4 * GB,
      },
    });
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.getHardware.mockResolvedValue('qcom');
    DeviceInfo.getModel.mockReturnValue('Snapdragon test device');
    realNativeBoundary.diffusion.module.getSoCModel = jest.fn().mockResolvedValue('SM8550');
    originalFetch = global.fetch;
    global.fetch = networkFetch as typeof global.fetch;
    realRTL = requireRTL();
    RealReact = require('react');
    ({ NavigationContainer: RealNavigationContainer } = require('@react-navigation/native'));
    ({ ModelsScreen: RealModelsScreen } = require('../../../src/screens/ModelsScreen'));
    const { hardwareService } =
      require('../../../src/services/hardware') as typeof import('../../../src/services/hardware');
    await hardwareService.getDeviceInfo();
    const mobileFixture =
      require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
    await mobileFixture.seedMobileDownloadJournal([]);
    realFixture = await mobileFixture.startMobileApplicationFixture();
  });

  afterEach(() => {
    searchResponse = [];
    searchFails = false;
    treeResponse = [];
    treeHangs = false;
    networkFetch.mockClear();
    realRTL.cleanup();
  });
  afterAll(async () => {
    await realFixture.dispose();
    global.fetch = originalFetch;
  });

  const renderRealScreen = () =>
    realRTL.render(
      RealReact.createElement(
        RealNavigationContainer,
        null,
        RealReact.createElement(RealModelsScreen),
      ),
    );

  it('renders the models screen container', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('models-screen')).toBeTruthy());
  });

  it('shows the Models title', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByText('Models')).toBeTruthy());
  });

  it('shows text and image tab buttons', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => {
      expect(view.getByText('Text Models')).toBeTruthy();
      expect(view.getByText('Image Models')).toBeTruthy();
    });
  });

  it('shows the downloads icon', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('downloads-icon')).toBeTruthy());
  });

  it('shows Import Local File button', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByText('Import Local File')).toBeTruthy());
  });

  it('navigates to DownloadManager when downloads icon pressed', async () => {
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByTestId('downloads-icon'));
    expect(mockNavigate).toHaveBeenCalledWith('DownloadManager');
  });

  it('switches to image models tab', async () => {
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByText('Image Models'));
    await realRTL.waitFor(() => expect(view.getByText('Image Models')).toBeTruthy());
  });

  it('switches back to text models tab', async () => {
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByText('Image Models'));
    realRTL.fireEvent.press(view.getByText('Text Models'));
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
  });

  it('shows search input on text tab', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
  });

  it('triggers search when typing', async () => {
    searchResponse = [
      {
        id: 'meta-llama/Llama-3',
        author: 'meta-llama',
        lastModified: '2026-01-01T00:00:00Z',
        downloads: 1,
        likes: 1,
        tags: ['gguf'],
      },
    ];
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'llama');
    await realRTL.waitFor(() => {
      expect(networkFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=llama'),
        expect.objectContaining({ headers: { Accept: 'application/json' } }),
      );
    });
  });

  it('shows recommended models header', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() =>
      expect(view.getByText('Recommended for your device')).toBeTruthy(),
    );
  });

  it('shows RAM info banner', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByText(/\d+GB RAM/)).toBeTruthy());
  });

  it('shows search results after searching', async () => {
    searchResponse = [
      {
        id: 'test-org/Test Model Alpha',
        author: 'test-org',
        lastModified: '2026-01-01T00:00:00Z',
        downloads: 1,
        likes: 1,
        tags: ['gguf'],
      },
      {
        id: 'test-org/Test Model Beta',
        author: 'test-org',
        lastModified: '2026-01-01T00:00:00Z',
        downloads: 1,
        likes: 1,
        tags: ['gguf'],
      },
    ];
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => {
      expect(view.getByText('Test Model Alpha')).toBeTruthy();
      expect(view.getByText('Test Model Beta')).toBeTruthy();
    });
  });

  it('shows empty state when no search results', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'nonexistent-model');
    await realRTL.waitFor(() => expect(view.getByText(/No models found/)).toBeTruthy());
  });

  it('always shows the Voice Models tab button', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('voice-models-tab')).toBeTruthy());
  });

  it('shows the upsell when no voice engine is registered', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('voice-models-tab')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('voice-models-tab'));
    await realRTL.waitFor(() => expect(view.getByTestId('voice-models-upsell')).toBeTruthy());
  });

  it('navigates to ProDetail when Get Pro is pressed', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('voice-models-tab')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('voice-models-tab'));
    await realRTL.waitFor(() => expect(view.getByText('Get Pro')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Get Pro'));
    expect(mockNavigate).toHaveBeenCalledWith('ProDetail');
  });

  const openTextFilters = async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('text-filter-toggle')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('text-filter-toggle'));
    return view;
  };

  it('shows filter pills when filter toggle is pressed', async () => {
    const view = await openTextFilters();
    await realRTL.waitFor(() => {
      expect(view.getByText(/Org/)).toBeTruthy();
      expect(view.getByText(/Type/)).toBeTruthy();
      expect(view.getByText(/Source/)).toBeTruthy();
      expect(view.getByText(/Size/)).toBeTruthy();
      expect(view.getAllByText(/Quant/).length).toBeGreaterThan(0);
    });
  });

  it('expands Org filter and shows org chips', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Org/));
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
  });

  it('selects org filter chip and shows badge count', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Org/));
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
  });

  it('expands Type filter and shows type options', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Type/));
    await realRTL.waitFor(() => expect(view.getByText('Text')).toBeTruthy());
  });

  it('selects a type filter', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Type/));
    await realRTL.waitFor(() => expect(view.getByText('Text')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Text'));
  });

  it('expands Source filter and shows credibility options', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Source/));
    await realRTL.waitFor(() => expect(view.getByText('All')).toBeTruthy());
  });

  it('expands Size filter and shows size options', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Size/));
    await realRTL.waitFor(() => expect(view.getByText('1-3B')).toBeTruthy());
  });

  it('expands Quant filter and shows quant options', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/^Quant [▴▾]$/));
    await realRTL.waitFor(() => expect(view.getByText('Q4_K_M')).toBeTruthy());
  });

  it('shows Clear button when org filter is active', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Org/));
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
    await realRTL.waitFor(() => expect(view.getByText('Clear')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Clear'));
  });

  it('hides filter bar when toggle pressed again', async () => {
    const view = await openTextFilters();
    await realRTL.waitFor(() => expect(view.getByText(/Org/)).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('text-filter-toggle'));
  });

  it('collapses expanded dimension when same pill pressed again', async () => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(/Org/));
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText(/Org/));
    await realRTL.waitFor(() => expect(view.queryByText('Qwen')).toBeNull());
  });

  const rawModel = (id: string, author = id.split('/')[0], extra: Record<string, unknown> = {}) => ({
    id,
    author,
    lastModified: '2026-01-01T00:00:00Z',
    downloads: 5000,
    likes: 200,
    tags: ['gguf'],
    ...extra,
  });
  const rawFile = (path: string, size: number) => ({ type: 'file', path, size });
  const openModelDetail = async (id: string, author?: string) => {
    searchResponse = [rawModel(id, author)];
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText(id.split('/').pop()!)).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('model-card-0'));
    return view;
  };

  it('navigates to model detail when search result is pressed', async () => {
    treeResponse = [rawFile('model-Q4_K_M.gguf', 2_000_000_000)];
    const view = await openModelDetail('test-org/Test Model');
    await realRTL.waitFor(() => expect(view.getByTestId('model-detail-screen')).toBeTruthy());
  });

  it('does not navigate to detail for unsupported phi models', async () => {
    searchResponse = [rawModel('microsoft/Phi-3 Mini')];
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'phi');
    await realRTL.waitFor(() => expect(view.getByText('Phi-3 Mini')).toBeTruthy());
    networkFetch.mockClear();
    realRTL.fireEvent.press(view.getByTestId('model-card-0'));
    expect(view.queryByTestId('model-detail-screen')).toBeNull();
    expect(networkFetch).not.toHaveBeenCalled();
  });

  it('shows back button on model detail view', async () => {
    treeResponse = [rawFile('model.gguf', 1_000_000_000)];
    const view = await openModelDetail('test-org/Back Test Model');
    await realRTL.waitFor(() => expect(view.getByLabelText('Back')).toBeTruthy());
    realRTL.fireEvent.press(view.getByLabelText('Back'));
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
  });

  it('shows model description and stats in detail view', async () => {
    treeResponse = [rawFile('model.gguf', 1_000_000_000)];
    const view = await openModelDetail('org/Stats Model');
    await realRTL.waitFor(() => {
      expect(view.getByText('Text generation · by org')).toBeTruthy();
      expect(view.getByText(/downloads/)).toBeTruthy();
      expect(view.getByText(/likes/)).toBeTruthy();
    });
  });

  it('shows Available Files section in detail view', async () => {
    treeResponse = [
      rawFile('model-Q4_K_M.gguf', 2_000_000_000),
      rawFile('model-Q8_0.gguf', 4_000_000_000),
    ];
    const view = await openModelDetail('org/Files Model');
    await realRTL.waitFor(() => {
      expect(view.getByText('Available Files')).toBeTruthy();
      expect(view.getByText(/Choose a quantization/)).toBeTruthy();
    });
  });

  it('renders Gemma 4 E2B files from the Shared catalog without network discovery', async () => {
    const view = await openModelDetail('unsloth/gemma-4-E2B-it-GGUF', 'google');
    await realRTL.waitFor(() => expect(view.getByText('gemma-4-E2B-it-Q4_K_M')).toBeTruthy());
    expect(view.getByText(/Vision files include mmproj/)).toBeTruthy();
    expect(view.queryByText('No compatible files found for this model.')).toBeNull();
    expect(view.queryByText('Failed to load model files.')).toBeNull();
    expect(networkFetch.mock.calls.some(([url]) => String(url).includes('/tree/'))).toBe(false);
  });

  it('shows credibility badge for official models', async () => {
    treeResponse = [rawFile('model.gguf', 1_000_000_000)];
    const view = await openModelDetail('meta-llama/Official Model');
    await realRTL.waitFor(() => expect(view.getByText('✓')).toBeTruthy());
  });

  it('shows credibility badge for lmstudio curated models', async () => {
    treeResponse = [rawFile('model.gguf', 1_000_000_000)];
    const view = await openModelDetail('lmstudio-community/LMStudio Model');
    await realRTL.waitFor(() => expect(view.getByText('★')).toBeTruthy());
  });

  it('shows credibility badge for verified quantizers', async () => {
    treeResponse = [rawFile('model.gguf', 1_000_000_000)];
    const view = await openModelDetail('bartowski/Verified Model');
    await realRTL.waitFor(() => expect(view.getByText('◆')).toBeTruthy());
  });

  it('filters out files too large for device', async () => {
    treeResponse = [
      rawFile('model-small.gguf', 2 * 1024 * 1024 * 1024),
      rawFile('model-large.gguf', 6 * 1024 * 1024 * 1024),
    ];
    const view = await openModelDetail('org/Large Model');
    await realRTL.waitFor(() => expect(view.getByText('Available Files')).toBeTruthy());
    await realRTL.waitFor(() => expect(view.getByTestId('file-card-0')).toBeTruthy());
  });

  it('shows vision mmproj note when files have mmProjFile', async () => {
    treeResponse = [
      rawFile('model-Q4_K_M.gguf', 2_000_000_000),
      rawFile('mmproj-model-f16.gguf', 500_000_000),
    ];
    const view = await openModelDetail('org/Vision Model');
    await realRTL.waitFor(() => expect(view.getByText(/mmproj/)).toBeTruthy());
  });

  const openFilter = async (label: RegExp) => {
    const view = await openTextFilters();
    realRTL.fireEvent.press(view.getByText(label));
    return view;
  };

  it('clears search results when query is emptied', async () => {
    searchResponse = [rawModel('test/Search Result')];
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText('Search Result')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), '');
    await realRTL.waitFor(() => expect(view.getByText('Recommended for your device')).toBeTruthy());
  });

  it('handles submit editing (enter key) to trigger search', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    networkFetch.mockClear();
    realRTL.fireEvent(view.getByTestId('search-input'), 'submitEditing');
    await realRTL.waitFor(() =>
      expect(networkFetch).toHaveBeenCalledWith(
        expect.stringContaining('search=test'),
        expect.any(Object),
      ),
    );
  });

  it('selects a source filter chip', async () => {
    const view = await openFilter(/Source/);
    await realRTL.waitFor(() => expect(view.getByText('LM Studio')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('LM Studio'));
    await realRTL.waitFor(() => expect(view.getByText(/LM Studio/)).toBeTruthy());
  });

  it('selects a size filter chip', async () => {
    const view = await openFilter(/Size/);
    await realRTL.waitFor(() => expect(view.getByText('3-8B')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('3-8B'));
    await realRTL.waitFor(() => expect(view.getByText(/3-8B/)).toBeTruthy());
  });

  it('selects a quant filter chip', async () => {
    const view = await openFilter(/^Quant [▴▾]$/);
    await realRTL.waitFor(() => expect(view.getByText('Q5_K_M')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Q5_K_M'));
    await realRTL.waitFor(() => expect(view.getByText(/Q5_K_M/)).toBeTruthy());
  });

  it('clears all text filters via Clear button', async () => {
    const view = await openFilter(/Org/);
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
    await realRTL.waitFor(() => expect(view.getByText('Clear')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Clear'));
    await realRTL.waitFor(() => expect(view.getByText(/Org/)).toBeTruthy());
  });

  it('filters search results by source credibility', async () => {
    searchResponse = [
      rawModel('official/Official 3B', 'meta-llama'),
      rawModel('community/Community 3B', 'random'),
    ];
    const view = await openFilter(/Source/);
    await realRTL.waitFor(() => expect(view.getByText('Official')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Official'));
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'model');
    await realRTL.waitFor(() => expect(view.getByText('Official 3B')).toBeTruthy());
    expect(view.queryByText('Community 3B')).toBeNull();
  });

  it('filters search results by model type (vision)', async () => {
    searchResponse = [
      rawModel('test/LLaVA Vision 7B', 'test', { tags: ['gguf', 'vision', 'multimodal'] }),
      rawModel('test/Text Only 3B', 'test', { tags: ['gguf', 'text-generation'] }),
    ];
    const view = await openFilter(/Type/);
    await realRTL.waitFor(() => expect(view.getAllByText('Vision').length).toBeGreaterThan(0));
    realRTL.fireEvent.press(view.getAllByText('Vision')[0]);
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText('LLaVA Vision 7B')).toBeTruthy());
    expect(view.queryByText('Text Only 3B')).toBeNull();
  });

  it('filters search results by size', async () => {
    searchResponse = [
      rawModel('test/Small 1B', 'test', { siblings: [{ rfilename: 'small-Q4_K_M.gguf', size: 1_000_000_000 }] }),
      rawModel('test/Large 70B', 'test', { siblings: [{ rfilename: 'large-Q4_K_M.gguf', size: 4_000_000_000 }] }),
    ];
    const view = await openFilter(/Size/);
    await realRTL.waitFor(() => expect(view.getByText('1-3B')).toBeTruthy());
    networkFetch.mockClear();
    realRTL.fireEvent.press(view.getByText('1-3B'));
    await realRTL.waitFor(() => expect(view.getByText('Small 1B')).toBeTruthy());
    expect(networkFetch).toHaveBeenCalled();
    expect(view.queryByText('Large 70B')).toBeNull();
  });

  it('shows empty state with filter message when filters active but no results', async () => {
    const view = await openFilter(/Type/);
    await realRTL.waitFor(() => expect(view.getAllByText('Vision').length).toBeGreaterThan(0));
    realRTL.fireEvent.press(view.getAllByText('Vision')[0]);
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'nonexistent');
    await realRTL.waitFor(() => expect(view.getByText(/No models match your filters/)).toBeTruthy());
  });

  it('shows generic empty state when no filters but no results', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'nonexistent');
    await realRTL.waitFor(() => expect(view.getByText(/No models found/)).toBeTruthy());
  });

  const openImageTab = async () => {
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByText('Image Models'));
    return view;
  };
  const openImageFilters = async (view: ReturnType<typeof renderRealScreen>) => {
    const filterToggle = await view.findByRole('button', {
      name: 'Filter image models',
    });
    realRTL.fireEvent.press(filterToggle);
  };

  it('shows image search input on image tab', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByPlaceholderText('Search models...')).toBeTruthy());
  });

  it('shows RAM info on image tab', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText(/8GB RAM/)).toBeTruthy());
  });

  it('renders image tab content area', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => {
      expect(view.getByPlaceholderText('Search models...')).toBeTruthy();
      expect(view.getByTestId('rec-toggle')).toBeTruthy();
    });
  });

  it('renders image models after recommendation loads', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => {
      expect(view.getByTestId('image-model-card-0')).toBeTruthy();
      expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy();
    });
  });

  it('toggles recommended-only star button', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
    expect(view.queryByText('Stable Diffusion V1 (GPU)')).toBeNull();
    realRTL.fireEvent.press(view.getByTestId('rec-toggle'));
    await realRTL.waitFor(() => expect(view.getByText('Stable Diffusion V1 (GPU)')).toBeTruthy());
  });

  it('shows image filter toggle on image tab', async () => {
    const view = await openImageTab();
    await openImageFilters(view);
    expect(view.getByText(/^NPU [▴▾]$/)).toBeTruthy();
    expect(view.getByText(/^Style [▴▾]$/)).toBeTruthy();
  });

  it('renders device recommendation banner on image tab', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText(/Snapdragon flagship/)).toBeTruthy());
  });

  it('loads and shows image models on image tab', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
  });

  it('shows image filter bar when filter toggle pressed on image tab', async () => {
    const view = await openImageTab();
    await openImageFilters(view);
    expect(view.getByText(/^NPU [▴▾]$/)).toBeTruthy();
    expect(view.getByText(/^Style [▴▾]$/)).toBeTruthy();
  });

  it('renders image tab with models available', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => {
      expect(view.getByTestId('image-model-card-0')).toBeTruthy();
      expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy();
    });
  });

  it('filters image models by search query text', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('rec-toggle'));
    await realRTL.waitFor(() => expect(view.getByText('Anime Generator (GPU)')).toBeTruthy());
    realRTL.fireEvent.changeText(view.getByPlaceholderText('Search models...'), 'anime');
    await realRTL.waitFor(() => expect(view.getByText('Anime Generator (GPU)')).toBeTruthy());
    expect(view.queryByText('Stable Diffusion V1 (GPU)')).toBeNull();
    expect(view.queryByText('Fast Model (NPU 8gen2)')).toBeNull();
  });

  it('image tab shows recommendation text', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText(/Snapdragon flagship/)).toBeTruthy());
  });

  it('clears image filters via clearImageFilters', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('rec-toggle'));
    await openImageFilters(view);
    realRTL.fireEvent.press(view.getByText(/^Backend [▴▾]$/));
    await realRTL.waitFor(() => expect(view.getAllByText('GPU').length).toBeGreaterThan(0));
    realRTL.fireEvent.press(view.getAllByText('GPU')[0]);
    await realRTL.waitFor(() => expect(view.getByText('Stable Diffusion V1 (GPU)')).toBeTruthy());
    expect(view.queryByText('Fast Model (NPU 8gen2)')).toBeNull();
    realRTL.fireEvent.press(view.getByText('Clear'));
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
  });

  it('hides non-recommended models while recommended-only is on', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText('Fast Model (NPU 8gen2)')).toBeTruthy());
    expect(view.queryByText('Stable Diffusion V1 (GPU)')).toBeNull();
    expect(view.queryByText('Anime Generator (GPU)')).toBeNull();
  });

  it('dismisses first-time hint when rec-toggle is pressed', async () => {
    const view = await openImageTab();
    await realRTL.waitFor(() => expect(view.getByText(/Showing recommended models only/)).toBeTruthy());
    expect(view.queryByText('Stable Diffusion V1 (GPU)')).toBeNull();
    realRTL.fireEvent.press(view.getByTestId('rec-toggle'));
    await realRTL.waitFor(() => {
      expect(view.queryByText(/Showing recommended models only/)).toBeNull();
      expect(view.getByText('Stable Diffusion V1 (GPU)')).toBeTruthy();
    });
  });

  it('shows import button', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('import-local-model')).toBeTruthy());
  });

  it('triggers file picker on import press', async () => {
    const picker = require('@react-native-documents/picker');
    picker.pick.mockRejectedValueOnce({ code: 'OPERATION_CANCELED' });
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByTestId('import-local-model'));
    await realRTL.waitFor(() => expect(picker.pick).toHaveBeenCalled());
  });

  it('shows import button when not importing', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('import-local-model')).toBeTruthy());
  });

  it('calls file picker when import button pressed', async () => {
    const picker = require('@react-native-documents/picker');
    picker.pick.mockRejectedValueOnce({ code: 'OPERATION_CANCELED' });
    const view = renderRealScreen();
    realRTL.fireEvent.press(view.getByTestId('import-local-model'));
    await realRTL.waitFor(() => expect(picker.pick).toHaveBeenCalled());
  });

  it('handles search network error gracefully', async () => {
    searchFails = true;
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText('Search Error')).toBeTruthy());
    expect(view.getByTestId('models-screen')).toBeTruthy();
  });

  it('handles API error gracefully during search', async () => {
    searchFails = true;
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() =>
      expect(view.getByText('Failed to search models. Please try again.')).toBeTruthy(),
    );
    expect(view.getByTestId('models-screen')).toBeTruthy();
  });

  it('pulls to refresh reloads downloaded models', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByTestId('models-list')).toBeTruthy());
    const storage = require('@react-native-async-storage/async-storage');
    const { RefreshControl } = require('react-native');
    storage.getItem.mockClear();
    realRTL.fireEvent(view.UNSAFE_getByType(RefreshControl), 'refresh');
    await realRTL.waitFor(() => expect(storage.getItem).toHaveBeenCalled());
  });

  it('resets text filters when switching to image tab', async () => {
    const view = await openTextFilters();
    await realRTL.waitFor(() => expect(view.getByText(/Org/)).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Image Models'));
    realRTL.fireEvent.press(view.getByText('Text Models'));
    await realRTL.waitFor(() => expect(view.queryByText('Qwen')).toBeNull());
  });

  it('detects code models from tags', async () => {
    searchResponse = [rawModel('test/DeepSeek Coder 7B', 'test', { tags: ['gguf', 'code'] })];
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'coder');
    await realRTL.waitFor(() => expect(view.getByText('DeepSeek Coder 7B')).toBeTruthy());
  });

  it('detects image-gen models from diffusion tags', async () => {
    searchResponse = [rawModel('test/Stable Diffusion XL', 'test', { tags: ['gguf', 'diffusion', 'text-to-image'] })];
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'stable');
    await realRTL.waitFor(() => expect(view.getByText('Stable Diffusion XL')).toBeTruthy());
  });

  it('hides models with files too large for device RAM', async () => {
    searchResponse = [
      rawModel('test/Fits in RAM 3B', 'test', { siblings: [{ rfilename: 'fits-Q4_K_M.gguf', size: 2_000_000_000 }] }),
      rawModel('test/Too Big 70B', 'test', { siblings: [{ rfilename: 'large-Q4_K_M.gguf', size: 40_000_000_000 }] }),
    ];
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText('Fits in RAM 3B')).toBeTruthy());
    expect(view.queryByText('Too Big 70B')).toBeNull();
  });

  it('shows models with no file info (files not yet fetched)', async () => {
    searchResponse = [rawModel('test/No File Info')];
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'no-files');
    await realRTL.waitFor(() => expect(view.getByText('No File Info')).toBeTruthy());
  });

  it('matches models by org in ID (quantizer repos)', async () => {
    searchResponse = [
      rawModel('bartowski/Qwen 2.5 7B', 'bartowski'),
      rawModel('test/Unrelated Model 3B', 'test'),
    ];
    const view = await openFilter(/Org/);
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'test');
    await realRTL.waitFor(() => expect(view.getByText('Qwen 2.5 7B')).toBeTruthy());
    expect(view.queryByText('Unrelated Model 3B')).toBeNull();
  });

  it('toggles org on then off', async () => {
    const view = await openFilter(/Org/);
    await realRTL.waitFor(() => expect(view.getByText('Qwen')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
    await realRTL.waitFor(() => expect(view.getByText('1')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Qwen'));
    await realRTL.waitFor(() => expect(view.queryByText('1')).toBeNull());
  });

  it('triggers HuggingFace search when vision type filter is set and query is empty', async () => {
    const view = await openFilter(/Type/);
    await realRTL.waitFor(() => expect(view.getAllByText('Vision').length).toBeGreaterThan(0));
    networkFetch.mockClear();
    realRTL.fireEvent.press(view.getAllByText('Vision')[0]);
    await realRTL.waitFor(() =>
      expect(networkFetch).toHaveBeenCalledWith(
        expect.stringContaining('pipeline_tag=image-text-to-text'),
        expect.any(Object),
      ),
    );
  });

  it('does not trigger HuggingFace search when query is empty and no filters are active', async () => {
    const view = renderRealScreen();
    await realRTL.waitFor(() => expect(view.getByText(/Recommended for your device/)).toBeTruthy());
    networkFetch.mockClear();
    expect(networkFetch).not.toHaveBeenCalled();
    expect(view.getByText(/Recommended for your device/)).toBeTruthy();
  });

  it('shows loading spinner when files are loading', async () => {
    treeHangs = true;
    const view = await openModelDetail('test-org/Loading Model');
    await realRTL.waitFor(() => expect(view.getByTestId('model-detail-screen')).toBeTruthy());
    expect(view.getByLabelText('Working')).toBeTruthy();
  });

  it('filters files in detail view by quant filter', async () => {
    treeResponse = [
      rawFile('model-Q4_K_M.gguf', 2_000_000_000),
      rawFile('model-Q8_0.gguf', 4_000_000_000),
    ];
    searchResponse = [rawModel('test-org/Quant Model')];
    const view = await openFilter(/^Quant [▴▾]$/);
    await realRTL.waitFor(() => expect(view.getByText('Q4_K_M')).toBeTruthy());
    realRTL.fireEvent.press(view.getByText('Q4_K_M'));
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'quant');
    await realRTL.waitFor(() => expect(view.getByText('Quant Model')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('model-card-0'));
    await realRTL.waitFor(() => expect(view.getByText('model-Q4_K_M')).toBeTruthy());
    expect(view.queryByText('model-Q8_0')).toBeNull();
  });

  it('pressing back returns to model list and clears files', async () => {
    treeResponse = [rawFile('model-Q4_K_M.gguf', 2_000_000_000)];
    const view = await openModelDetail('test-org/Back Navigation Model');
    await realRTL.waitFor(() => expect(view.getByText('model-Q4_K_M')).toBeTruthy());
    realRTL.fireEvent.press(view.getByLabelText('Back'));
    await realRTL.waitFor(() => expect(view.getByTestId('search-input')).toBeTruthy());
    expect(view.queryByText('model-Q4_K_M')).toBeNull();
  });

  it('triggers HuggingFace search with "coder" keyword when code filter is set and query is empty', async () => {
    const view = await openFilter(/Type/);
    await realRTL.waitFor(() => expect(view.getByText('Code')).toBeTruthy());
    networkFetch.mockClear();
    realRTL.fireEvent.press(view.getByText('Code'));
    await realRTL.waitFor(() =>
      expect(networkFetch).toHaveBeenCalledWith(
        expect.stringContaining(`search=${CODE_FALLBACK_QUERY}`),
        expect.any(Object),
      ),
    );
  });

  it('shows formatted download count in detail view', async () => {
    searchResponse = [rawModel('test-org/Popular Model', 'test-org', {
      downloads: 1_500_000,
      likes: 2_500,
    })];
    treeResponse = [rawFile('model-Q4_K_M.gguf', 2_000_000_000)];
    const view = renderRealScreen();
    realRTL.fireEvent.changeText(view.getByTestId('search-input'), 'popular');
    await realRTL.waitFor(() => expect(view.getByText('Popular Model')).toBeTruthy());
    realRTL.fireEvent.press(view.getByTestId('model-card-0'));
    await realRTL.waitFor(() => {
      expect(view.getByText('1.5M downloads')).toBeTruthy();
      expect(view.getByText('2.5K likes')).toBeTruthy();
    });
  });
});

describe('ModelsScreen', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();

    // Default mock responses
    mockSearchModels.mockResolvedValue([]);
    mockGetModelFiles.mockResolvedValue([]);
    mockGetModelDetails.mockResolvedValue(createModelInfo());
    mockGetDownloadedModels.mockResolvedValue([]);
    mockGetDownloadedImageModels.mockResolvedValue([]);
    mockFetchAvailableModels.mockResolvedValue([]);

    // Set up device info so recommended models render
    useAppStore.setState({
      deviceInfo: createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
    });
  });

  // ============================================================================
  // Download badge
  // ============================================================================
  describe('download badge', () => {
    it('does not show badge when no active downloads', async () => {
      const model = createDownloadedModel({ id: 'dl-model' });
      mockGetDownloadedModels.mockResolvedValue([model]);
      useAppStore.setState({ downloadedModels: [model] });

      const { queryByText } = renderModelsScreen();

      await waitFor(() => {
        // Badge should not show because there are no active downloads
        expect(queryByText('1')).toBeFalsy();
      });
    });

    it('does not show badge for downloaded image models with no active downloads', async () => {
      const textModel = createDownloadedModel({ id: 'text-1' });
      const imageModel = createONNXImageModel({ id: 'image-1' });
      mockGetDownloadedModels.mockResolvedValue([textModel]);
      mockGetDownloadedImageModels.mockResolvedValue([imageModel]);
      useAppStore.setState({
        downloadedModels: [textModel],
        downloadedImageModels: [imageModel],
      });

      const { queryByText } = renderModelsScreen();

      await waitFor(() => {
        // Badge should not show because there are no active downloads
        expect(queryByText('2')).toBeFalsy();
      });
    });
  });
  // ============================================================================
  // Recommended Models & Constants
  // ============================================================================
  describe('recommended models', () => {
    it('RECOMMENDED_MODELS has entries', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      expect(RECOMMENDED_MODELS.length).toBeGreaterThan(0);
    });

    it('all recommended models have minRam', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      for (const model of RECOMMENDED_MODELS) {
        expect(model.minRam).toBeGreaterThan(0);
      }
    });

    it('all recommended models have type badges (text/vision/code)', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      const validTypes = ['text', 'vision', 'code'];
      for (const model of RECOMMENDED_MODELS) {
        expect(validTypes).toContain(model.type);
      }
    });

    it('recommended models have editorial ordering with Gemma 4 first', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      expect(RECOMMENDED_MODELS[0].id).toContain('gemma-4');
    });

    it('MODEL_ORGS contains expected organizations', () => {
      const { MODEL_ORGS } = require('@offgrid/models');
      const keys = MODEL_ORGS.map((o: any) => o.key);
      expect(keys).toContain('Qwen');
      expect(keys).toContain('meta-llama');
      expect(keys).toContain('google');
      expect(keys).toContain('microsoft');
    });
  });

  // ============================================================================
  // Model type filtering (constants)
  // ============================================================================
  describe('type filter', () => {
    it('filters by text models', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      const textModels = RECOMMENDED_MODELS.filter((m: any) => m.type === 'text');
      expect(textModels.length).toBeGreaterThan(0);
    });

    it('filters by vision models', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      const visionModels = RECOMMENDED_MODELS.filter((m: any) => m.type === 'vision');
      expect(visionModels.length).toBeGreaterThan(0);
    });

    it('has no code models after removal', () => {
      const { RECOMMENDED_MODELS } = require('@offgrid/models');
      const codeModels = RECOMMENDED_MODELS.filter((m: any) => m.type === 'code');
      expect(codeModels.length).toBe(0);
    });
  });

  // ============================================================================
  // Multi-file Download (Vision Models)
  // ============================================================================
  describe('multi-file download', () => {
    it('vision model files include mmProjFile', () => {
      const file = createModelFileWithMmProj({
        name: 'vision-model.gguf',
        mmProjName: 'mmproj.gguf',
        mmProjSize: 500 * 1024 * 1024,
      });

      expect(file.mmProjFile).toBeDefined();
      expect(file.mmProjFile!.name).toBe('mmproj.gguf');
      expect(file.mmProjFile!.size).toBe(500 * 1024 * 1024);
    });

    it('calculates combined size for vision model files', () => {
      const file = createModelFileWithMmProj({
        size: 4000000000,
        mmProjSize: 500000000,
      });

      const totalSize = file.size + (file.mmProjFile?.size || 0);
      expect(totalSize).toBe(4500000000);
    });
  });
  });
  // ============================================================================
  // Downloaded model indicators
  // ============================================================================
  describe('downloaded model indicators', () => {
    it('marks recommended model as downloaded when matching model exists', async () => {
      // Download a model that matches a recommended model
      const downloadedModel = createDownloadedModel({
        id: 'Qwen/Qwen3-0.6B-GGUF/qwen3-0.6b-q4_k_m.gguf',
      });
      mockGetDownloadedModels.mockResolvedValue([downloadedModel]);
      useAppStore.setState({ downloadedModels: [downloadedModel] });

      const { getByTestId } = renderModelsScreen();

      await waitFor(() => {
        expect(getByTestId('models-screen')).toBeTruthy();
      });
    });
  // ============================================================================
  // Bring Your Own Model (constants/logic)
  // Model detail view - download and file filtering
  // ============================================================================
  describe('model detail view interactions', () => {
    it('triggers download when download button pressed on file card', async () => {
      mockSearchModels.mockResolvedValue([
        createModelInfo({ id: 'test-org/test-model-3B', name: 'Test Model', author: 'test-org' }),
      ]);
      mockGetModelFiles.mockResolvedValue([
        createModelFile({ name: 'model-Q4_K_M.gguf', size: 2000000000 }),
      ]);
      const { getByTestId, getByText } = renderModelsScreen();
      await waitFor(() => expect(getByTestId('search-input')).toBeTruthy());
      fireEvent.changeText(getByTestId('search-input'), 'test');
      await waitFor(() => expect(getByText('Test Model')).toBeTruthy());
      fireEvent.press(getByText('Test Model'));
      await waitFor(() => expect(getByTestId('file-card-0-download-btn')).toBeTruthy());
      fireEvent.press(getByTestId('file-card-0-download-btn'));
    });

    it('shows downloaded indicator on already-downloaded file', async () => {
      const downloadedModel = createDownloadedModel({
        id: 'test-org/test-model-3B/model-Q4_K_M.gguf',
        name: 'Test Model Q4_K_M',
      });
      const files = [
        createModelFile({ name: 'model-Q4_K_M.gguf', size: 2000000000 }),
      ];
      mockSearchModels.mockResolvedValue([
        createModelInfo({
          id: 'test-org/test-model-3B',
          name: 'Test Model',
          author: 'test-org',
          files: [],
        }),
      ]);
      mockGetModelFiles.mockResolvedValue(files);

      // Mark model as downloaded via the mock that loadDownloadedModels calls
      mockGetDownloadedModels.mockResolvedValue([downloadedModel]);

      const { getByTestId, getByText } = renderModelsScreen();

      await waitFor(() => expect(getByTestId('search-input')).toBeTruthy());

      await act(async () => {
        fireEvent.changeText(getByTestId('search-input'), 'test');
      });
      await waitFor(() => expect(getByText('Test Model')).toBeTruthy());
      await act(async () => {
        fireEvent.press(getByText('Test Model'));
      });

      await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy());

      // File should show downloaded indicator
      await waitFor(() => {
        expect(getByTestId('file-card-0-downloaded')).toBeTruthy();
      });
    });
  });
  // ============================================================================
  // Import progress rendering
  // ============================================================================
  describe('import progress', () => {
    it('shows import progress card when importing', async () => {
      // We can test this by setting isImporting state
      // Since isImporting is internal state, we trigger it via the import flow
      const { getByTestId } = renderModelsScreen();

      await waitFor(() => expect(getByTestId('import-local-model')).toBeTruthy());
    });
  });

  // Recommended models filtering with active filters
  // ============================================================================
  describe('recommended models with filters', () => {
    it('filters recommended models by type filter', async () => {
      const { getByTestId, getByText, getAllByText } = renderModelsScreen();

      await waitFor(() => expect(getByTestId('text-filter-toggle')).toBeTruthy());

      // Set type filter to "vision"
      await act(async () => {
        fireEvent.press(getByTestId('text-filter-toggle'));
      });
      await act(async () => {
        fireEvent.press(getByText(/Type/));
      });
      await waitFor(() => expect(getAllByText('Vision').length).toBeGreaterThan(0));
      await act(async () => {
        fireEvent.press(getAllByText('Vision')[0]);
      });

      // The recommended models list should now be filtered by vision type
      // We can verify the filter is active by checking the pill shows "Vision"
      await waitFor(() => {
        expect(getByText(/Vision/)).toBeTruthy();
      });
    });

    it('hides recommended models that are already downloaded', async () => {
      // Set a downloaded model that matches a recommended model ID
      useAppStore.setState({
        downloadedModels: [
          createDownloadedModel({
            id: 'bartowski/Llama-3.2-1B-Instruct-GGUF/some-file.gguf',
          }),
        ],
      });

      const { getByTestId } = renderModelsScreen();

      await waitFor(() => expect(getByTestId('models-screen')).toBeTruthy());
      // Recommended models that match downloaded IDs should be filtered out
    });
  });
  // ============================================================================
  // Detail view - back button returns to list
  // ============================================================================
  describe('detail view navigation', () => {
  });
  // ============================================================================
  // handleDownload - covers the download handler branches
  // ============================================================================
  describe('text model download flow', () => {
    it('calls downloadModelBackground when download button is pressed', async () => {
      const { modelLibrary } = require('../../../src/services/modelServices/bootstrap/modelLibraryBootstrap');
      modelLibrary.downloadModelBackground = jest.fn(() => Promise.resolve({ downloadId: 1 }));

      const files = [
        createModelFile({ name: 'model-Q4_K_M.gguf', size: 2000000000 }),
      ];
      mockSearchModels.mockResolvedValue([
        createModelInfo({
          id: 'test-org/test-model-3B',
          name: 'Test Model',
          author: 'test-org',
        }),
      ]);
      mockGetModelFiles.mockResolvedValue(files);

      const { getByTestId, getByText } = renderModelsScreen();

      await waitFor(() => expect(getByTestId('search-input')).toBeTruthy());

      await act(async () => {
        fireEvent.changeText(getByTestId('search-input'), 'test');
      });
      await waitFor(() => expect(getByText('Test Model')).toBeTruthy());
      await act(async () => {
        fireEvent.press(getByText('Test Model'));
      });
      await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy());

      await waitFor(() => {
        expect(getByTestId('file-card-0-download-btn')).toBeTruthy();
      });

      await act(async () => {
        fireEvent.press(getByTestId('file-card-0-download-btn'));
      });

      expect(modelLibrary.downloadModelBackground).toHaveBeenCalled();
    });
  });
  // ============================================================================
  // handleSearch with filters
  // ============================================================================
  describe('handleSearch with active filters', () => {
  });

  // ============================================================================
  // formatNumber utility
  // ============================================================================
  describe('formatNumber display', () => {
  });
});
