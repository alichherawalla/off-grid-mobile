import { useEffect, useState } from 'react';
import { DownloadedModel, RemoteModel } from '../types';
import {
  activeMobileModel,
  mobileLLMService,
  mobileTextModelRecord,
  refreshMobileModelServices,
} from '../services/modelServices';

export type ActiveTextModelResult = {
  /** The resolved active model (remote preferred over local) */
  model: DownloadedModel | RemoteModel | null;
  /** The model ID suitable for creating conversations */
  modelId: string | null;
  /** Display name */
  modelName: string;
  /** Whether the active model is remote */
  isRemote: boolean;
};

/**
 * The active text model, preferring remote over local. THE answer to "is a text model available" -
 * chat, the chat list and Home all read it here rather than each repeating the lookup.
 *
 * The local branch delegates to activeModelService, which tolerates a selected id whose entry was
 * rebuilt under a different id (see resolveModel). Repeating `find(m => m.id === activeModelId)` in a
 * view is what let the chat refuse to send to a model the engine had loaded.
 */
export function useActiveTextModel(): ActiveTextModelResult {
  const [snapshot, setSnapshot] = useState(() => activeMobileModel('text'));

  useEffect(() => {
    const publish = () => setSnapshot(activeMobileModel('text'));
    const unsubscribe = mobileLLMService.subscribe(publish);
    refreshMobileModelServices().then(publish).catch(() => undefined);
    return unsubscribe;
  }, []);

  const record = mobileTextModelRecord(snapshot.model);
  return {
    model: record,
    modelId: snapshot.model?.id ?? null,
    modelName: snapshot.model?.name ?? 'Unknown',
    isRemote: snapshot.model?.source === 'remote',
  };
}
