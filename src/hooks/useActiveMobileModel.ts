import { useEffect, useState } from 'react';
import type { ActiveModelSnapshot, ModelModality } from '@offgrid/models';
import {
  activeMobileModel,
  mobileLLMService,
  refreshMobileModelServices,
} from '../services/modelServices';

/** Reactive projection of the shared active route for one modality. */
export function useActiveMobileModel(modality: ModelModality): ActiveModelSnapshot {
  const [snapshot, setSnapshot] = useState(() => activeMobileModel(modality));

  useEffect(() => {
    const publish = () => setSnapshot(activeMobileModel(modality));
    const unsubscribe = mobileLLMService.subscribe(publish);
    refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, [modality]);

  return snapshot;
}
