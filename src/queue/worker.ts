import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { CrawlRequest, CrawlJob, ScrapeResponse } from '../types';
import { scrapeUrl } from '../core/scraper';
import * as cheerio from 'cheerio';
import axios from 'axios';

const redisConnection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Mock Redis/Queue if connection fails or not available
let crawlQueue: Queue | null = null;
try {
  crawlQueue = new Queue('crawl-queue', { connection: redisConnection });
} catch (e) {
  console.warn("Redis not available, crawl queue will not work properly.");
}

const jobsStore = new Map<string, CrawlJob>();

export async function createCrawlJob(request: CrawlRequest): Promise<string> {
  const jobId = uuidv4();
  const job: CrawlJob = {
    id: jobId,
    status: 'pending',
    progress: 0,
    results: [],
    total_pages: 0,
    created_at: new Date().toISOString(),
  };
  
  jobsStore.set(jobId, job);

  if (crawlQueue) {
    await crawlQueue.add('crawl-task', { jobId, request });
  } else {
    // Fallback for demo: run in background without queue
    processCrawl(jobId, request).catch(console.error);
  }

  return jobId;
}

export function getCrawlJob(jobId: string): CrawlJob | undefined {
  return jobsStore.get(jobId);
}

async function processCrawl(jobId: string, request: CrawlRequest) {
  const job = jobsStore.get(jobId);
  if (!job) return;

  job.status = 'running';
  const visited = new Set<string>();
  const queue = [{ url: request.url, depth: 0 }];
  const results: ScrapeResponse[] = [];

  const baseUrl = new URL(request.url);

  while (queue.length > 0 && results.length < (request.limit || 10)) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);

    const scrapeResult = await scrapeUrl({
      url: current.url,
      formats: request.scrape_options?.formats || ['markdown'],
      ai_provider: request.scrape_options?.ai_provider || 'gemini',
      extract: request.scrape_options?.extract,
    });

    if (scrapeResult.success) {
      results.push(scrapeResult);
      job.results = [...results];
      job.progress = Math.round((results.length / (request.limit || 10)) * 100);
      
      // Extract links for next depth
      if (current.depth < (request.max_depth || 2)) {
        const $ = cheerio.load(scrapeResult.data.html || '');
        $('a').each((_, el) => {
          const href = $(el).attr('href');
          if (href) {
            try {
              const absoluteUrl = new URL(href, current.url).toString();
              const parsedAbsolute = new URL(absoluteUrl);
              
              const isSameDomain = parsedAbsolute.hostname === baseUrl.hostname;
              if (isSameDomain || request.allow_external) {
                if (!visited.has(absoluteUrl)) {
                  queue.push({ url: absoluteUrl, depth: current.depth + 1 });
                }
              }
            } catch (e) {}
          }
        });
      }
    }
  }

  job.status = 'completed';
  job.progress = 100;
  job.total_pages = results.length;
}

// Worker setup (only if Redis is available)
if (crawlQueue) {
  new Worker('crawl-queue', async (job: Job) => {
    const { jobId, request } = job.data;
    await processCrawl(jobId, request);
  }, { connection: redisConnection });
}
