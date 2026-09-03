// Composition root: shared remote discovery services over Mobile's HTTP and device ports.
import {
  RemoteCapabilityDiscoveryApplicationService,
  RemoteLanDiscoveryApplicationService,
  RemoteProviderDiscoveryApplicationService,
} from '@offgrid/models';
import { mobileRemoteCapabilityPorts } from '../adapters/remote/modelCapabilityDiscovery';
import { mobileRemoteProviderDiscoveryPorts } from '../adapters/remote/serverDiscovery';
import { mobileLanDiscoveryPorts } from '../networkDiscovery';
import { once } from './once';

export const remoteCapabilityDiscovery = once(
  () => new RemoteCapabilityDiscoveryApplicationService(mobileRemoteCapabilityPorts()),
);
export const remoteProviderDiscovery = once(
  () => new RemoteProviderDiscoveryApplicationService(mobileRemoteProviderDiscoveryPorts()),
);
export const remoteLanDiscovery = once(
  () => new RemoteLanDiscoveryApplicationService(mobileLanDiscoveryPorts()),
);
