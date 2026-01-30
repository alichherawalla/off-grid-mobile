import { initWhisper, WhisperContext, RealtimeTranscribeEvent } from 'whisper.rn';
import { Platform, PermissionsAndroid } from 'react-native';
import RNFS from 'react-native-fs';

export interface TranscriptionResult {
  text: string;
  isCapturing: boolean;
  processTime: number;
  recordingTime: number;
}

export type TranscriptionCallback = (result: TranscriptionResult) => void;

// Whisper models info
export const WHISPER_MODELS = [
  {
    id: 'tiny.en',
    name: 'Whisper Tiny (English)',
    size: 75, // MB
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    description: 'Fastest, English only, good for basic transcription',
  },
  {
    id: 'tiny',
    name: 'Whisper Tiny (Multilingual)',
    size: 75,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    description: 'Fast, supports multiple languages',
  },
  {
    id: 'base.en',
    name: 'Whisper Base (English)',
    size: 142,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    description: 'Better accuracy, English only',
  },
  {
    id: 'base',
    name: 'Whisper Base (Multilingual)',
    size: 142,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    description: 'Better accuracy, multiple languages',
  },
  {
    id: 'small.en',
    name: 'Whisper Small (English)',
    size: 466,
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    description: 'High accuracy, English only, needs more RAM',
  },
];

class WhisperService {
  private context: WhisperContext | null = null;
  private currentModelPath: string | null = null;
  private isTranscribing: boolean = false;
  private stopFn: (() => void) | null = null;

  getModelsDir(): string {
    return `${RNFS.DocumentDirectoryPath}/whisper-models`;
  }

  async ensureModelsDirExists(): Promise<void> {
    const dir = this.getModelsDir();
    const exists = await RNFS.exists(dir);
    if (!exists) {
      await RNFS.mkdir(dir);
    }
  }

  getModelPath(modelId: string): string {
    return `${this.getModelsDir()}/ggml-${modelId}.bin`;
  }

  async isModelDownloaded(modelId: string): Promise<boolean> {
    const path = this.getModelPath(modelId);
    return await RNFS.exists(path);
  }

  async downloadModel(
    modelId: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const model = WHISPER_MODELS.find(m => m.id === modelId);
    if (!model) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    await this.ensureModelsDirExists();
    const destPath = this.getModelPath(modelId);

    // Check if already exists
    if (await RNFS.exists(destPath)) {
      return destPath;
    }

    console.log(`[Whisper] Downloading ${model.name}...`);

    const download = RNFS.downloadFile({
      fromUrl: model.url,
      toFile: destPath,
      progress: (res) => {
        const progress = res.bytesWritten / res.contentLength;
        onProgress?.(progress);
      },
      progressDivider: 1,
    });

    const result = await download.promise;

    if (result.statusCode !== 200) {
      await RNFS.unlink(destPath).catch(() => {});
      throw new Error(`Download failed with status ${result.statusCode}`);
    }

    console.log(`[Whisper] Downloaded to ${destPath}`);
    return destPath;
  }

  async deleteModel(modelId: string): Promise<void> {
    const path = this.getModelPath(modelId);
    if (await RNFS.exists(path)) {
      await RNFS.unlink(path);
    }
  }

  async loadModel(modelPath: string): Promise<void> {
    // Unload if different model
    if (this.context && this.currentModelPath !== modelPath) {
      await this.unloadModel();
    }

    // Skip if already loaded
    if (this.context && this.currentModelPath === modelPath) {
      return;
    }

    console.log(`[Whisper] Loading model: ${modelPath}`);

    try {
      this.context = await initWhisper({
        filePath: modelPath,
      });
      this.currentModelPath = modelPath;
      console.log('[Whisper] Model loaded successfully');
    } catch (error) {
      console.error('[Whisper] Failed to load model:', error);
      throw error;
    }
  }

  async unloadModel(): Promise<void> {
    if (this.context) {
      await this.context.release();
      this.context = null;
      this.currentModelPath = null;
    }
  }

