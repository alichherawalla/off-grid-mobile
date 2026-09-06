import { useChatStore } from '@offgrid/core/stores/chatStore';
import type { Conversation, Message } from '@offgrid/core/types';
import type { SharedFileControl } from '@offgrid/sync';
import type { MobileSharedFileRecord } from '../../../pro/sync/sharedFileStore';
import {
  materializeSharedFile,
  placeholderSharedFile,
} from '../../../pro/sync/sharedFileMaterializer';

/**
 * What a synced attachment IS is decided once, by the shared classifier, for every device.
 *
 * On 16 Aug 2026 a message sent from an iPhone carrying a photo, a screenshot and `mobile.pdf`
 * arrived on the peer as a chip reading "mobile.pdf text" whose preview opened empty; a voice note
 * took the same branch. The rule here was `image, else audio, else document` by MIME prefix alone,
 * which is the app deciding a property of the file for itself. Now the shared `attachmentKindFor`
 * decides - MIME first, then the file name - and this side only projects that kind onto the types
 * the chat renderer draws.
 *
 * Runs the REAL materializer against the REAL chat store; nothing of ours is mocked. The outcome is
 * read where the user meets it: the attachment on the message.
 */
describe('a synced attachment takes its kind from the shared classifier', () => {
  const record = (
    overrides: Partial<MobileSharedFileRecord> = {},
  ): MobileSharedFileRecord =>
    ({
      syncId: 'file-1',
      kind: 'message_attachment',
      name: 'notes.pdf',
      mimeType: 'application/pdf',
      fileSize: 4096,
      createdAt: '2026-08-16T10:00:00.000Z',
      localPath: '/docs/shared_files/notes.pdf',
      conversationId: 'chat-1',
      messageId: 'message-1',
      ...overrides,
    } as MobileSharedFileRecord);

  const message = (): Message => ({
    id: 'row-1',
    uuid: 'message-1',
    role: 'user',
    content: 'here is the file',
    timestamp: 1_700_000_000_000,
  });

  const conversation = (): Conversation => ({
    id: 'chat-1',
    title: 'Files',
    modelId: 'gemma',
    messages: [message()],
    createdAt: '2026-08-16T09:00:00.000Z',
    updatedAt: '2026-08-16T09:30:00.000Z',
  });

  const attachmentsOnMessage = () =>
    useChatStore
      .getState()
      .conversations.find(({ id }) => id === 'chat-1')
      ?.messages.find(({ uuid }) => uuid === 'message-1')?.attachments ?? [];

  beforeEach(() => {
    useChatStore.setState({ conversations: [conversation()] });
  });

  it('a PDF is a document on its message, not text', () => {
    materializeSharedFile(record());

    expect(attachmentsOnMessage()).toEqual([
      expect.objectContaining({
        id: 'file-1',
        type: 'document',
        fileName: 'notes.pdf',
        mimeType: 'application/pdf',
        uri: 'file:///docs/shared_files/notes.pdf',
      }),
    ]);
  });

  it('a voice note is audio on its message', () => {
    materializeSharedFile(
      record({
        syncId: 'file-2',
        name: 'voice note.m4a',
        mimeType: 'audio/mp4',
        localPath: '/docs/shared_files/voice-note.m4a',
        durationSeconds: 12,
      }),
    );

    expect(attachmentsOnMessage()).toEqual([
      expect.objectContaining({
        id: 'file-2',
        type: 'audio',
        fileName: 'voice note.m4a',
        audioDurationSeconds: 12,
      }),
    ]);
  });

  it('a sender that did not know the MIME type is still read by the file name', () => {
    // `application/octet-stream` is what a sender reaches for when it does not know, and it is exactly
    // the case that used to land in text. The extension is on the wire too, so the kind is still known.
    materializeSharedFile(
      record({
        syncId: 'file-3',
        name: 'recording.wav',
        mimeType: 'application/octet-stream',
        localPath: '/docs/shared_files/recording.wav',
      }),
    );

    expect(attachmentsOnMessage()).toEqual([
      expect.objectContaining({ id: 'file-3', type: 'audio' }),
    ]);
  });

  it('the placeholder drawn before the bytes arrive already has the right kind', () => {
    const control: SharedFileControl = {
      syncId: 'file-4',
      kind: 'message_attachment',
      name: 'brief.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
      createdAt: '2026-08-16T10:00:00.000Z',
      conversationId: 'chat-1',
      messageId: 'message-1',
    } as SharedFileControl;

    placeholderSharedFile(control);

    expect(attachmentsOnMessage()).toEqual([
      expect.objectContaining({
        id: 'file-4',
        type: 'document',
        pending: true,
        uri: '',
      }),
    ]);
  });
});
