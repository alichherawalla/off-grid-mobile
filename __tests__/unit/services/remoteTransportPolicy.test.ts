import {
  PUBLIC_HTTP_REMOTE_ERROR,
  canReconcileCredentialedEndpoint,
  isCredentialTransportDowngrade,
  remoteAuthorizationHeaders,
  validateRemoteEndpoint,
} from '../../../src/services/remoteTransportPolicy';
import { fetchModelsFromServer } from '../../../src/stores/remoteServerHelpers';

describe('remote transport policy', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it('allows unauthenticated private-LAN HTTP but never sends its bearer credential', () => {
    expect(
      remoteAuthorizationHeaders('http://192.168.1.30:7878', 'secret'),
    ).toEqual({});
    expect(
      remoteAuthorizationHeaders('http://desktop.local:7878', 'secret'),
    ).toEqual({});
    expect(remoteAuthorizationHeaders('http://desktop:7878', 'secret')).toEqual(
      {},
    );
  });

  it('allows bearer credentials only on HTTPS', () => {
    expect(
      remoteAuthorizationHeaders('https://desktop.example.test', 'secret'),
    ).toEqual({
      Authorization: 'Bearer secret',
    });
  });

  it('rejects public cleartext endpoints before a request starts', () => {
    expect(() => validateRemoteEndpoint('http://example.test:7878')).toThrow(
      PUBLIC_HTTP_REMOTE_ERROR,
    );
    expect(() =>
      validateRemoteEndpoint('http://192.168.attacker.example:7878'),
    ).toThrow(PUBLIC_HTTP_REMOTE_ERROR);
    expect(() =>
      validateRemoteEndpoint('http://10.attacker.example:7878'),
    ).toThrow(PUBLIC_HTTP_REMOTE_ERROR);
  });

  it('does not reconcile a credentialed server onto a discovered HTTP endpoint', () => {
    expect(
      canReconcileCredentialedEndpoint('http://192.168.1.31:7878', true),
    ).toBe(false);
    expect(
      canReconcileCredentialedEndpoint('http://192.168.1.31:7878', false),
    ).toBe(true);
    expect(
      canReconcileCredentialedEndpoint('https://desktop.local:7878', true),
    ).toBe(true);
  });

  it('detects an HTTPS-to-HTTP response downgrade only for credentialed requests', () => {
    expect(
      isCredentialTransportDowngrade(
        'https://desktop.example.test/v1/chat',
        'http://192.168.1.30:7878/v1/chat',
        true,
      ),
    ).toBe(true);
    expect(
      isCredentialTransportDowngrade(
        'https://desktop.example.test/v1/chat',
        'http://192.168.1.30:7878/v1/chat',
        false,
      ),
    ).toBe(false);
  });

  it('keeps model discovery on private-LAN HTTP unauthenticated', async () => {
    const calls: Array<RequestInit | undefined> = [];
    global.fetch = jest.fn(async (_url, init) => {
      calls.push(init);
      return {
        ok: true,
        json: async () => ({ object: 'list', data: [] }),
      } as Response;
    }) as typeof fetch;

    await fetchModelsFromServer({
      id: 'desktop',
      name: 'Desktop',
      endpoint: 'http://192.168.1.30:7878',
      providerType: 'openai-compatible',
      apiKey: 'secret',
      createdAt: '2026-08-30',
    });

    expect(calls[0]?.headers).not.toHaveProperty('Authorization');
    expect(calls[0]?.redirect).toBe('error');
  });
});
