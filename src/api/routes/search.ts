import express, { Request, Response } from 'express';
import axios from 'axios';
import { SearchRequestSchema } from '../../types';
import { scrapeUrl } from '../../core/scraper';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query, limit, scrape_results } = SearchRequestSchema.parse(req.body);
    
    // Using DuckDuckGo HTML search as a free alternative
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await axios.get(searchUrl);
    const results: any[] = [];
    
    // Simple parsing (could be improved with cheerio)
    const links = response.data.match(/class="result__a" href="([^"]+)"/g) || [];
    
    for (let i = 0; i < Math.min(links.length, limit || 5); i++) {
      const match = links[i].match(/href="([^"]+)"/);
      if (match) {
        const url = decodeURIComponent(match[1].replace('/l/?kh=-1&amp;uddg=', ''));
        results.push({ url });
      }
    }

    if (scrape_results) {
      const scrapedResults = await Promise.all(
        results.map(r => scrapeUrl({ 
          url: r.url, 
          formats: ['markdown'],
          ai_provider: 'gemini'
        }))
      );
      return res.json({ success: true, data: scrapedResults });
    }

    res.json({ success: true, data: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
