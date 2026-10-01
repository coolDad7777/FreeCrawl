import express, { type Request, type Response } from 'express';
import { getAIProvider } from '../../ai';
import { FreeCrawlError, toErrorMessage } from '../../core/errors';
import { scrapeDocument } from '../../core/scraper';
import { assertSafeUrl } from '../../core/url';
import { ExtractRequestSchema } from '../../types';
import { asyncHandler } from '../middleware';

const router = express.Router();

const MAX_CHARS_PER_SOURCE = 60_000;

router.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const request = ExtractRequestSchema.parse(req.body ?? {});
    const requested = request.urls ?? (request.url ? [request.url] : []);
    const urls = await Promise.all(requested.map((url) => assertSafeUrl(url)));

    const provider = getAIProvider(request.aiProvider);
    if (!provider.isConfigured()) {
      throw new FreeCrawlError(
        `AI provider "${provider.name}" is not configured. Set ${provider.name === 'groq' ? 'GROQ_API_KEY' : 'GEMINI_API_KEY'}.`,
        501,
        'not_configured',
      );
    }

    const sources: { url: string; status: 'ok' | 'failed'; title?: string; error?: string }[] = [];
    const sections: string[] = [];

    await Promise.all(
      urls.map(async (url, index) => {
        try {
          const document = await scrapeDocument(url, {
            ...(request.scrapeOptions ?? {}),
            formats: ['markdown'],
          });
          sections[index] = [
            `## Source ${index + 1}: ${document.metadata.title || url}`,
            `URL: ${url}`,
            '',
            (document.markdown ?? '').slice(0, MAX_CHARS_PER_SOURCE),
          ].join('\n');
          sources[index] = { url, status: 'ok', title: document.metadata.title };
        } catch (error) {
          sections[index] = '';
          sources[index] = { url, status: 'failed', error: toErrorMessage(error) };
        }
      }),
    );

    const content = sections.filter(Boolean).join('\n\n---\n\n');
    if (!content.trim()) {
      throw new FreeCrawlError(
        `Could not scrape any of the requested URLs: ${sources
          .map((source) => `${source.url} (${source.error ?? 'empty'})`)
          .join('; ')}`,
        502,
        'scrape_failed',
      );
    }

    const data = await provider.extractStructured({
      content,
      schema: request.schema,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
      sourceUrl: urls.join(', '),
    });

    res.json({ success: true, data, sources, provider: provider.name });
  }),
);

export default router;
