import { isModelDownloadInProgress, type ModelsSnapshot } from '@offgrid/application';
import { hideAlert, showAlert, type AlertState } from '../../components/CustomAlert';
import type { DownloadedModel } from '../../types';

export function downloadedModelMatchesFile(
  model: DownloadedModel,
  repositoryId: string,
  fileName: string,
): boolean {
  return model.fileName === fileName || model.id === `${repositoryId}/${fileName}`;
}

export function buildFileDownloadHandler(input: {
  state: { downloaded: boolean; progress: unknown; hasFailed: boolean };
  fileName: string;
  sizeBytes: number;
  ramGB: number;
  warning: (fileName: string, sizeBytes: number, ramGB: number) => { title: string; message: string } | null;
  proceed: () => void;
  setAlertState: (state: AlertState) => void;
}): (() => void) | undefined {
  if (input.state.downloaded || input.state.progress || input.state.hasFailed) return undefined;
  return () => {
    const warning = input.warning(input.fileName, input.sizeBytes, input.ramGB);
    if (!warning) return input.proceed();
    input.setAlertState(showAlert(warning.title, warning.message, [
      { text: 'Cancel', style: 'cancel', onPress: () => input.setAlertState(hideAlert()) },
      { text: 'Download anyway', style: 'default', onPress: () => {
        input.setAlertState(hideAlert());
        input.proceed();
      } },
    ]));
  };
}

export function aggregateTextModelDownloads(downloads: ModelsSnapshot['downloads'], repositoryId: string) {
  const active = downloads.filter(row =>
    row.modelType === 'text'
    && row.modelId.startsWith(`${repositoryId}/`)
    && isModelDownloadInProgress(row.status));
  const downloaded = active.reduce((sum, row) => sum + row.bytesDownloaded, 0);
  const total = active.reduce((sum, row) => sum + row.totalBytes, 0);
  return {
    downloading: active.some(row => row.status === 'downloading'),
    queued: active.some(row => row.status === 'queued'),
    progress: total > 0 ? downloaded / total : 0,
    bytes: { downloaded, total },
    count: active.length,
  };
}
