/**
 * Load-policy projection — the SINGLE place the persisted "aggressive model
 * loading" setting is mapped to the residency manager's runtime LoadPolicy.
 *
 * Separation of concerns (MVVM-ish):
 *  - Views (the Settings screen AND the in-chat quick settings) only dispatch an
 *    intent: `updateSettings({ aggressiveModelLoading })`. They never touch the
 *    residency manager or compute a policy themselves — so the two surfaces can't
 *    drift.
 *  - This module PROJECTS that one setting onto the service that owns the runtime
 *    policy (modelResidencyManager). The boolean→policy mapping lives here, once.
 *  - The service (modelResidencyManager) owns the authoritative policy + memory
 *    math; imperative load decisions read it from the service, never from a
 *    reactive store snapshot.
 */
import { useAppStore } from '../stores';
import { mobileResidencyIntents } from './modelServices/residencyIntents';
import type { LoadPolicyTransitionCoordinator } from '@offgrid/models';
import { loadPolicyTransition } from './composition/text-load';

/**
 * Mobile keeps the persisted-settings subscription and native residency ports.
 * Shared owns legacy reconciliation, effective-policy diffing, and ejection policy.
 */
export interface LoadPolicySyncCoordinator {
  start(): void;
  dispose(): void;
}

/** Residency intents as the policy ports. */
export function mobileLoadPolicyPorts(): ConstructorParameters<typeof LoadPolicyTransitionCoordinator>[0] {
  return {
    setPolicy: next => mobileResidencyIntents.setLoadPolicy(next),
    ejectAll: () => mobileResidencyIntents.ejectAll(),
  };
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
