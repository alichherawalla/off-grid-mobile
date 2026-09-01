import { useEffect, useState } from 'react';
import type { ModelModality, RuntimeModel } from '@offgrid/models';
import {
  mobileLLMService,
  refreshMobileModelServices,
} from '../services/modelServices';

/** Reactive read-only inventory projection from the Shared model service. */
export function useMobileModelInventory(modality?: ModelModality): RuntimeModel[] {
  const [models, setModels] = useState(() => mobileLLMService.list(modality));

  useEffect(() => {
    const publish = () => setModels(mobileLLMService.list(modality));
    const unsubscribe = mobileLLMService.subscribe(publish);
    refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, [modality]);

  return models;
}
