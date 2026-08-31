import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { initCompanionTaskMesh } from '@offgrid/pro/mcp/companionTaskMesh';
import { useSyncStore } from '@offgrid/pro/sync/syncStore';
import { useRemoteServerStore } from '@offgrid/core/stores';
import { useTaskRunStore } from '@offgrid/pro/tasks/taskRunStore';

const mockMeshListeners: Array<(deviceId: string, channel: string, data: unknown) => void> = [];
const mockMeshSendApp = jest.fn();

jest.mock('@offgrid/pro/sync/syncService', () => ({
  syncService: {
    onAppMessage: (listener: (deviceId: string, channel: string, data: unknown) => void) => {
      mockMeshListeners.push(listener);
      return () => {
        const index = mockMeshListeners.indexOf(listener);
        if (index >= 0) mockMeshListeners.splice(index, 1);
      };
    },
    sendApp: (...args: unknown[]) => mockMeshSendApp(...args),
  },
}));

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

  beforeEach(() => {
    useSyncStore.getState().reset();
    useRemoteServerStore.getState().setActiveRemoteTextModelId(null);
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
    mockMeshSendApp.mockReset().mockImplementation((deviceId, channel, data) => {
      if (channel !== 'companion-task-call') return true;
      const request = data as { requestId: string };
      queueMicrotask(() => {
        for (const listener of mockMeshListeners) {
          listener(deviceId, 'companion-task-result', {
            version: 1,
            requestId: request.requestId,
            ok: true,
            content: 'task started',
            durationMs: 5,
          });
        }
        const origin = (data as any).origin;
        useTaskRunStore.getState().applySynced({
          version: 1,
          taskId: 'desktop-task-1',
          launchId: origin.launchId,
          requestingDeviceId: origin.deviceId,
          conversationId: origin.conversationId,
          kind: 'computer_use',
          executionDevice: { id: deviceId, name: 'Studio Mac' },
          title: 'Open the project plan.',
          status: 'done',
          progress: [],
          startedAt: 1,
          updatedAt: 2,
          finishedAt: 2,
          summary: 'The project plan is open.',
        });
      });
      return true;
    });
    stopMesh = initCompanionTaskMesh();
  });

  afterEach(() => {
    stopMesh?.();
    useMcpStore.getState().removeServer('office-tools');
    useMcpStore.getState().removeServer('studio-tools');
    useSyncStore.getState().reset();
  });

  it('keeps Desktop selection visible to the model and sends its canonical ID', async () => {
    const schema = McpToolExtension.getOpenAISchemas!() as Array<any>;
    expect(schema).toHaveLength(1);
    expect(schema[0].function.name).toBe('computer_use');
    expect(schema[0].function.parameters.properties).toHaveProperty(
      'execution_device',
    );
    expect(schema[0].function.parameters.properties).not.toHaveProperty(
      'notes',
    );

    const result = await McpToolExtension.execute({
      id: 'task-call-1',
      name: 'computer_use',
      arguments: {
        goal: 'Open the project plan.',
        execution_device: 'studio alias',
      },
      context: { conversationId: 'chat-mobile-1' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe(
      'The project plan is open.\n\nTask reference: desktop-task-1.',
    );
    expect(mockMeshSendApp).toHaveBeenCalledTimes(1);
    expect(mockMeshSendApp).toHaveBeenCalledWith(
      'desktop-studio',
      'companion-task-call',
      expect.objectContaining({
        version: 1,
        requestId: expect.any(String),
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
    );
  });
});
