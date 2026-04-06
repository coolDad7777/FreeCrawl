import express, { Request, Response } from 'express';
import { scrapeUrl } from '../../core/scraper';
import { ScrapeRequestSchema } from '../../types';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = ScrapeRequestSchema.parse(req.body);
    const result = await scrapeUrl(validated);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

export default router;
