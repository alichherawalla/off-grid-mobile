import type { DownloadEntry } from '../stores/downloadStore';
import type { ImageDownloadDeps } from './imageModelDownloadTypes';
import { executeMobileImageDownload } from './adapters/downloads/imageDownloadApplicationAdapter';

export async function resumeImageDownload(entry: DownloadEntry, deps: ImageDownloadDeps): Promise<void> {
  await executeMobileImageDownload({ type: 'resume', entry }, deps);
}
