import { useMemo } from 'react';
import { useRemoteServerStore } from '../stores/remoteServerStore';
import { discoveredRemoteModels } from '../stores/remoteServerProjection';
import type { RemoteModel } from '../types';

/** Reactive read of every server's discovered text models, derived from the server catalogs. */
export function useDiscoveredRemoteModels(): Record<string, RemoteModel[]> {
  const servers = useRemoteServerStore(state => state.servers);
  return useMemo(() => discoveredRemoteModels(servers), [servers]);
}
