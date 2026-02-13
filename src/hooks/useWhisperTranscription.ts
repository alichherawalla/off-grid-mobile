import { useState, useEffect, useCallback, useRef } from 'react';
import { Vibration } from 'react-native';
import { whisperService } from '../services/whisperService';
import { useWhisperStore } from '../stores/whisperStore';

export interface UseWhisperTranscriptionResult {
  isRecording: boolean;
  isModelLoaded: boolean;
  isModelLoading: boolean;
  isTranscribing: boolean;
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
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [partialResult, setPartialResult] = useState('');
  const [finalResult, setFinalResult] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const isCancelled = useRef(false);
  const transcribingStartTime = useRef<number | null>(null);
  const pendingResult = useRef<string | null>(null);

  const { downloadedModelId, isModelLoaded, isModelLoading, loadModel } = useWhisperStore();

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

  // Minimum time to show transcribing state (ms)
  const MIN_TRANSCRIBING_TIME = 600;

  // Helper to finalize transcription with minimum display time
  // NOTE: This does NOT clear isTranscribing - that's done by clearResult()
  // which is called from ChatInput after the text is added to the input box.
  // This keeps the loader visible until text actually appears.
  const finalizeTranscription = useCallback((text: string) => {
    const startTime = transcribingStartTime.current;
    const elapsed = startTime ? Date.now() - startTime : MIN_TRANSCRIBING_TIME;
    const remaining = Math.max(0, MIN_TRANSCRIBING_TIME - elapsed);

    if (remaining > 0) {
      // Store result and wait for minimum time
      pendingResult.current = text;
      setTimeout(() => {
        if (!isCancelled.current && pendingResult.current !== null) {
          setFinalResult(pendingResult.current);
          pendingResult.current = null;
        } else {
          // If cancelled, clear the transcribing state
          setIsTranscribing(false);
        }
        setPartialResult('');
        transcribingStartTime.current = null;
      }, remaining);
    } else {
      // Minimum time already passed - set result, let clearResult() clear isTranscribing
      setFinalResult(text);
      setPartialResult('');
      transcribingStartTime.current = null;
    }
  }, []);

  // Extra recording time after user releases button (ms)
  // Whisper needs trailing audio/silence to properly process speech
  const TRAILING_RECORD_TIME = 2500;

  // Define stopRecording first since startRecording depends on it
  const stopRecording = useCallback(async () => {
    console.log('[Whisper] stopRecording called');

    // Immediately update UI to show "Transcribing..." state
    // But keep recording in background for better accuracy
    setIsRecording(false);
    transcribingStartTime.current = Date.now();

    try {
      // Continue recording for a bit longer to capture trailing audio
      // This helps Whisper process the speech more accurately
      // User sees "Transcribing..." during this time
      console.log('[Whisper] Capturing trailing audio for', TRAILING_RECORD_TIME, 'ms...');
      await new Promise<void>(resolve => setTimeout(() => resolve(), TRAILING_RECORD_TIME));

      // Check if cancelled during the wait
      if (isCancelled.current) {
        console.log('[Whisper] Cancelled during trailing capture');
        whisperService.forceReset();
        return;
      }

      // Now actually stop the transcription
      await whisperService.stopTranscription();
      // Haptic feedback
      Vibration.vibrate(30);
    } catch (err) {
      console.error('[Whisper] Stop error:', err);
      // Force reset on error
      whisperService.forceReset();
      // On error, also clear transcribing state
      setIsTranscribing(false);
      transcribingStartTime.current = null;
    }
  }, []);

  const clearResult = useCallback(() => {
    setFinalResult('');
    setPartialResult('');
    setIsTranscribing(false);
    isCancelled.current = true;
    pendingResult.current = null;
    transcribingStartTime.current = null;
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
        } catch {
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
      setIsTranscribing(true);

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
        } else {
          // Recording finished - haptic feedback
          Vibration.vibrate(30);
          setIsRecording(false);
          // Use finalizeTranscription to ensure minimum display time
          if (result.text && !isCancelled.current) {
            finalizeTranscription(result.text);
          } else {
            setIsTranscribing(false);
            setPartialResult('');
            transcribingStartTime.current = null;
          }
        }
      });
    } catch (err) {
      console.error('[Whisper] Recording error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to start recording';
      setError(errorMsg);
      setIsRecording(false);
      setIsTranscribing(false);
      // Force reset whisper service state
      whisperService.forceReset();
      // Error haptic
      Vibration.vibrate([0, 50, 50, 50]);
    }
  }, [downloadedModelId, loadModel, isRecording, stopRecording, finalizeTranscription]);

  return {
    isRecording,
    isModelLoaded: isModelLoaded || whisperService.isModelLoaded(),
    isModelLoading,
    isTranscribing,
    partialResult,
    finalResult,
    error,
    recordingTime,
    startRecording,
    stopRecording,
    clearResult,
  };
};
