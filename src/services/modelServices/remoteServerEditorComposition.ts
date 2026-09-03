import { activeMobileRoute } from './mobileLLMService';
/** Mobile composition for the port-driven Remote Server Editor use case. */
import { useRemoteServerStore } from '../../stores/remoteServerStore';
import { createRemoteServerEditorApplication } from './remoteServerEditorApplication';
import { remoteServerManager } from './remoteServerController';
import { selectRemoteMobileModel } from './index';

export const remoteServerEditorApplication = createRemoteServerEditorApplication({
  credentials: { read: serverId => remoteServerManager.getApiKey(serverId) },
  servers: {
    add: input => remoteServerManager.addServer(input),
    update: (id, input) => remoteServerManager.updateServer(id, input),
    testCandidate: (endpoint, apiKey) =>
      remoteServerManager.testConnectionByEndpoint(endpoint, apiKey),
    testSaved: serverId => remoteServerManager.testConnection(serverId),
  },
  models: {
    project: (serverId, models) =>
      useRemoteServerStore.getState().setDiscoveredModels(serverId, models),
    select: (serverId, modality, modelId) =>
      selectRemoteMobileModel(serverId, modality, modelId),
  },
  activeServerId: () => activeMobileRoute('text').model?.serverId ?? null,
});
