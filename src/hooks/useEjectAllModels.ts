import { useState } from 'react';
import { ejectAllModelsForUser } from '../services/userModelEjection';
import { useAppStore, useRemoteServerStore } from '../stores';

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
  const activeModelId = useAppStore((s) => s.activeModelId);
  const activeImageModelId = useAppStore((s) => s.activeImageModelId);
  const activeRemoteTextModelId = useRemoteServerStore((s) => s.activeRemoteTextModelId);
  const activeRemoteImageModelId = useRemoteServerStore((s) => s.activeRemoteImageModelId);

  const hasActiveModel = !!(activeModelId || activeImageModelId || activeRemoteTextModelId || activeRemoteImageModelId);

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
