import express, { type Request, type Response } from 'express';
import { asyncHandler } from '../middleware';
import { scrapeDocument } from '../../core/scraper';
import { assertSafeUrl } from '../../core/url';
import { ScrapeRequestSchema } from '../../types';

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const { url, ...options } = ScrapeRequestSchema.parse(req.body ?? {});
    const safeUrl = await assertSafeUrl(url);
    const document = await scrapeDocument(safeUrl, options);
    res.json({ success: true, data: document });
  }),
);

export default router;
