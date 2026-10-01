import express, { type Request, type Response } from 'express';
import { toErrorMessage } from '../../core/errors';
import { scrapeDocument } from '../../core/scraper';
import { searchWeb } from '../../core/search';
import { isSafeUrl } from '../../core/url';
import { SearchRequestSchema, type SearchResult } from '../../types';
import { asyncHandler } from '../middleware';

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const request = SearchRequestSchema.parse(req.body ?? {});

    const { results, engine, attempts } = await searchWeb(
      {
        query: request.query,
        limit: request.limit,
        lang: request.lang,
        country: request.country,
      },
      request.engine,
    );

    const scrapeOptions =
      request.scrapeOptions ?? (request.scrape_results ? { formats: ['markdown' as const] } : undefined);

    if (!scrapeOptions) {
      res.json({
        success: true,
        engine,
        data: results satisfies SearchResult[],
        ...(attempts.length > 0 ? { warning: `Fell back from: ${attempts.map((a) => a.engine).join(', ')}` } : {}),
      });
      return;
    }

    const enriched = await Promise.all(
      results.map(async (hit): Promise<SearchResult> => {
        if (!(await isSafeUrl(hit.url))) {
          return { ...hit, description: hit.description || 'Skipped: unsafe or unresolvable URL' };
        }
        try {
          const document = await scrapeDocument(hit.url, scrapeOptions);
          return {
            ...hit,
            title: hit.title || document.metadata.title,
            description: hit.description || document.metadata.description,
            markdown: document.markdown,
            html: document.html,
            rawHtml: document.rawHtml,
            links: document.links,
            screenshot: document.screenshot,
            json: document.json,
            metadata: document.metadata,
          };
        } catch (error) {
          return { ...hit, metadata: undefined, description: hit.description, ...{ error: toErrorMessage(error) } };
        }
      }),
    );

    res.json({
      success: true,
      engine,
      data: enriched,
      ...(attempts.length > 0 ? { warning: `Fell back from: ${attempts.map((a) => a.engine).join(', ')}` } : {}),
    });
  }),
);

export default router;
