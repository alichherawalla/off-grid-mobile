import type { LLMProvider } from '../../../../src/services/adapters/providers/types';
import { getProviderForServer, providerRegistry } from '../../../../src/services/adapters/providers/registry';

function provider(id: string): LLMProvider {
  return {
    id,
    type: 'openai-compatible',
    capabilities: { supportsVision: false, supportsToolCalling: false, supportsThinking: false },
    async loadModel() {},
    async unloadModel() {},
    isModelLoaded: () => false,
    getLoadedModelId: () => null,
    async generate(_messages, _options, callbacks) { callbacks.onComplete({ content: '' }); },
    async stopGeneration() {},
    async getTokenCount(text) { return text.length; },
    async isReady() { return true; },
  };
}

describe('ProviderRegistry lookup boundary', () => {
  beforeEach(() => providerRegistry.clear());

  it('registers and resolves providers by exact identity', () => {
    const remote = provider('server-1');
    providerRegistry.registerProvider(remote.id, remote);
    expect(providerRegistry.getProvider('server-1')).toBe(remote);
    expect(getProviderForServer('server-1')).toBe(remote);
  });

  it('does not substitute local for an unknown remote identity', () => {
    expect(providerRegistry.getProvider('missing')).toBeUndefined();
    expect(getProviderForServer('missing')).toBeUndefined();
  });

  it('keeps the local transport registered while remote providers change', () => {
    providerRegistry.registerProvider('server-2', provider('server-2'));
    providerRegistry.unregisterProvider('server-2');
    expect(providerRegistry.getProvider('server-2')).toBeUndefined();
    expect(providerRegistry.getProvider('local')?.id).toBe('local');
  });

  it('clears only remote provider lookups', () => {
    providerRegistry.registerProvider('server-3', provider('server-3'));
    providerRegistry.clear();
    expect(providerRegistry.getProviderIds()).toEqual(['local']);
  });
});
