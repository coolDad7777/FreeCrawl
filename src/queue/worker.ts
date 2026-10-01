import { randomUUID } from 'node:crypto';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config';
import type { BatchScrapeRequest, CrawlRequest, Document, JobRecord } from '../types';
import { toErrorMessage } from '../core/errors';
import { runBatchScrape, runCrawl } from './crawler';
import { jobStore } from './store';

const QUEUE_NAME = 'freecrawl-jobs';

type JobPayload =
  | { kind: 'crawl'; jobId: string; request: CrawlRequest }
  | { kind: 'batch_scrape'; jobId: string; request: BatchScrapeRequest };

let queue: Queue<JobPayload> | null = null;
let worker: Worker<JobPayload> | null = null;
let connection: IORedis | null = null;
let backend: 'redis' | 'in-process' = 'in-process';

async function execute(payload: JobPayload): Promise<void> {
  if (payload.kind === 'crawl') {
    await runCrawl(payload.jobId, payload.request);
  } else {
    await runBatchScrape(payload.jobId, payload.request);
  }
}

/**
 * Uses BullMQ when Redis is reachable so jobs survive process restarts and can
 * be spread over several workers. Falls back to running jobs in this process,
 * which keeps a single-container deployment working with no extra services.
 */
export async function initQueue(): Promise<'redis' | 'in-process'> {
  if (!config.jobs.redisUrl) {
    console.log('[queue] REDIS_URL is not set; running jobs in-process.');
    backend = 'in-process';
    return backend;
  }

  try {
    connection = new IORedis(config.jobs.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5_000,
      retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1_000)),
    });
    connection.on('error', () => {
      // Errors surface through the connect() rejection below; keep logs quiet.
    });

    await connection.connect();
    await connection.ping();

    queue = new Queue<JobPayload>(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    });

    worker = new Worker<JobPayload>(
      QUEUE_NAME,
      async (job: Job<JobPayload>) => execute(job.data),
      { connection, concurrency: 2 },
    );

    worker.on('failed', (job, error) => {
      if (job?.data?.jobId) {
        jobStore.update(job.data.jobId, { status: 'failed', error: toErrorMessage(error) });
      }
    });

    backend = 'redis';
    console.log(`[queue] connected to Redis at ${config.jobs.redisUrl}; using BullMQ.`);
  } catch (error) {
    console.warn(
      `[queue] Redis unavailable (${toErrorMessage(error)}); running jobs in-process.`,
    );
    await connection?.quit().catch(() => undefined);
    connection = null;
    queue = null;
    backend = 'in-process';
  }

  return backend;
}

async function dispatch(payload: JobPayload): Promise<void> {
  if (queue) {
    try {
      await queue.add(payload.kind, payload, { jobId: payload.jobId });
      return;
    } catch (error) {
      console.warn(`[queue] enqueue failed (${toErrorMessage(error)}); running in-process.`);
    }
  }

  void execute(payload).catch((error) => {
    jobStore.update(payload.jobId, { status: 'failed', error: toErrorMessage(error) });
  });
}

export async function createCrawlJob(request: CrawlRequest): Promise<string> {
  const jobId = randomUUID();
  jobStore.create(jobId, 'crawl', request, 1);
  await dispatch({ kind: 'crawl', jobId, request });
  return jobId;
}

export async function createBatchScrapeJob(request: BatchScrapeRequest): Promise<string> {
  const jobId = randomUUID();
  jobStore.create(jobId, 'batch_scrape', request, request.urls.length);
  await dispatch({ kind: 'batch_scrape', jobId, request });
  return jobId;
}

export function getJob(jobId: string): JobRecord | null {
  return jobStore.get(jobId);
}

export function getJobDocuments(
  jobId: string,
  options: { offset?: number; limit?: number } = {},
): Document[] {
  return jobStore.listDocuments(jobId, options);
}

export function countJobDocuments(jobId: string): number {
  return jobStore.countDocuments(jobId);
}

export async function cancelJob(jobId: string): Promise<boolean> {
  const cancelled = jobStore.cancel(jobId);
  if (cancelled && queue) {
    await queue.remove(jobId).catch(() => undefined);
  }
  return cancelled;
}

export function queueBackend(): 'redis' | 'in-process' {
  return backend;
}

export async function shutdownQueue(): Promise<void> {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  await connection?.quit().catch(() => undefined);
  worker = null;
  queue = null;
  connection = null;
}
