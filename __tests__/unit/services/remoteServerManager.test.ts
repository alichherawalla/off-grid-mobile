jest.mock('react-native-keychain', () => {
  const values = new Map<string, string>();
  return {
    ACCESSIBLE: { WHEN_UNLOCKED: 'WHEN_UNLOCKED' },
    setGenericPassword: jest.fn(async (_user, password, options) => {
      values.set(options.service, password);
      return true;
    }),
    getGenericPassword: jest.fn(async options => {
      const password = values.get(options.service);
      return password ? { username: 'server', password } : false;
    }),
    resetGenericPassword: jest.fn(async options => {
      values.delete(options.service);
      return true;
    }),
  };
});

import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import {
  startMobileApplicationFixture,
  type MobileApplicationFixture,
} from '../../harness/mobileApplicationFixture';

describe('Mobile remote-server application composition', () => {
  let applicationFixture: MobileApplicationFixture;

  beforeAll(async () => {
    applicationFixture = await startMobileApplicationFixture();
    await useRemoteServerStore.persist.rehydrate();
  });

  afterAll(async () => {
    await applicationFixture.dispose();
  });

  beforeEach(() => {
    useRemoteServerStore.setState({
      servers: [],
      activeServerId: null,
      serverHealth: {},
      activeRemoteTextModelId: null,
      activeRemoteImageModelId: null,
    });
  });

  it('routes add, endpoint deduplication, and update through Shared authority', async () => {
    const first = await remoteServerManager.addServer({
      name: 'Desktop',
      endpoint: 'http://desktop.local:7878',
      provider: 'openai-compatible',
    });
    const duplicate = await remoteServerManager.addServer({
      name: 'Duplicate',
      endpoint: 'http://desktop.local:7878/',
      provider: 'openai-compatible',
    });
    expect(duplicate.id).toBe(first.id);
    expect(remoteServerManager.getServers()).toHaveLength(1);

    await remoteServerManager.updateServer(first.id, { name: 'Studio' });
    expect(remoteServerManager.getServer(first.id)?.name).toBe('Studio');
  });

  it('keeps credentials outside the public Zustand projection', async () => {
    const server = await remoteServerManager.addServer({
      name: 'Cloud',
      endpoint: 'https://models.example.com/v1',
      provider: 'openai-compatible',
      apiKey: 'secret',
    });
    expect(useRemoteServerStore.getState().servers[0]).not.toHaveProperty(
      'apiKey',
    );
    expect(
      await remoteServerManager.getServerWithApiKey(server.id),
    ).toMatchObject({ apiKey: 'secret' });
  });

  it('rejects credentials on an insecure endpoint before persistence', async () => {
    await expect(
      remoteServerManager.addServer({
        name: 'Unsafe',
        endpoint: 'http://models.example.com/v1',
        provider: 'openai-compatible',
        apiKey: 'secret',
      }),
    ).rejects.toThrow(
      'Remote HTTP servers must use a private LAN or Tailscale address.',
    );
    expect(remoteServerManager.getServers()).toEqual([]);
  });
});
