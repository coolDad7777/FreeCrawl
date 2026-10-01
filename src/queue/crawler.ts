import { config } from '../config';
import type { BatchScrapeRequest, CrawlRequest, ScrapeOptions } from '../types';
import { toErrorMessage } from '../core/errors';
import { scrapeDocument } from '../core/scraper';
import { discoverSitemapUrls } from '../core/sitemap';
import { fetchRobotsTxt, isPathAllowed } from '../core/robots';
import {
  directoryPrefix,
  isCrawlableLink,
  isSameSite,
  looksLikePage,
  matchesPathFilters,
  normalizeUrl,
  urlSimilarityKey,
} from '../core/url';
import { jobStore } from './store';

interface Target {
  url: string;
  depth: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Breadth-first frontier shared by the crawl workers. */
class Frontier {
  private readonly queue: Target[] = [];
  private readonly visited = new Set<string>();
  private readonly similar = new Set<string>();

  constructor(private readonly deduplicateSimilarURLs: boolean) {}

  add(url: string, depth: number): boolean {
    let normalized: string;
    try {
      normalized = normalizeUrl(url);
    } catch {
      return false;
    }

    if (this.visited.has(normalized)) return false;

    if (this.deduplicateSimilarURLs) {
      const key = urlSimilarityKey(normalized);
      if (this.similar.has(key)) return false;
      this.similar.add(key);
    }

    this.visited.add(normalized);
    this.queue.push({ url: normalized, depth });
    return true;
  }

  take(): Target | undefined {
    return this.queue.shift();
  }

  get size(): number {
    return this.queue.length;
  }

  get discovered(): number {
    return this.visited.size;
  }
}

async function crawlDelayFor(url: string, respectRobots: boolean): Promise<number> {
  if (!respectRobots) return 0;
  const robots = await fetchRobotsTxt(url);
  return robots.crawlDelayMs;
}

export async function runCrawl(jobId: string, request: CrawlRequest): Promise<void> {
  const scrapeOptions: Partial<ScrapeOptions> = {
    ...(request.scrapeOptions ?? {}),
  };
  // `html` is needed to discover links even if the caller did not ask for it.
  const formats = new Set(scrapeOptions.formats ?? ['markdown']);
  const requestedFormats = [...formats];
  formats.add('links');
  scrapeOptions.formats = [...formats] as ScrapeOptions['formats'];

  const base = new URL(request.url);
  const basePathPrefix = request.crawlEntireDomain ? undefined : directoryPrefix(base);
  const linkOptions = {
    base,
    allowExternalLinks: request.allowExternalLinks,
    includeSubdomains: request.includeSubdomains,
    basePathPrefix,
    includePaths: request.includePaths,
    excludePaths: request.excludePaths,
  };

  const frontier = new Frontier(request.deduplicateSimilarURLs);
  frontier.add(request.url, 0);

  jobStore.update(jobId, { status: 'scraping', total: 1 });

  if (!request.ignoreSitemap) {
    try {
      const entries = await discoverSitemapUrls(request.url, {
        limit: Math.min(request.limit * 5, 5_000),
        includeSubdomains: request.includeSubdomains,
      });
      for (const entry of entries) {
        if (isCrawlableLink(entry.url, linkOptions)) frontier.add(entry.url, 1);
      }
    } catch {
      // A missing or broken sitemap is not a crawl failure.
    }
  }

  const respectRobots = scrapeOptions.respectRobotsTxt ?? config.scrape.respectRobotsTxt;
  const crawlDelayMs = await crawlDelayFor(request.url, respectRobots);
  const robots = respectRobots ? await fetchRobotsTxt(request.url) : null;

  const workerCount = Math.max(
    1,
    Math.min(request.maxConcurrency ?? config.scrape.concurrency, config.scrape.concurrency),
  );

  let completed = 0;
  let inFlight = 0;
  let stopped = false;

  const isCancelled = () => jobStore.getStatus(jobId) === 'cancelled';

  async function worker(): Promise<void> {
    while (!stopped) {
      if (completed >= request.limit) return;
      if (isCancelled()) {
        stopped = true;
        return;
      }

      const target = frontier.take();
      if (!target) {
        // Another worker may still enqueue links; only finish once all idle.
        if (inFlight === 0) return;
        await sleep(50);
        continue;
      }

      // Reserve a slot before scraping so workers cannot overshoot the limit.
      if (completed >= request.limit) return;
      inFlight += 1;

      try {
        if (robots && !isPathAllowed(robots, `${new URL(target.url).pathname}${new URL(target.url).search}`)) {
          jobStore.appendError(jobId, {
            url: target.url,
            error: 'Skipped: disallowed by robots.txt',
            timestamp: new Date().toISOString(),
          });
          continue;
        }

        const document = await scrapeDocument(target.url, scrapeOptions);

        if (completed >= request.limit || isCancelled()) continue;

        // Strip formats the caller did not request before persisting.
        const stored = { ...document };
        if (!requestedFormats.includes('links')) delete stored.links;

        completed = jobStore.appendDocument(jobId, target.url, stored);

        if (target.depth < request.maxDepth) {
          for (const link of document.links ?? []) {
            if (frontier.discovered >= request.limit * 20) break;
            if (isCrawlableLink(link, linkOptions)) frontier.add(link, target.depth + 1);
          }
        }

        jobStore.update(jobId, { total: Math.max(completed, Math.min(frontier.size + completed, request.limit)) });
      } catch (error) {
        jobStore.appendError(jobId, {
          url: target.url,
          error: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        });
      } finally {
        inFlight -= 1;
      }

      if (crawlDelayMs > 0) await sleep(crawlDelayMs);
    }
  }

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    if (isCancelled()) {
      jobStore.update(jobId, { total: completed });
      return;
    }

    jobStore.update(jobId, { status: 'completed', total: completed, completed });
  } catch (error) {
    jobStore.update(jobId, { status: 'failed', error: toErrorMessage(error), total: completed });
  }
}

