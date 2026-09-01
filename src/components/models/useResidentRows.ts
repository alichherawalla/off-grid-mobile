/**
 * useResidentRows — the manager sheet's per-row residency projection, read from the OWNING service
 * (modelResidencyManager: the accounting of what is actually in RAM). One place maps the sheet's
 * modality rows onto residency types — no engine branching in the view, and both callers (Home,
 * Chat) inherit the projection with zero wiring.
 *
 * The shared residency manager owns the reactive snapshot revision. The UI only projects it
 * into the four model rows shown by this sheet.
 */
import { useSyncExternalStore } from 'react';
import { modelResidencyManager } from '../../services/modelResidency';
import type { Resident, ResidentType } from '../../services/modelResidency/policy';

/** The manager sheet's modality rows. Defined HERE (the lower-level projection) rather than in
 *  ModelsManagerSheet so the hook doesn't import the component — that was a dependency cycle
 *  (ModelsManagerSheet → useResidentRows → ModelsManagerSheet). The sheet re-exports it. */
export type ModelRowType = 'text' | 'image' | 'voice' | 'speech';

/** Sheet row → residency type. Voice is the TTS output engine; Speech is the Whisper STT input. */
const ROW_RESIDENT_TYPE: Record<ModelRowType, ResidentType> = {
  text: 'text',
  image: 'image',
  voice: 'tts',
  speech: 'whisper',
};

/** Pure: pick the resident (if any) backing each sheet row. */
function residentsByRow(residents: Resident[]): Partial<Record<ModelRowType, Resident>> {
  const out: Partial<Record<ModelRowType, Resident>> = {};
  (Object.keys(ROW_RESIDENT_TYPE) as ModelRowType[]).forEach((row) => {
    const match = residents.find((r) => r.type === ROW_RESIDENT_TYPE[row]);
    if (match) out[row] = match;
  });
  return out;
}

export function useResidentRows(active: boolean): Partial<Record<ModelRowType, Resident>> {
  useSyncExternalStore(
    active ? listener => modelResidencyManager.subscribe(listener) : () => () => {},
    () => modelResidencyManager.getRevision(),
    () => modelResidencyManager.getRevision(),
  );
  return residentsByRow(modelResidencyManager.getResidents());
}

/** Eject one row's resident via the owning service (its registered unload runs; lazy-reload on next use). */
export function ejectResident(resident: Resident): Promise<boolean> {
  return modelResidencyManager.evictByKey(resident.key);
}
