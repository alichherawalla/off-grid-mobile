import type { ActiveModelSnapshot } from '@offgrid/models';
import { applicationFacade } from '../applicationFacade';
import { lifecycleProjectionPort } from './lifecycleProjectionPort';
import { mobileRouteId, type MobileRouteFacts } from './mobileRoute';

/**
 * The route-selection commands, kept OUT of the `modelServices` barrel so a port or an adapter
 * can issue one without depending on the composition that the barrel performs. Every command is
 * an `@offgrid/application` call plus the registered inventory projection - no local policy.
 */

function requireSelected(
  outcome: Awaited<ReturnType<ReturnType<typeof applicationFacade>['models']['select']>>,
): void {
  if (outcome.ok) return;
  throw new Error(
    outcome.failure.kind === 'runtime'
      ? outcome.failure.message
      : outcome.failure.kind,
  );
}

/** The user picked a model. The application facade owns remote activation and route selection. */
export async function selectMobileModel(facts: MobileRouteFacts): Promise<void> {
  requireSelected(
    await applicationFacade().models.select({
      modality: facts.modality,
      modelId: mobileRouteId(facts),
    }),
  );
  await lifecycleProjectionPort.refreshInventory();
}

/** Convenience intent for UI surfaces that select a discovered remote route. */
export function selectRemoteMobileModel(
  serverId: string,
  modality: MobileRouteFacts['modality'],
  modelId: string,
): Promise<void> {
  return selectMobileModel({ source: 'remote', hostId: serverId, modality, modelId });
}

export async function clearMobileModel(
  modality: ActiveModelSnapshot['modality'],
): Promise<void> {
  requireSelected(
    await applicationFacade().models.select({ modality, modelId: null }),
  );
  await lifecycleProjectionPort.refreshInventory();
}
