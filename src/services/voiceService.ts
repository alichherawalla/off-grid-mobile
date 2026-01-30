import Voice, {
  SpeechResultsEvent,
  SpeechErrorEvent,
  SpeechStartEvent,
  SpeechEndEvent,
} from '@react-native-voice/voice';
import { Platform, PermissionsAndroid } from 'react-native';

export type VoiceEventCallbacks = {
  onStart?: () => void;
  onEnd?: () => void;
  onResults?: (results: string[]) => void;
  onPartialResults?: (results: string[]) => void;
  onError?: (error: string) => void;
};

class VoiceService {
  private isInitialized = false;
  private callbacks: VoiceEventCallbacks = {};

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      console.log('[VoiceService] Checking availability...');

      // Check if Voice is available
      const available = await Voice.isAvailable();
      console.log('[VoiceService] Voice.isAvailable():', available);

      if (!available) {
        // Try to get more info about why it's not available
        try {
          const services = await Voice.getSpeechRecognitionServices();
          console.log('[VoiceService] Available speech services:', services);
        } catch (e) {
          console.log('[VoiceService] Could not get speech services:', e);
        }
        console.warn('[VoiceService] Voice recognition is not available on this device');
        return false;
      }

      // Set up event listeners
      Voice.onSpeechStart = this.handleSpeechStart;
      Voice.onSpeechEnd = this.handleSpeechEnd;
      Voice.onSpeechResults = this.handleSpeechResults;
      Voice.onSpeechPartialResults = this.handleSpeechPartialResults;
      Voice.onSpeechError = this.handleSpeechError;

      this.isInitialized = true;
      console.log('[VoiceService] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[VoiceService] Failed to initialize:', error);
      return false;
    }
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
        console.error('Failed to request microphone permission:', error);
        return false;
      }
    }
    // iOS handles permissions through Info.plist
    return true;
  }

  setCallbacks(callbacks: VoiceEventCallbacks) {
    this.callbacks = callbacks;
  }

  private handleSpeechStart = (e: SpeechStartEvent) => {
    this.callbacks.onStart?.();
  };

  private handleSpeechEnd = (e: SpeechEndEvent) => {
    this.callbacks.onEnd?.();
  };

  private handleSpeechResults = (e: SpeechResultsEvent) => {
    if (e.value) {
      this.callbacks.onResults?.(e.value);
    }
  };

  private handleSpeechPartialResults = (e: SpeechResultsEvent) => {
    if (e.value) {
      this.callbacks.onPartialResults?.(e.value);
    }
  };

  private handleSpeechError = (e: SpeechErrorEvent) => {
    const errorMessage = e.error?.message || 'Unknown error occurred';
    this.callbacks.onError?.(errorMessage);
  };

  async startListening(): Promise<void> {
    try {
      await this.initialize();
      await Voice.start('en-US');
    } catch (error) {
      console.error('Failed to start voice recognition:', error);
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    try {
      await Voice.stop();
    } catch (error) {
      console.error('Failed to stop voice recognition:', error);
      throw error;
    }
  }

  async cancelListening(): Promise<void> {
    try {
      await Voice.cancel();
    } catch (error) {
      console.error('Failed to cancel voice recognition:', error);
      throw error;
    }
  }

  async destroy(): Promise<void> {
    try {
      await Voice.destroy();
      this.isInitialized = false;
    } catch (error) {
      console.error('Failed to destroy voice service:', error);
    }
  }

  async isRecognizing(): Promise<boolean> {
    try {
      const result = await Voice.isRecognizing();
      return Boolean(result);
    } catch {
      return false;
    }
  }
}

export const voiceService = new VoiceService();
