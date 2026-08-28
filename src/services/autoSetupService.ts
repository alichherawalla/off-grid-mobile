import { startModelDownload } from './startModelDownload';
import { startImageModelDownload } from './imageModelDownloadOwner';
import { useAppStore } from '../stores';
import { useWhisperStore } from '../stores/whisperStore';
import { initialAlertState } from '../components/CustomAlert';
import type { AutoSetupPlan } from './autoSetupPlan';

/** The only Auto Setup side-effect owner. Existing domain download owners keep all download state. */
export async function startAutoSetupPlan(plan: AutoSetupPlan, completedIds: ReadonlySet<string> = new Set()): Promise<void> {
  const [text, image, stt] = plan.items;
  const app = useAppStore.getState();
  const starts: Promise<unknown>[] = [];
  if (!completedIds.has(`text:${text.id}`)) starts.push(startModelDownload(text.payload.modelId, text.payload.file));
  if (!completedIds.has(`image:${image.id}`)) starts.push(startImageModelDownload(image.payload, {
      addDownloadedImageModel: app.addDownloadedImageModel,
      activeImageModelId: app.activeImageModelId,
      setActiveImageModelId: app.setActiveImageModelId,
      setAlertState: () => initialAlertState,
      triedImageGen: app.onboardingChecklist.triedImageGen,
    }));
  if (!completedIds.has(`stt:${stt.id}`)) starts.push(useWhisperStore.getState().downloadModel(stt.payload.modelId));
  await Promise.all(starts);
}

/** Activate the finished text+vision model through the existing app-store owner. */
export function completeAutoSetupPlan(plan: AutoSetupPlan): void {
  useAppStore.getState().setActiveModelId(plan.items[0].id);
}
