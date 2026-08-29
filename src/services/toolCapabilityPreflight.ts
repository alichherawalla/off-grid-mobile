import { useRemoteServerStore } from '../stores/remoteServerStore';
import { providerRegistry } from './providers';

export const REMOTE_TOOLS_UNAVAILABLE =
  'This remote model cannot run tools from Chat. Select a model with tool support, or use it as the Computer Use specialist.';

/** One preflight before a turn enters the tool loop. Providers remain transport adapters. */
export function remoteToolCapabilityIssue(
  requestedToolCount: number,
): string | undefined {
  if (requestedToolCount === 0) return undefined;
  const serverId = useRemoteServerStore.getState().activeServerId;
  if (!serverId) return undefined;
  const provider = providerRegistry.getProvider(serverId);
  return provider && !provider.capabilities.supportsToolCalling
    ? REMOTE_TOOLS_UNAVAILABLE
    : undefined;
}
