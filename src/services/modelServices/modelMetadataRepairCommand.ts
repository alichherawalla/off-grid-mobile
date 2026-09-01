import {
  ModelMetadataRepairCommandService,
  visionMetadataRepairIds,
} from '@offgrid/models';
import type { DownloadedModel, ModelFile } from '../../types';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';

/** Mobile adapter for the Shared metadata-repair transaction. */
export function repairDownloadedVisionMetadata(input: {
  modelId: string
  files: readonly ModelFile[]
  resolveDownloaded(modelId: string, fileName: string): DownloadedModel | undefined
}): Promise<boolean> {
  const command = new ModelMetadataRepairCommandService<string[]>({
    resolve: async () => {
      const ids = visionMetadataRepairIds(input.files.map(file => {
        const model = input.resolveDownloaded(input.modelId, file.name);
        return {
          id: model?.id ?? '',
          engine: model?.engine,
          hasProjector: Boolean(file.mmProjFile),
          visionRecorded: model?.engine === 'llama' ? model.isVisionModel : false,
        };
      }).filter(row => row.id));
      return ids.length > 0 ? ids : null;
    },
    persist: async ids => { await Promise.all(ids.map(id => modelLibrary.markVisionModel(id))); },
    reload: () => undefined,
  });
  return command.execute();
}
