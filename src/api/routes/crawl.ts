import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { config } from '../../config';
import { NotFoundError } from '../../core/errors';
import { assertSafeUrl } from '../../core/url';
import { CrawlRequestSchema, type JobRecord } from '../../types';
import {
  cancelJob,
  countJobDocuments,
  createCrawlJob,
  getJob,
  getJobDocuments,
} from '../../queue/worker';
import { asyncHandler } from '../middleware';

const router = express.Router();

const PaginationSchema = z.object({
  skip: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(1_000).default(100),
});

function statusPath(job: JobRecord): string {
  return job.kind === 'crawl' ? 'crawl' : 'batch/scrape';
}

/** Firecrawl-compatible job status envelope with cursor pagination. */
export function jobStatusResponse(
  job: JobRecord,
  query: unknown,
  baseUrl: string,
): Record<string, unknown> {
  const { skip, limit } = PaginationSchema.parse(query ?? {});
  const total = countJobDocuments(job.id);
  const data = getJobDocuments(job.id, { offset: skip, limit });
  const nextSkip = skip + data.length;

  return {
    success: job.status !== 'failed',
    id: job.id,
    status: job.status,
    total: Math.max(job.total, total),
    completed: total,
    creditsUsed: total,
    createdAt: job.createdAt,
    expiresAt: job.expiresAt,
    progress: job.total > 0 ? Math.min(100, Math.round((total / Math.max(job.total, 1)) * 100)) : 0,
    next:
      nextSkip < total
        ? `${baseUrl}/v1/${statusPath(job)}/${job.id}?skip=${nextSkip}&limit=${limit}`
        : undefined,
    errorCount: job.errors.length,
    ...(job.error ? { error: job.error } : {}),
    data,
  };
}

export function requestBaseUrl(req: Request): string {
  const forwardedProto = String(req.header('x-forwarded-proto') ?? '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.header('host') ?? `localhost:${config.port}`;
  return `${protocol}://${host}`;
}

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const request = CrawlRequestSchema.parse(req.body ?? {});
    const url = await assertSafeUrl(request.url);
    const jobId = await createCrawlJob({ ...request, url });

    res.status(200).json({
      success: true,
      id: jobId,
      // Retained so pre-1.0 clients reading `job_id` keep working.
      job_id: jobId,
      url: `${requestBaseUrl(req)}/v1/crawl/${jobId}`,
    });
  }),
);

router.get(
  '/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const job = getJob(req.params.jobId);
    if (!job) throw new NotFoundError(`No job with id "${req.params.jobId}"`);
    res.json(jobStatusResponse(job, req.query, requestBaseUrl(req)));
  }),
);

router.get(
  '/:jobId/errors',
  asyncHandler(async (req: Request, res: Response) => {
    const job = getJob(req.params.jobId);
    if (!job) throw new NotFoundError(`No job with id "${req.params.jobId}"`);
    res.json({ success: true, errors: job.errors, robotsBlocked: [] });
  }),
);

router.delete(
  '/:jobId',
  asyncHandler(async (req: Request, res: Response) => {
    const job = getJob(req.params.jobId);
    if (!job) throw new NotFoundError(`No job with id "${req.params.jobId}"`);
    const cancelled = await cancelJob(req.params.jobId);
    if (!cancelled) {
      res.status(409).json({
        success: false,
        error: `Job "${req.params.jobId}" already finished with status "${job.status}"`,
        code: 'job_not_active',
      });
      return;
    }
    res.json({ success: true, status: 'cancelled' });
  }),
);

export default router;
