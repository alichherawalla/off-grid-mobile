import { startModelDownload } from './startModelDownload';
import { whisperService } from './whisperService';
import { handleDownloadImageModel } from '../screens/ModelsScreen/imageDownloadActions';
import { useAppStore } from '../stores';
import { initialAlertState } from '../components/CustomAlert';
import type { AutoSetupPlan } from './autoSetupPlan';

/** The only Auto Setup side-effect owner. Existing domain download owners keep all download state. */
export async function startAutoSetupPlan(plan: AutoSetupPlan): Promise<void> {
  const [text, image, stt] = plan.items;
  const app = useAppStore.getState();
  await Promise.all([
    startModelDownload(text.payload.modelId, text.payload.file),
    handleDownloadImageModel(image.payload, {
      addDownloadedImageModel: app.addDownloadedImageModel,
      activeImageModelId: app.activeImageModelId,
      setActiveImageModelId: app.setActiveImageModelId,
      setAlertState: () => initialAlertState,
      triedImageGen: app.onboardingChecklist.triedImageGen,
    }),
    whisperService.downloadModel(stt.payload.modelId),
  ]);
}
