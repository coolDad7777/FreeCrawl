import { z } from 'zod';
import { config } from '../config';

/**
 * Requests accept Firecrawl's camelCase field names. The snake_case names used
 * by earlier FreeCrawl releases keep working: `aliases` rewrites them before
 * validation so both spellings hit the same schema.
 */
function aliases<T extends z.ZodTypeAny>(map: Record<string, string>, schema: T) {
  return z.preprocess((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = { ...input };
    for (const [from, to] of Object.entries(map)) {
      if (from in output && !(to in output)) {
        output[to] = output[from];
        delete output[from];
      }
    }
    return output;
  }, schema);
}

export const SCRAPE_FORMATS = [
  'markdown',
  'html',
  'rawHtml',
  'links',
  'screenshot',
  'screenshot@fullPage',
  'json',
] as const;

export type ScrapeFormat = (typeof SCRAPE_FORMATS)[number];

const FormatSchema = z.preprocess(
  (value) => (value === 'extract' ? 'json' : value),
  z.enum(SCRAPE_FORMATS),
);

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('wait'),
    milliseconds: z.number().int().min(0).max(30_000).optional(),
    selector: z.string().min(1).max(500).optional(),
  }),
  z.object({
    type: z.literal('click'),
    selector: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('write'),
    selector: z.string().min(1).max(500).optional(),
    text: z.string().max(10_000),
  }),
  z.object({
    type: z.literal('press'),
    key: z.string().min(1).max(50),
  }),
  z.object({
    type: z.literal('scroll'),
    direction: z.enum(['up', 'down']).default('down'),
    amount: z.number().int().min(1).max(50).default(1),
  }),
  z.object({
    type: z.literal('scrape'),
  }),
  z.object({
    type: z.literal('screenshot'),
    fullPage: z.boolean().default(false),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

/** Accepts either a JSON Schema object or a flat `{ field: description }` map. */
export const ExtractionSchemaSchema = z.record(z.string(), z.unknown());

export const JsonOptionsSchema = aliases(
  { systemPrompt: 'systemPrompt' },
  z.object({
    schema: ExtractionSchemaSchema.optional(),
    prompt: z.string().max(10_000).optional(),
    systemPrompt: z.string().max(10_000).optional(),
  }),
);

export const ScrapeOptionsSchema = aliases(
  {
    only_main_content: 'onlyMainContent',
    include_tags: 'includeTags',
    exclude_tags: 'excludeTags',
    wait_for: 'waitFor',
    ai_provider: 'aiProvider',
    extract: 'jsonOptions',
    json_options: 'jsonOptions',
    max_age: 'maxAge',
    skip_cache: 'skipCache',
    remove_base64_images: 'removeBase64Images',
    respect_robots_txt: 'respectRobotsTxt',
  },
  z.object({
    formats: z.array(FormatSchema).min(1).max(SCRAPE_FORMATS.length).default(['markdown']),
    /** `auto` uses a plain HTTP fetch and escalates to a browser when needed. */
    engine: z.enum(['auto', 'fetch', 'browser']).default('auto'),
    onlyMainContent: z.boolean().default(true),
    includeTags: z.array(z.string().min(1).max(200)).max(100).default([]),
    excludeTags: z.array(z.string().min(1).max(200)).max(100).default([]),
    headers: z.record(z.string(), z.string()).default({}),
    waitFor: z.number().int().min(0).max(30_000).default(0),
    mobile: z.boolean().default(false),
    timeout: z.number().int().min(1_000).max(300_000).default(config.scrape.timeoutMs),
    actions: z.array(ActionSchema).max(25).optional(),
    jsonOptions: JsonOptionsSchema.optional(),
    aiProvider: z.enum(['gemini', 'groq']).default(config.ai.defaultProvider),
    removeBase64Images: z.boolean().default(true),
    respectRobotsTxt: z.boolean().default(config.scrape.respectRobotsTxt),
    /** Serve a cached result when it is younger than this, in milliseconds. */
    maxAge: z.number().int().min(0).max(31 * 24 * 3600 * 1000).optional(),
    skipCache: z.boolean().default(false),
  }),
);

export type ScrapeOptions = z.infer<typeof ScrapeOptionsSchema>;

export const ScrapeRequestSchema = z.intersection(
  z.object({ url: z.string().min(1).max(4_000) }),
  ScrapeOptionsSchema,
);

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;

export const BatchScrapeRequestSchema = aliases(
  { scrape_options: 'scrapeOptions' },
  z.object({
    urls: z.array(z.string().min(1).max(4_000)).min(1).max(1_000),
    scrapeOptions: ScrapeOptionsSchema.optional(),
  }),
);

export type BatchScrapeRequest = z.infer<typeof BatchScrapeRequestSchema>;

export interface PageMetadata {
  title: string;
  description: string;
  language: string;
  sourceURL: string;
  statusCode?: number;
  contentType?: string;
  canonical?: string;
  keywords?: string;
  author?: string;
  publishedTime?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogSiteName?: string;
  favicon?: string;
  scrapeDurationMs: number;
  engine: 'fetch' | 'browser' | 'cache';
  error?: string;
}

export interface Document {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, unknown>;
  /** Deprecated alias of `json`, kept for pre-1.0 FreeCrawl clients. */
  extract?: Record<string, unknown>;
  actions?: { screenshots: string[]; scrapes: { url: string; html: string }[] };
  metadata: PageMetadata;
  warning?: string;
}

export interface ScrapeResponse {
  success: boolean;
  data: Document | null;
  error?: string;
}

export const CrawlRequestSchema = aliases(
  {
    max_depth: 'maxDepth',
    scrape_options: 'scrapeOptions',
    allow_external: 'allowExternalLinks',
    allow_external_links: 'allowExternalLinks',
    include_paths: 'includePaths',
    exclude_paths: 'excludePaths',
    ignore_sitemap: 'ignoreSitemap',
    include_subdomains: 'includeSubdomains',
    allow_backward_links: 'crawlEntireDomain',
    crawl_entire_domain: 'crawlEntireDomain',
    max_concurrency: 'maxConcurrency',
  },
  z.object({
    url: z.string().min(1).max(4_000),
    maxDepth: z.number().int().min(0).max(config.crawl.maxDepth).default(2),
    limit: z.number().int().min(1).max(config.crawl.maxPages).default(10),
    includePaths: z.array(z.string().min(1).max(500)).max(100).default([]),
    excludePaths: z.array(z.string().min(1).max(500)).max(100).default([]),
    /** Follow links outside the start URL's path prefix. */
    crawlEntireDomain: z.boolean().default(true),
    allowExternalLinks: z.boolean().default(false),
    includeSubdomains: z.boolean().default(false),
    ignoreSitemap: z.boolean().default(false),
    deduplicateSimilarURLs: z.boolean().default(true),
    maxConcurrency: z.number().int().min(1).max(32).optional(),
    scrapeOptions: ScrapeOptionsSchema.optional(),
  }),
);

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

export type JobStatus = 'pending' | 'scraping' | 'completed' | 'failed' | 'cancelled';

export interface JobError {
  url: string;
  error: string;
  timestamp: string;
}

export interface JobRecord {
  id: string;
  kind: 'crawl' | 'batch_scrape';
  status: JobStatus;
  total: number;
  completed: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  error?: string;
  errors: JobError[];
}

export const MapRequestSchema = aliases(
  {
    ignore_sitemap: 'ignoreSitemap',
    include_subdomains: 'includeSubdomains',
  },
  z.object({
    url: z.string().min(1).max(4_000),
    /** Ranks returned links by relevance to this term. */
    search: z.string().max(500).optional(),
    limit: z.number().int().min(1).max(30_000).default(100),
    ignoreSitemap: z.boolean().default(false),
    includeSubdomains: z.boolean().default(false),
    sitemapOnly: z.boolean().default(false),
  }),
);

export type MapRequest = z.infer<typeof MapRequestSchema>;

export const SearchRequestSchema = aliases(
  { scrape_options: 'scrapeOptions' },
  z.object({
    query: z.string().trim().min(1).max(500),
    limit: z.number().int().min(1).max(50).default(5),
    lang: z.string().min(2).max(10).default('en'),
    country: z.string().min(2).max(10).default('us'),
    engine: z.enum(['auto', 'searxng', 'duckduckgo', 'bing']).default('auto'),
    scrapeOptions: ScrapeOptionsSchema.optional(),
    /** Legacy switch equivalent to `scrapeOptions: { formats: ["markdown"] }`. */
    scrape_results: z.boolean().default(false),
  }),
);

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface SearchResult {
  url: string;
  title: string;
  description: string;
  engine?: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, unknown>;
  metadata?: PageMetadata;
}

export const ExtractRequestSchema = aliases(
  {
    system_prompt: 'systemPrompt',
    ai_provider: 'aiProvider',
    scrape_options: 'scrapeOptions',
  },
  z
    .object({
      urls: z.array(z.string().min(1).max(4_000)).min(1).max(20).optional(),
      url: z.string().min(1).max(4_000).optional(),
      prompt: z.string().max(10_000).optional(),
      systemPrompt: z.string().max(10_000).optional(),
      schema: ExtractionSchemaSchema.optional(),
      aiProvider: z.enum(['gemini', 'groq']).default(config.ai.defaultProvider),
      scrapeOptions: ScrapeOptionsSchema.optional(),
    })
    .refine((value) => Boolean(value.url) || (value.urls && value.urls.length > 0), {
      message: 'Provide "url" or a non-empty "urls" array',
      path: ['urls'],
    })
    .refine((value) => Boolean(value.prompt) || Boolean(value.schema), {
      message: 'Provide "prompt" or "schema"',
      path: ['prompt'],
    }),
);

export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
