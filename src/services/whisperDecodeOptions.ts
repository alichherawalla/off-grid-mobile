interface WhisperDecodeOptions {
  language: string;
  translate: boolean;
  temperature: number;
  beamSize?: number;
}

/**
 * One decode policy for microphone and file transcription.
 *
 * Explicitly disable translation. For a selected non-English language, use a
 * small beam search. Do not provide example transcript text as a prompt:
 * Whisper can copy that text into short or uncertain transcriptions.
 */
export function whisperDecodeOptions(language = 'en'): WhisperDecodeOptions {
  const isSelectedNonEnglish = language !== 'auto' && language !== 'en';

  return {
    language,
    translate: false,
    temperature: 0,
    ...(isSelectedNonEnglish ? { beamSize: 5 } : {}),
  };
}
