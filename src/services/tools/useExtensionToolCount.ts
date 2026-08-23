import { useSyncExternalStore } from 'react';
import { getToolExtensions, subscribeToolExtensions } from './extensions';

/**
 * The live sum of every extension's enabled-tool count.
 *
 * `useSyncExternalStore` rather than a render-time reduce, because the counts live in PRO stores this
 * core module must not import (DIP - the same reason extensions exist at all). Reading them
 * imperatively is what made the "Pro Tools" badge stale: deactivate an MCP server and the mounted
 * chat kept the count from its last render, while a fresh chat showed the truth.
 *
 * `subscribe` is MODULE-LEVEL and stable, so React wires it once per mount - and it listens to the
 * REGISTRY as well as to each extension. Both halves matter: an extension can register after a
 * consumer mounted (Pro activates at runtime), so a subscription taken only at mount would miss it
 * and freeze the count at 0; and a per-render inline subscribe "fixed" that only by tearing the
 * subscription down on every render of the hottest screen in the app.
 */
function subscribe(onChange: () => void): () => void {
  let stops: Array<() => void> = [];
  const wire = () => {
    stops.forEach(stop => stop());
    stops = getToolExtensions()
      .map(extension => extension.subscribe?.(onChange))
      .filter((stop): stop is () => void => typeof stop === 'function');
  };
  wire();
  const stopRegistry = subscribeToolExtensions(() => {
    wire(); // wire the newcomer's store
    onChange(); // and re-read the count now
  });
  return () => {
    stopRegistry();
    stops.forEach(stop => stop());
  };
}

const getSnapshot = (): number =>
  getToolExtensions().reduce((n, e) => n + e.enabledToolCount(), 0);

export function useExtensionToolCount(): number {
  return useSyncExternalStore(subscribe, getSnapshot);
}
