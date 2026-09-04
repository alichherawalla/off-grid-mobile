import type { ResidentSpec } from '@offgrid/models';
import {
  textResidentSpec,
  transcriptionResidentSpec,
} from './modelLifecyclePorts';
import { modelResidencyManager } from './residencyBootstrap';

/**
 * The two resident specs, bound to the LIVE residency manager.
 *
 * `modelLifecyclePorts` takes its residency reads as an argument so the workspace can hand them
 * over when it composes the lifecycle ports; that is what points the dependency the right way and
 * removes the cycle. But several callers outside that composition - the lifecycle bootstrap, and
 * the residency intents behind it - only ever want the spec for the manager the app is actually
 * running, and making each of them reach for the manager would spread the same lookup across the
 * app. This module is the ONE place that binds the port to that instance.
 *
 * It sits BELOW nothing and above the bootstrap on purpose: it depends on the manager, so nothing
 * the workspace composes may depend on it, and nothing here is re-exported back into the
 * composition path.
 */
export function resolveTextResidentSpec(
  modelId: string,
): Promise<ResidentSpec> {
  return textResidentSpec(modelId, modelResidencyManager);
}

export function resolveTranscriptionResidentSpec(
  modelId: string,
): ResidentSpec {
  return transcriptionResidentSpec(modelId, modelResidencyManager);
}
