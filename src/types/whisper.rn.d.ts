declare module 'whisper.rn' {
  export interface WhisperContextOptions {
    filePath: string;
    coreMLModelAsset?: {
      filename: string;
      assets: any[];
    };
  }

  export interface TranscribeOptions {
    language?: string;
    translate?: boolean;
    temperature?: number;
    beamSize?: number;
    prompt?: string;
    maxLen?: number;
    onProgress?: (progress: number) => void;
  }

  export interface TranscribeRealtimeOptions {
    language?: string;
    maxLen?: number;
    realtimeAudioSec?: number;
    realtimeAudioSliceSec?: number;
    /**
     * Only transcribe slices that actually contain speech. The first check runs after 2s of
     * recording. This gates WHAT is transcribed - it does not end the session; see
     * AUTO_STOP_SILENCE_MS in whisperService for the endpointing that does.
     */
    useVad?: boolean;
    /** Audio collected per VAD decision. Cannot be under 2000ms. (Default: 2000) */
    vadMs?: number;
    /** VAD threshold, 0-1. Higher needs louder speech. (Default: 0.6) */
    vadThold?: number;
    /** High-pass filter frequency applied before the VAD decision. (Default: 100.0) */
    vadFreqThold?: number;
    audioSessionOnStartIos?: any;
    audioSessionOnStopIos?: any;
  }

  export interface TranscribeResult {
    result: string;
  }

  export interface RealtimeTranscribeEvent {
    isCapturing: boolean;
    data?: {
      result: string;
    };
    processTime?: number;
    recordingTime?: number;
  }

  export interface WhisperContext {
    transcribe(
      filePath: string | number,
      options?: TranscribeOptions
    ): {
      stop: () => void;
      promise: Promise<TranscribeResult>;
    };

    transcribeRealtime(
      options?: TranscribeRealtimeOptions
    ): Promise<{
      stop: () => void;
      subscribe: (callback: (event: RealtimeTranscribeEvent) => void) => void;
    }>;

    release(): Promise<void>;
  }

  export function initWhisper(options: WhisperContextOptions): Promise<WhisperContext>;

  export function releaseAllWhisper(): Promise<void>;

  export const AudioSessionIos: {
    Category: {
      PlayAndRecord: string;
      Playback: string;
      Record: string;
    };
    CategoryOption: {
      MixWithOthers: string;
      AllowBluetooth: string;
    };
    Mode: {
      Default: string;
      VoiceChat: string;
    };
    setCategory(category: string, options?: string[]): Promise<void>;
    setMode(mode: string): Promise<void>;
    setActive(active: boolean): Promise<void>;
  };
}
