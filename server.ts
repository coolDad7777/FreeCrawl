import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import { pathToFileURL } from 'url';
import { createServer as createViteServer } from 'vite';

import scrapeRouter from './src/api/routes/scrape';
import crawlRouter from './src/api/routes/crawl';
import mapRouter from './src/api/routes/map';
import searchRouter from './src/api/routes/search';
import extractRouter from './src/api/routes/extract';

export async function createApp() {
  const app = express();

  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json({ limit: '10mb' }));

  // API Routes
  app.use('/v1/scrape', scrapeRouter);
  app.use('/v1/crawl', crawlRouter);
  app.use('/v1/map', mapRouter);
  app.use('/v1/search', searchRouter);
  app.use('/v1/extract', extractRouter);

  // Health check
  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production' && process.env.FREECRAWL_DISABLE_VITE !== 'true') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  return app;
}

export async function startServer() {
  const app = await createApp();
  const PORT = Number(process.env.PORT || 3000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FreeCrawl API running on http://localhost:${PORT}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
