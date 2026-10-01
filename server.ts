import { config } from './src/config';
import { attachErrorHandlers, attachFrontend, createApp } from './src/api/app';
import { browserManager } from './src/core/browser';
import { scrapeCache } from './src/core/cache';
import { jobStore } from './src/queue/store';
import { initQueue, shutdownQueue } from './src/queue/worker';

async function main(): Promise<void> {
  // Jobs left mid-flight by an unclean shutdown can never resume; surface them
  // as failed instead of leaving clients polling forever.
  const interrupted = jobStore.failInterrupted();
  if (interrupted > 0) console.log(`[jobs] marked ${interrupted} interrupted job(s) as failed.`);
  jobStore.prune();
  scrapeCache.prune();

  await initQueue();

  const app = createApp();
  await attachFrontend(app);
  attachErrorHandlers(app);

  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`FreeCrawl listening on http://0.0.0.0:${config.port}`);
    console.log(`  API      POST /v1/scrape | /v1/crawl | /v1/map | /v1/search | /v1/extract`);
    console.log(`  Auth     ${config.apiKeys.length > 0 ? 'API key required' : 'open (set FREECRAWL_API_KEY to lock down)'}`);
  });

  const maintenance = setInterval(() => {
    jobStore.prune();
    scrapeCache.prune();
  }, 15 * 60_000);
  maintenance.unref();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] received ${signal}; closing down.`);
    clearInterval(maintenance);
    server.close();
    await shutdownQueue();
    await browserManager.close();
    scrapeCache.close();
    jobStore.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });
}

main().catch((error) => {
  console.error('Failed to start FreeCrawl:', error);
  process.exit(1);
});
