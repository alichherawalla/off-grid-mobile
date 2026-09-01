import { Alert } from 'react-native';
import { modelLibrary } from '../../services';
import { showAlert, AlertState } from '../../components/CustomAlert';
import { DownloadedModel } from '../../types';
import { isLiteRTFileName } from '../../utils/modelHelpers';
import { classifyModelImport, isModelProjectorFile } from '@offgrid/models';

export type GgufFileRef = { uri: string; name: string; size: number };

export type GgufImportDeps = {
  setAlertState: (s: AlertState) => void;
  setImportProgress: (p: { fraction: number; fileName: string } | null) => void;
  addDownloadedModel: (model: DownloadedModel) => void;
};

export function isMmProj(name: string): boolean {
  return isModelProjectorFile(name);
}

export function classifyGgufPair(
  file1: GgufFileRef,
  file2: GgufFileRef,
): { mainFile: GgufFileRef; mmProjFile: GgufFileRef } {
  const selection = classifyModelImport({
    artifacts: [
      { uri: file1.uri, name: file1.name, sizeBytes: file1.size },
      { uri: file2.uri, name: file2.name, sizeBytes: file2.size },
    ],
    liteRTAvailable: true,
  });
  if (selection.type !== 'text' || !selection.projector) {
    return { mainFile: file1, mmProjFile: file2 };
  }
  return {
    mainFile: { uri: selection.primary.uri, name: selection.primary.name, size: selection.primary.sizeBytes },
    mmProjFile: { uri: selection.projector.uri, name: selection.projector.name, size: selection.projector.sizeBytes },
  };
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

export async function importGgufFiles(
  files: Array<{ uri: string; name: string | null; size: number | null }>,
  deps: GgufImportDeps,
): Promise<void> {
  const { setAlertState, setImportProgress, addDownloadedModel } = deps;

  const artifacts = files.map(file => ({
    uri: file.uri,
    name: file.name ?? 'unknown',
    sizeBytes: file.size ?? 0,
  }));
  const selection = classifyModelImport({ artifacts, liteRTAvailable: true });
  if (selection.type !== 'text') throw new Error('Invalid text model import');

  if (!selection.projector) {
    const resolvedFileName = selection.primary.name;
    const isLitert = selection.engine === 'litert' || isLiteRTFileName(resolvedFileName);

    let liteRTVision = false;
    if (isLitert) {
      liteRTVision = await new Promise<boolean>(resolve => {
        Alert.alert(
          'Vision Support',
          'Does this model support image/vision input?\n\nEnable this only for multimodal models (e.g. Gemma 3n). Enabling it on a text-only model will cause a load error.',
          [
            { text: 'Text Only', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Vision', style: 'default', onPress: () => resolve(true) },
          ],
          { cancelable: false },
        );
      });
    }

    const model = await modelLibrary.importLocalModel({
      sourceUri: selection.primary.uri,
      fileName: resolvedFileName,
      sourceSize: selection.primary.sizeBytes,
      engine: isLitert ? 'litert' : undefined,
      liteRTVision: isLitert ? liteRTVision : undefined,
      onProgress: p => {
        setImportProgress(p);
      },
    });
    addDownloadedModel(model);
    setAlertState(showAlert('Success', `${model.name} imported successfully!`));
    return;
  }

  const mainFile = selection.primary;
  const mmProjFile = selection.projector;

  const confirmed = await new Promise<boolean>(resolve => {
    Alert.alert(
      'Import Vision Model?',
      `Main model:  ${mainFile.name}\nProjector:    ${mmProjFile.name}\n\nIf these look wrong, cancel and rename your files.`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Import', onPress: () => resolve(true) },
      ],
      { cancelable: false },
    );
  });

  if (!confirmed) {
    return;
  }

  const model = await modelLibrary.importLocalModel({
    sourceUri: mainFile.uri,
    fileName: mainFile.name,
    sourceSize: mainFile.sizeBytes,
    onProgress: p => {
      setImportProgress(p);
    },
    mmProjSourceUri: mmProjFile.uri,
    mmProjFileName: mmProjFile.name,
    mmProjSourceSize: mmProjFile.sizeBytes,
  });
  addDownloadedModel(model);
  setAlertState(showAlert('Success', `${model.name} imported with vision projector!`));
}
