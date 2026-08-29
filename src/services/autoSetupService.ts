import { startModelDownload } from './startModelDownload';
import { startImageModelDownload } from './imageModelDownloadOwner';
import { useAppStore } from '../stores';
import { useWhisperStore } from '../stores/whisperStore';
import { uniformDownloadId } from './modelDownloadService/uniformId';
import type { AutoSetupPlan } from './autoSetupPlan';

export interface AutoSetupDownloadBoundaries {
  startText: typeof startModelDownload;
  startImage: typeof startImageModelDownload;
  startSpeech: (modelId: string) => Promise<unknown>;
}

const productionDownloadBoundaries: AutoSetupDownloadBoundaries = {
  startText: startModelDownload,
  startImage: startImageModelDownload,
  startSpeech: modelId => useWhisperStore.getState().downloadModel(modelId),
};

/** The only Auto Setup side-effect owner. Existing domain download owners keep all download state. */
export async function startAutoSetupPlan(
  plan: AutoSetupPlan,
  completedIds: ReadonlySet<string> = new Set(),
  boundaries: AutoSetupDownloadBoundaries = productionDownloadBoundaries,
): Promise<void> {
  const [text, image, stt] = plan.items;
  const app = useAppStore.getState();
  const starts: Promise<unknown>[] = [];
  if (!completedIds.has(uniformDownloadId('text', text.id))) starts.push(boundaries.startText(text.payload.modelId, text.payload.file));
  if (!completedIds.has(uniformDownloadId('image', image.id))) starts.push(boundaries.startImage(image.payload, {
      addDownloadedImageModel: app.addDownloadedImageModel,
      activeImageModelId: app.activeImageModelId,
      setActiveImageModelId: app.setActiveImageModelId,
      setAlertState: () => undefined,
      triedImageGen: app.onboardingChecklist.triedImageGen,
    }));
  if (!completedIds.has(uniformDownloadId('stt', stt.id))) starts.push(boundaries.startSpeech(stt.payload.modelId));
  await Promise.all(starts);
}

/** Activate the finished text+vision model through the existing app-store owner. */
export function completeAutoSetupPlan(plan: AutoSetupPlan): void {
  useAppStore.getState().setActiveModelId(plan.items[0].id);
}
