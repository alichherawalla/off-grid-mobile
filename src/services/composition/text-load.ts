// Composition root: shared text-load admission, native load ladder, and load-policy projection
// over Mobile's filesystem, llama.rn, and residency ports.
import type { LlamaContext } from 'llama.rn';
import {
  LoadPolicyTransitionCoordinator,
  MobileNativeLoadService,
  MobileTextLoadAdmissionService,
} from '@offgrid/models';
import { once } from '@offgrid/models';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../llmAdmissionPorts') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../llmAdmissionPorts') as typeof import('../llmAdmissionPorts');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../llmHelpers') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../llmHelpers') as typeof import('../llmHelpers');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../loadPolicySync') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../loadPolicySync') as typeof import('../loadPolicySync');

export const textLoadAdmission = once(
  () => new MobileTextLoadAdmissionService(ports1().mobileTextLoadAdmissionPorts()),
);
export const nativeTextLoad = once(
  () => new MobileNativeLoadService<LlamaContext>(ports2().mobileNativeLoadPorts()),
);
/** One coordinator per load-policy projection lifetime. */
export function loadPolicyTransition(): LoadPolicyTransitionCoordinator {
  return new LoadPolicyTransitionCoordinator(ports3().mobileLoadPolicyPorts());
}
