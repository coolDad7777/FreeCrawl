import dotenv from 'dotenv';

dotenv.config();

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function float(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(value ?? '');
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function list(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const config = {
  port: int(process.env.PORT, 3000, 1, 65535),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  get isProduction() {
    return this.nodeEnv === 'production';
  },

  /** When set, every /v1 request must send `Authorization: Bearer <key>`. */
  apiKeys: list(process.env.FREECRAWL_API_KEY, []),

  rateLimit: {
    requestsPerMinute: int(process.env.RATE_LIMIT_RPM, 60, 0, 100_000),
  },

  cache: {
    enabled: bool(process.env.CACHE_ENABLED, true),
    ttlHours: float(process.env.CACHE_TTL_HOURS, 24, 0, 24 * 365),
    path: process.env.CACHE_PATH ?? '.freecrawl/cache.sqlite',
    maxEntries: int(process.env.CACHE_MAX_ENTRIES, 5_000, 10, 1_000_000),
  },

  jobs: {
    path: process.env.JOB_STORE_PATH ?? '.freecrawl/jobs.sqlite',
    /** Jobs older than this are pruned and reported as expired. */
    retentionHours: float(process.env.JOB_RETENTION_HOURS, 24, 0.1, 24 * 30),
    redisUrl: process.env.REDIS_URL ?? '',
  },

  scrape: {
    timeoutMs: int(process.env.SCRAPE_TIMEOUT_MS, 30_000, 1_000, 300_000),
    maxBytes: int(process.env.SCRAPE_MAX_BYTES, 10 * 1024 * 1024, 1024, 200 * 1024 * 1024),
    userAgent: process.env.USER_AGENT ?? DEFAULT_USER_AGENT,
    /** Parallel page scrapes shared across every crawl and batch job. */
    concurrency: int(process.env.SCRAPE_CONCURRENCY, 4, 1, 64),
    respectRobotsTxt: bool(process.env.RESPECT_ROBOTS_TXT, true),
    /** Skip loading images/fonts/media in the browser engine. */
    blockMedia: bool(process.env.BLOCK_MEDIA, true),
  },

  crawl: {
    maxPages: int(process.env.CRAWL_MAX_PAGES, 5_000, 1, 1_000_000),
    maxDepth: int(process.env.CRAWL_MAX_DEPTH, 10, 1, 50),
  },

  search: {
    /** Ordered engine preference; the first engine returning results wins. */
    engines: list(process.env.SEARCH_ENGINES, ['searxng', 'duckduckgo', 'bing']),
    searxngUrl: (process.env.SEARXNG_URL ?? '').replace(/\/+$/, ''),
  },

  ai: {
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    groqApiKey: process.env.GROQ_API_KEY ?? '',
    groqModel: process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile',
    defaultProvider: (process.env.AI_PROVIDER ?? 'gemini') as 'gemini' | 'groq',
  },

  /**
   * Allows scraping loopback and RFC1918 addresses. Required to crawl intranet
   * hosts, and also used by the test suite against its local fixture server.
   * Leave disabled on any publicly reachable deployment: it re-opens SSRF.
   */
  allowPrivateUrls: bool(process.env.ALLOW_PRIVATE_URLS, false),
};

export type Config = typeof config;
