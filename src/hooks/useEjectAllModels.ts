import { useState } from 'react';
import { ejectAllModelsForUser } from '../services/modelServices/ejectModelsForUser';
import { useAppStore, useRemoteServerStore } from '../stores';
import { useActiveMobileModel } from './useActiveMobileModel';

/**
 * Thin View-side projection for the "Eject All" control, shared by Home + Chat.
 *
 * - `hasActiveModel` is derived REACTIVELY from the stores (the projection layer).
 * - the unload SIDE-EFFECT is NOT here: `ejectAll` dispatches to the shared user
 *   ejection coordinator. No screen re-implements cancellation or unloading.
 * - `isEjecting` is the ephemeral in-flight flag for this dispatch (spinner only).
 */
export function useEjectAllModels(): {
  isEjecting: boolean;
  hasActiveModel: boolean;
  ejectAll: () => Promise<number>;
} {
  const [isEjecting, setIsEjecting] = useState(false);
  const hasLocalText = useAppStore(state => !!state.activeModelId);
  const hasLocalImage = useAppStore(state => !!state.activeImageModelId);
  const hasRemoteText = useRemoteServerStore(state => !!state.activeRemoteTextModelId);
  const hasRemoteImage = useRemoteServerStore(state => !!state.activeRemoteImageModelId);
  const transcription = useActiveMobileModel('transcription').model;
  const voice = useActiveMobileModel('voice').model;
  const hasActiveModel = hasLocalText || hasLocalImage || hasRemoteText ||
    hasRemoteImage || !!transcription || !!voice;

  const ejectAll = async (): Promise<number> => {
    setIsEjecting(true);
    try {
      const { count } = await ejectAllModelsForUser();
      return count;
    } finally {
      setIsEjecting(false);
    }
  };

  return { isEjecting, hasActiveModel, ejectAll };
}
