import {
  createMcpToolExtension,
  type McpToolExtensionPorts,
} from '@offgrid/pro/mcp/McpToolExtension';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import {
  CompanionTaskRuntime,
  type CompanionTaskTransport,
} from '@offgrid/pro/mcp/companionTaskMesh';
import { useSyncStore } from '@offgrid/pro/sync/syncStore';
import { useTaskRunStore } from '@offgrid/pro/tasks/taskRunStore';
import type { SendCommand, SyncEvent } from '@offgrid/sync';

class MeshBoundary implements CompanionTaskTransport {
  listener: ((event: SyncEvent) => void) | undefined;
  readonly sent: SendCommand[] = [];

  events(listener: (event: SyncEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  async send(command: SendCommand) {
    this.sent.push(command);
    const request = (command.payload as any).payload;
    queueMicrotask(() => {
      this.listener?.({
        type: 'mutation_received',
        fromDeviceId: command.deviceId,
        channel: 'companion-task-result',
        payload: {
          version: 1,
          requestId: request.requestId,
          ok: true,
          content: 'task started',
          durationMs: 5,
        },
      });
      useTaskRunStore.getState().applySynced({
        version: 1,
        taskId: 'desktop-task-1',
        launchId: request.origin.launchId,
        requestingDeviceId: request.origin.deviceId,
        conversationId: request.origin.conversationId,
        kind: 'computer_use',
        executionDevice: { id: command.deviceId, name: 'Studio Mac' },
        title: 'Open the project plan.',
        status: 'done',
        progress: [],
        startedAt: 1,
        updatedAt: 2,
        finishedAt: 2,
        summary: 'The project plan is open.',
      });
    });
    return { ok: true as const, value: undefined };
  }
}

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const computerTask = {
  name: 'computer_use',
  description: `Use the selected Desktop. ${'Route carefully. '.repeat(80)}`,
  inputSchema: {
    type: 'object',
    properties: {
      goal: { type: 'string', description: 'The work to complete.' },
      execution_device: {
        type: 'string',
        description: 'The connected Desktop name or alias.',
      },
      notes: { type: 'string', description: 'Optional details.'.repeat(80) },
    },
    required: ['goal'],
  },
};

function addDesktop(serverId: string, deviceId: string, name: string) {
  const store = useMcpStore.getState();
  store.addServer({
    id: serverId,
    name,
    url: `http://${serverId}/mcp`,
    grantedByDeviceId: deviceId,
  });
  store.setConnectionState(serverId, 'connected');
  store.setServerTools(serverId, [computerTask]);
}

describe('Mobile companion task routing integration', () => {
  let stopMesh: (() => void) | undefined;
  let boundary: MeshBoundary;
  let runtime: CompanionTaskRuntime;
  let extension: ReturnType<typeof createMcpToolExtension>;

  beforeEach(() => {
    useSyncStore.getState().reset();
    addDesktop('office-tools', 'desktop-office', 'Office Mac');
    addDesktop('studio-tools', 'desktop-studio', 'Studio Mac');
    useMcpStore.getState().setEnabledTools(['computer_use']);
    useSyncStore.getState().setThisDevice({
      id: 'phone-1',
      name: 'Ali phone',
      platform: 'ios',
      version: '1',
      host: '',
      port: 0,
    });
    useSyncStore.getState().setKnownDevices([
      {
        id: 'desktop-office',
        name: 'Office Mac',
        platform: 'macos',
        version: '1',
        host: 'office',
        port: 1,
        status: 'connected',
        pairedAt: 1,
        lastSeenAt: 1,
      },
      {
        id: 'desktop-studio',
        name: 'Studio Alias',
        platform: 'macos',
        version: '1',
        host: 'studio',
        port: 1,
        status: 'connected',
        pairedAt: 1,
        lastSeenAt: 1,
      },
    ]);
    useSyncStore
      .getState()
      .setConnectedDeviceIds(['desktop-office', 'desktop-studio']);
    boundary = new MeshBoundary();
    runtime = new CompanionTaskRuntime(boundary, () => 'request-1');
    stopMesh = runtime.start();
    const ports: McpToolExtensionPorts = {
      executeCompanionTask: input => runtime.execute(input),
    };
    extension = createMcpToolExtension(ports);
  });

  afterEach(() => {
    stopMesh?.();
    useMcpStore.getState().removeServer('office-tools');
    useMcpStore.getState().removeServer('studio-tools');
    useTaskRunStore.getState().remove('desktop-task-1');
    useSyncStore.getState().reset();
  });

  it('keeps Desktop selection visible to the model and sends its canonical ID', async () => {
    const schema = extension.getOpenAISchemas!() as Array<any>;
    expect(schema).toHaveLength(1);
    expect(schema[0].function.name).toBe('computer_use');
    expect(schema[0].function.parameters.properties).toHaveProperty(
      'execution_device',
    );
    expect(schema[0].function.parameters.properties).not.toHaveProperty(
      'notes',
    );

    const result = await extension.execute({
      id: 'task-call-1',
      name: 'computer_use',
      arguments: {
        goal: 'Open the project plan.',
        execution_device: 'studio alias',
      },
      context: { conversationId: 'chat-mobile-1' },
    });

    expect(result.error).toBeUndefined();
    expect(result.toolCallId).toBe('task-call-1');
    expect(result.content).toBe(
      'The project plan is open.\n\nTask reference: desktop-task-1.',
    );
    expect(boundary.sent).toEqual([
      expect.objectContaining({
        deviceId: 'desktop-studio',
        payload: expect.objectContaining({
          kind: 'mutation',
          channel: 'companion-task-call',
          payload: expect.objectContaining({
            version: 1,
            requestId: 'request-1',
            name: 'computer_use',
            args: {
              goal: 'Open the project plan.',
              execution_device: 'studio alias',
            },
            origin: {
              conversationId: 'chat-mobile-1',
              launchId: expect.any(String),
              deviceId: 'phone-1',
              deviceName: 'Ali phone',
              executionDeviceId: 'desktop-studio',
            },
          }),
        }),
      }),
    ]);
  });
});
