/**
 * BackgroundDownloadService Unit Tests
 *
 * Tests for Android background download management via NativeModules.
 * Priority: P0 (Critical) - Download reliability.
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';

// We need to test the class directly since the singleton auto-constructs.
// Mock Platform and NativeModules before importing.

// Store original Platform.OS for restoration
const originalOS = Platform.OS;

// Create the mock native module
const mockDownloadManagerModule = {
  startDownload: jest.fn(),
  cancelDownload: jest.fn(),
  getActiveDownloads: jest.fn(),
  getDownloadProgress: jest.fn(),
  moveCompletedDownload: jest.fn(),
  startProgressPolling: jest.fn(),
  stopProgressPolling: jest.fn(),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

// We need to test the BackgroundDownloadService class directly
// because the exported singleton constructs immediately.
// Extract the class from the module.

describe('BackgroundDownloadService', () => {
  let BackgroundDownloadServiceClass: any;
  let service: any;

  // Captured event handlers from NativeEventEmitter.addListener
  let eventHandlers: Record<string, (event: any) => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    eventHandlers = {};

    // Set up NativeModules
    NativeModules.DownloadManagerModule = mockDownloadManagerModule;

    // Mock NativeEventEmitter to capture event listeners
    jest.spyOn(NativeEventEmitter.prototype, 'addListener').mockImplementation(
      (eventType: string, handler: any) => {
        eventHandlers[eventType] = handler;
        return { remove: jest.fn() };
      }
    );

    // Reset Platform.OS to android for most tests
    Object.defineProperty(Platform, 'OS', { get: () => 'android' });

    // Re-require the module to get a fresh class
    jest.isolateModules(() => {
      const mod = require('../../../src/services/backgroundDownloadService');
      // The module exports a singleton; we access its constructor to create fresh instances
      BackgroundDownloadServiceClass = (mod.backgroundDownloadService as any).constructor;
    });

    service = new BackgroundDownloadServiceClass();
  });

  afterEach(() => {
    // Restore original Platform.OS
    Object.defineProperty(Platform, 'OS', { get: () => originalOS });
  });

  // ========================================================================
  // isAvailable
  // ========================================================================
  describe('isAvailable', () => {
    it('returns true on Android with native module present', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      expect(service.isAvailable()).toBe(true);
    });

    it('returns false on iOS', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      expect(service.isAvailable()).toBe(false);
    });

    it('returns false when native module is null', () => {
      const savedModule = NativeModules.DownloadManagerModule;
      NativeModules.DownloadManagerModule = null;

      // Create fresh instance without module
      jest.isolateModules(() => {
        const mod = require('../../../src/services/backgroundDownloadService');
        const freshService = new (mod.backgroundDownloadService as any).constructor();
        expect(freshService.isAvailable()).toBe(false);
      });

      NativeModules.DownloadManagerModule = savedModule;
    });
  });

  // ========================================================================
  // startDownload
  // ========================================================================
  describe('startDownload', () => {
    it('calls native module with correct params', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 42,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
        title: 'Downloading model',
        description: 'In progress...',
        totalBytes: 4000000000,
      });

      expect(mockDownloadManagerModule.startDownload).toHaveBeenCalledWith({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
        title: 'Downloading model',
        description: 'In progress...',
        totalBytes: 4000000000,
      });
      expect(result.downloadId).toBe(42);
      expect(result.status).toBe('pending');
    });

    it('returns pending status', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 1,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const result = await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      expect(result.status).toBe('pending');
      expect(result.bytesDownloaded).toBe(0);
    });

    it('uses default title and description when not provided', async () => {
      mockDownloadManagerModule.startDownload.mockResolvedValue({
        downloadId: 1,
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      await service.startDownload({
        url: 'https://example.com/model.gguf',
        fileName: 'model.gguf',
        modelId: 'test/model',
      });

      const callArgs = mockDownloadManagerModule.startDownload.mock.calls[0][0];
      expect(callArgs.title).toBe('Downloading model.gguf');
      expect(callArgs.description).toBe('Model download in progress...');
    });

    it('throws when not available', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const iosService = new BackgroundDownloadServiceClass();

      await expect(
        iosService.startDownload({
          url: 'https://example.com/model.gguf',
          fileName: 'model.gguf',
          modelId: 'test/model',
        })
      ).rejects.toThrow('Background downloads not available');
    });
  });

  // ========================================================================
  // cancelDownload
  // ========================================================================
  describe('cancelDownload', () => {
    it('delegates to native module', async () => {
      mockDownloadManagerModule.cancelDownload.mockResolvedValue(undefined);

      await service.cancelDownload(42);

      expect(mockDownloadManagerModule.cancelDownload).toHaveBeenCalledWith(42);
    });

    it('throws when not available', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const iosService = new BackgroundDownloadServiceClass();

      await expect(iosService.cancelDownload(42)).rejects.toThrow('not available');
    });
  });

  // ========================================================================
  // getActiveDownloads
  // ========================================================================
  describe('getActiveDownloads', () => {
    it('returns empty array when not available', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const iosService = new BackgroundDownloadServiceClass();

      const result = await iosService.getActiveDownloads();
      expect(result).toEqual([]);
    });

    it('maps native response to BackgroundDownloadInfo', async () => {
      mockDownloadManagerModule.getActiveDownloads.mockResolvedValue([
        {
          downloadId: 1,
          fileName: 'model.gguf',
          modelId: 'test/model',
          status: 'running',
          bytesDownloaded: 1000,
          totalBytes: 5000,
          startedAt: 12345,
        },
      ]);

      const result = await service.getActiveDownloads();

      expect(result).toHaveLength(1);
      expect(result[0].downloadId).toBe(1);
      expect(result[0].status).toBe('running');
      expect(result[0].bytesDownloaded).toBe(1000);
    });
  });

  // ========================================================================
  // moveCompletedDownload
  // ========================================================================
  describe('moveCompletedDownload', () => {
    it('delegates to native module', async () => {
      mockDownloadManagerModule.moveCompletedDownload.mockResolvedValue('/final/path/model.gguf');

      const result = await service.moveCompletedDownload(42, '/final/path/model.gguf');

      expect(mockDownloadManagerModule.moveCompletedDownload).toHaveBeenCalledWith(42, '/final/path/model.gguf');
      expect(result).toBe('/final/path/model.gguf');
    });

    it('throws when not available', async () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const iosService = new BackgroundDownloadServiceClass();

      await expect(
        iosService.moveCompletedDownload(42, '/path')
      ).rejects.toThrow('not available');
    });
  });

  // ========================================================================
  // listener registration
  // ========================================================================
  describe('listener registration', () => {
    it('onProgress registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onProgress(42, callback);

      expect(typeof unsub).toBe('function');
      // Verify callback was stored
      expect(service['progressListeners'].has('progress_42')).toBe(true);

      // Unsubscribe
      unsub();
      expect(service['progressListeners'].has('progress_42')).toBe(false);
    });

    it('onComplete registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onComplete(42, callback);

      expect(service['completeListeners'].has('complete_42')).toBe(true);
      unsub();
      expect(service['completeListeners'].has('complete_42')).toBe(false);
    });

    it('onError registers and returns unsubscribe function', () => {
      const callback = jest.fn();
      const unsub = service.onError(42, callback);

      expect(service['errorListeners'].has('error_42')).toBe(true);
      unsub();
      expect(service['errorListeners'].has('error_42')).toBe(false);
    });

    it('onAnyProgress registers global listener', () => {
      const callback = jest.fn();
      service.onAnyProgress(callback);

      expect(service['progressListeners'].has('progress_all')).toBe(true);
    });

    it('onAnyComplete registers global listener', () => {
      const callback = jest.fn();
      service.onAnyComplete(callback);

      expect(service['completeListeners'].has('complete_all')).toBe(true);
    });

    it('onAnyError registers global listener', () => {
      const callback = jest.fn();
      service.onAnyError(callback);

      expect(service['errorListeners'].has('error_all')).toBe(true);
    });
  });

  // ========================================================================
  // event dispatching
  // ========================================================================
  describe('event dispatching', () => {
    it('dispatches progress to specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onProgress(42, specificCb);
      service.onAnyProgress(globalCb);

      const event = { downloadId: 42, bytesDownloaded: 1000, totalBytes: 5000, status: 'running', fileName: 'model.gguf', modelId: 'test' };

      // Simulate event from NativeEventEmitter
      if (eventHandlers['DownloadProgress']) {
        eventHandlers['DownloadProgress'](event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches complete to specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onComplete(42, specificCb);
      service.onAnyComplete(globalCb);

      const event = { downloadId: 42, fileName: 'model.gguf', modelId: 'test', bytesDownloaded: 5000, totalBytes: 5000, status: 'completed', localUri: '/path/model.gguf' };

      if (eventHandlers['DownloadComplete']) {
        eventHandlers['DownloadComplete'](event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('dispatches error to specific and global listeners', () => {
      const specificCb = jest.fn();
      const globalCb = jest.fn();
      service.onError(42, specificCb);
      service.onAnyError(globalCb);

      const event = { downloadId: 42, fileName: 'model.gguf', modelId: 'test', status: 'failed', reason: 'Network error' };

      if (eventHandlers['DownloadError']) {
        eventHandlers['DownloadError'](event);
      }

      expect(specificCb).toHaveBeenCalledWith(event);
      expect(globalCb).toHaveBeenCalledWith(event);
    });

    it('does not throw when no listener registered for downloadId', () => {
      // No listeners registered for download 99
      const event = { downloadId: 99, bytesDownloaded: 1000, totalBytes: 5000, status: 'running', fileName: 'model.gguf', modelId: 'test' };

      expect(() => {
        if (eventHandlers['DownloadProgress']) {
          eventHandlers['DownloadProgress'](event);
        }
      }).not.toThrow();
    });
  });

  // ========================================================================
  // polling
  // ========================================================================
  describe('polling', () => {
    it('startProgressPolling calls native module', () => {
      service.startProgressPolling();

      expect(mockDownloadManagerModule.startProgressPolling).toHaveBeenCalled();
      expect(service['isPolling']).toBe(true);
    });

    it('startProgressPolling is idempotent', () => {
      service.startProgressPolling();
      service.startProgressPolling();

      expect(mockDownloadManagerModule.startProgressPolling).toHaveBeenCalledTimes(1);
    });

    it('stopProgressPolling stops polling', () => {
      service.startProgressPolling();
      service.stopProgressPolling();

      expect(mockDownloadManagerModule.stopProgressPolling).toHaveBeenCalled();
      expect(service['isPolling']).toBe(false);
    });

    it('does nothing when not available', () => {
      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      const iosService = new BackgroundDownloadServiceClass();

      iosService.startProgressPolling();
      expect(mockDownloadManagerModule.startProgressPolling).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // cleanup
  // ========================================================================
  describe('cleanup', () => {
    it('stops polling and clears all listeners', () => {
      // Register some listeners
      service.onProgress(1, jest.fn());
      service.onComplete(1, jest.fn());
      service.onError(1, jest.fn());
      service.startProgressPolling();

      service.cleanup();

      expect(service['progressListeners'].size).toBe(0);
      expect(service['completeListeners'].size).toBe(0);
      expect(service['errorListeners'].size).toBe(0);
      expect(service['isPolling']).toBe(false);
    });
  });
});
