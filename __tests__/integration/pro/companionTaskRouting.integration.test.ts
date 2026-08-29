import { TASK_ORIGIN_META_KEY } from '@offgrid/sync';
import { McpToolExtension } from '@offgrid/pro/mcp/McpToolExtension';
import type { McpClient } from '@offgrid/pro/mcp/mcpClient';
import {
  _registerClientDirect,
  disconnectServer,
} from '@offgrid/pro/mcp/mcpService';
import { useMcpStore } from '@offgrid/pro/mcp/mcpStore';
import { useSyncStore } from '@offgrid/pro/sync/syncStore';
import { useRemoteServerStore } from '@offgrid/core/stores';

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
  name: 'computer_task',
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
  const calls = {
    office: jest.fn(),
    studio: jest.fn(),
  };

  beforeEach(() => {
    useSyncStore.getState().reset();
    useRemoteServerStore.getState().setActiveRemoteTextModelId(null);
    addDesktop('office-tools', 'desktop-office', 'Office Mac');
    addDesktop('studio-tools', 'desktop-studio', 'Studio Mac');
    useMcpStore.getState().setEnabledTools(['computer_task']);
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
    calls.office.mockReset().mockResolvedValue('wrong Desktop');
    calls.studio.mockReset().mockResolvedValue('task started');
    _registerClientDirect('office-tools', {
      callTool: calls.office,
      close: jest.fn(),
    } as unknown as McpClient);
    _registerClientDirect('studio-tools', {
      callTool: calls.studio,
      close: jest.fn(),
    } as unknown as McpClient);
  });

  afterEach(() => {
    disconnectServer('office-tools');
    disconnectServer('studio-tools');
    useMcpStore.getState().removeServer('office-tools');
    useMcpStore.getState().removeServer('studio-tools');
    useSyncStore.getState().reset();
  });

  it('keeps Desktop selection visible to the model and sends its canonical ID', async () => {
    const schema = McpToolExtension.getOpenAISchemas!() as Array<any>;
    expect(schema).toHaveLength(1);
    expect(schema[0].function.name).toBe('computer_task');
    expect(schema[0].function.parameters.properties).toHaveProperty(
      'execution_device',
    );
    expect(schema[0].function.parameters.properties).not.toHaveProperty(
      'notes',
    );

    const result = await McpToolExtension.execute({
      id: 'task-call-1',
      name: 'computer_task',
      arguments: {
        goal: 'Open the project plan.',
        execution_device: 'studio alias',
      },
      context: { conversationId: 'chat-mobile-1' },
    });

    expect(result.error).toBeUndefined();
    expect(result.content).toBe('task started');
    expect(calls.office).not.toHaveBeenCalled();
    expect(calls.studio).toHaveBeenCalledWith(
      'computer_task',
      {
        goal: 'Open the project plan.',
        execution_device: 'studio alias',
      },
      {
        [TASK_ORIGIN_META_KEY]: {
          conversationId: 'chat-mobile-1',
          launchId: expect.any(String),
          deviceId: 'phone-1',
          deviceName: 'Ali phone',
          executionDeviceId: 'desktop-studio',
        },
      },
    );
  });
});
