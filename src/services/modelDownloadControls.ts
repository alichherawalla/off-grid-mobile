import { modelDownloadRegistry } from './modelServices/downloadRegistryBootstrap';
import { useDownloadStore } from '../stores/downloadStore';

/** Execute retry and persist its failure before the presentation layer observes it. */
export async function retryModelDownload(id: string, projectionId?: string): Promise<void> {
  try {
    await modelDownloadRegistry.retry(id);
  } catch (error) {
    if (projectionId) {
      const message = error instanceof Error
        ? error.message
        : 'Retry failed. Please remove and re-download.';
      useDownloadStore.getState().setStatus(projectionId, 'failed', { message });
    }
    throw error;
  }
}
