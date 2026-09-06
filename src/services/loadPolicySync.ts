/**
 * Load-policy projection — the SINGLE place the persisted "aggressive model
 * loading" setting is mapped to the residency manager's runtime LoadPolicy.
 *
 * Separation of concerns (MVVM-ish):
 *  - Views (the Settings screen AND the in-chat quick settings) only dispatch an
 *    intent: `updateSettings({ aggressiveModelLoading })`. They never touch the
 *    residency manager or compute a policy themselves — so the two surfaces can't
 *    drift.
 *  - This module PROJECTS that one setting onto the application facade, which owns
 *    the runtime policy. The boolean→policy mapping lives in Shared.
 *  - The ports this projection runs on live in `modelServices/loadPolicyPorts`, so
 *    the composition root can construct the coordinator without importing a consumer.
 */
import { useAppStore } from '../stores';
import { loadPolicyTransition } from './composition/text-load';

/**
 * Mobile keeps the persisted-settings subscription. Shared owns legacy reconciliation,
 * effective-policy diffing, and ejection policy.
 */
export interface LoadPolicySyncCoordinator {
  start(): void;
  dispose(): void;
}

/** Create one explicit app-lifetime projection. Repeated start calls are idempotent. */
export function createLoadPolicySync(): LoadPolicySyncCoordinator {
  const policy = loadPolicyTransition();
  let unsubscribe: (() => void) | null = null;
  return {
    start() {
      if (unsubscribe) return;
      policy.apply(useAppStore.getState().settings);
      unsubscribe = useAppStore.subscribe(state => policy.apply(state.settings));
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = null;
      policy.dispose();
    },
  };
}

/** Compatibility entry point for tests and non-React composition roots. */
export function startLoadPolicySync(): () => void {
  const coordinator = createLoadPolicySync();
  coordinator.start();
  return () => coordinator.dispose();
}
