import type { ModelFile } from '../types';
import type { ImageModelDescriptor } from '../screens/ModelsScreen/types';

export type AutoSetupTier = 'lean' | 'balanced' | 'extreme';
export type AutoSetupModelKind = 'text' | 'image' | 'stt';

export interface AutoSetupCandidate<T = unknown> {
  id: string;
  name: string;
  kind: AutoSetupModelKind;
  sizeBytes: number;
  fitScore: number;
  payload: T;
}

export interface AutoSetupPlan {
  tier: AutoSetupTier;
  title: string;
  summary: string;
  items: readonly [
    AutoSetupCandidate<{ modelId: string; file: ModelFile }>,
    AutoSetupCandidate<ImageModelDescriptor>,
    AutoSetupCandidate<{ modelId: string }>,
  ];
  totalBytes: number;
}

export interface AutoSetupCompatibleCatalog {
  text: AutoSetupCandidate<{ modelId: string; file: ModelFile }>[];
  image: AutoSetupCandidate<ImageModelDescriptor>[];
  stt: AutoSetupCandidate<{ modelId: string }>[];
}

const PLAN_COPY: Record<AutoSetupTier, Pick<AutoSetupPlan, 'title' | 'summary'>> = {
  lean: { title: 'Lean', summary: 'Small downloads and fast local replies.' },
  balanced: { title: 'Balanced', summary: 'The best balance for this device.' },
  extreme: { title: 'Extreme', summary: 'The largest safe models for this device.' },
};

function choose<T>(tier: AutoSetupTier, candidates: AutoSetupCandidate<T>[]): AutoSetupCandidate<T> | null {
  if (candidates.length === 0) return null;
  if (tier === 'balanced') return [...candidates].sort((a, b) => a.fitScore - b.fitScore)[0];
  const bySize = [...candidates].sort((a, b) => a.sizeBytes - b.sizeBytes);
  return tier === 'lean' ? bySize[0] : bySize[bySize.length - 1];
}

/** Pure plan selector. Its input contains only candidates admitted by existing compatibility owners. */
export function selectAutoSetupPlan(
  tier: AutoSetupTier,
  catalog: AutoSetupCompatibleCatalog,
): AutoSetupPlan | null {
  const text = choose(tier, catalog.text);
  const image = choose(tier, catalog.image);
  const stt = choose(tier, catalog.stt);
  if (!text || !image || !stt) return null;
  const items: AutoSetupPlan['items'] = [text, image, stt];
  return {
    tier,
    ...PLAN_COPY[tier],
    items,
    totalBytes: items.reduce((total, item) => total + item.sizeBytes, 0),
  };
}

export function selectAutoSetupPlans(catalog: AutoSetupCompatibleCatalog): AutoSetupPlan[] {
  return (['lean', 'balanced', 'extreme'] as const)
    .map(tier => selectAutoSetupPlan(tier, catalog))
    .filter((plan): plan is AutoSetupPlan => plan !== null);
}
