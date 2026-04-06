import { z } from 'zod';

export const ScrapeRequestSchema = z.object({
  url: z.string().url(),
  formats: z.array(z.enum(['markdown', 'html', 'screenshot'])).default(['markdown']),
  actions: z.array(z.object({
    type: z.enum(['scroll', 'click', 'wait', 'type']),
    direction: z.enum(['up', 'down']).optional(),
    selector: z.string().optional(),
    ms: z.number().optional(),
    value: z.string().optional(),
  })).optional(),
  extract: z.object({
    schema: z.record(z.string(), z.string()).optional(),
    prompt: z.string().optional(),
  }).optional(),
  ai_provider: z.enum(['gemini', 'groq', 'ollama']).default('gemini'),
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
    };
  };
  error?: string;
}

export const CrawlRequestSchema = z.object({
  url: z.string().url(),
  max_depth: z.number().min(1).max(5).default(2),
  limit: z.number().min(1).max(100).default(10),
  allow_external: z.boolean().default(false),
  scrape_options: ScrapeRequestSchema.omit({ url: true }).optional(),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

export interface CrawlJob {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  results: ScrapeResponse[];
  total_pages: number;
  created_at: string;
}

export const MapRequestSchema = z.object({
  url: z.string().url(),
  limit: z.number().min(1).max(500).default(100),
});

export type MapRequest = z.infer<typeof MapRequestSchema>;

export const SearchRequestSchema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(10).default(5),
  scrape_results: z.boolean().default(false),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;
