import dns from 'node:dns/promises';
import net from 'node:net';

const blockedHostnames = new Set(['localhost', 'localhost.localdomain']);

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1' || normalized === '::' ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb');
  }

  return false;
}

export function normalizeUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = '';
  return parsed.toString();
}

export async function assertSafeUrl(value: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('A valid URL is required');
  }

  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Only public HTTP(S) URLs without credentials are allowed');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (blockedHostnames.has(hostname) || isPrivateIp(hostname)) {
    throw new Error('Private and local URLs are not allowed');
  }

  const addresses = await dns.lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Private and local URLs are not allowed');
  }

  return normalizeUrl(value);
}

export function isAllowedLink(value: string, base: URL, allowExternal: boolean): boolean {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return false;
    if (!allowExternal && parsed.hostname !== base.hostname) return false;
    return !blockedHostnames.has(parsed.hostname.toLowerCase()) && !isPrivateIp(parsed.hostname);
  } catch {
    return false;
  }
}
