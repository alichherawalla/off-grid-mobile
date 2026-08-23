import type { VisionRepairOutcome } from './visionRepairService';

/**
 * What to tell the user about a vision repair - the one place an outcome becomes words.
 *
 * Every surface that can repair a model (the Download Manager, the Models screen, the chat advice
 * card) needs to explain the SAME six outcomes, and three copies of that wording is three chances
 * to describe the same event differently. Returns a [title, body] pair for showAlert.
 *
 * The two honest endings matter most. "unknown" is not an error: a model imported from storage has
 * no upstream to fetch from, and saying so with the next step is more useful than a failure that
 * implies something went wrong. "ambiguous" refuses to guess - several repos publish the same file
 * name, and a projector built for a different quantisation loads and then produces nonsense.
 */
export function visionRepairMessage(
  outcome: VisionRepairOutcome,
  modelName: string,
): [string, string] {
  switch (outcome.kind) {
    case 'repaired':
      return [
        'Vision Repaired',
        `Vision file restored for ${modelName} from ${outcome.repoId}. Reload the model to enable vision.`,
      ];
    case 'linked':
      return [
        'Vision Repaired',
        `${modelName} already had its vision file on this device - it is now linked. Reload the model to enable vision.`,
      ];
    case 'ambiguous':
      return [
        'Cannot Identify This Model',
        `More than one Hugging Face repository publishes a file of this name at this size (${outcome.candidates.join(
          ', ',
        )}), and the wrong vision file would load but read images incorrectly. Download ${modelName} from Models to be certain of the pair.`,
      ];
    case 'noProjectorPublished':
      return [
        'No Vision File Available',
        `${outcome.repoId} does not publish a separate vision file for ${modelName}. Re-download the original (non-i1) variant if vision support is required.`,
      ];
    case 'unknown':
      return [
        'No Source To Repair From',
        `${modelName} was imported or received from another device, so there is no repository to fetch its vision file from. Download it from Models, or copy the mmproj file onto this device beside the model.`,
      ];
    case 'unsupported':
      return [
        'Not A Vision Model',
        `${modelName} does not use a separate vision file.`,
      ];
  }
}
