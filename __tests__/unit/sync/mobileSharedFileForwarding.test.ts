import {
  canForwardReplicatedSharedFile,
  connectedRepairPeerIds,
} from '../../../pro/sync/mobileSharedFileForwarding';
import type { MobileSharedFileRecord } from '../../../pro/sync/sharedFileStore';

const SYNC_ID = '11111111-1111-4111-8111-111111111111';
const REQUESTER = 'the-iphone';

const replicatedRecord = (): MobileSharedFileRecord => ({
  syncId: SYNC_ID,
  kind: 'download',
  name: 'field-notes.pdf',
  mimeType: 'application/pdf',
  fileSize: 2048,
  contentHash: 'a'.repeat(64),
  createdAt: '2026-08-30T12:00:00.000Z',
  localPath: '/documents/shared/field-notes.pdf',
  provenance: {
    originDeviceId: 'the-mac',
    originDeviceName: 'Off Grid Desktop',
  },
});

describe('Mobile whole-item forwarding', () => {
  it('asks the current mesh once and prefers the peer that supplied the missing item', () => {
    expect(
      connectedRepairPeerIds('the-mac', [
        REQUESTER,
        'the-mac',
        REQUESTER,
        'android-tablet',
      ]),
    ).toEqual(['the-mac', REQUESTER, 'android-tablet']);

    expect(
      connectedRepairPeerIds('offline-source', [REQUESTER, 'android-tablet']),
    ).toEqual([REQUESTER, 'android-tablet']);
  });

  it('offers only a known replicated item with verified complete bytes to a live known peer', () => {
    const record = replicatedRecord();
    expect(
      canForwardReplicatedSharedFile({
        requesterId: REQUESTER,
        record,
        availableSyncIds: new Set([SYNC_ID]),
        connectedDeviceIds: [REQUESTER],
        knownDeviceIds: [REQUESTER],
      }),
    ).toBe(true);

    const common = {
      requesterId: REQUESTER,
      availableSyncIds: new Set([SYNC_ID]),
      connectedDeviceIds: [REQUESTER],
      knownDeviceIds: [REQUESTER],
    };
    expect(
      canForwardReplicatedSharedFile({
        ...common,
        record: { ...record, provenance: undefined },
      }),
    ).toBe(false);
    expect(
      canForwardReplicatedSharedFile({
        ...common,
        record: { ...record, contentHash: undefined },
      }),
    ).toBe(false);
    expect(
      canForwardReplicatedSharedFile({
        ...common,
        record,
        availableSyncIds: new Set(),
      }),
    ).toBe(false);
    expect(
      canForwardReplicatedSharedFile({
        ...common,
        record,
        connectedDeviceIds: [],
      }),
    ).toBe(false);
    expect(
      canForwardReplicatedSharedFile({
        ...common,
        record,
        knownDeviceIds: [],
      }),
    ).toBe(false);
  });
});
