// Composition root: shared remote discovery services over Mobile's HTTP and device ports.
import {
  RemoteCapabilityDiscoveryApplicationService,
  RemoteLanDiscoveryApplicationService,
  RemoteProviderDiscoveryApplicationService,
} from '@offgrid/models';
import { once } from './once';

// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports1 = (): typeof import('../adapters/remote/modelCapabilityDiscovery') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/remote/modelCapabilityDiscovery') as typeof import('../adapters/remote/modelCapabilityDiscovery');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports2 = (): typeof import('../adapters/remote/serverDiscovery') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../adapters/remote/serverDiscovery') as typeof import('../adapters/remote/serverDiscovery');
// Resolved at call time: this module reaches back into the composition, and an eager import
// would form a cycle (jest evaluates modules eagerly; Metro happens to tolerate it).
const ports3 = (): typeof import('../networkDiscovery') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../networkDiscovery') as typeof import('../networkDiscovery');

export const remoteCapabilityDiscovery = once(
  () => new RemoteCapabilityDiscoveryApplicationService(ports1().mobileRemoteCapabilityPorts()),
);
export const remoteProviderDiscovery = once(
  () => new RemoteProviderDiscoveryApplicationService(ports2().mobileRemoteProviderDiscoveryPorts()),
);
export const remoteLanDiscovery = once(
  () => new RemoteLanDiscoveryApplicationService(ports3().mobileLanDiscoveryPorts()),
);
