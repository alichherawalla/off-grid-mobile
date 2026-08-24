import { getIpAddress } from 'react-native-device-info';

/** Returns true if the IPv4 address belongs to a private (RFC 1918) network */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.');
  if (parts.length !== 4) return false;
  const first = parseInt(parts[0], 10);
  const second = parseInt(parts[1], 10);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Returns true for the CGNAT IPv4 range assigned to Tailscale devices. */
export function isTailscaleIPv4(ip: string): boolean {
  const match = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!match) return false;

  const second = Number.parseInt(match[1], 10);
  const third = Number.parseInt(match[2], 10);
  const fourth = Number.parseInt(match[3], 10);
  return second >= 64 && second <= 127 && third <= 255 && fourth <= 255;
}

/** Returns true if the string looks like an IPv6 address */
export function isIPv6(ip: string): boolean {
  return ip.includes(':');
}

/**
 * Returns true if the device appears to be on a local WiFi network.
 * Returns false if on mobile data, no network, or an unexpected address.
 */
export async function isOnLocalNetwork(): Promise<boolean> {
  try {
    const ip = await getIpAddress();
    if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;
    if (isIPv6(ip)) return false;
    return isPrivateIPv4(ip);
  } catch {
    return false;
  }
}
