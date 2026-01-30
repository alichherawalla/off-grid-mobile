import { useState, useEffect, useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { whisperService } from '../services/whisperService';
import { useWhisperStore } from '../stores/whisperStore';

export interface UseWhisperTranscriptionResult {
  isRecording: boolean;
  isModelLoaded: boolean;
  isLoading: boolean;
  partialResult: string;
  finalResult: string;
  error: string | null;
  recordingTime: number;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  clearResult: () => void;
}

export const useWhisperTranscription = (): UseWhisperTranscriptionResult => {
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [partialResult, setPartialResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const isCancelled = useRef(false);

  const { downloadedModelId, isModelLoaded, loadModel } = useWhisperStore();

  // Auto-load model if downloaded but not loaded
  useEffect(() => {
    const autoLoadModel = async () => {
      if (downloadedModelId && !isModelLoaded && !whisperService.isModelLoaded()) {
        console.log('[Whisper] Auto-loading model...');
        try {
          await loadModel();
          console.log('[Whisper] Model auto-loaded successfully');
        } catch (err) {
          console.error('[Whisper] Failed to auto-load model:', err);
        }
      }
    };
    autoLoadModel();
  }, [downloadedModelId, isModelLoaded, loadModel]);

  // Define stopRecording first since startRecording depends on it
  const stopRecording = useCallback(async () => {
    console.log('[Whisper] stopRecording called');
    try {
      await whisperService.stopTranscription();
      // Haptic feedback
      Vibration.vibrate(30);
    } catch (err) {
      console.error('[Whisper] Stop error:', err);
      // Force reset on error
      whisperService.forceReset();
    } finally {
      setIsRecording(false);
      setIsLoading(false);
    }
  }, []);

  const clearResult = useCallback(() => {
    setFinalResult('');
    setPartialResult('');
    isCancelled.current = true;
    // Also ensure recording is stopped
    if (whisperService.isCurrentlyTranscribing()) {
      whisperService.stopTranscription();
    }
  }, []);

  const startRecording = useCallback(async () => {
    console.log('[Whisper] startRecording called');
    console.log('[Whisper] Model loaded:', whisperService.isModelLoaded());
    console.log('[Whisper] Current isRecording state:', isRecording);

    // If already recording, stop first
    if (isRecording || whisperService.isCurrentlyTranscribing()) {
      console.log('[Whisper] Already recording, stopping first...');
      await stopRecording();
      await new Promise<void>(resolve => setTimeout(resolve, 150));
    }

    if (!whisperService.isModelLoaded()) {
      console.log('[Whisper] Model not loaded, trying to load...');
      // Try to load if we have a downloaded model
      if (downloadedModelId) {
        try {
          await loadModel();
        } catch (err) {
          setError('Failed to load Whisper model. Please try again.');
          return;
        }
      } else {
        setError('No transcription model downloaded. Go to Settings to download one.');
        return;
      }
    }

    // Haptic feedback to indicate recording started
    Vibration.vibrate(50);

    try {
      isCancelled.current = false;
      setError(null);
      setPartialResult('');
      setFinalResult('');
      setIsRecording(true);
      setIsLoading(true);

      console.log('[Whisper] Starting realtime transcription...');

      await whisperService.startRealtimeTranscription((result) => {
        console.log('[Whisper] Transcription result:', result.isCapturing, result.text?.slice(0, 50));

        if (isCancelled.current) return;

        setRecordingTime(result.recordingTime);

        if (result.isCapturing) {
          // Still recording - update partial result
          if (result.text) {
            setPartialResult(result.text);
          }
          setIsLoading(false);
        } else {
          // Recording finished - haptic feedback
          Vibration.vibrate(30);
          setIsRecording(false);
          setIsLoading(false);
          if (result.text && !isCancelled.current) {
            setFinalResult(result.text);
            setPartialResult('');
          }
        }
      });
    } catch (err) {
      console.error('[Whisper] Recording error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to start recording';
      setError(errorMsg);
      setIsRecording(false);
      setIsLoading(false);
      // Force reset whisper service state
      whisperService.forceReset();
      // Error haptic
      Vibration.vibrate([0, 50, 50, 50]);
    }
  }, [downloadedModelId, loadModel, isRecording, stopRecording]);

  return {
    isRecording,
    isModelLoaded: isModelLoaded || whisperService.isModelLoaded(),
    isLoading,
    partialResult,
    finalResult,
    error,
    recordingTime,
    startRecording,
    stopRecording,
    clearResult,
  };
};
