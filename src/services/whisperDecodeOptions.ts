interface WhisperDecodeOptions {
  language: string;
  translate: boolean;
  temperature: number;
  beamSize?: number;
  prompt?: string;
}

const LANGUAGE_PROMPTS: Readonly<Record<string, string>> = {
  hi: 'यह हिंदी और English में स्वाभाविक बातचीत है। Hello, kaise ho bhai? नमस्ते, कैसे हो भाई?',
};

/**
 * One decode policy for microphone and file transcription.
 *
 * Explicitly disable translation. For a selected non-English language, use a
 * small beam search and a language prompt so short, code-switched utterances
 * are less likely to be decoded as similar-sounding English words.
 */
export function whisperDecodeOptions(language = 'en'): WhisperDecodeOptions {
  const isSelectedNonEnglish = language !== 'auto' && language !== 'en';

  return {
    language,
    translate: false,
    temperature: 0,
    ...(isSelectedNonEnglish ? { beamSize: 5 } : {}),
    ...(LANGUAGE_PROMPTS[language]
      ? { prompt: LANGUAGE_PROMPTS[language] }
      : {}),
  };
}
