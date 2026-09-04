import type { ModelLibraryCommandService } from '@offgrid/models';
import { modelLibraryCommands } from '../composition/model-library';
import type { LibraryModality } from './modelLibraryCommandPorts';

const service = (): ModelLibraryCommandService => modelLibraryCommands();

function assertSuccess(result: { success: boolean; error?: string }): void {
  if (!result.success) throw new Error(result.error ?? 'The model operation failed.');
}

/** Mobile adapter for the Shared remove-model transaction. */
export async function removeMobileLibraryModel(
  modality: LibraryModality,
  modelId: string,
): Promise<void> {
  assertSuccess(await service().remove(modality, modelId));
}

/** Mobile adapter for the Shared cancel-and-projection-cleanup transaction. */
export async function cancelMobileLibraryDownload(
  modality: LibraryModality,
  modelId: string,
): Promise<void> {
  assertSuccess(await service().cancel(modality, modelId));
}
