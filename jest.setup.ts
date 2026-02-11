/**
 * Jest Setup File
 *
 * Configures global mocks and test utilities for the LocalLLM test suite.
 * This file runs after the test framework is installed in the environment.
 */

// Import extended matchers - path varies by version
// v12.4+ has built-in matchers, earlier versions use separate import
try {
  require('@testing-library/react-native/extend-expect');
} catch {
  // Built-in matchers in v12.4+, or no matchers needed for basic tests
}

// ============================================================================
// AsyncStorage Mock
// ============================================================================
const mockStorage: Record<string, string> = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn((key: string, value: string) => {
    mockStorage[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => {
    return Promise.resolve(mockStorage[key] || null);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockStorage[key];
    return Promise.resolve();
  }),
  multiSet: jest.fn((pairs: [string, string][]) => {
    pairs.forEach(([key, value]) => {
      mockStorage[key] = value;
    });
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys: string[]) => {
    return Promise.resolve(keys.map(key => [key, mockStorage[key] || null]));
  }),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => {
    return Promise.resolve(Object.keys(mockStorage));
  }),
}));

// Helper to clear storage between tests
export const clearMockStorage = () => {
  Object.keys(mockStorage).forEach(key => delete mockStorage[key]);
};

// ============================================================================
// React Native Mocks - Partial mocks to avoid full module loading issues
// ============================================================================
// Note: We don't mock the entire 'react-native' module as it causes issues
// with internal RN module loading (DevMenu, TurboModules, etc.)
// Instead, we mock specific native modules that need it.

// ============================================================================
// Navigation Mocks
// ============================================================================
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
    useRoute: () => ({
      params: {},
    }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
  };
});

// ============================================================================
// Native Module Mocks
// ============================================================================

// llama.rn mock - use virtual mock since native module may not resolve
jest.mock('llama.rn', () => ({
  initLlama: jest.fn(() => Promise.resolve({
    id: 'test-context-id',
    gpu: false,
    reasonNoGPU: 'Test environment',
    model: {
      nParams: 1000000,
    },
    release: jest.fn(() => Promise.resolve()),
    completion: jest.fn(() => Promise.resolve({
      text: 'Test completion response',
      tokens_predicted: 10,
      tokens_evaluated: 5,
      timings: {
        predicted_per_token_ms: 50,
        predicted_per_second: 20,
      },
    })),
    initMultimodal: jest.fn(() => Promise.resolve(true)),
    getMultimodalSupport: jest.fn(() => Promise.resolve({ vision: false, audio: false })),
  })),
  releaseContext: jest.fn(() => Promise.resolve()),
  completion: jest.fn(() => Promise.resolve({
    text: 'Test completion response',
    tokens_predicted: 10,
    tokens_evaluated: 5,
    timings: {
      predicted_per_token_ms: 50,
      predicted_per_second: 20,
    },
  })),
  stopCompletion: jest.fn(() => Promise.resolve()),
  tokenize: jest.fn(() => Promise.resolve({ tokens: [1, 2, 3] })),
  detokenize: jest.fn(() => Promise.resolve({ text: 'detokenized' })),
}), { virtual: true });

// whisper.rn mock - use virtual mock since native module may not resolve
jest.mock('whisper.rn', () => ({
  initWhisper: jest.fn(() => Promise.resolve({
    id: 'test-whisper-id',
  })),
  releaseWhisper: jest.fn(() => Promise.resolve()),
  transcribeFile: jest.fn(() => Promise.resolve({
    result: 'Transcribed text',
    segments: [],
  })),
  transcribeRealtime: jest.fn(() => Promise.resolve()),
  AudioSessionIos: {
    setCategory: jest.fn(() => Promise.resolve()),
    setMode: jest.fn(() => Promise.resolve()),
    setActive: jest.fn(() => Promise.resolve()),
  },
}), { virtual: true });

// react-native-fs mock
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/documents',
  CachesDirectoryPath: '/mock/caches',
  ExternalDirectoryPath: '/mock/external',
  downloadFile: jest.fn(() => ({
    jobId: 1,
    promise: Promise.resolve({ statusCode: 200, bytesWritten: 1000 }),
  })),
  stopDownload: jest.fn(),
  exists: jest.fn(() => Promise.resolve(false)),
  mkdir: jest.fn(() => Promise.resolve()),
  unlink: jest.fn(() => Promise.resolve()),
  readDir: jest.fn(() => Promise.resolve([])),
  readFile: jest.fn(() => Promise.resolve('')),
  writeFile: jest.fn(() => Promise.resolve()),
  stat: jest.fn(() => Promise.resolve({ size: 1000, isFile: () => true })),
  copyFile: jest.fn(() => Promise.resolve()),
  moveFile: jest.fn(() => Promise.resolve()),
  hash: jest.fn(() => Promise.resolve('mockhash')),
}));

