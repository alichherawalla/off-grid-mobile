/**
 * Voice (TTS) + transcription (STT/Whisper) completed-download items for the
 * Download Manager. STT installation comes from the transcription selector;
 * TTS installation and transfer state come from the ModelsFacade projection.
 */
import { useState, useEffect, useCallback } from 'react';
import { AlertState, showAlert } from '../../components/CustomAlert';
import {
  modelsFailureMessage,
  type ModelsSnapshot,
  type TranscriptionModelsSnapshot,
} from '@offgrid/application';
import { DownloadItem, formatBytes } from './items';
import { useTranscriptionModelsProjection } from '../../hooks/useTranscriptionModelsProjection';
import { removeTranscriptionModel } from '../../services/transcriptionModelApplication';
import logger from '../../utils/logger';
import { applicationFacade } from '../../services/applicationFacade';
import { useModelDownloadsProjection } from '../../hooks/useModelDownloadsProjection';

async function loadItems(
  transcription: TranscriptionModelsSnapshot,
  downloads: ModelsSnapshot['downloads'],
): Promise<DownloadItem[]> {
  const items: DownloadItem[] = [];

  for (const row of transcription.models) {
    if (row.installed) {
      const fileSize = row.catalog.size * 1024 * 1024;
      items.push({
        type: 'completed', modelType: 'stt', modelId: row.catalog.id,
        fileName: row.catalog.name, author: 'Transcription', quantization: '', fileSize,
        bytesDownloaded: fileSize, progress: 1, status: 'completed', name: row.catalog.name,
      });
    }
  }

  try {
    // The same facade projection drives this manager and the Voice Models panel.
    const tts = downloads.filter(d => d.modelType === 'tts');
    for (const d of tts) {
      const engineId = d.modelId;
      if (d.status === 'completed') {
        items.push({
          type: 'completed', modelType: 'tts', modelId: engineId, fileName: d.fileName,
          author: 'Voice', quantization: '', fileSize: d.totalBytes,
          bytesDownloaded: d.totalBytes, progress: 1, status: 'completed', name: d.fileName,
          downloadId: d.downloadId,
        });
      }
    }
  } catch (error) {
    logger.error('[Downloads] Voice model inventory failed', error);
    throw error;
  }

  return items;
}

async function deleteItem(item: DownloadItem): Promise<void> {
  if (item.modelType === 'stt') {
    const outcome = await removeTranscriptionModel(item.modelId);
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  } else {
    const models = applicationFacade().models;
    const outcome = await models.remove(item.modelId);
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    if (item.downloadId) {
      const cleared = await models.removeDownload({ downloadId: item.downloadId });
      if (!cleared.ok) throw new Error(modelsFailureMessage(cleared.failure));
    }
  }
}

export interface VoiceDownloadItems {
  voiceItems: DownloadItem[];
  refreshVoiceItems: () => Promise<void>;
  /** Build the confirm-delete alert for a tts/stt item; deletes + refreshes on confirm. */
  buildDeleteAlert: (item: DownloadItem) => AlertState;
}

export function useVoiceDownloadItems(onAlertClose: () => void): VoiceDownloadItems {
  const [voiceItems, setVoiceItems] = useState<DownloadItem[]>([]);
  const transcription = useTranscriptionModelsProjection();
  const downloads = useModelDownloadsProjection();

  const refreshVoiceItems = useCallback(async () => {
    setVoiceItems(await loadItems(transcription, downloads));
  }, [downloads, transcription]);

  useEffect(() => {
    refreshVoiceItems().catch(error => {
      logger.error('[Downloads] Voice inventory refresh failed', error);
    });
  }, [refreshVoiceItems]);

  const buildDeleteAlert = useCallback((item: DownloadItem): AlertState => {
    const kind = item.modelType === 'tts' ? 'Voice' : 'Transcription';
    return showAlert(
      `Delete ${kind} Model`,
      `Are you sure you want to delete "${item.fileName}"? This will free up ${formatBytes(item.fileSize)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: () => {
            onAlertClose();
            deleteItem(item)
              .then(refreshVoiceItems)
              .catch(error => logger.error('[Downloads] Model delete failed', error));
          },
        },
      ],
    );
  }, [onAlertClose, refreshVoiceItems]);

  return { voiceItems, refreshVoiceItems, buildDeleteAlert };
}
