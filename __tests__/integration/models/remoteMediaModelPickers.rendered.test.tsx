import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import RNFS from 'react-native-fs';
import { RemoteModelOptionsSection } from '../../../src/components/models/RemoteModelOptionsSection';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { remoteServerManager } from '../../../src/services/remoteServerManager';
import { RemoteModelField } from '../../../src/components/RemoteServerEditor/RemoteModelField';
import { TranscriptionModelsTab } from '../../../src/screens/ModelsScreen/TranscriptionModelsTab';
import {
  refreshMobileModelServices,
  selectRemoteMobileModel,
} from '../../../src/services/modelServices';
import { useModelFailureStore } from '../../../src/stores/modelFailureStore';

describe('remote media model pickers', () => {
  beforeEach(async () => {
    await remoteServerManager.clearAllServers();
    useModelFailureStore.getState().clear();
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

  it('shows the remote transcription privacy boundary even when remote choices are hidden', async () => {
    const serverId = await addGateway();
    await refreshMobileModelServices();
    await selectRemoteMobileModel(
      serverId,
      'transcription',
      '/models/whisper-base.bin',
    );

    const ui = render(
      <TranscriptionModelsTab showRemoteModels={false} />,
    );

    await waitFor(() => {
      expect(
        ui.getByText('Whisper Base runs on your active remote server'),
      ).toBeTruthy();
    });
    expect(ui.queryByText(/audio is never sent anywhere/)).toBeNull();
    ui.unmount();
  });

  it('shows a canonical transcription failure when tab disk reconciliation fails', async () => {
    (RNFS.exists as jest.Mock).mockResolvedValueOnce(true);
    (RNFS.readDir as jest.Mock).mockRejectedValueOnce(
      new Error('Model storage is unavailable'),
    );

    const ui = render(<TranscriptionModelsTab showRemoteModels={false} />);

    await waitFor(() => {
      expect(ui.getByTestId('model-failure-stt')).toBeTruthy();
      expect(ui.getByText('Model storage is unavailable')).toBeTruthy();
    });
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

  it('shows the canonical catalog name when Desktop reports an active file alias', () => {
    const ui = render(
      <RemoteModelField
        label="Text model"
        value="Qwen3.5-2B-Q4_K_M.gguf"
        displayValue="Qwen 3.5 2B"
        options={[{
          id: 'unsloth/Qwen3.5-2B-GGUF',
          name: 'Qwen 3.5 2B',
          activeAliases: ['Qwen3.5-2B-Q4_K_M.gguf'],
        }]}
        onChange={jest.fn()}
        placeholder="Model"
        testID="canonical-model"
      />,
    );

    expect(ui.getByText('Qwen 3.5 2B')).toBeTruthy();
    expect(ui.queryByText('Qwen3.5-2B-Q4_K_M.gguf')).toBeNull();
  });
});
