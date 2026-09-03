import { useEffect, useState } from 'react';
import type { ActiveModelSnapshot, ModelModality } from '@offgrid/models';
// Resolved at call time: the model services reach the screens that use this hook, and an eager
// import would form a cycle under eager module loading (jest).
const services = (): typeof import('../services/modelServices') =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../services/modelServices') as typeof import('../services/modelServices');

/** The selected LOCAL model id for a modality, or null (a remote route reads as null). */
export function useActiveLocalModelId(modality: ModelModality): string | null {
  const model = useActiveMobileModel(modality).model;
  return model && model.source === 'local' ? model.id : null;
}

/** Reactive projection of the shared active route for one modality. */
export function useActiveMobileModel(modality: ModelModality): ActiveModelSnapshot {
  const [snapshot, setSnapshot] = useState(() => services().activeMobileModel(modality));

  useEffect(() => {
    const publish = () => setSnapshot(services().activeMobileModel(modality));
    const unsubscribe = services().mobileLLMService.subscribe(publish);
    services().refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, [modality]);

  return snapshot;
}
