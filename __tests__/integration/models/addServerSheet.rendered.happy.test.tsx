/**
 * Full-screen remote-server editor through the real form, manager, store, Keychain adapter, and
 * HTTP client. Only the network and navigation hosts are test boundaries.
 */
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RemoteServerEditorScreen } from '../../../src/screens/RemoteServerEditorScreen';
import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';
import {
  gatewayModelList,
  installLanProbe,
  type LanProbeHandle,
} from '../../harness/lanProbe';

const mockRoute: { params?: { serverId?: string } } = {};
const mockGoBack = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: mockGoBack }),
  useRoute: () => mockRoute,
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

const MAC = '192.168.1.30:7878';

describe('full-screen remote server editor', () => {
  let lan: LanProbeHandle;

  beforeEach(() => {
    mockRoute.params = undefined;
    mockGoBack.mockClear();
    useRemoteServerStore.getState().clearAllServers();
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => '192.168.1.10');
    lan = installLanProbe({ [MAC]: { paths: ['/v1/'], body: gatewayModelList } });
  });

  afterEach(() => lan.uninstall());

  it('rejects an invalid address before it creates a server', async () => {
    const ui = render(<RemoteServerEditorScreen />);
    fireEvent.changeText(ui.getByTestId('server-name'), 'Study Mac');
    fireEvent.changeText(ui.getByTestId('server-endpoint'), 'not-a-url');
    fireEvent.press(ui.getByTestId('test-connection'));

    await waitFor(() => expect(ui.getByText('Invalid URL format')).toBeTruthy());
    expect(useRemoteServerStore.getState().servers).toHaveLength(0);
  });

  it('states when media leaves the phone and when it stays on the local network', async () => {
    const ui = render(<RemoteServerEditorScreen />);
    const address = ui.getByTestId('server-endpoint');

    fireEvent.changeText(address, `http://${MAC}`);
    expect(
      ui.getByText('A server on your network keeps requests between your devices.'),
    ).toBeTruthy();

    fireEvent.changeText(address, 'https://api.example.com');
    await waitFor(() =>
      expect(ui.getByText(/prompts, images, and audio leave this phone/)).toBeTruthy(),
    );
    expect(ui.getByText('The key stays in Keychain on this phone.')).toBeTruthy();
  });

  it('saves media model IDs and shows the named server in the list', async () => {
    const editor = render(<RemoteServerEditorScreen />);
    fireEvent.changeText(editor.getByTestId('server-name'), 'Study Mac');
    fireEvent.changeText(editor.getByTestId('server-endpoint'), `http://${MAC}`);
    fireEvent.changeText(editor.getByPlaceholderText('gpt-image-1'), 'flux-schnell');
    fireEvent.changeText(editor.getByPlaceholderText('whisper-1'), 'whisper-large-v3');
    fireEvent.changeText(editor.getByPlaceholderText('gpt-4o-mini-tts'), 'kokoro');
    fireEvent.press(editor.getByTestId('test-connection'));
    await waitFor(() => expect(editor.getByText(/Connected/)).toBeTruthy());
    fireEvent.press(editor.getByTestId('save-server'));

    await waitFor(() => expect(useRemoteServerStore.getState().servers).toHaveLength(1));
    expect(useRemoteServerStore.getState().servers[0]?.mediaModels).toEqual({
      image: 'flux-schnell',
      transcription: 'whisper-large-v3',
      voice: 'kokoro',
    });
    expect(useRemoteServerStore.getState().servers[0]).not.toHaveProperty('apiKey');

    editor.unmount();
    const list = render(<RemoteServersScreen />);
    await waitFor(() => expect(list.getByText('Study Mac')).toBeTruthy());
  });
});
