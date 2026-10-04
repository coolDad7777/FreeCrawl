import express, { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { MapRequestSchema } from '../../types';
import { assertSafeUrl, isAllowedLink, normalizeUrl } from '../../core/url';

const router = express.Router();
const maxRedirects = 5;

async function fetchSafePage(url: string) {
  let target = url;

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const response = await axios.get(target, {
      headers: { 'User-Agent': 'FreeCrawl/1.0' },
      timeout: 30000,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 10 * 1024 * 1024,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (response.status < 300) return { response, url: target };

    const location = response.headers.location;
    if (!location) throw new Error('Redirect response is missing a Location header');
    target = await assertSafeUrl(new URL(location, target).toString());
  }

  throw new Error(`Too many redirects (maximum ${maxRedirects})`);
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { url: requestedUrl, limit } = MapRequestSchema.parse(req.body);
    const url = await assertSafeUrl(requestedUrl);
    
    // Simple implementation: fetch page and extract all unique internal links
    const { response, url: finalUrl } = await fetchSafePage(url);
    const $ = cheerio.load(response.data);
    const baseUrl = new URL(finalUrl);
    const links = new Set<string>();

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const absoluteUrl = normalizeUrl(new URL(href, finalUrl).toString());
          if (isAllowedLink(absoluteUrl, baseUrl, false)) links.add(absoluteUrl);
        } catch {}
      }
      if (links.size >= (limit || 100)) return false;
    });

    res.json({
      success: true,
      data: {
        url: finalUrl,
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
