import { startModelDownload } from './startModelDownload';
import { startImageModelDownload } from './imageModelDownloadOwner';
import { modelDownloadService } from './modelDownloadService';
import type { ModelDownload } from './modelDownloadService/types';
import { useAppStore } from '../stores';
import { useWhisperStore } from '../stores/whisperStore';
import { uniformDownloadId } from './modelDownloadService/uniformId';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupCatalogBoundaries,
} from './autoSetupCatalog';
import {
  selectAutoSetupPlans,
  type AutoSetupPlan,
  type AutoSetupTier,
} from './autoSetupPlan';

export interface AutoSetupDownloadBoundaries {
  startText: typeof startModelDownload;
  startImage: typeof startImageModelDownload;
  startSpeech: (modelId: string) => Promise<unknown>;
  list: () => Promise<ModelDownload[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

const productionDownloadBoundaries: AutoSetupDownloadBoundaries = {
  startText: startModelDownload,
  startImage: startImageModelDownload,
  startSpeech: modelId => useWhisperStore.getState().downloadModel(modelId),
  list: () => modelDownloadService.list(),
  cancel: id => modelDownloadService.cancel(id),
  subscribe: listener => modelDownloadService.subscribe(listener),
};

export type AutoSetupItemPhase =
  | 'waiting'
  | 'starting'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AutoSetupItemOutcome {
  id: string;
  phase: AutoSetupItemPhase;
  progress: number;
  error?: string;
}

export interface AutoSetupSnapshot {
  phase: 'loading_catalog' | 'ready' | 'downloading' | 'completed' | 'failed';
  plans: AutoSetupPlan[];
  selectedTier: AutoSetupTier;
  outcomes: Record<string, AutoSetupItemOutcome>;
  error: string | null;
}

export interface AutoSetupSession {
  snapshot(): AutoSetupSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  selectTier(tier: AutoSetupTier): void;
  start(): Promise<void>;
  complete(): void;
  dispose(): void;
}

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  catalogDeadlineMs?: number;
}

const DEFAULT_CATALOG_DEADLINE_MS = 15_000;
const TIER_POLICY = {
  lean: 'conservative',
  balanced: 'balanced',
  extreme: 'aggressive',
} as const;

function tierFromPersistedIntent(): AutoSetupTier {
  const mode = useAppStore.getState().settings.modelLoadingMode;
  if (mode === 'conservative') return 'lean';
  if (mode === 'aggressive') return 'extreme';
  return 'balanced';
}

function persistTierIntent(tier: AutoSetupTier): void {
  useAppStore
    .getState()
    .updateSettings({ modelLoadingMode: TIER_POLICY[tier] });
}

export function autoSetupDownloadId(
  item: AutoSetupPlan['items'][number],
): string {
  return uniformDownloadId(item.kind, item.id);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialOutcomes(
  plan: AutoSetupPlan,
): Record<string, AutoSetupItemOutcome> {
  return Object.fromEntries(
    plan.items.map(item => {
      const id = autoSetupDownloadId(item);
      return [id, { id, phase: 'waiting', progress: 0 }];
    }),
  );
}

/** One owner for the complete Auto Setup lifecycle. The screen only renders this projection. */
export function createAutoSetupSession(
  boundaries: AutoSetupSessionBoundaries = {},
): AutoSetupSession {
  const downloads = boundaries.downloads ?? productionDownloadBoundaries;
  const listeners = new Set<() => void>();
  const activeIds = new Set<string>();
  let disposed = false;
  let operation = 0;
  let refreshInFlight = false;
  let state: AutoSetupSnapshot = {
    phase: 'loading_catalog',
    plans: [],
    selectedTier: tierFromPersistedIntent(),
    outcomes: {},
    error: null,
  };

  const publish = (patch: Partial<AutoSetupSnapshot>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };

  const selectedPlan = (): AutoSetupPlan | undefined =>
    state.plans.find(plan => plan.tier === state.selectedTier) ??
    state.plans[0];

  const stopActive = async (cancelled: boolean): Promise<void> => {
    const ids = [...activeIds];
    activeIds.clear();
    await Promise.allSettled(ids.map(id => downloads.cancel(id)));
    if (cancelled && !disposed) {
      const outcomes = { ...state.outcomes };
      for (const id of ids) {
        const current = outcomes[id];
        if (current && current.phase !== 'completed') {
          outcomes[id] = { ...current, phase: 'cancelled' };
        }
      }
      publish({ outcomes });
    }
  };

  const refreshDownloads = async (): Promise<void> => {
    if (disposed || refreshInFlight || activeIds.size === 0) return;
    refreshInFlight = true;
    try {
      const listed = await downloads.list();
      if (disposed) return;
      const byId = new Map(listed.map(download => [download.id, download]));
      const outcomes = { ...state.outcomes };
      let failure: AutoSetupItemOutcome | undefined;
      let allCompleted = activeIds.size > 0;
      for (const id of activeIds) {
        const download = byId.get(id);
        const current = outcomes[id] ?? { id, phase: 'starting', progress: 0 };
        if (!download) {
          allCompleted = false;
          outcomes[id] = current;
          continue;
        }
        const phase: AutoSetupItemPhase =
          download.status === 'completed'
            ? 'completed'
            : download.status === 'error'
            ? 'failed'
            : 'downloading';
        outcomes[id] = {
          id,
          phase,
          progress: download.progress,
          ...(download.error ? { error: download.error } : {}),
        };
        if (phase === 'failed') failure = outcomes[id];
        if (phase !== 'completed') allCompleted = false;
      }
      publish({ outcomes });
      if (failure) {
        operation += 1;
        await stopActive(false);
        publish({
          phase: 'failed',
          error: failure.error ?? 'A model download failed. Try again.',
        });
      } else if (allCompleted) {
        activeIds.clear();
        publish({ phase: 'completed', error: null });
      }
    } finally {
      refreshInFlight = false;
    }
  };

  const unsubscribeDownloads = downloads.subscribe(() => {
    refreshDownloads().catch(() => undefined);
  });

  const load = async (): Promise<void> => {
    const token = ++operation;
    publish({ phase: 'loading_catalog', error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const catalog = await Promise.race([
        loadAutoSetupCompatibleCatalog(boundaries.catalog),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('The model catalog did not respond in time.')),
            boundaries.catalogDeadlineMs ?? DEFAULT_CATALOG_DEADLINE_MS,
          );
        }),
      ]);
      if (disposed || token !== operation) return;
      publish({
        phase: 'ready',
        plans: selectAutoSetupPlans(catalog),
        error: null,
      });
    } catch (error) {
      if (disposed || token !== operation) return;
      publish({
        phase: 'failed',
        error: message(error) || 'Auto Setup could not load the model catalog.',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const start = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan || disposed) return;
    const token = ++operation;
    await stopActive(false);
    const existing = await downloads.list();
    if (disposed || token !== operation) return;
    const completedIds = new Set(
      existing
        .filter(download => download.status === 'completed')
        .map(download => download.id),
    );
    const outcomes = initialOutcomes(plan);
    for (const item of plan.items) {
      const id = autoSetupDownloadId(item);
      if (completedIds.has(id))
        outcomes[id] = { id, phase: 'completed', progress: 1 };
      else {
        outcomes[id] = { id, phase: 'starting', progress: 0 };
        activeIds.add(id);
      }
    }
    publish({
      phase: activeIds.size ? 'downloading' : 'completed',
      outcomes,
      error: null,
    });
    if (activeIds.size === 0) return;

    const [text, image, stt] = plan.items;
    const app = useAppStore.getState();
    const jobs = [
      {
        id: autoSetupDownloadId(text),
        run: () => downloads.startText(text.payload.modelId, text.payload.file),
      },
      {
        id: autoSetupDownloadId(image),
        run: () =>
          downloads.startImage(image.payload, {
            addDownloadedImageModel: app.addDownloadedImageModel,
            activeImageModelId: app.activeImageModelId,
            setActiveImageModelId: app.setActiveImageModelId,
            setAlertState: () => undefined,
            triedImageGen: app.onboardingChecklist.triedImageGen,
          }),
      },
      {
        id: autoSetupDownloadId(stt),
        run: () => downloads.startSpeech(stt.payload.modelId),
      },
    ].filter(job => activeIds.has(job.id));
    const starts = await Promise.allSettled(jobs.map(job => job.run()));
    if (disposed || token !== operation) return;
    const failedIndex = starts.findIndex(
      result => result.status === 'rejected',
    );
    if (failedIndex >= 0) {
      const id = jobs[failedIndex].id;
      const failure = starts[failedIndex] as PromiseRejectedResult;
      const next = {
        ...state.outcomes,
        [id]: {
          id,
          phase: 'failed' as const,
          progress: 0,
          error: message(failure.reason),
        },
      };
      await stopActive(false);
      publish({
        phase: 'failed',
        outcomes: next,
        error: message(failure.reason),
      });
      return;
    }
    await refreshDownloads();
  };

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    selectTier(tier) {
      persistTierIntent(tier);
      publish({ selectedTier: tier, outcomes: {}, error: null });
    },
    start,
    complete() {
      const plan = selectedPlan();
      if (plan && state.phase === 'completed') {
        useAppStore.getState().setActiveModelId(plan.items[0].id);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operation += 1;
      unsubscribeDownloads();
      stopActive(false).catch(() => undefined);
      listeners.clear();
    },
  };
}
