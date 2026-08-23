import { DownloadedModel, ONNXImageModel } from '../types';

function isUnknownLike(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized === 'unknown';
}

export function isSuspiciousRecoveredTextModel(model: DownloadedModel): boolean {
  if (!model.id.startsWith('recovered_')) return false;
  return isUnknownLike(model.author) || isUnknownLike(model.quantization);
}

export function isSuspiciousRecoveredImageModel(model: ONNXImageModel): boolean {
  return model.id.startsWith('recovered_');
}

function isWhisperTextModel(model: DownloadedModel): boolean {
  return (
    model.id.startsWith('whisper-') ||
    (model.fileName?.startsWith('ggml-') === true &&
      model.fileName.endsWith('.bin'))
  );
}

export function isExcludedTextModel(model: DownloadedModel): boolean {
  return isSuspiciousRecoveredTextModel(model) || isWhisperTextModel(model);
}

/**
 * SDXL (apple/coreml-stable-diffusion-xl-base-ios) is unsupported on iOS: its Core ML runtime
 * footprint is ~7 GB of DIRTY (un-pageable) memory, which jetsams even a 12 GB iPhone 17 Pro Max
 * mid-load. It's been removed from the download catalog (coreMLModelBrowser), but a copy downloaded
 * before that must never be OFFERED as selectable either — otherwise tapping it is a guaranteed
 * jetsam. Match by its repo slug so it's hidden regardless of how the id/name was recorded.
 * (It stays in the store so it remains deletable from the Download Manager to reclaim space.)
 */
export function isUnsupportedJetsamImageModel(model: ONNXImageModel): boolean {
  const id = model.id.toLowerCase();
  const path = model.modelPath.toLowerCase();
  return id.includes('coreml-stable-diffusion-xl-base-ios') ||
    path.includes('coreml-stable-diffusion-xl-base-ios');
}
