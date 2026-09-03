import { useEffect, useState } from 'react';
import type { ModelModality, RuntimeModel } from '@offgrid/models';
import {
  mobileModelsFacade,
  refreshMobileModelServices,
} from '../services/modelServices';

const inventory = (modality?: ModelModality): RuntimeModel[] =>
  mobileModelsFacade().snapshot().inventory.filter(model => !modality || model.modality === modality);

/** Reactive read-only inventory projection from the Shared model service. */
export function useMobileModelInventory(modality?: ModelModality): RuntimeModel[] {
  const [models, setModels] = useState(() => inventory(modality));

  useEffect(() => {
    const publish = () => setModels(inventory(modality));
    const unsubscribe = mobileModelsFacade().subscribe(publish);
    refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, [modality]);

  return models;
}
