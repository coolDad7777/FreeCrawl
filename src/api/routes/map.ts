import express, { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { MapRequestSchema } from '../../types';
import { isAllowedLink, normalizeUrl } from '../../core/url';
import { fetchText } from '../../core/fetcher';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { url: requestedUrl, limit } = MapRequestSchema.parse(req.body);
    const fetched = await fetchText(requestedUrl);
    const url = fetched.url;
    
    const $ = cheerio.load(fetched.body);
    const baseUrl = new URL(url);
    const links = new Set<string>();

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const absoluteUrl = normalizeUrl(new URL(href, url).toString());
          if (isAllowedLink(absoluteUrl, baseUrl, false)) links.add(absoluteUrl);
        } catch {}
      }
      if (links.size >= (limit || 100)) return false;
    });

    res.json({
      success: true,
      data: {
        url,
        links: Array.from(links),
        count: links.size
      }
    });
  } catch (error: any) {
    const status = error?.name === 'ZodError' ? 400 : 422;
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
