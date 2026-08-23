import { ModelFile } from '../types';
import { predictGgufCapabilities } from './ggufCapabilities';

interface VisionRepairCandidate {
  isVisionModel?: boolean;
  mmProjPath?: string;
  mmProjFileName?: string;
  name?: string;
  fileName?: string;
}

function looksLikeVisionByName(model: VisionRepairCandidate): boolean {
  const name = (model.name ?? '').toLowerCase();
  const file = (model.fileName ?? '').toLowerCase();
  return (
    name.includes('vl') ||
    name.includes('vision') ||
    name.includes('smolvlm') ||
    file.includes('vl') ||
    file.includes('vision')
  );
}

/**
 * Returns true if the model is a vision model and is missing its mmproj file,
 * meaning vision capability needs to be repaired.
 *
 * Check if mmProjFileName exists (metadata indicating model should have vision).
 * This persists even if the mmproj file fails to download or gets deleted.
 */
export function needsVisionRepair(
  model: VisionRepairCandidate | null | undefined,
  catalogFile?: ModelFile,
): boolean {
  if (!model) return false;
  // "Can it see right now" has ONE owner - the same predictor deriveEngineCapabilities falls back
  // to, which reads the projector rather than the name. Re-testing mmProjPath here would be a
  // second copy of that rule, and the two would eventually disagree about the same model.
  if (predictGgufCapabilities(model).vision) return false;

  // Primary signal: mmProjFileName metadata indicates this model should have vision
  const hasVisionMetadata = !!model.mmProjFileName;
  if (hasVisionMetadata && !model.mmProjPath) return true;

  // Catalog metadata is authoritative for recommended models that haven't
  // successfully persisted sidecar metadata yet.
  if (catalogFile?.mmProjFile) return true;

  // Persisted vision flag from imported/discovered models is the next-best
  // signal once mmproj metadata is absent.
  if (model.isVisionModel) return true;

  // Last-resort fallback for older/incomplete records.
  if (looksLikeVisionByName(model)) {
    if (catalogFile !== undefined && !catalogFile.mmProjFile) return false;
    return true;
  }

  return false;
}
