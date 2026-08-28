import { recommendedModelsForDevice, ramFitScore } from '../utils/recommendedModels';
import { fileExceedsBudget } from './memoryBudget';
import { fetchModelFiles } from '../screens/ModelDownloadHelpers';
import { hardwareService } from './hardware';
import { WHISPER_MODELS } from './whisperModels';
import type { AutoSetupCompatibleCatalog } from './autoSetupPlan';
import { autoSetupImageCatalogProvider } from './autoSetupImageCatalogProvider';

const MB = 1024 * 1024;

/** Resolve the live catalogs, then admit candidates through the existing device-fit owners. */
export async function loadAutoSetupCompatibleCatalog(): Promise<AutoSetupCompatibleCatalog> {
  const ramGB = hardwareService.getTotalMemoryGB();
  const textModels = recommendedModelsForDevice(ramGB).filter(model => model.type === 'vision');
  const files = await fetchModelFiles(textModels);
  const text = textModels.flatMap(model => {
    const file = files[model.id]?.[0];
    if (!file || fileExceedsBudget(file.size, ramGB)) return [];
    return [{
      id: `${model.id}/${file.name}`,
      name: model.name,
      kind: 'text' as const,
      sizeBytes: file.size + (file.mmProjFile?.size ?? 0),
      fitScore: ramFitScore(model.minRam, ramGB),
      payload: { modelId: model.id, file },
    }];
  });

  const imageRecommendation = await hardwareService.getImageModelRecommendation();
  const imageModels = await autoSetupImageCatalogProvider.load();
  const compatibleImages = imageModels.filter(model =>
    imageRecommendation.compatibleBackends.includes(model.backend) &&
    (!imageRecommendation.qnnVariant || model.backend !== 'qnn' || model.variant === imageRecommendation.qnnVariant) &&
    !fileExceedsBudget(model.size, ramGB),
  );
  const image = compatibleImages.map((model, index) => ({
    id: model.id,
    name: model.name,
    kind: 'image' as const,
    sizeBytes: model.size,
    fitScore: imageRecommendation.recommendedModels?.some(label => model.name.toLowerCase().includes(label)) ? 0 : index + 1,
    payload: model,
  }));

  const stt = WHISPER_MODELS.filter(model =>
    model.lang === 'multi' && !fileExceedsBudget(model.size * MB, ramGB),
  ).map(model => ({
    id: model.id,
    name: `${model.name} Speech`,
    kind: 'stt' as const,
    sizeBytes: model.size * MB,
    fitScore: Math.abs(model.size - Math.min(809, ramGB * 100)),
    payload: { modelId: model.id },
  }));

  return { text, image, stt };
}