export async function runBatchScrape(jobId: string, request: BatchScrapeRequest): Promise<void> {
  const urls = [...new Set(request.urls)];
  jobStore.update(jobId, { status: 'scraping', total: urls.length });

  const workerCount = Math.max(1, Math.min(config.scrape.concurrency, urls.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (jobStore.getStatus(jobId) === 'cancelled') return;
      const index = cursor;
      cursor += 1;
      if (index >= urls.length) return;

      const url = urls[index];
      try {
        const document = await scrapeDocument(url, request.scrapeOptions ?? {});
        jobStore.appendDocument(jobId, url, document);
      } catch (error) {
        jobStore.appendError(jobId, {
          url,
          error: toErrorMessage(error),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (jobStore.getStatus(jobId) === 'cancelled') return;
    jobStore.update(jobId, { status: 'completed', completed: jobStore.countDocuments(jobId) });
  } catch (error) {
    jobStore.update(jobId, { status: 'failed', error: toErrorMessage(error) });
  }
}

/** Shared by `/v1/map`: links from the page itself plus the sitemap. */
export async function mapSite(options: {
  url: string;
  limit: number;
  ignoreSitemap: boolean;
  includeSubdomains: boolean;
  sitemapOnly: boolean;
  search?: string;
}): Promise<{ links: string[]; fromSitemap: number; fromPage: number }> {
  const base = new URL(options.url);
  const collected = new Map<string, number>();
  let fromSitemap = 0;
  let fromPage = 0;

  const accept = (candidate: string, rank: number): void => {
    let parsed: URL;
    let normalized: string;
    try {
      parsed = new URL(candidate);
      normalized = normalizeUrl(candidate);
    } catch {
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return;
    if (!isSameSite(parsed, base, { includeSubdomains: options.includeSubdomains })) return;
    if (!looksLikePage(normalized)) return;
    if (!matchesPathFilters(parsed.pathname)) return;
    if (!collected.has(normalized)) collected.set(normalized, rank);
  };

  accept(options.url, 0);

  if (!options.ignoreSitemap) {
    try {
      const entries = await discoverSitemapUrls(options.url, {
        limit: Math.max(options.limit * 4, 1_000),
        includeSubdomains: options.includeSubdomains,
      });
      for (const entry of entries) {
        const before = collected.size;
        accept(entry.url, 1);
        if (collected.size > before) fromSitemap += 1;
      }
    } catch {
      // Fall back to page links only.
    }
  }

  if (!options.sitemapOnly) {
    try {
      const document = await scrapeDocument(options.url, {
        formats: ['links'],
        onlyMainContent: false,
      });
      for (const link of document.links ?? []) {
        const before = collected.size;
        accept(link, 2);
        if (collected.size > before) fromPage += 1;
      }
    } catch {
      // Sitemap-only results are still useful.
    }
  }

  let links = [...collected.entries()].sort((a, b) => a[1] - b[1]).map(([url]) => url);

  if (options.search) {
    const needle = options.search.toLowerCase();
    const score = (url: string): number => {
      const lower = url.toLowerCase();
      if (!lower.includes(needle)) return 0;
      const path = new URL(url).pathname.toLowerCase();
      return path.endsWith(needle) ? 3 : path.includes(needle) ? 2 : 1;
    };
    links = links.filter((url) => score(url) > 0).sort((a, b) => score(b) - score(a));
  }

  return { links: links.slice(0, options.limit), fromSitemap, fromPage };
}
