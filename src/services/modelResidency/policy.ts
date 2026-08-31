/** React Native platform binding for the shared residency policy. */
import { Platform } from 'react-native';
import {
  computeBudgetMB as sharedComputeBudgetMB,
  planEviction,
  type Resident,
  type ResidentSpec as IncomingModel,
  type ResidencyLoadPolicy,
  type ResidentType,
  type EvictionPlan,
} from '@offgrid/models';

export { planEviction };
export type { Resident, IncomingModel, ResidentType, EvictionPlan };

export function computeBudgetMB(
  totalRamMB: number,
  options: {
    reserveMB?: number;
    fraction?: number;
    policy?: ResidencyLoadPolicy;
  } = {},
): number {
  return sharedComputeBudgetMB(totalRamMB, {
    ...options,
    platform: Platform.OS,
  });
}
