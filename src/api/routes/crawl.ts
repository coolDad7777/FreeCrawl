import express, { Request, Response } from 'express';
import { createCrawlJob, getCrawlJob } from '../../queue/worker';
import { CrawlRequestSchema } from '../../types';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = CrawlRequestSchema.parse(req.body);
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

export default router;
