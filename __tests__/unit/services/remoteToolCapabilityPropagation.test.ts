import { setActiveRemoteTextModelImpl } from '../../../src/services/remoteServerManagerUtils';
import { OpenAICompatibleProvider } from '../../../src/services/providers/openAICompatibleProvider';
import { providerRegistry } from '../../../src/services/providers/registry';
import {
  REMOTE_TOOLS_UNAVAILABLE,
  remoteToolCapabilityIssue,
} from '../../../src/services/toolCapabilityPreflight';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

describe('selected remote model tool capability', () => {
  beforeEach(() => {
    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  afterEach(() => {
    providerRegistry.clear();
    useRemoteServerStore.getState().clearAllServers();
  });

  it('propagates an unsupported selected model and blocks the tool loop', async () => {
    const serverId = useRemoteServerStore.getState().addServer({
      name: 'Private Desktop',
      endpoint: 'http://192.168.1.30:7878',
      providerType: 'openai-compatible',
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
    const provider = new OpenAICompatibleProvider(serverId, {
      endpoint: 'http://192.168.1.30:7878',
      modelId: '',
    });
    providerRegistry.registerProvider(serverId, provider);

    await setActiveRemoteTextModelImpl(serverId, 'vision-without-tools');

    expect(provider.capabilities.supportsToolCalling).toBe(false);
    expect(remoteToolCapabilityIssue(1)).toBe(REMOTE_TOOLS_UNAVAILABLE);
    expect(remoteToolCapabilityIssue(0)).toBeUndefined();
  });
});
