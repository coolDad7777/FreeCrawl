import express, { type Request, type Response } from 'express';
import { assertSafeUrl } from '../../core/url';
import { MapRequestSchema } from '../../types';
import { mapSite } from '../../queue/crawler';
import { asyncHandler } from '../middleware';

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const request = MapRequestSchema.parse(req.body ?? {});
    const url = await assertSafeUrl(request.url);
    const { links, fromSitemap, fromPage } = await mapSite({ ...request, url });

    res.json({
      success: true,
      links,
      // Retained for pre-1.0 clients that read `data.links`.
      data: { url, links, count: links.length },
      sources: { sitemap: fromSitemap, page: fromPage },
    });
  }),
);

export default router;
