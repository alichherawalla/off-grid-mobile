import type { ModelOrigin } from '../types';

const SPECIAL_HUGGING_FACE_REVISION_SOURCE = String.raw`refs\/(?:pr\/\d+|convert\/[\w.-]+)`;
const SPECIAL_HUGGING_FACE_REVISION = new RegExp(`^${SPECIAL_HUGGING_FACE_REVISION_SOURCE}$`);
const SPECIAL_HUGGING_FACE_RESOLVE_URL = new RegExp(
  `^https?://huggingface\\.co/([^/]+/[^/]+)/resolve/(${SPECIAL_HUGGING_FACE_REVISION_SOURCE})/(.+)$`,
);

/** One resolve-route revision. Hugging Face reserves two slash-bearing ref shapes as path routes. */
export function huggingFaceRevisionPath(revision: string): string {
  return SPECIAL_HUGGING_FACE_REVISION.test(revision)
    ? revision
    : encodeURIComponent(revision);
}

/**
 * Reads a Hugging Face resolve URL back into the provenance it encodes.
 *
 *   https://huggingface.co/{owner}/{name}/resolve/{revision}/{path}
 *
 * Every download path in this app builds exactly that shape - the catalog, the HF browser, the
 * CoreML browser, the curated LiteRT registry and the Whisper models - so one parser covers every
 * model on Hugging Face, whether or not it is in our catalog.
 *
 * Returns null for anything else: a local import has no upstream, and inventing one is what turned
 * a missing field into a 401 in a dialog.
 */
export function parseHuggingFaceUrl(url: string | undefined): ModelOrigin | null {
  if (!url) return null;
  const cleanUrl = url.split('?')[0];
  const special = SPECIAL_HUGGING_FACE_RESOLVE_URL.exec(cleanUrl);
  const match =
    special ??
    /^https?:\/\/huggingface\.co\/([^/]+\/[^/]+)\/resolve\/([^/]+)\/(.+)$/.exec(
      cleanUrl,
    );
  if (!match) return null;
  const [, repoId, encodedRevision, path] = match;
  // A repo id is always `owner/name`; anything shallower is a URL we do not understand.
  if (repoId.split('/').length < 2) return null;
  try {
    return { repoId, revision: decodeURIComponent(encodedRevision), path };
  } catch {
    return null;
  }
}
