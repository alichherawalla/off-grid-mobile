import RNFS from 'react-native-fs';
import type { SharedFileDescriptor } from '@offgrid/sync';
import { useAppStore } from '../../../src/stores/appStore';
import { useChatStore } from '../../../src/stores/chatStore';
import { LocalSharedFileScan } from '../../../pro/sync/localSharedFileScan';
import { createGeneratedImage } from '../../utils/factories';

describe('local shared-file projection repair', () => {
  const syncId = '5579552f-121e-4228-9bb7-b9f9c7541d69';
  const imagePath = '/mock/generated/image.png';
  const generated = createGeneratedImage({
    id: syncId,
    imagePath,
    createdAt: '2026-08-20T05:10:03.888Z',
  });
  const attachment: SharedFileDescriptor = {
    syncId,
    kind: 'message_attachment',
    name: 'image.png',
    mimeType: 'image/jpeg',
    fileSize: 506981,
    createdAt: '2026-08-20T05:10:03.888Z',
    conversationId: 'conversation-1',
    messageId: 'message-1',
    width: 512,
    height: 512,
  };

  beforeEach(() => {
    useAppStore.setState({ generatedImages: [generated] });
    useChatStore.setState({ conversations: [] });
    (RNFS.readDir as jest.Mock).mockResolvedValue([
      {
        name: 'image.png',
        path: imagePath,
        size: 506981,
        isFile: () => true,
        isDirectory: () => false,
      },
    ]);
    (RNFS.hash as jest.Mock).mockResolvedValue('a'.repeat(64));
  });

  afterEach(() => {
    useAppStore.setState({ generatedImages: [] });
    jest.clearAllMocks();
  });

  function scanHost(input: {
    stored?: SharedFileDescriptor;
    durable?: SharedFileDescriptor;
    durableReady?: boolean;
    owns?: boolean;
  }) {
    let stored = input.stored;
    const admit = jest.fn(async (descriptor: SharedFileDescriptor) => {
      stored = descriptor;
    });
    return {
      admit,
      scan: new LocalSharedFileScan({
        stored: () => stored,
        durableReady: () => input.durableReady ?? false,
        durable: () => input.durable,
        owns: () => input.owns ?? true,
        storedRecords: () => (stored ? [stored] : []),
        admit,
        isDeleting: () => false,
        requestDelete: jest.fn(),
      }),
    };
  }

  it('re-admits a generated image when the same id was stored as an attachment', async () => {
    const host = scanHost({ stored: attachment });

    await host.scan.run(false);

    expect(host.admit).toHaveBeenCalledWith(
      expect.objectContaining({
        syncId,
        kind: 'generated_media',
        mimeType: 'image/png',
      }),
      imagePath,
      false,
    );
  });

  it('repairs a stale durable winner even when the local projection is already correct', async () => {
    const first = scanHost({ stored: attachment });
    await first.scan.run(false);
    const current = first.admit.mock.calls[0]?.[0] as SharedFileDescriptor;
    const host = scanHost({
      stored: current,
      durable: attachment,
      durableReady: true,
    });

    await host.scan.run(true);

    expect(host.admit).toHaveBeenCalledWith(
      expect.objectContaining({ syncId, kind: 'generated_media' }),
      imagePath,
      true,
    );
  });

  it('does not publish a peer-owned image back as a local attachment or generated image', async () => {
    const host = scanHost({ stored: attachment, owns: false });

    await host.scan.run(true);

    expect(host.admit).not.toHaveBeenCalled();
  });
});
