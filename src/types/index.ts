import { z } from 'zod';

export const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  formats: z.array(z.enum(['markdown', 'html', 'screenshot'])).min(1).max(3).default(['markdown']),
  actions: z.array(z.object({
    type: z.enum(['scroll', 'click', 'wait', 'type']),
    direction: z.enum(['up', 'down']).optional(),
    selector: z.string().optional(),
    ms: z.number().min(0).max(30000).optional(),
    value: z.string().max(10000).optional(),
  })).max(20).optional(),
  extract: z.object({
    schema: z.record(z.string(), z.string()).optional(),
    prompt: z.string().optional(),
  }).optional(),
  ai_provider: z.enum(['local', 'gemini', 'groq']).default('local'),
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;

export interface ScrapeResponse {
  success: boolean;
  data: {
    markdown?: string;
    html?: string;
    screenshot?: string;
    extract?: any;
    metadata: {
      title: string;
      description: string;
      language: string;
      scrape_duration_ms: number;
      url: string;
      status_code?: number;
    };
  };
  error?: string;
}

export const CrawlRequestSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(0).max(5).default(2),
  limit: z.number().min(1).max(100).default(10),
  allow_external: z.boolean().default(false),
  scrape_options: ScrapeRequestSchema.omit({ url: true }).optional(),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

export interface CrawlJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  results: ScrapeResponse[];
  total_pages: number;
  created_at: string;
  error?: string;
}

export const MapRequestSchema = z.object({
  url: z.string().url(),
  limit: z.number().min(1).max(500).default(100),
});

export type MapRequest = z.infer<typeof MapRequestSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().min(1).max(10).default(5),
  scrape_results: z.boolean().default(false),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export const ExtractRequestSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10),
  prompt: z.string().max(2000).optional(),
  schema: z.record(z.string(), z.string()).default({ summary: 'A concise summary of the page' }),
  ai_provider: z.enum(['local', 'gemini', 'groq']).default('local'),
});

export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
