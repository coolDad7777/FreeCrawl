import express, { Request, Response } from 'express';
import { scrapeUrl } from '../../core/scraper';
import { ScrapeRequestSchema } from '../../types';
import { assertSafeUrl } from '../../core/url';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = ScrapeRequestSchema.parse(req.body);
    validated.url = await assertSafeUrl(validated.url);
    const result = await scrapeUrl(validated);
    res.json(result);
  } catch (error: any) {
    const status = error?.name === 'ZodError' ? 400 : 422;
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
