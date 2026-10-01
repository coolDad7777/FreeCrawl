import express, { Request, Response } from 'express';
import { ExtractRequestSchema } from '../../types';
import { getAIProvider } from '../../ai';
import { scrapeUrl } from '../../core/scraper';
import { assertSafeUrl } from '../../core/url';

const router = express.Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const validated = ExtractRequestSchema.parse(req.body);
    const ai = getAIProvider(validated.ai_provider);
    const data = [];

    for (const requestedUrl of validated.urls) {
      const url = await assertSafeUrl(requestedUrl);
      const scrape = await scrapeUrl({ url, formats: ['markdown'], ai_provider: 'local' });

      if (!scrape.success) {
        data.push({ url, success: false, error: scrape.error });
        continue;
      }

      data.push({
        url: scrape.data.metadata.url,
        success: true,
        data: await ai.extractStructured(scrape.data.markdown || '', validated.schema, validated.prompt),
        metadata: scrape.data.metadata,
      });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    const status = error?.name === 'ZodError' ? 400 : 422;
    res.status(status).json({ success: false, error: error.message });
  }
});

export default router;
