import type { ModelOrigin } from '../../types';

/**
 * Where a missing mmproj can be fetched from, and how sure we are.
 *
 * `recorded`  - the model carries its own provenance. Free and certain.
 * `matched`   - no provenance, but exactly one Hugging Face repo publishes a file of this name at
 *               byte-identical size. Verified, not guessed.
 * `ambiguous` - several repos publish that file name and we cannot tell them apart. A wrong
 *               projector loads and produces nonsense, so this is a question for the user, not a
 *               coin toss. (`SmolVLM-500M-Instruct-GGUF` matches three repos, one of them an `i1`
 *               requantisation whose projector does NOT match ours.)
 * `unknown`   - nothing upstream. A local import has no repo, and neither does anything HF has
 *               never published. The honest answer, and the reason this is a union rather than a
 *               nullable repo id: the UI must be able to say WHY.
 */
export type VisionRepairSource =
  | { kind: 'recorded'; origin: ModelOrigin }
  | { kind: 'matched'; origin: ModelOrigin }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'unknown' };

/** One candidate repo, reduced to what identifies a file: its name and its exact size. */
interface RepoFileCandidate {
  repoId: string;
  files: { name: string; sizeBytes?: number }[];
}

/** Injected so the decision below is pure and testable with no network. */
export type HuggingFaceSearch = (
  fileName: string,
) => Promise<RepoFileCandidate[]>;

export interface RepairSourceInput {
  origin?: ModelOrigin;
  /** The primary file we hold locally - the thing a candidate repo has to match. */
  fileName: string;
  fileSize: number;
}

/**
 * Resolve where this model's projector can come from.
 *
 * Search finds CANDIDATES; size identifies the FILE. Matching on name alone picks one of several
 * repos at random, which is how a model ends up with a projector built for a different
 * quantisation. A candidate only survives if it publishes our exact file name at our exact byte
 * size, and the answer is only used when exactly one survives.
 */
export async function resolveVisionRepairSource(
  input: RepairSourceInput,
  search: HuggingFaceSearch,
): Promise<VisionRepairSource> {
  if (input.origin) return { kind: 'recorded', origin: input.origin };

  const candidates = await search(input.fileName);
  const matches = candidates.filter(candidate =>
    candidate.files.some(
      file => file.name === input.fileName && file.sizeBytes === input.fileSize,
    ),
  );

  if (matches.length === 1) {
    return {
      kind: 'matched',
      // The search told us nothing about which commit these bytes came from, and pinning a guess
      // would be a second invention. `main` is the honest read of "whatever that repo publishes
      // now", and the size check already proved the file we want is there.
      origin: {
        repoId: matches[0].repoId,
        revision: 'main',
        path: input.fileName,
      },
    };
  }
  if (matches.length > 1) {
    return { kind: 'ambiguous', candidates: matches.map(m => m.repoId) };
  }
  return { kind: 'unknown' };
}
