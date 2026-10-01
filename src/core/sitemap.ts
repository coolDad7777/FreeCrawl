import { XMLParser } from 'fast-xml-parser';
import { gunzipSync } from 'node:zlib';
import { httpGet } from './fetcher';
import { fetchRobotsTxt } from './robots';
import { isSameSite, normalizeUrl } from './url';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  trimValues: true,
  isArray: (name) => ['url', 'sitemap'].includes(name),
});

export interface SitemapEntry {
  url: string;
  lastModified?: string;
}

export interface SitemapOptions {
  /** Hard ceiling on returned URLs. */
  limit?: number;
  includeSubdomains?: boolean;
  /** Guards against sitemap-index loops and fan-out. */
  maxSitemaps?: number;
  timeout?: number;
}

const DEFAULT_SITEMAP_PATHS = [
  '/sitemap.xml',
  '/sitemap_index.xml',
  '/sitemap-index.xml',
  '/sitemap.xml.gz',
  '/wp-sitemap.xml',
  '/sitemap/sitemap.xml',
];

function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)['#text']).trim();
  }
  return '';
}

/** Parses either a urlset or a sitemapindex document. */
export function parseSitemapXml(xml: string): { entries: SitemapEntry[]; sitemaps: string[] } {
  const entries: SitemapEntry[] = [];
  const sitemaps: string[] = [];

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return { entries, sitemaps };
  }

  const urlset = parsed.urlset as { url?: Record<string, unknown>[] } | undefined;
  for (const entry of urlset?.url ?? []) {
    const loc = toText(entry.loc);
    if (loc) entries.push({ url: loc, lastModified: toText(entry.lastmod) || undefined });
  }

  const index = parsed.sitemapindex as { sitemap?: Record<string, unknown>[] } | undefined;
  for (const entry of index?.sitemap ?? []) {
    const loc = toText(entry.loc);
    if (loc) sitemaps.push(loc);
  }

  return { entries, sitemaps };
}

async function fetchSitemapBody(url: string, timeout: number): Promise<string | null> {
  try {
    const response = await httpGet(url, {
      timeout,
      maxBytes: 20 * 1024 * 1024,
      headers: { Accept: 'application/xml,text/xml,*/*' },
    });
    if (response.statusCode >= 400 || !response.buffer) return null;

    const isGzip =
      url.endsWith('.gz') ||
      (response.buffer.length > 2 && response.buffer[0] === 0x1f && response.buffer[1] === 0x8b);

    const body = isGzip ? gunzipSync(response.buffer).toString('utf8') : response.body;
    return body.includes('<') ? body : null;
  } catch {
    return null;
  }
}

/**
 * Walks a site's sitemaps breadth-first, following `robots.txt` hints and the
 * conventional sitemap paths, and returns same-site URLs.
 */
export async function discoverSitemapUrls(
  startUrl: string,
  options: SitemapOptions = {},
): Promise<SitemapEntry[]> {
  const limit = options.limit ?? 5_000;
  const maxSitemaps = options.maxSitemaps ?? 25;
  const timeout = options.timeout ?? 15_000;

  const base = new URL(startUrl);
  const robots = await fetchRobotsTxt(startUrl);

  const queue: string[] = [];
  const seenSitemaps = new Set<string>();
  const pushSitemap = (candidate: string) => {
    try {
      const absolute = new URL(candidate, base).toString();
      if (!seenSitemaps.has(absolute)) {
        seenSitemaps.add(absolute);
        queue.push(absolute);
      }
    } catch {
      // Ignore malformed sitemap references.
    }
  };

  for (const sitemap of robots.sitemaps) pushSitemap(sitemap);
  for (const path of DEFAULT_SITEMAP_PATHS) pushSitemap(new URL(path, base.origin).toString());

  const entries: SitemapEntry[] = [];
  const seenUrls = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && entries.length < limit && fetched < maxSitemaps) {
    const sitemapUrl = queue.shift()!;
    fetched += 1;

    const body = await fetchSitemapBody(sitemapUrl, timeout);
    if (!body) continue;

    const { entries: found, sitemaps } = parseSitemapXml(body);
    for (const sitemap of sitemaps) pushSitemap(sitemap);

    for (const entry of found) {
      if (entries.length >= limit) break;
      let normalized: string;
      let parsed: URL;
      try {
        parsed = new URL(entry.url);
        normalized = normalizeUrl(entry.url);
      } catch {
        continue;
      }
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      if (!isSameSite(parsed, base, { includeSubdomains: options.includeSubdomains })) continue;
      if (seenUrls.has(normalized)) continue;
      seenUrls.add(normalized);
      entries.push({ url: normalized, lastModified: entry.lastModified });
    }
  }

  return entries;
}
