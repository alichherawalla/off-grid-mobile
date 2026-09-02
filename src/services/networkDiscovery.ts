/** Mobile device and HTTP adapter for Shared LAN remote-server discovery. */

import { getIpAddress, isEmulator } from 'react-native-device-info';
import {
  RemoteLanDiscoveryApplicationService,
  type RemoteLanProbeEvidence,
  type RemoteLanServer,
} from '@offgrid/models';
import logger from '../utils/logger';

export type DiscoveredServer = RemoteLanServer;

async function probe(url: string, timeoutMs: number): Promise<RemoteLanProbeEvidence> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal }); // NOSONAR — LAN-only probe
    return { reachable: true, status: response.status };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

const discovery = new RemoteLanDiscoveryApplicationService({
  isEmulator,
  ipAddress: getIpAddress,
  probe,
});

export function discoverLANServers(
  onLog?: (message: string) => void,
): Promise<DiscoveredServer[]> {
  return discovery.discover(message => {
    logger.warn('[Discovery]', message);
    onLog?.(message);
  });
}
