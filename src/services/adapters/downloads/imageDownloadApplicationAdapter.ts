import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import {
  ImageDownloadApplicationService,
  type ImageDownloadApplicationResult,
  type ImageDownloadCommand,
  type ImageDownloadEntryFacts,
} from '@offgrid/models';
import { modelLibrary } from '../../modelServices/bootstrap/modelLibraryBootstrap';
import { coordinatedDownloads } from '../../modelServices/coordinatedDownloadBridge';
import { hardwareService } from '../../hardware';
import { resolveCoreMLModelDir, downloadCoreMLTokenizerFiles } from '../../../utils/coreMLModelUtils';
import { ensureImageExtractionComplete, validateImageModelDir } from '../../../utils/imageModelIntegrity';
import { statFile } from '../../../utils/fileStat';
import { showAlert } from '../../../utils/alertState';
import { getUserFacingDownloadMessage } from '../../../utils/downloadErrors';
import type { ONNXImageModel } from '../../../types';
import type { ImageDownloadDeps } from '../../imageModelDownloadTypes';
import {
  attachImageTransfer,
  beginImageDownload,
  beginImageDownloadProcessing,
  completeImageDownload,
  failImageDownload,
  failImageDownloadRecord,
  isActiveImageDownload,
  removeImageDownloadRecord,
  reportImageDownloadProgress,
} from './imageDownloadWorkflowAdapter';
import { downloadSequentialImageFiles } from './sequentialImageFileAdapter';
import type { DownloadOperationOwner, ImageDownloadPlan } from '@offgrid/models';

async function removeIfPresent(path: string): Promise<void> {
  if (await RNFS.exists(path)) await RNFS.unlink(path).catch(() => undefined);
}

async function validateDirectory(path: string, backend?: string): Promise<boolean> {
  if (!(await RNFS.exists(path))) return false;
  try {
    const entries = await RNFS.readDir(path);
    if (entries.length === 0) return false;
    if (backend === 'mnn' || backend === 'qnn') {
      return (await validateImageModelDir(path, backend)).complete;
    }
    return true;
  } catch {
    return false;
  }
}

async function validateArchive(path: string, expectedBytes: number): Promise<boolean> {
  if (!(await RNFS.exists(path))) return false;
  const actualBytes = (await statFile(path))?.size ?? 0;
  if (actualBytes <= 0) return false;
  if (expectedBytes > 0 && Math.abs(actualBytes - expectedBytes) / expectedBytes > 0.001) return false;
  try {
    return (await RNFS.read(path, 4, 0, 'ascii')).startsWith('PK');
  } catch {
    return true;
  }
}

function archiveTransfer(plan: ImageDownloadPlan, url: string): Promise<{
  transferId: string;
  completed: Promise<void>;
}> {
  return coordinatedDownloads.startDownload({
    url,
    fileName: plan.fileName,
    modelId: plan.modelId,
    modelKey: plan.modelKey,
    modelType: 'image',
    totalBytes: plan.totalBytes,
    metadataJson: plan.metadataJson,
  }).then(info => {
    const completed = new Promise<void>((resolve, reject) => {
      const offComplete = coordinatedDownloads.onComplete(info.downloadId, () => {
        offComplete(); offError(); resolve();
      });
      const offError = coordinatedDownloads.onError(info.downloadId, event => {
        offComplete(); offError(); reject(new Error(event.reason || 'Download failed'));
      });
    });
    return { transferId: info.downloadId, completed };
  });
}

function imageEntry(entry: ImageDownloadEntryFacts): ImageDownloadEntryFacts {
  return entry;
}

/** Mobile composition root. Shared owns every decision; these ports perform device I/O only. */
export function executeMobileImageDownload(
  command: ImageDownloadCommand,
  deps: ImageDownloadDeps,
): Promise<ImageDownloadApplicationResult> {
  const application = new ImageDownloadApplicationService<DownloadOperationOwner>({
    lifecycle: {
      begin: beginImageDownload,
      isActive: isActiveImageDownload,
      signal: owner => owner.signal,
      attach: (owner, id) => attachImageTransfer(owner, id),
      progress: reportImageDownloadProgress,
      processing: beginImageDownloadProcessing,
      complete: completeImageDownload,
      fail: failImageDownload,
      remove: removeImageDownloadRecord,
      failEntry: failImageDownloadRecord,
    },
    storage: {
      imageModelsDirectory: () => modelLibrary.getImageModelsDirectory(),
      exists: path => RNFS.exists(path),
      ensureDirectory: async path => { if (!(await RNFS.exists(path))) await RNFS.mkdir(path); },
      remove: removeIfPresent,
      writeMarker: (path, value = '') => RNFS.writeFile(path, value, 'utf8'),
      validateModelDirectory: validateDirectory,
      validateArchive,
      moveCompletedTransfer: async (id, destination) => {
        await coordinatedDownloads.moveCompletedDownload(id, destination);
      },
      extractArchive: async (archive, destination, input) => {
        await unzip(archive, destination);
        await ensureImageExtractionComplete({
          backend: input.backend as ONNXImageModel['backend'],
          modelDir: destination,
          zipPath: archive,
          modelId: input.modelId,
        });
      },
      resolveModelPath: (directory, backend) =>
        backend === 'coreml' ? resolveCoreMLModelDir(directory) : Promise.resolve(directory),
      prepareRuntimeAssets: async (directory, model) => {
        if (model.backend === 'coreml' && model.repo) {
          await downloadCoreMLTokenizerFiles(directory, model.repo);
        }
      },
    },
    transfers: {
      downloadArtifacts: input => downloadSequentialImageFiles({
        modelId: input.plan.modelId.replace(/^image:/, ''),
        signal: input.signal,
        modelDir: input.modelDirectory,
        files: [...input.plan.artifacts],
        transfers: coordinatedDownloads,
        isCancelled: input.isCancelled,
        onTransferStarted: input.onStarted,
        onProgress: input.onProgress,
      }),
      startArchive: input => archiveTransfer(input.plan, input.url),
      nativeStatus: async id => {
        const rows = await coordinatedDownloads.getActiveDownloads();
        return rows.find(row => row.downloadId === id)?.status;
      },
      cancel: id => coordinatedDownloads.cancelDownload(id),
      resume: id => coordinatedDownloads.retryDownload(id),
      startProgressPolling: () => coordinatedDownloads.startProgressPolling(),
    },
    repository: {
      list: () => modelLibrary.getDownloadedImageModels(),
      register: model => modelLibrary.addDownloadedImageModel(model as ONNXImageModel),
      publish: model => deps.addDownloadedImageModel(model as ONNXImageModel),
    },
    selection: {
      activeModelId: () => deps.activeImageModelId,
      onboardingComplete: () => deps.triedImageGen,
      activate: model => deps.selectActiveImageModel(model as ONNXImageModel),
    },
    deviceFacts: async model => {
      if (model.backend !== 'qnn' || Platform.OS !== 'android') {
        return { platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'other' };
      }
      const facts = await hardwareService.getSoCInfo();
      return { platform: 'android', hasNpu: facts.hasNPU, qnnVariant: facts.qnnVariant };
    },
    now: () => new Date().toISOString(),
    notify: event => {
      if (event.type === 'installed') {
        deps.setAlertState(showAlert('Success', `${event.modelName} downloaded successfully!`));
      } else {
        deps.setAlertState(showAlert('Download Failed', getUserFacingDownloadMessage(event.message)));
      }
    },
  });
  return application.execute(command.type === 'retry' || command.type === 'resume'
    ? { ...command, entry: imageEntry(command.entry) }
    : command);
}
