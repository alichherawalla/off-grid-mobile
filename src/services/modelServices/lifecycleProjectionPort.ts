import type { ModelModality } from '@offgrid/models';

export interface LifecycleProjectionPort {
  refreshInventory(): Promise<unknown>;
  selectRoute(modality: ModelModality, routeId: string | null): Promise<void>;
}

let port: LifecycleProjectionPort = {
  refreshInventory: async () => undefined,
  selectRoute: async () => undefined,
};

/** Composition-root registration. Lifecycle code depends inward on this port, not on LLMService. */
export function registerLifecycleProjectionPort(next: LifecycleProjectionPort): () => void {
  port = next;
  return () => {
    if (port === next) {
      port = {
        refreshInventory: async () => undefined,
        selectRoute: async () => undefined,
      };
    }
  };
}

export const lifecycleProjectionPort: LifecycleProjectionPort = {
  refreshInventory: () => port.refreshInventory(),
  selectRoute: (modality, routeId) => port.selectRoute(modality, routeId),
};
