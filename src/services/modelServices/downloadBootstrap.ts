/**
 * Register the core download providers (text / image / stt) with the single
 * ModelDownloadService. Called once at app boot. The tts provider lives in pro and
 * registers itself via pro activation (it owns the executorch fetcher).
 */
import { textProvider } from '../adapters/downloads/textDownloadAdapter';
import { imageProvider } from '../adapters/downloads/imageDownloadAdapter';
import { sttProvider } from '../adapters/downloads/transcriptionDownloadAdapter';
import { modelDownloadRegistry } from './downloadRegistryBootstrap';

let registered = false;

export function registerCoreDownloadProviders(): void {
  if (registered) return;
  registered = true;
  modelDownloadRegistry.register(textProvider);
  modelDownloadRegistry.register(imageProvider);
  modelDownloadRegistry.register(sttProvider);
}