// react-native-device-info mock
jest.mock('react-native-device-info', () => ({
  getTotalMemory: jest.fn(() => Promise.resolve(8 * 1024 * 1024 * 1024)), // 8GB
  getUsedMemory: jest.fn(() => Promise.resolve(4 * 1024 * 1024 * 1024)), // 4GB
  getFreeDiskStorage: jest.fn(() => Promise.resolve(50 * 1024 * 1024 * 1024)), // 50GB
  getModel: jest.fn(() => 'Test Device'),
  getSystemName: jest.fn(() => 'Android'),
  getSystemVersion: jest.fn(() => '13'),
  isEmulator: jest.fn(() => Promise.resolve(false)),
  getDeviceId: jest.fn(() => 'test-device-id'),
}));

// react-native-image-picker mock
jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/image.jpg',
      type: 'image/jpeg',
      fileName: 'image.jpg',
      width: 1024,
      height: 768,
    }],
  })),
  launchCamera: jest.fn(() => Promise.resolve({
    assets: [{
      uri: 'file:///mock/camera.jpg',
      type: 'image/jpeg',
      fileName: 'camera.jpg',
      width: 1024,
      height: 768,
    }],
  })),
}));

// react-native-keychain mock
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  getGenericPassword: jest.fn(() => Promise.resolve(false)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
}));

// @react-native-voice/voice mock
jest.mock('@react-native-voice/voice', () => ({
  start: jest.fn(() => Promise.resolve()),
  stop: jest.fn(() => Promise.resolve()),
  destroy: jest.fn(() => Promise.resolve()),
  isAvailable: jest.fn(() => Promise.resolve(true)),
  onSpeechStart: null,
  onSpeechEnd: null,
  onSpeechResults: null,
  onSpeechError: null,
}));

// react-native-gesture-handler mock
jest.mock('react-native-gesture-handler', () => {
  const MockView = 'View';
  return {
    Swipeable: MockView,
    GestureHandlerRootView: MockView,
    ScrollView: MockView,
    PanGestureHandler: MockView,
    TapGestureHandler: MockView,
    State: {},
    Directions: {},
  };
});

// Mock the direct import of Swipeable
jest.mock('react-native-gesture-handler/Swipeable', () => 'View');

// react-native-worklets mock — must come before reanimated
jest.mock('react-native-worklets', () => ({}));

// react-native-reanimated mock — fully manual to avoid loading native worklets
jest.mock('react-native-reanimated', () => {
  const { View, Text, Image } = require('react-native');
  return {
    __esModule: true,
    default: {
      createAnimatedComponent: (component: any) => component || View,
      addWhitelistedNativeProps: jest.fn(),
      addWhitelistedUIProps: jest.fn(),
      View,
      Text,
      Image,
    },
    useSharedValue: jest.fn((init: any) => ({ value: init })),
    useAnimatedStyle: jest.fn((fn: any) => fn()),
    useDerivedValue: jest.fn((fn: any) => ({ value: fn() })),
    useAnimatedProps: jest.fn((fn: any) => fn()),
    useReducedMotion: jest.fn(() => false),
    withSpring: jest.fn((val: any) => val),
    withTiming: jest.fn((val: any) => val),
    withDelay: jest.fn((_: any, val: any) => val),
    withSequence: jest.fn((...vals: any[]) => vals[vals.length - 1]),
    withRepeat: jest.fn((val: any) => val),
    cancelAnimation: jest.fn(),
    Easing: {
      linear: jest.fn(),
      ease: jest.fn(),
      bezier: jest.fn(() => jest.fn()),
      in: jest.fn(),
      out: jest.fn(),
      inOut: jest.fn(),
    },
    FadeIn: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    FadeOut: { duration: jest.fn().mockReturnThis(), delay: jest.fn().mockReturnThis() },
    SlideInDown: { duration: jest.fn().mockReturnThis() },
    SlideOutDown: { duration: jest.fn().mockReturnThis() },
    Layout: { duration: jest.fn().mockReturnThis() },
    createAnimatedComponent: (component: any) => component || View,
  };
});

// react-native-haptic-feedback mock
jest.mock('react-native-haptic-feedback', () => ({
  trigger: jest.fn(),
}));

// @react-native-community/blur mock
jest.mock('@react-native-community/blur', () => ({
  BlurView: 'BlurView',
}));

// lottie-react-native mock
jest.mock('lottie-react-native', () => 'LottieView');

// react-native-linear-gradient mock
jest.mock('react-native-linear-gradient', () => 'LinearGradient');

// moti mock (kept for any transitive imports)
jest.mock('moti', () => ({
  MotiView: 'MotiView',
  MotiText: 'MotiText',
  MotiImage: 'MotiImage',
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
}), { virtual: true });

// react-native-zip-archive mock
jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(() => Promise.resolve('/mock/unzipped/path')),
  zip: jest.fn(() => Promise.resolve('/mock/zipped/path')),
}));

// Mock react-native-vector-icons
jest.mock('react-native-vector-icons/Feather', () => 'Icon');

// react-native-safe-area-context mock
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) => children,
    SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
    useSafeAreaInsets: () => inset,
  };
});

// ============================================================================
// Global Test Utilities
// ============================================================================

// Silence console during tests (optional - comment out for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
//   warn: jest.fn(),
//   error: jest.fn(),
// };

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  clearMockStorage();
});

// Global timeout for async operations
jest.setTimeout(10000);