  isModelLoaded(): boolean {
    return this.context !== null;
  }

  getLoadedModelPath(): string | null {
    return this.currentModelPath;
  }

  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          {
            title: 'Microphone Permission',
            message: 'This app needs access to your microphone for voice input.',
            buttonPositive: 'OK',
            buttonNegative: 'Cancel',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      } catch (error) {
        console.error('[Whisper] Failed to request permission:', error);
        return false;
      }
    }
    return true;
  }

  async startRealtimeTranscription(
    onResult: TranscriptionCallback,
    options?: {
      language?: string;
      maxLen?: number;
    }
  ): Promise<void> {
    console.log('[WhisperService] startRealtimeTranscription called');
    console.log('[WhisperService] Context exists:', !!this.context);
    console.log('[WhisperService] isTranscribing:', this.isTranscribing);

    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    // If already transcribing, force stop before starting new
    if (this.isTranscribing || this.stopFn) {
      console.log('[WhisperService] Stopping previous transcription before starting new one');
      await this.stopTranscription();
      // Small delay to ensure cleanup
      await new Promise<void>(resolve => setTimeout(resolve, 100));
    }

    console.log('[WhisperService] Requesting permissions...');
    const hasPermission = await this.requestPermissions();
    console.log('[WhisperService] Permission granted:', hasPermission);

    if (!hasPermission) {
      throw new Error('Microphone permission denied');
    }

    this.isTranscribing = true;

    try {
      console.log('[WhisperService] Calling transcribeRealtime...');
      // Use the transcribeRealtime API
      const { stop, subscribe } = await this.context.transcribeRealtime({
        language: options?.language || 'en',
        maxLen: options?.maxLen || 0, // 0 = no limit
        realtimeAudioSec: 30, // Process in 30-second chunks
        realtimeAudioSliceSec: 3, // Slice every 3 seconds for faster intermediate results
      });

      console.log('[WhisperService] transcribeRealtime started successfully');
      this.stopFn = stop;

      subscribe((evt: RealtimeTranscribeEvent) => {
        console.log('[WhisperService] Event received:', {
          isCapturing: evt.isCapturing,
          hasData: !!evt.data,
          text: evt.data?.result?.slice(0, 50),
        });

        const { isCapturing, data, processTime, recordingTime } = evt;
        onResult({
          text: data?.result || '',
          isCapturing,
          processTime: processTime || 0,
          recordingTime: recordingTime || 0,
        });

        if (!isCapturing) {
          console.log('[WhisperService] Recording finished');
          this.isTranscribing = false;
          this.stopFn = null;
        }
      });
    } catch (error) {
      console.error('[WhisperService] transcribeRealtime error:', error);
      this.isTranscribing = false;
      this.stopFn = null;
      throw error;
    }
  }

  async stopTranscription(): Promise<void> {
    console.log('[WhisperService] stopTranscription called');
    try {
      if (this.stopFn) {
        this.stopFn();
        this.stopFn = null;
      }
    } catch (error) {
      console.error('[WhisperService] Error stopping transcription:', error);
    } finally {
      this.isTranscribing = false;
    }
  }

  // Force reset state - use when state gets stuck
  forceReset(): void {
    console.log('[WhisperService] Force resetting state');
    this.isTranscribing = false;
    this.stopFn = null;
  }

  isCurrentlyTranscribing(): boolean {
    return this.isTranscribing;
  }

  // Transcribe a single audio file
  async transcribeFile(
    filePath: string,
    options?: {
      language?: string;
      onProgress?: (progress: number) => void;
    }
  ): Promise<string> {
    if (!this.context) {
      throw new Error('No Whisper model loaded');
    }

    const { promise } = this.context.transcribe(filePath, {
      language: options?.language || 'en',
      onProgress: options?.onProgress,
    });

    const { result } = await promise;
    return result;
  }
}

export const whisperService = new WhisperService();
