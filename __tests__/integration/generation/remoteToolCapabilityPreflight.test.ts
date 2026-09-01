import { OpenAICompatibleTransport } from '../../../src/services/adapters/providers/openAICompatibleProvider';
import { remoteTextTransportRegistry } from '../../../src/services/adapters/providers';
import {
  REMOTE_TOOLS_UNAVAILABLE,
  remoteToolCapabilityIssue,
} from '../../../src/services/toolCapabilityPreflight';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { refreshMobileModelServices } from '../../../src/services/modelServices';

describe('remote Chat tool capability preflight', () => {
  afterEach(() => {
    useRemoteServerStore.getState().clearAllServers();
    remoteTextTransportRegistry.clear();
  });

  it('stops a tool turn before selection when the active remote model cannot call tools', async () => {
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'No tools', endpoint: 'http://remote.example', provider: 'openai-compatible',
    });
    useRemoteServerStore.getState().setDiscoveredModels(serverId, [{
      id: 'ui-tars', name: 'UI TARS', serverId,
      capabilities: { supportsVision: true, supportsToolCalling: false, supportsThinking: false },
      lastUpdated: '2026-08-30T00:00:00.000Z',
    }]);
    const transport = new OpenAICompatibleTransport(serverId, {
      endpoint: 'http://remote.example',
    });
    remoteTextTransportRegistry.register(serverId, transport);
    useRemoteServerStore.setState({
      activeServerId: serverId,
      activeRemoteTextModelId: 'ui-tars',
    });
    await refreshMobileModelServices();

    expect(remoteToolCapabilityIssue(2)).toBe(REMOTE_TOOLS_UNAVAILABLE);
  });

  it('allows ordinary chat and a tool turn with a capable remote model', async () => {
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'With tools', endpoint: 'http://remote.example', provider: 'openai-compatible',
    });
    useRemoteServerStore.getState().setDiscoveredModels(serverId, [{
      id: 'planner', name: 'Planner', serverId,
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
      lastUpdated: '2026-08-30T00:00:00.000Z',
    }]);
    const transport = new OpenAICompatibleTransport(serverId, {
      endpoint: 'http://remote.example',
    });
    remoteTextTransportRegistry.register(serverId, transport);
    useRemoteServerStore.setState({
      activeServerId: serverId,
      activeRemoteTextModelId: 'planner',
    });
    await refreshMobileModelServices();

    expect(remoteToolCapabilityIssue(0)).toBeUndefined();
    expect(remoteToolCapabilityIssue(2)).toBeUndefined();
  });
});
