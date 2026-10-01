import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';
import { config } from '../config';
import { ConfigurationError, FreeCrawlError, toErrorMessage } from './errors';
import { httpGet } from './fetcher';
import { normalizeUrl } from './url';

export interface SearchHit {
  url: string;
  title: string;
  description: string;
  engine: string;
}

export interface SearchParams {
  query: string;
  limit: number;
  lang: string;
  country: string;
}

export type EngineName = 'searxng' | 'duckduckgo' | 'bing';

const rssParser = new XMLParser({ ignoreAttributes: true, trimValues: true });

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** DuckDuckGo wraps outbound links in `/l/?uddg=<encoded>`. */
function unwrapDuckDuckGoUrl(href: string): string | null {
  try {
    const absolute = href.startsWith('//')
      ? `https:${href}`
      : href.startsWith('http')
        ? href
        : `https://duckduckgo.com${href}`;
    const parsed = new URL(absolute);
    const target = parsed.searchParams.get('uddg');
    if (target) return target;
    if (parsed.hostname.endsWith('duckduckgo.com') && parsed.pathname.startsWith('/l/')) return null;
    return absolute;
  } catch {
    return null;
  }
}

function dedupe(hits: SearchHit[], limit: number): SearchHit[] {
  const seen = new Set<string>();
  const output: SearchHit[] = [];

  for (const hit of hits) {
    let key: string;
    try {
      key = normalizeUrl(hit.url);
    } catch {
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...hit, url: key });
    if (output.length >= limit) break;
  }

  return output;
}

/**
 * SearXNG is the recommended engine for self-hosting: set `SEARXNG_URL` to an
 * instance with the JSON format enabled and searches stay entirely free and
 * unmetered. Required because the public scraped engines rate-limit datacenter IPs.
 */
