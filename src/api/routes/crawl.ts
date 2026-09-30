import express, { Request, Response } from 'express';
import { createCrawlJob, getCrawlJob, cancelCrawlJob } from '../../queue/worker';
import { CrawlRequestSchema } from '../../types';
import { assertSafeUrl } from '../../core/url';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = CrawlRequestSchema.parse(req.body);
    validated.url = await assertSafeUrl(validated.url);
    const jobId = await createCrawlJob(validated);
    res.json({ success: true, job_id: jobId });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/:jobId', (req: Request, res: Response) => {
  const job = getCrawlJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  res.json({ success: true, data: job });
});

router.delete('/:jobId', (req: Request, res: Response) => {
  if (!cancelCrawlJob(req.params.jobId)) {
    return res.status(404).json({ success: false, error: 'Active job not found' });
  }
  res.json({ success: true, data: { status: 'cancelled' } });
});

export default router;
