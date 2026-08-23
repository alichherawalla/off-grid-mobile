import RNFS from 'react-native-fs';
import { MediaAttachment, Message } from '../types';
import logger from '../utils/logger';

/**
 * What the MODEL may be shown, asked in one place.
 *
 * Two questions live here because they are one rule read at two depths. The pure half asks what the
 * attachment DECLARES; the I/O half also asks the filesystem. Six call sites used to filter
 * `type === 'image'` by hand and one caller of three checked existence, so a stale photo reached the
 * runtime through the tool path and llama.rn refused the whole turn with "File does not exist or
 * cannot be opened" - a plain text message failed because of a photo from an earlier turn.
 *
 * A rule about model input has to hold everywhere or it holds nowhere, so it is not restated per
 * caller.
 */

/** Declared state says the model may see this image. Pure: no filesystem, so it is cheap and total. */
function isModelVisibleImage(attachment: MediaAttachment): boolean {
  return attachment.type === 'image' && !attachment.pending && !!attachment.uri;
}

/** The image attachments of one message that the model may see, by declaration alone. */
export function modelImageAttachments(
  attachments: MediaAttachment[] | undefined,
): MediaAttachment[] {
  return (attachments ?? []).filter(isModelVisibleImage);
}

async function attachmentStillAvailable(
  attachment: MediaAttachment,
): Promise<boolean> {
  if (attachment.type !== 'image') return true;
  if (attachment.pending) {
    logger.log(
      `[LLM] skipping an attachment still arriving: ${
        attachment.fileName ?? attachment.id
      }`,
    );
    return false;
  }
  const path = (attachment.uri || '').replace(/^file:\/\//, '');
  const exists =
    path.length > 0 && (await RNFS.exists(path).catch(() => false));
  if (!exists) {
    logger.warn(
      `[LLM] dropping missing image attachment (file gone): ${attachment.uri}`,
    );
  }
  return exists;
}

async function dropMissingImagesFromMessage(
  message: Message,
): Promise<Message> {
  const attachments = message.attachments;
  if (!attachments?.some(attachment => attachment.type === 'image')) {
    return message;
  }
  const availability = await Promise.all(
    attachments.map(attachmentStillAvailable),
  );
  const kept = attachments.filter((_attachment, index) => availability[index]);
  return kept.length === attachments.length
    ? message
    : { ...message, attachments: kept };
}

/**
 * The same messages, minus every image the filesystem cannot back.
 *
 * Separated from the pure check because it asks the disk: an attachment can name a file that existed
 * when it was written and does not now - an app container path goes stale on reinstall, and a picked
 * photo lives in a temporary directory the OS may reclaim.
 */
export async function dropMissingImageAttachments(
  messages: Message[],
): Promise<Message[]> {
  return Promise.all(messages.map(dropMissingImagesFromMessage));
}
