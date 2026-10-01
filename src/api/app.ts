import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express, { type Express } from 'express';
import morgan from 'morgan';
import { config } from '../config';
import { listAIProviders } from '../ai';
import { scrapeCache } from '../core/cache';
import { jobStore } from '../queue/store';
import { queueBackend } from '../queue/worker';
import {
  createRateLimiter,
  errorHandler,
  notFoundHandler,
  requireApiKey,
} from './middleware';
import batchRouter from './routes/batch';
import crawlRouter from './routes/crawl';
import extractRouter from './routes/extract';
import mapRouter from './routes/map';
import scrapeRouter from './routes/scrape';
import searchRouter from './routes/search';

export interface AppOptions {
  /** Disables request logging, which keeps test output readable. */
  logging?: boolean;
}

export function createApp(options: AppOptions = {}): Express {
  const app = express();

  app.disable('x-powered-by');
  // Needed for correct client IPs (and therefore rate limiting) behind a proxy.
  app.set('trust proxy', true);

  app.use(cors({ exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'] }));
  if (options.logging ?? !config.isProduction) {
    app.use(morgan(config.isProduction ? 'combined' : 'dev'));
  }
  app.use(express.json({ limit: '4mb' }));

  app.get('/health', (_req, res) => {
    const jobs = jobStore.stats();
    res.json({
      status: 'ok',
      version: '1.0.0',
      uptimeSeconds: Math.round(process.uptime()),
      queue: queueBackend(),
      jobs,
      cache: scrapeCache.stats(),
      aiProviders: listAIProviders(),
      searchEngines: {
        configured: config.search.engines,
        searxng: Boolean(config.search.searxngUrl),
      },
      authRequired: config.apiKeys.length > 0,
    });
  });

  app.get('/openapi.yaml', (_req, res) => {
    const specPath = path.join(process.cwd(), 'openapi.yaml');
    if (!fs.existsSync(specPath)) {
      res.status(404).json({ success: false, error: 'openapi.yaml is not present' });
      return;
    }
    res.type('yaml').send(fs.readFileSync(specPath, 'utf8'));
  });

  const v1 = express.Router();
  v1.use(createRateLimiter());
  v1.use(requireApiKey);
  v1.use('/scrape', scrapeRouter);
  v1.use('/batch/scrape', batchRouter);
  v1.use('/crawl', crawlRouter);
  v1.use('/map', mapRouter);
  v1.use('/search', searchRouter);
  v1.use('/extract', extractRouter);
  // Registered here, not in attachErrorHandlers: the Vite/static middleware that
  // follows would otherwise answer unknown /v1 paths with an empty 404.
  v1.use(notFoundHandler);
  app.use('/v1', v1);

  return app;
}

/** Registers the SPA (Vite in development, built assets in production). */
export async function attachFrontend(app: Express): Promise<void> {
  if (config.isProduction) {
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distPath)) {
      console.warn('[web] dist/ is missing; run "npm run build" to serve the playground.');
      return;
    }
    app.use(express.static(distPath));
    app.get(/^\/(?!v1\/|health$|openapi\.yaml$).*/, (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    return;
  }

  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

export function attachErrorHandlers(app: Express): void {
  app.use(errorHandler);
}
