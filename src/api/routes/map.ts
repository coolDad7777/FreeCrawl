import express, { Request, Response } from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { MapRequestSchema } from '../../types';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { url, limit } = MapRequestSchema.parse(req.body);
    
    // Simple implementation: fetch page and extract all unique internal links
    const response = await axios.get(url, { headers: { 'User-Agent': 'FreeCrawl/1.0' } });
    const $ = cheerio.load(response.data);
    const baseUrl = new URL(url);
    const links = new Set<string>();

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, url).toString();
          const parsed = new URL(absoluteUrl);
          if (parsed.hostname === baseUrl.hostname) {
            links.add(absoluteUrl);
          }
        } catch (e) {}
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
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