async function searchSearxng(params: SearchParams): Promise<SearchHit[]> {
  if (!config.search.searxngUrl) {
    throw new ConfigurationError('SEARXNG_URL is not configured');
  }

  const url = new URL(`${config.search.searxngUrl}/search`);
  url.searchParams.set('q', params.query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('language', params.lang);
  url.searchParams.set('safesearch', '0');

  const response = await httpGet(url.toString(), {
    timeout: 20_000,
    maxBytes: 8 * 1024 * 1024,
    headers: { Accept: 'application/json' },
    validateRedirects: false,
  });

  if (response.statusCode >= 400) {
    throw new FreeCrawlError(
      `SearXNG responded with HTTP ${response.statusCode}`,
      502,
      'search_failed',
    );
  }

  let payload: { results?: { url?: string; title?: string; content?: string }[] };
  try {
    payload = JSON.parse(response.body);
  } catch {
    throw new FreeCrawlError(
      'SearXNG did not return JSON. Enable the "json" format in its settings.yml.',
      502,
      'search_failed',
    );
  }

  return (payload.results ?? [])
    .filter((result): result is { url: string } & typeof result => Boolean(result.url))
    .map((result) => ({
      url: result.url,
      title: cleanText(result.title ?? ''),
      description: cleanText(result.content ?? ''),
      engine: 'searxng',
    }));
}

export function parseDuckDuckGoHtml(html: string): SearchHit[] {
  const $ = cheerio.load(html);
  const hits: SearchHit[] = [];

  $('.result, .web-result').each((_, element) => {
    const node = $(element);
    const anchor = node.find('a.result__a').first();
    const href = anchor.attr('href');
    if (!href) return;
    const target = unwrapDuckDuckGoUrl(href);
    if (!target) return;

    hits.push({
      url: target,
      title: cleanText(anchor.text()),
      description: cleanText(node.find('.result__snippet').first().text()),
      engine: 'duckduckgo',
    });
  });

  // The lite layout omits the `.result` wrapper entirely.
  if (hits.length === 0) {
    $('a.result-link, a.result__a').each((_, element) => {
      const anchor = $(element);
      const target = unwrapDuckDuckGoUrl(anchor.attr('href') ?? '');
      if (!target) return;
      hits.push({
        url: target,
        title: cleanText(anchor.text()),
        description: '',
        engine: 'duckduckgo',
      });
    });
  }

  return hits;
}

async function searchDuckDuckGo(params: SearchParams): Promise<SearchHit[]> {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', params.query);
  url.searchParams.set('kl', `${params.country.toLowerCase()}-${params.lang.toLowerCase()}`);

  const response = await httpGet(url.toString(), {
    timeout: 20_000,
    maxBytes: 8 * 1024 * 1024,
    headers: { Referer: 'https://duckduckgo.com/' },
  });

  const hits = parseDuckDuckGoHtml(response.body);

  if (hits.length === 0) {
    const challenged =
      response.statusCode === 202 ||
      response.statusCode === 403 ||
      /anomaly|unusual traffic|captcha|verifying your browser/i.test(response.body);
    throw new FreeCrawlError(
      challenged
        ? 'DuckDuckGo rejected the request as automated traffic. Set SEARXNG_URL for reliable search.'
        : `DuckDuckGo returned no parseable results (HTTP ${response.statusCode})`,
      502,
      'search_failed',
    );
  }

  return hits;
}

export function parseBingRss(xml: string): SearchHit[] {
  let items: { title?: unknown; link?: unknown; description?: unknown }[] = [];
  try {
    const parsed = rssParser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
    const item = parsed.rss?.channel?.item;
    items = Array.isArray(item) ? (item as typeof items) : item ? [item as (typeof items)[number]] : [];
  } catch {
    throw new FreeCrawlError('Bing returned an unparseable RSS feed', 502, 'search_failed');
  }

  return items
    .map((item) => ({
      url: String(item.link ?? ''),
      title: cleanText(String(item.title ?? '')),
      description: cleanText(String(item.description ?? '')),
      engine: 'bing',
    }))
    .filter((hit) => /^https?:\/\//.test(hit.url));
}

/**
 * Bing's RSS output needs no key and is rarely blocked, which makes it a usable
 * last resort, though its result relevance is weaker than the other engines.
 */
async function searchBing(params: SearchParams): Promise<SearchHit[]> {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', params.query);
  url.searchParams.set('format', 'rss');
  url.searchParams.set('count', String(Math.min(params.limit * 2, 50)));
  url.searchParams.set('setlang', params.lang);
  url.searchParams.set('cc', params.country);

  const response = await httpGet(url.toString(), {
    timeout: 20_000,
    maxBytes: 8 * 1024 * 1024,
    headers: { Accept: 'application/rss+xml,application/xml,text/xml' },
  });

  if (response.statusCode >= 400) {
    throw new FreeCrawlError(`Bing responded with HTTP ${response.statusCode}`, 502, 'search_failed');
  }

  const hits = parseBingRss(response.body);
  if (hits.length === 0) {
    throw new FreeCrawlError('Bing returned no results', 502, 'search_failed');
  }

  return hits;
}

const ENGINES: Record<EngineName, (params: SearchParams) => Promise<SearchHit[]>> = {
  searxng: searchSearxng,
  duckduckgo: searchDuckDuckGo,
  bing: searchBing,
};

export function resolveEngineOrder(requested: 'auto' | EngineName): EngineName[] {
  if (requested !== 'auto') return [requested];

  const configured = config.search.engines.filter(
    (name): name is EngineName => name in ENGINES,
  );
  const order = configured.length > 0 ? configured : (['searxng', 'duckduckgo', 'bing'] as EngineName[]);

  // Skip SearXNG when it has no URL so the fallback chain is not wasted on it.
  return order.filter((name) => name !== 'searxng' || Boolean(config.search.searxngUrl));
}

/** Tries each engine in order and returns the first non-empty result set. */
export async function searchWeb(
  params: SearchParams,
  requestedEngine: 'auto' | EngineName = 'auto',
): Promise<{ results: SearchHit[]; engine: EngineName; attempts: { engine: string; error: string }[] }> {
  const order = resolveEngineOrder(requestedEngine);
  if (order.length === 0) {
    throw new ConfigurationError(
      'No search engine is available. Set SEARXNG_URL or allow duckduckgo/bing via SEARCH_ENGINES.',
    );
  }

  const attempts: { engine: string; error: string }[] = [];

  for (const engine of order) {
    try {
      const hits = await ENGINES[engine](params);
      const results = dedupe(hits, params.limit);
      if (results.length > 0) return { results, engine, attempts };
      attempts.push({ engine, error: 'No results' });
    } catch (error) {
      attempts.push({ engine, error: toErrorMessage(error) });
    }
  }

  const detail = attempts.map(({ engine, error }) => `${engine}: ${error}`).join(' | ');
  throw new FreeCrawlError(
    `All search engines failed (${detail})`,
    502,
    'search_failed',
    attempts,
  );
}
