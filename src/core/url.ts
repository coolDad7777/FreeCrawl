import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config';
import { UnsafeUrlError } from './errors';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'metadata.google.internal',
]);

/** Cloud instance metadata endpoints, which are routable but must never be scraped. */
const BLOCKED_ADDRESSES = new Set(['169.254.169.254', 'fd00:ec2::254']);

const NON_PAGE_EXTENSIONS = new Set([
  '.css', '.js', '.mjs', '.json', '.xml', '.rss', '.atom', '.zip', '.gz', '.tar', '.bz2', '.7z',
  '.rar', '.exe', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.iso', '.bin', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp',
  '.tif', '.tiff', '.avif', '.mp3', '.mp4', '.m4a', '.m4v', '.wav', '.ogg', '.oga', '.ogv',
  '.webm', '.mov', '.avi', '.mkv', '.flv', '.wmv', '.doc', '.docx', '.xls', '.xlsx', '.ppt',
  '.pptx', '.odt', '.ods', '.odp', '.csv', '.tsv', '.epub', '.mobi', '.psd', '.ai', '.dwg',
]);

/** Tracking parameters that produce duplicate pages under different URLs. */
const TRACKING_PARAMS = [
  /^utm_/i, /^ga_/i, /^_ga$/i, /^gclid$/i, /^gbraid$/i, /^wbraid$/i, /^fbclid$/i, /^msclkid$/i,
  /^dclid$/i, /^yclid$/i, /^mc_[ce]id$/i, /^igshid$/i, /^ref_src$/i, /^ref_url$/i, /^s_kwcid$/i,
  /^vero_/i, /^hsa_/i, /^_hs[a-z]*$/i,
];

export function isPrivateIp(address: string): boolean {
  if (BLOCKED_ADDRESSES.has(address.toLowerCase())) return true;

  if (net.isIPv4(address)) {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
      return true;
    }
    const [a, b] = octets;
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }

  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    if (normalized === '::1' || normalized === '::') return true;
    // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible addresses inherit IPv4 rules.
    const mapped = normalized.match(/::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb)/.test(normalized);
  }

  return false;
}

/** Strips fragments, tracking params, and default ports so URLs dedupe reliably. */
export function normalizeUrl(value: string, options: { stripTracking?: boolean } = {}): string {
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');

  if ((parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')) {
    parsed.port = '';
  }

  if (options.stripTracking !== false) {
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/') && !parsed.search) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  }

  return parsed.toString();
}

export function parseUrl(value: string): URL {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(candidate);
  } catch {
    throw new UnsafeUrlError('A valid URL is required');
  }
}

/**
 * Resolves `value` and rejects anything that could reach the host's own network.
 * Returns the normalized URL for use by the scrapers.
 */
export async function assertSafeUrl(value: string): Promise<string> {
  const parsed = parseUrl(value);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new UnsafeUrlError('Only http: and https: URLs are supported');
  }
  if (parsed.username || parsed.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not allowed');
  }

  if (config.allowPrivateUrls) return normalizeUrl(parsed.toString());

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || isPrivateIp(hostname)) {
    throw new UnsafeUrlError('Private, local, and link-local URLs are not allowed');
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve host "${hostname}"`);
  }

  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new UnsafeUrlError('Private, local, and link-local URLs are not allowed');
  }

  return normalizeUrl(parsed.toString());
}

/** Same checks as `assertSafeUrl` but returns a boolean, for filtering link lists. */
export async function isSafeUrl(value: string): Promise<boolean> {
  try {
    await assertSafeUrl(value);
    return true;
  } catch {
    return false;
  }
}

export function isSameSite(
  candidate: URL,
  base: URL,
  options: { includeSubdomains?: boolean } = {},
): boolean {
  if (candidate.hostname === base.hostname) return true;
  if (!options.includeSubdomains) return false;
  const root = registrableSuffix(base.hostname);
  return candidate.hostname === root || candidate.hostname.endsWith(`.${root}`);
}

/** Best-effort apex domain. Handles the common `co.uk`-style two-part suffixes. */
export function registrableSuffix(hostname: string): string {
  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;
  const twoPartSuffixes = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'go', 'or', 'ne']);
  if (parts.length >= 3 && twoPartSuffixes.has(parts[parts.length - 2])) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

export function looksLikePage(value: string): boolean {
  try {
    const { pathname } = new URL(value);
    const lastSegment = pathname.split('/').pop() ?? '';
    const dot = lastSegment.lastIndexOf('.');
    if (dot <= 0) return true;
    return !NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot).toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Converts a crawl path filter into a regex. Accepts glob-ish syntax
 * (`blog/*`, `**` for multi-segment) and passes raw regex syntax through.
 */
export function pathPatternToRegExp(pattern: string): RegExp {
  const trimmed = pattern.trim();
  const hasGlob = trimmed.includes('*') || trimmed.includes('?');
  const looksLikeRegExp = /[\\|()\[\]{}+^$]/.test(trimmed);

  if (looksLikeRegExp && !hasGlob) {
    try {
      return new RegExp(trimmed);
    } catch {
      // Fall through to literal matching below.
    }
  }

  const escaped = trimmed
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^/]');

  // Always anchored: `/blog/*` matches one segment, `/blog/**` matches any depth.
  const anchored = escaped.startsWith('/') ? `^${escaped}` : `^/?${escaped}`;
  return new RegExp(`${anchored}/?$`);
}

export interface LinkFilterOptions {
  base: URL;
  allowExternalLinks?: boolean;
  includeSubdomains?: boolean;
  /** Restricts crawling to URLs at or below the start URL's directory. */
  basePathPrefix?: string;
  includePaths?: string[];
  excludePaths?: string[];
}

export function matchesPathFilters(
  pathname: string,
  includePaths: string[] = [],
  excludePaths: string[] = [],
): boolean {
  if (excludePaths.some((pattern) => pathPatternToRegExp(pattern).test(pathname))) return false;
  if (includePaths.length === 0) return true;
  return includePaths.some((pattern) => pathPatternToRegExp(pattern).test(pathname));
}

export function isCrawlableLink(value: string, options: LinkFilterOptions): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  if (parsed.username || parsed.password) return false;
  if (!config.allowPrivateUrls) {
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) return false;
  }
  if (!looksLikePage(value)) return false;

  if (!options.allowExternalLinks && !isSameSite(parsed, options.base, options)) return false;

  if (options.basePathPrefix && isSameSite(parsed, options.base, options)) {
    if (!parsed.pathname.startsWith(options.basePathPrefix)) return false;
  }

  return matchesPathFilters(parsed.pathname, options.includePaths, options.excludePaths);
}

/** Directory portion of a URL path, used as the default crawl boundary. */
export function directoryPrefix(url: URL): string {
  const path = url.pathname;
  if (path.endsWith('/')) return path;
  const lastSlash = path.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : path.slice(0, lastSlash + 1);
}

/**
 * Collapses URLs that differ only by numeric path segments or trailing
 * `index.html`, so paginated duplicates do not consume the crawl budget.
 */
export function urlSimilarityKey(value: string): string {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname
      .replace(/\/index\.(html?|php|asp|aspx|jsp)$/i, '/')
      .replace(/\/+$/, '') || '/';
    return `${parsed.hostname}${path}${parsed.search}`;
  } catch {
    return value;
  }
}
