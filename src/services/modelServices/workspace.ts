import {
  DERIVED_TEXT_MODALITIES,
  type DerivedTextModality,
  createModelWorkspace,
  type RemoteServerApplicationPorts,
} from '@offgrid/models';
import { generateId } from '../../utils/generateId';
import { mobileModelSelectionStore } from './selectionStore';
import { mobileConversationPort, mobileToolExecutor } from './toolExecutorPorts';
import { mobileModelLifecyclePorts } from './modelLifecyclePorts';
import { mobileModelMemoryAdvisoryPorts } from './modelMemoryAdvisoryPorts';
import { mobileExecutionAdapterId } from './mobileRoute';
import { Platform } from 'react-native';
import { hardwareService } from '../hardware';
import { remoteTextTransportRegistry } from '../adapters/providers/registry';
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { classifierExecutionAdapter } from '../adapters/native/classifierExecutionAdapter';
import logger from '../../utils/logger';

// Remote-server I/O reaches transports and stores that in turn reach this composition, so it is
// resolved at call time as well. Every member delegates; nothing is decided here.
type RemotePorts = Omit<RemoteServerApplicationPorts, 'select'>;
function remotePorts(): RemotePorts {
  return (require('./remoteServerApplication') as typeof import('./remoteServerApplication'))
    .mobileRemoteServerPorts;
}
const lazyRemote: RemotePorts = {
  configuration: {
    read: () => remotePorts().configuration.read(),
    write: value => remotePorts().configuration.write(value),
  },
  credentials: {
    read: id => remotePorts().credentials.read(id),
    write: (id, value) => remotePorts().credentials.write(id, value),
    remove: id => remotePorts().credentials.remove(id),
  },
  providers: {
    register: (server, credential) => remotePorts().providers.register(server, credential),
    update: (server, credential) =>
      remotePorts().providers.update?.(server, credential) ??
      remotePorts().providers.register(server, credential),
    unregister: id => remotePorts().providers.unregister(id),
  },
  clearSelections: id => remotePorts().clearSelections(id),
  discover: (server, credential) => {
    const discover = remotePorts().discover;
    if (!discover) throw new Error('Remote discovery is not available.');
    return discover(server, credential);
  },
  projectDiscovery: (id, result) => remotePorts().projectDiscovery?.(id, result),
  test: (server, credential) => {
    const test = remotePorts().test;
    if (!test) throw new Error('Remote health checks are not available.');
    return test(server, credential);
  },
  scan: (onFound, onProgress) => {
    const scan = remotePorts().scan;
    if (!scan) throw new Error('LAN scan is not available.');
    return scan(onFound, onProgress);
  },
  activateManaged: (...args) => {
    const activate = remotePorts().activateManaged;
    if (!activate) throw new Error('Managed activation is not available.');
    return activate(...args);
  },
};

// Remote reachability, from the transport registry and server health.
function remoteStatus(serverId: string): { ready: boolean; error?: string } {
  const unhealthy = useRemoteServerStore.getState().serverHealth[serverId]?.status === 'unhealthy';
  return {
    ready: !!remoteTextTransportRegistry.get(serverId),
    ...(unhealthy ? { error: 'Remote server is unavailable' } : {}),
  };
}

// Device memory as the residency manager's memory source.
const memory = {
  current: () => ({
    totalMB: hardwareService.getTotalMemoryGB() * 1024,
    availableMB: hardwareService.getAvailableMemoryGB() * 1024,
    platform: Platform.OS,
  }),
  refresh: async () => {
    await hardwareService.refreshMemoryInfo();
    return {
      totalMB: hardwareService.getTotalMemoryGB() * 1024,
      availableMB: hardwareService.getAvailableMemoryGB() * 1024,
      platform: Platform.OS,
    };
  },
};

/** The ONE shared facade Mobile composes its model layer from. Everything here is a port. */
export const mobileWorkspace = createModelWorkspace({
  selection: mobileModelSelectionStore,
  memory,
  residencyLogger: {
    debug: (message, details) => logger.log(`[ModelResidency] ${message}`, details),
    warn: (message, details) => logger.warn(`[ModelResidency] ${message}`, details),
  },
  generation: { tools: mobileToolExecutor, conversations: mobileConversationPort },
  remote: lazyRemote,
  remoteServerId: generateId,
  // Ports for the services the facade composes on demand. The lifecycle ports are handed the two
  // residency reads they need at that moment: the workspace OWNS the residency manager, so this is
  // where those reads legitimately come from, and it is why the ports no longer import the
  // bootstrap alias back out of this module.
  lifecycle: () => mobileModelLifecyclePorts(mobileWorkspace.residency),
  memoryAdvisory: mobileModelMemoryAdvisoryPorts,
  classifier: () => classifierExecutionAdapter,
  remoteInventory: {
    // Mobile has no remote executor for the derived text routes yet; shared skips a route whose
    // executor is null.
    adapterId: (modality, server) =>
      DERIVED_TEXT_MODALITIES.includes(modality as DerivedTextModality)
        ? null
        : mobileExecutionAdapterId('remote', server.id, modality),
    status: server => remoteStatus(server.id),
  },
});

/** Remote-server application, owned by the workspace. */
