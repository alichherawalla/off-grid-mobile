import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RemoteModelOptionsSection } from '../../../src/components/models/RemoteModelOptionsSection';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { remoteServerManager } from '../../../src/services/remoteServerManager';

describe('remote media model pickers', () => {
  beforeEach(async () => {
    await remoteServerManager.clearAllServers();
  });

  async function addGateway(): Promise<string> {
    return (await remoteServerManager.addServer({
      name: 'Studio Mac',
      endpoint: 'http://192.168.1.50:7878', // NOSONAR - private LAN test fixture
      provider: 'openai-compatible',
      selections: {
        transcription: '/models/whisper-base.bin',
        voice: '/models/kokoro.pte',
      },
      catalog: {
        transcription: [
          { id: '/models/whisper-base.bin', name: 'Whisper Base' },
          { id: '/models/whisper-large-v3.bin', name: 'Whisper Large v3' },
        ],
        voice: [
          { id: '/models/kokoro.pte', name: 'Kokoro' },
          { id: '/models/orpheus.pte', name: 'Orpheus' },
        ],
      },
    })).id;
  }

  it('changes the active transcription model and shows human names', async () => {
    const serverId = await addGateway();
    const ui = render(<RemoteModelOptionsSection category="transcription" />);

    expect(ui.getByText('Whisper Large v3')).toBeTruthy();
    expect(ui.queryByText('/models/whisper-large-v3.bin')).toBeNull();
    fireEvent.press(
      ui.getByTestId(
        `remote-transcription-model-${serverId}:/models/whisper-large-v3.bin`,
      ),
    );

    await waitFor(() =>
      expect(
        useRemoteServerStore.getState().getServerById(serverId)?.selections
          ?.transcription,
      ).toBe('/models/whisper-large-v3.bin'),
    );
    ui.unmount();
  });

  it('changes the active voice model without changing the raw server model ID', async () => {
    const serverId = await addGateway();
    const textServerId = (await remoteServerManager.addServer({
      name: 'Text Mac',
      endpoint: 'http://192.168.1.51:7878', // NOSONAR - private LAN test fixture
      provider: 'openai-compatible',
      selections: { text: 'text-model' },
      catalog: { text: [{ id: 'text-model', name: 'Text Model' }] },
    })).id;
    useRemoteServerStore.getState().setDiscoveredModels(textServerId, [{
      id: 'text-model', name: 'Text Model', serverId: textServerId,
      capabilities: { supportsVision: false, supportsToolCalling: true, supportsThinking: false },
      lastUpdated: new Date(0).toISOString(),
    }]);
    await remoteServerManager.setActiveRemoteTextModel(textServerId, 'text-model');
    const ui = render(<RemoteModelOptionsSection category="voice" />);

    fireEvent.press(
      ui.getByTestId(`remote-voice-model-${serverId}:/models/orpheus.pte`),
    );

    await waitFor(() => {
      const state = useRemoteServerStore.getState();
      expect(state.activeServerId).toBe(textServerId);
      expect(state.activeRemoteMediaServerIds.voice).toBe(serverId);
      expect(state.getServerById(serverId)?.selections?.voice).toBe(
        '/models/orpheus.pte',
      );
    });
    expect(ui.getByText('Orpheus')).toBeTruthy();
    ui.unmount();
  });
});
