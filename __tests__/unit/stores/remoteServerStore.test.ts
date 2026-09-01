import { migrateRemoteServerState, useRemoteServerStore } from '../../../src/stores/remoteServerStore';

describe('remoteServerStore persistence adapter', () => {
  beforeEach(() => {
    useRemoteServerStore.setState({
      servers: [],
      activeServerId: null,
      discoveredModels: {},
      serverHealth: {},
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
      activeRemoteMediaServerIds: {},
      isLoading: false,
      testingServerId: null,
      discoveringServerId: null,
    });
  });

  it('migrates legacy public records without credentials', () => {
    const migrated = migrateRemoteServerState({
      servers: [{
        id: 'server-1', name: 'Desktop', endpoint: 'http://desktop.local:7878',
        provider: 'openai-compatible', model: 'gemma', apiKey: 'must-not-persist',
      }],
      activeServerId: 'server-1',
    });
    expect(migrated.servers).toHaveLength(1);
    expect(migrated.servers?.[0]).not.toHaveProperty('apiKey');
    expect(migrated.servers?.[0].selections).toEqual({ text: 'gemma' });
  });

  it('projects discovered inventory without changing server configuration', () => {
    useRemoteServerStore.setState({
      servers: [{
        id: 'server-1', name: 'Desktop', endpoint: 'http://desktop.local:7878',
        provider: 'openai-compatible', createdAt: '2026-01-01T00:00:00.000Z',
      }],
    });
    useRemoteServerStore.getState().setDiscoveredModels('server-1', [{
      id: 'gemma', name: 'Gemma', serverId: 'server-1', lastUpdated: 'now',
      capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: false },
    }]);
    expect(useRemoteServerStore.getState().discoveredModels['server-1']?.[0].id).toBe('gemma');
    expect(useRemoteServerStore.getState().servers[0].selections).toBeUndefined();
  });

  it('projects health and selectors without network or selection policy', () => {
    useRemoteServerStore.setState({
      servers: [{
        id: 'server-1', name: 'Desktop', endpoint: 'http://desktop.local:7878',
        provider: 'openai-compatible', createdAt: '2026-01-01T00:00:00.000Z',
      }],
    });
    useRemoteServerStore.getState().updateServerHealth('server-1', true);
    expect(useRemoteServerStore.getState().serverHealth['server-1']?.status).toBe('healthy');
    expect(useRemoteServerStore.getState().getServerById('server-1')?.name).toBe('Desktop');
  });
});
