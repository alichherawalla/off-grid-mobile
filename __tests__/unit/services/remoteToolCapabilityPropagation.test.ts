import { setActiveRemoteTextModelImpl } from '../../../src/services/adapters/remote/serverRuntime';
import { OpenAICompatibleTransport } from '../../../src/services/adapters/providers/openAICompatibleProvider';
import { remoteTextTransportRegistry } from '../../../src/services/adapters/providers/registry';
import {
  REMOTE_TOOLS_UNAVAILABLE,
  remoteToolCapabilityIssue,
} from '../../../src/services/toolCapabilityPreflight';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { activeMobileModel, refreshMobileModelServices } from '../../../src/services/modelServices';

describe('selected remote model tool capability', () => {
  beforeEach(() => {
    remoteTextTransportRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  afterEach(() => {
    remoteTextTransportRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  it('propagates an unsupported selected model and blocks the tool loop', async () => {
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'Private Desktop',
      endpoint: 'http://192.168.1.30:7878',
      provider: 'openai-compatible',
    });
    useRemoteServerStore.getState().setDiscoveredModels(serverId, [
      {
        id: 'vision-without-tools',
        name: 'Vision without tools',
        serverId,
        capabilities: {
          supportsVision: true,
          supportsToolCalling: false,
          supportsThinking: false,
        },
        lastUpdated: '2026-08-30T00:00:00.000Z',
      },
    ]);
    const transport = new OpenAICompatibleTransport(serverId, {
      endpoint: 'http://192.168.1.30:7878',
    });
    remoteTextTransportRegistry.register(serverId, transport);

    await setActiveRemoteTextModelImpl(serverId, 'vision-without-tools');
    await refreshMobileModelServices();

    expect(activeMobileModel('text').model?.capabilities.tools).toBe(false);
    expect(remoteToolCapabilityIssue(1)).toBe(REMOTE_TOOLS_UNAVAILABLE);
    expect(remoteToolCapabilityIssue(0)).toBeUndefined();
  });
});
