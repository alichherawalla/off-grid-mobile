import { useMemo } from 'react';
import type { TextEngineCapabilities } from '@offgrid/models';
import { useActiveMobileRoute } from '../services/modelServices/activeRoute';
import { mobileTextEngineControl } from '../services/modelServices/textEngineControl';

/**
 * Vision, tool, and thinking support of the active text route, projected by shared. Re-renders
 * when the route or inventory changes; nothing is copied into component state.
 */
export function useActiveTextCapabilities(): TextEngineCapabilities {
  const snapshot = useActiveMobileRoute('text');
  return useMemo(
    () => mobileTextEngineControl.capabilities(snapshot.model?.id ?? null),
    [snapshot],
  );
}
