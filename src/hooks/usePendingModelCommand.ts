import { useEffect, useState } from 'react';
import type { ModelCommandRoute, ModelModality } from '@offgrid/application';
import { mobileModelCommands } from '../services/modelServices/modelCommandApplication';

/** The route the shared command owner is switching this modality to, or null. */
export function usePendingModelCommand(modality: ModelModality): ModelCommandRoute | null {
  const [pending, setPending] = useState(() => mobileModelCommands.pending(modality));
  useEffect(() => {
    const publish = () => setPending(mobileModelCommands.pending(modality));
    publish();
    return mobileModelCommands.subscribe(publish);
  }, [modality]);
  return pending;
}
