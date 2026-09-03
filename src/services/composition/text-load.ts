// Composition root: shared text-load admission, native load ladder, and load-policy projection
// over Mobile's filesystem, llama.rn, and residency ports.
import type { LlamaContext } from 'llama.rn';
import {
  LoadPolicyTransitionCoordinator,
  MobileNativeLoadService,
  MobileTextLoadAdmissionService,
} from '@offgrid/models';
import { mobileTextLoadAdmissionPorts } from '../llmAdmissionPorts';
import { mobileNativeLoadPorts } from '../llmHelpers';
import { mobileLoadPolicyPorts } from '../loadPolicySync';
import { once } from './once';

export const textLoadAdmission = once(
  () => new MobileTextLoadAdmissionService(mobileTextLoadAdmissionPorts()),
);
export const nativeTextLoad = once(
  () => new MobileNativeLoadService<LlamaContext>(mobileNativeLoadPorts()),
);
/** One coordinator per load-policy projection lifetime. */
export function loadPolicyTransition(): LoadPolicyTransitionCoordinator {
  return new LoadPolicyTransitionCoordinator(mobileLoadPolicyPorts());
}
