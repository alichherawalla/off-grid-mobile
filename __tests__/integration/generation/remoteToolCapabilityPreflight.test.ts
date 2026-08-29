import { OpenAICompatibleProvider } from '../../../src/services/providers/openAICompatibleProvider';
import { providerRegistry } from '../../../src/services/providers';
import {
  REMOTE_TOOLS_UNAVAILABLE,
  remoteToolCapabilityIssue,
} from '../../../src/services/toolCapabilityPreflight';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';

describe('remote Chat tool capability preflight', () => {
  afterEach(() => {
    useRemoteServerStore.setState({ activeServerId: null });
    providerRegistry.unregisterProvider('no-tools');
    providerRegistry.unregisterProvider('with-tools');
  });

  it('stops a tool turn before selection when the active remote model cannot call tools', () => {
    const provider = new OpenAICompatibleProvider('no-tools', {
      endpoint: 'http://remote.example',
      modelId: 'ui-tars',
    });
    provider.updateCapabilities({ supportsToolCalling: false });
    providerRegistry.registerProvider('no-tools', provider);
    useRemoteServerStore.setState({ activeServerId: 'no-tools' });

    expect(remoteToolCapabilityIssue(2)).toBe(REMOTE_TOOLS_UNAVAILABLE);
  });

  it('allows ordinary chat and a tool turn with a capable remote model', () => {
    const provider = new OpenAICompatibleProvider('with-tools', {
      endpoint: 'http://remote.example',
      modelId: 'planner',
    });
    provider.updateCapabilities({ supportsToolCalling: true });
    providerRegistry.registerProvider('with-tools', provider);
    useRemoteServerStore.setState({ activeServerId: 'with-tools' });

    expect(remoteToolCapabilityIssue(0)).toBeUndefined();
    expect(remoteToolCapabilityIssue(2)).toBeUndefined();
  });
});
