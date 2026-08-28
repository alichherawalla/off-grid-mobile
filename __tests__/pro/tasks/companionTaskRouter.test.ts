import {
  routeCompanionTask,
  type CompanionTaskTool,
} from '../../../pro/tasks/companionTaskRouter';

const tool = (name: CompanionTaskTool) => ({
  name,
  description: name,
  inputSchema: { type: 'object' },
});

function twoDesktopInput(task: CompanionTaskTool) {
  return {
    tool: task,
    servers: [
      {
        id: 'server-z',
        name: 'Studio Mac',
        grantedByDeviceId: 'desktop-b',
      },
      {
        id: 'server-a',
        name: 'Office Mac',
        grantedByDeviceId: 'desktop-a',
      },
    ],
    connectionStates: {
      'server-z': 'connected' as const,
      'server-a': 'connected' as const,
    },
    serverTools: {
      'server-z': [tool(task)],
      'server-a': [tool(task)],
    },
    enabledTools: [task],
    devices: [
      { id: 'desktop-b', name: 'Release Mac', platform: 'macos' as const },
      { id: 'desktop-a', name: 'Desk', platform: 'windows' as const },
    ],
    connectedDeviceIds: ['desktop-b', 'desktop-a'],
  };
}

describe('Release 107 companion task router', () => {
  it.each(['web_use', 'computer_use'] as const)(
    'uses one stable eligible default for %s across two Desktops',
    task => {
      expect(routeCompanionTask(twoDesktopInput(task))).toEqual({
        ok: true,
        serverId: 'server-a',
        deviceId: 'desktop-a',
      });
    },
  );

  it.each(['web_use', 'computer_use'] as const)(
    'matches an explicit %s Desktop name or alias without case sensitivity',
    task => {
      expect(
        routeCompanionTask({
          ...twoDesktopInput(task),
          requestedDevice: 'STUDIO MAC',
        }),
      ).toEqual({
        ok: true,
        serverId: 'server-z',
        deviceId: 'desktop-b',
      });
      expect(
        routeCompanionTask({
          ...twoDesktopInput(task),
          requestedDevice: 'release mac',
        }),
      ).toEqual({
        ok: true,
        serverId: 'server-z',
        deviceId: 'desktop-b',
      });
    },
  );

  it('does not fall back when the named Desktop is offline', () => {
    const input = twoDesktopInput('web_use');
    expect(
      routeCompanionTask({
        ...input,
        requestedDevice: 'Studio Mac',
        connectedDeviceIds: ['desktop-a'],
      }),
    ).toEqual({
      ok: false,
      error:
        'Studio Mac is not available for web_use. Connect it and enable this task tool, then try again.',
    });
  });

  it('does not fall back when the named Desktop has the task tool disabled', () => {
    const input = twoDesktopInput('computer_use');
    expect(
      routeCompanionTask({
        ...input,
        requestedDevice: 'Studio Mac',
        serverTools: { ...input.serverTools, 'server-z': [] },
      }),
    ).toEqual({
      ok: false,
      error:
        'Studio Mac is not available for computer_use. Connect it and enable this task tool, then try again.',
    });
  });
});
