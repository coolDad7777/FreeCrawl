import express, { Request, Response } from 'express';
import * as cheerio from 'cheerio';
import { SearchRequestSchema } from '../../types';
import { scrapeUrl } from '../../core/scraper';
import { fetchText } from '../../core/fetcher';
import { assertSafeUrl, normalizeUrl } from '../../core/url';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query, limit, scrape_results } = SearchRequestSchema.parse(req.body);
    
    // DuckDuckGo's HTML endpoint keeps search free and does not require an API key.
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetchText(searchUrl, { timeoutMs: 15000, maxBytes: 5 * 1024 * 1024 });
    const $ = cheerio.load(response.body);
    const results: Array<{ url: string; title: string; snippet: string }> = [];
    
    $('.result').each((_, element) => {
      if (results.length >= limit) return false;
      const anchor = $(element).find('.result__a').first();
      const href = anchor.attr('href');
      if (!href) return;

      try {
        const parsedHref = new URL(href, searchUrl);
        const destination = parsedHref.searchParams.get('uddg') || parsedHref.toString();
        const safeUrl = normalizeUrl(destination);
        results.push({
          url: safeUrl,
          title: anchor.text().trim(),
          snippet: $(element).find('.result__snippet').text().replace(/\s+/g, ' ').trim(),
        });
      } catch {
        // Ignore malformed search results.
      }
    });

    const safeResults = [];
    for (const result of results) {
      try {
        safeResults.push({ ...result, url: await assertSafeUrl(result.url) });
      } catch {
        // Search engines can return local or unsupported URLs. Do not surface them.
      }
    }

    if (scrape_results) {
      const scrapedResults = await Promise.all(
        safeResults.map(async (r) => ({
          ...r,
          scrape: await scrapeUrl({
            url: r.url,
            formats: ['markdown'],
            ai_provider: 'local',
          }),
        }))
      );
      return res.json({ success: true, data: scrapedResults });
    }

    res.json({ success: true, data: safeResults });
  } catch (error: any) {
    const status = error?.name === 'ZodError' ? 400 : 502;
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
