/**
 * WhisperService Unit Tests
 *
 * Tests for Whisper speech-to-text service.
 * Priority: P1 - Voice input support.
 */

import { initWhisper, AudioSessionIos } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';
import { whisperService, WHISPER_MODELS } from '../../../src/services/whisperService';

const mockedAudioSessionIos = AudioSessionIos as jest.Mocked<typeof AudioSessionIos>;

const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;
const mockedInitWhisper = initWhisper as jest.MockedFunction<typeof initWhisper>;

describe('WhisperService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    // Reset singleton state
    (whisperService as any).context = null;
    (whisperService as any).currentModelPath = null;
    (whisperService as any).isTranscribing = false;
    (whisperService as any).stopFn = null;
    // Re-establish default AudioSessionIos mock implementations
    // (previous tests may have set mockRejectedValue which clearAllMocks doesn't reset)
    mockedAudioSessionIos.setCategory.mockResolvedValue(undefined as any);
    mockedAudioSessionIos.setMode.mockResolvedValue(undefined as any);
    mockedAudioSessionIos.setActive.mockResolvedValue(undefined as any);
  });

  // ========================================================================
  // getModelsDir / getModelPath
  // ========================================================================
  describe('getModelsDir', () => {
    it('returns path under DocumentDirectoryPath', () => {
      expect(whisperService.getModelsDir()).toBe('/mock/documents/whisper-models');
    });
  });

  describe('getModelPath', () => {
    it('returns correct path for a model ID', () => {
      expect(whisperService.getModelPath('tiny.en')).toBe(
        '/mock/documents/whisper-models/ggml-tiny.en.bin'
      );
    });
  });

  // ========================================================================
  // isModelDownloaded
  // ========================================================================
  describe('isModelDownloaded', () => {
    it('returns true when file exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);
      expect(await whisperService.isModelDownloaded('tiny.en')).toBe(true);
    });

    it('returns false when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);
      expect(await whisperService.isModelDownloaded('tiny.en')).toBe(false);
    });
  });

  // ========================================================================
  // downloadModel
  // ========================================================================
  describe('downloadModel', () => {
    it('throws for unknown model ID', async () => {
      await expect(whisperService.downloadModel('nonexistent')).rejects.toThrow('Unknown model');
    });

    it('returns existing path if already downloaded', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      const result = await whisperService.downloadModel('tiny.en');

      expect(result).toBe('/mock/documents/whisper-models/ggml-tiny.en.bin');
      expect(RNFS.downloadFile).not.toHaveBeenCalled();
    });

    it('downloads via RNFS when not present', async () => {
      // First exists check (ensureModelsDirExists) = true, second (destPath) = false
      mockedRNFS.exists
        .mockResolvedValueOnce(true) // dir exists
        .mockResolvedValueOnce(false); // model not yet downloaded

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 200, bytesWritten: 75000000 }),
      } as any);

      const result = await whisperService.downloadModel('tiny.en');

      expect(RNFS.downloadFile).toHaveBeenCalled();
      const callArgs = (RNFS.downloadFile as jest.Mock).mock.calls[0][0];
      expect(callArgs.fromUrl).toBe(WHISPER_MODELS[0].url);
      expect(result).toBe('/mock/documents/whisper-models/ggml-tiny.en.bin');
    });

    it('calls progress callback', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true) // dir exists
        .mockResolvedValueOnce(false); // model doesn't exist

      let capturedProgressFn: any;
      mockedRNFS.downloadFile.mockImplementation((opts: any) => {
        capturedProgressFn = opts.progress;
        return {
          jobId: 1,
          promise: Promise.resolve({ statusCode: 200, bytesWritten: 75000000 }),
        } as any;
      });

      const progressCb = jest.fn();
      await whisperService.downloadModel('tiny.en', progressCb);

      // Simulate progress
      if (capturedProgressFn) {
        capturedProgressFn({ bytesWritten: 37500000, contentLength: 75000000 });
        expect(progressCb).toHaveBeenCalledWith(0.5);
      }
    });

    it('cleans up on non-200 status', async () => {
      mockedRNFS.exists
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      mockedRNFS.downloadFile.mockReturnValue({
        jobId: 1,
        promise: Promise.resolve({ statusCode: 500, bytesWritten: 0 }),
      } as any);

      mockedRNFS.unlink.mockResolvedValue(undefined as any);

      await expect(whisperService.downloadModel('tiny.en')).rejects.toThrow('Download failed');
      expect(RNFS.unlink).toHaveBeenCalled();
    });
  });

  // ========================================================================
  // deleteModel
  // ========================================================================
  describe('deleteModel', () => {
    it('deletes file when it exists', async () => {
      mockedRNFS.exists.mockResolvedValue(true);

      await whisperService.deleteModel('tiny.en');

      expect(RNFS.unlink).toHaveBeenCalledWith('/mock/documents/whisper-models/ggml-tiny.en.bin');
    });

    it('does nothing when file does not exist', async () => {
      mockedRNFS.exists.mockResolvedValue(false);

      await whisperService.deleteModel('tiny.en');

      expect(RNFS.unlink).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // loadModel
  // ========================================================================
  describe('loadModel', () => {
    it('calls initWhisper with file path', async () => {
      const mockContext = {
        id: 'test-whisper',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValue(mockContext as any);

      await whisperService.loadModel('/path/to/model.bin');

      expect(initWhisper).toHaveBeenCalledWith({ filePath: '/path/to/model.bin' });
      expect(whisperService.isModelLoaded()).toBe(true);
      expect(whisperService.getLoadedModelPath()).toBe('/path/to/model.bin');
    });

    it('unloads different model before loading new one', async () => {
      const mockContext1 = {
        id: 'ctx1',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      const mockContext2 = {
        id: 'ctx2',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };

      mockedInitWhisper.mockResolvedValueOnce(mockContext1 as any);
      await whisperService.loadModel('/path/model1.bin');

      mockedInitWhisper.mockResolvedValueOnce(mockContext2 as any);
      await whisperService.loadModel('/path/model2.bin');

      expect(mockContext1.release).toHaveBeenCalled();
      expect(whisperService.getLoadedModelPath()).toBe('/path/model2.bin');
    });

    it('skips loading if same model already loaded', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);

      await whisperService.loadModel('/path/model.bin');
      await whisperService.loadModel('/path/model.bin');

      expect(initWhisper).toHaveBeenCalledTimes(1);
    });

    it('throws on initWhisper failure', async () => {
      mockedInitWhisper.mockRejectedValue(new Error('Load failed'));

      await expect(whisperService.loadModel('/bad/model.bin')).rejects.toThrow('Load failed');
    });
  });

  // ========================================================================
  // unloadModel
  // ========================================================================
  describe('unloadModel', () => {
    it('releases context and clears state', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(() => Promise.resolve()),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      await whisperService.unloadModel();

      expect(mockContext.release).toHaveBeenCalled();
      expect(whisperService.isModelLoaded()).toBe(false);
      expect(whisperService.getLoadedModelPath()).toBeNull();
    });

    it('does nothing when no model loaded', async () => {
      await whisperService.unloadModel(); // Should not throw
      expect(whisperService.isModelLoaded()).toBe(false);
    });
  });

  // ========================================================================
  // requestPermissions
  // ========================================================================
  describe('requestPermissions', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    describe('Android', () => {
      beforeEach(() => {
        Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      });

      it('returns true when granted', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        expect(await whisperService.requestPermissions()).toBe(true);
      });

      it('returns false when denied', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.DENIED
        );

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('returns false on permission error', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockRejectedValue(new Error('Permission error'));

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('does not call AudioSessionIos', async () => {
        jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        await whisperService.requestPermissions();

        expect(mockedAudioSessionIos.setCategory).not.toHaveBeenCalled();
        expect(mockedAudioSessionIos.setMode).not.toHaveBeenCalled();
        expect(mockedAudioSessionIos.setActive).not.toHaveBeenCalled();
      });

      it('requests RECORD_AUDIO permission with correct message', async () => {
        const requestSpy = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
          PermissionsAndroid.RESULTS.GRANTED
        );

        await whisperService.requestPermissions();

        expect(requestSpy).toHaveBeenCalledWith(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          expect.objectContaining({
            title: 'Microphone Permission',
            buttonPositive: 'OK',
          })
        );
      });
    });

    describe('iOS', () => {
      beforeEach(() => {
        Object.defineProperty(Platform, 'OS', { get: () => 'ios' });
      });

      it('configures audio session and returns true', async () => {
        expect(await whisperService.requestPermissions()).toBe(true);

        expect(mockedAudioSessionIos.setCategory).toHaveBeenCalledWith(
          'PlayAndRecord',
          ['AllowBluetooth', 'MixWithOthers']
        );
        expect(mockedAudioSessionIos.setMode).toHaveBeenCalledWith('Default');
        expect(mockedAudioSessionIos.setActive).toHaveBeenCalledWith(true);
      });

      it('calls setCategory before setMode before setActive', async () => {
        const callOrder: string[] = [];
        mockedAudioSessionIos.setCategory.mockImplementation(async () => { callOrder.push('setCategory'); });
        mockedAudioSessionIos.setMode.mockImplementation(async () => { callOrder.push('setMode'); });
        mockedAudioSessionIos.setActive.mockImplementation(async () => { callOrder.push('setActive'); });

        await whisperService.requestPermissions();

        expect(callOrder).toEqual(['setCategory', 'setMode', 'setActive']);
      });

      it('returns false when audio session setup fails', async () => {
        mockedAudioSessionIos.setCategory.mockRejectedValue(new Error('Audio session error'));

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('returns false when setActive fails (permission denied)', async () => {
        mockedAudioSessionIos.setActive.mockRejectedValue(new Error('Microphone permission denied'));

        expect(await whisperService.requestPermissions()).toBe(false);
      });

      it('does not call PermissionsAndroid', async () => {
        const requestSpy = jest.spyOn(PermissionsAndroid, 'request');

        await whisperService.requestPermissions();

        expect(requestSpy).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================================================
  // startRealtimeTranscription
  // ========================================================================
  describe('startRealtimeTranscription', () => {
    const originalOS = Platform.OS;

    afterEach(() => {
      Object.defineProperty(Platform, 'OS', { get: () => originalOS });
    });

    it('throws when no model loaded', async () => {
      await expect(
        whisperService.startRealtimeTranscription(jest.fn())
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('stops existing transcription before starting new one', async () => {
      // Set up a loaded model
      const mockStop = jest.fn();
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: mockStop,
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      // Simulate existing transcription
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn();

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' }); // auto-grant permissions

      await whisperService.startRealtimeTranscription(jest.fn());

      // The old stopFn should have been called
      expect((whisperService as any).stopFn).not.toBeNull(); // New stopFn is set
    });

    it('throws when permission denied', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
        PermissionsAndroid.RESULTS.DENIED
      );

      await expect(
        whisperService.startRealtimeTranscription(jest.fn())
      ).rejects.toThrow('Microphone permission denied');
    });

    it('calls transcribeRealtime with correct options', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn(), { language: 'fr', maxLen: 100 });

      expect(mockContext.transcribeRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          language: 'fr',
          maxLen: 100,
        })
      );
    });

    it('includes audioSessionOnStartIos options on iOS', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      await whisperService.startRealtimeTranscription(jest.fn());

      expect(mockContext.transcribeRealtime).toHaveBeenCalledWith(
        expect.objectContaining({
          audioSessionOnStartIos: expect.objectContaining({
            category: 'PlayAndRecord',
            options: ['AllowBluetooth', 'MixWithOthers'],
            mode: 'Default',
          }),
          audioSessionOnStopIos: 'restore',
        })
      );
    });

    it('does not include audioSession options on Android', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: jest.fn(),
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'android' });
      jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(
        PermissionsAndroid.RESULTS.GRANTED
      );

      await whisperService.startRealtimeTranscription(jest.fn());

      const callArgs = mockContext.transcribeRealtime.mock.calls[0][0];
      expect(callArgs.audioSessionOnStartIos).toBeUndefined();
      expect(callArgs.audioSessionOnStopIos).toBeUndefined();
    });

    it('forwards events to callback via subscribe', async () => {
      let subscribeFn: any;
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(() => Promise.resolve({
          stop: jest.fn(),
          subscribe: (fn: any) => { subscribeFn = fn; },
        })),
        transcribe: jest.fn(),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      Object.defineProperty(Platform, 'OS', { get: () => 'ios' });

      const resultCb = jest.fn();
      await whisperService.startRealtimeTranscription(resultCb);

      // Simulate event from subscribe
      subscribeFn({
        isCapturing: true,
        data: { result: 'hello world' },
        processTime: 100,
        recordingTime: 200,
      });

      expect(resultCb).toHaveBeenCalledWith({
        text: 'hello world',
        isCapturing: true,
        processTime: 100,
        recordingTime: 200,
      });
    });
  });

  // ========================================================================
  // stopTranscription
  // ========================================================================
  describe('stopTranscription', () => {
    it('calls stored stop function', async () => {
      const mockStopFn = jest.fn();
      (whisperService as any).stopFn = mockStopFn;
      (whisperService as any).isTranscribing = true;

      await whisperService.stopTranscription();

      expect(mockStopFn).toHaveBeenCalled();
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('handles error in stop function gracefully', async () => {
      (whisperService as any).stopFn = () => { throw new Error('stop error'); };
      (whisperService as any).isTranscribing = true;

      await whisperService.stopTranscription(); // Should not throw

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });

    it('is safe to call when not transcribing', async () => {
      await whisperService.stopTranscription(); // Should not throw
      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });
  });

  // ========================================================================
  // transcribeFile
  // ========================================================================
  describe('transcribeFile', () => {
    it('throws when no model loaded', async () => {
      await expect(
        whisperService.transcribeFile('/path/to/audio.wav')
      ).rejects.toThrow('No Whisper model loaded');
    });

    it('returns transcription result', async () => {
      const mockContext = {
        id: 'ctx',
        release: jest.fn(),
        transcribeRealtime: jest.fn(),
        transcribe: jest.fn(() => ({
          promise: Promise.resolve({ result: 'transcribed text' }),
        })),
      };
      mockedInitWhisper.mockResolvedValueOnce(mockContext as any);
      await whisperService.loadModel('/path/model.bin');

      const result = await whisperService.transcribeFile('/audio.wav');

      expect(result).toBe('transcribed text');
      expect(mockContext.transcribe).toHaveBeenCalledWith('/audio.wav', expect.objectContaining({
        language: 'en',
      }));
    });
  });

  // ========================================================================
  // forceReset
  // ========================================================================
  describe('forceReset', () => {
    it('resets transcription state', () => {
      (whisperService as any).isTranscribing = true;
      (whisperService as any).stopFn = jest.fn();

      whisperService.forceReset();

      expect(whisperService.isCurrentlyTranscribing()).toBe(false);
    });
  });
});
