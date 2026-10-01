import express, { type Request, type Response } from 'express';
import { NotFoundError } from '../../core/errors';
import { assertSafeUrl } from '../../core/url';
import { BatchScrapeRequestSchema } from '../../types';
import { cancelJob, createBatchScrapeJob, getJob } from '../../queue/worker';
import { asyncHandler } from '../middleware';
import { jobStatusResponse, requestBaseUrl } from './crawl';

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const request = BatchScrapeRequestSchema.parse(req.body ?? {});
    const urls = await Promise.all(request.urls.map((url) => assertSafeUrl(url)));
    const jobId = await createBatchScrapeJob({ ...request, urls });

    res.status(200).json({
      success: true,
      id: jobId,
      url: `${requestBaseUrl(req)}/v1/batch/scrape/${jobId}`,
      invalidURLs: [],
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
