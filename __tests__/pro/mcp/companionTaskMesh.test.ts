import {
  CompanionTaskMesh,
  type CompanionTaskTransport,
} from '../../../pro/mcp/companionTaskMesh';
import { parseTaskCapability } from '../../../pro/mcp/companionTaskMeshLogic';
import type {SendCommand, SyncEvent} from '@offgrid/sync';

const webUse = {
  name: 'web_use',
  description: 'Use the Desktop browser.',
  inputSchema: {
    type: 'object',
    properties: { goal: { type: 'string' } },
    required: ['goal'],
  },
};

class MeshBoundary implements CompanionTaskTransport {
  handler: ((event: SyncEvent) => void) | undefined;
  sent: SendCommand[] = [];

  events(handler: (event: SyncEvent) => void): () => void {
    this.handler = handler;
    return () => {
      this.handler = undefined;
    };
  }

  async send(command: SendCommand) {
    this.sent.push(command);
    return {ok: true as const, value: undefined};
  }
}

const origin = {
  conversationId: 'chat-1',
  launchId: 'launch-1',
  deviceId: 'phone-1',
  deviceName: 'Phone',
  executionDeviceId: 'mac-1',
};

describe('companion task mesh', () => {
  afterEach(() => jest.useRealTimers());

  it('accepts the two mesh task tools from the execution device', () => {
    const capability = parseTaskCapability({
      version: 1,
      executionDevice: { id: 'mac-1', name: 'My Mac' },
      remoteTasksAllowed: true,
      tools: [webUse, { ...webUse, name: 'computer_use' }],
    });
    expect(capability?.tools.map(tool => tool.name)).toEqual([
      'web_use',
      'computer_use',
    ]);
  });

  it('drops foreign tools and rejects malformed capability messages', () => {
    expect(
      parseTaskCapability({
        version: 1,
        executionDevice: { id: 'mac-1', name: 'My Mac' },
        remoteTasksAllowed: true,
        tools: [{ ...webUse, name: 'messages_send' }],
      })?.tools,
    ).toEqual([]);
    expect(parseTaskCapability({ version: 1 })).toBeNull();
  });

  it('clears and rejects pending work when the runtime deactivates', async () => {
    jest.useFakeTimers();
    const boundary = new MeshBoundary();
    const mesh = new CompanionTaskMesh(boundary, () => 'request-1', 30_000);
    const deactivate = mesh.start();
    const result = mesh.execute({
      deviceId: 'mac-1',
      name: 'web_use',
      args: { task: 'Find a flight' },
      origin,
    });

    deactivate();

    await expect(result).rejects.toThrow('stopped before the Desktop replied');
    expect(boundary.handler).toBeUndefined();
    expect(jest.getTimerCount()).toBe(0);
  });
});
