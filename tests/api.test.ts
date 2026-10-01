import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attachErrorHandlers, createApp } from '../src/api/app';
import { browserManager } from '../src/core/browser';
import { shutdownQueue } from '../src/queue/worker';
import { startFixtureServer, type FixtureServer } from './fixtures/server';

let fixture: FixtureServer;
let app: Express;

beforeAll(async () => {
  fixture = await startFixtureServer();
  app = createApp({ logging: false });
  attachErrorHandlers(app);
});

afterAll(async () => {
  await shutdownQueue();
  await browserManager.close();
  await fixture.close();
});

async function pollJob(path: string, timeoutMs = 45_000): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, any> = {};

  while (Date.now() < deadline) {
    const response = await request(app).get(path);
    last = response.body;
    if (['completed', 'failed', 'cancelled'].includes(String(last.status))) return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Job at ${path} did not finish in ${timeoutMs}ms (last status: ${last.status})`);
}

describe('GET /health', () => {
  it('reports service state', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.queue).toBe('in-process');
    expect(response.body.aiProviders).toEqual(
      expect.arrayContaining([{ name: 'gemini', configured: false }]),
    );
  });
});

describe('POST /v1/scrape', () => {
  it('returns clean markdown and metadata', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article') })
      .expect(200);

    expect(response.body.success).toBe(true);
    const { markdown, metadata } = response.body.data;
    expect(markdown).toContain('# The Main Article Heading');
    expect(markdown).toContain('| Feature | Supported |');
    expect(markdown).toContain('```python');
    expect(markdown).not.toContain('Sponsored');
    expect(markdown).not.toContain('All rights reserved');
    expect(metadata.title).toBe('Fixture Article');
    expect(metadata.statusCode).toBe(200);
    expect(metadata.engine).toBe('fetch');
    expect(metadata.scrapeDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('only returns the requested formats', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article'), formats: ['html', 'links'] })
      .expect(200);

    expect(response.body.data.markdown).toBeUndefined();
    expect(response.body.data.html).toContain('<h1>');
    expect(response.body.data.links).toContain(fixture.url('/docs/guide'));
  });

  it('exposes rawHtml with the boilerplate intact', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article'), formats: ['rawHtml'] })
      .expect(200);

    expect(response.body.data.rawHtml).toContain('site-footer');
  });

  it('keeps navigation and sidebars when onlyMainContent is false', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article'), onlyMainContent: false })
      .expect(200);

    expect(response.body.data.markdown).toContain('Sponsored');
  });

  it('restricts output with includeTags', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article'), includeTags: ['table'] })
      .expect(200);

    expect(response.body.data.markdown).toContain('| Feature | Supported |');
    expect(response.body.data.markdown).not.toContain('The Main Article Heading');
  });

  it('accepts the legacy snake_case field names', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/article'), only_main_content: false, ai_provider: 'gemini' })
      .expect(200);

    expect(response.body.data.markdown).toContain('Sponsored');
  });

  it('escalates to a headless browser for client-rendered pages', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/spa') })
      .expect(200);

    expect(response.body.data.metadata.engine).toBe('browser');
    expect(response.body.data.markdown).toContain('Rendered By JavaScript');
  });

  it('runs browser actions and captures screenshots', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({
        url: fixture.url('/article'),
        formats: ['markdown', 'screenshot'],
        actions: [{ type: 'scroll', direction: 'down' }, { type: 'wait', milliseconds: 100 }],
      })
      .expect(200);

    expect(response.body.data.metadata.engine).toBe('browser');
    expect(response.body.data.screenshot).toMatch(/^iVBOR/);
  });

  it('follows redirects and reports the final URL', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/redirect') })
      .expect(200);

    expect(response.body.data.metadata.sourceURL).toBe(fixture.url('/article'));
  });

  it('converts plain text documents to markdown', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/text.txt') })
      .expect(200);

    expect(response.body.data.markdown).toContain('A plain text document.');
  });

  it('reports the upstream status code for error pages', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/status/404') })
      .expect(200);

    expect(response.body.data.metadata.statusCode).toBe(404);
  });

  it('rejects an unsupported content type', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/binary'), engine: 'fetch' })
      .expect(415);

    expect(response.body.code).toBe('scrape_failed');
  });

  it('rejects a response larger than the configured limit', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/big'), engine: 'fetch' })
      .expect(413);

    expect(response.body.success).toBe(false);
  });

  it('honours robots.txt when asked to', async () => {
    const blocked = await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/private/secret'), respectRobotsTxt: true })
      .expect(403);
    expect(blocked.body.code).toBe('blocked_by_robots');

    await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/private/secret'), respectRobotsTxt: false })
      .expect(200);
  });

  it('rejects a missing url with a descriptive 400', async () => {
    const response = await request(app).post('/v1/scrape').send({}).expect(400);
    expect(response.body.code).toBe('invalid_request');
    expect(response.body.error).toContain('url');
  });

  it('rejects an unknown format', async () => {
    await request(app)
      .post('/v1/scrape')
      .send({ url: fixture.url('/'), formats: ['pdf'] })
      .expect(400);
  });

  it('rejects non-http schemes and embedded credentials', async () => {
    await request(app).post('/v1/scrape').send({ url: 'ftp://example.com/x' }).expect(422);
    await request(app).post('/v1/scrape').send({ url: 'https://user:pw@example.com' }).expect(422);
  });

  it('rejects malformed JSON bodies', async () => {
    const response = await request(app)
      .post('/v1/scrape')
      .set('Content-Type', 'application/json')
      .send('{"url":')
      .expect(400);
    expect(response.body.success).toBe(false);
  });
});

describe('POST /v1/map', () => {
  it('returns same-site page links from the sitemap and the page', async () => {
    const response = await request(app)
      .post('/v1/map')
      .send({ url: fixture.url('/') })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.links).toContain(fixture.url('/article'));
    expect(response.body.links).toContain(fixture.url('/blog/post-1'));
    expect(response.body.sources.sitemap).toBeGreaterThan(0);
  });

  it('excludes asset URLs and external hosts', async () => {
    const response = await request(app).post('/v1/map').send({ url: fixture.url('/') }).expect(200);
    expect(response.body.links.some((link: string) => link.endsWith('.css'))).toBe(false);
    expect(response.body.links.some((link: string) => link.includes('external.example.com'))).toBe(false);
  });

  it('respects the limit', async () => {
    const response = await request(app)
      .post('/v1/map')
      .send({ url: fixture.url('/'), limit: 2 })
      .expect(200);
    expect(response.body.links).toHaveLength(2);
  });

  it('ranks results by a search term', async () => {
    const response = await request(app)
      .post('/v1/map')
      .send({ url: fixture.url('/'), search: 'blog' })
      .expect(200);
    expect(response.body.links.length).toBeGreaterThan(0);
    expect(response.body.links.every((link: string) => link.includes('blog'))).toBe(true);
  });

  it('can skip the sitemap entirely', async () => {
    const response = await request(app)
      .post('/v1/map')
      .send({ url: fixture.url('/'), ignoreSitemap: true })
      .expect(200);
    expect(response.body.sources.sitemap).toBe(0);
    expect(response.body.sources.page).toBeGreaterThan(0);
  });
});

describe('POST /v1/crawl', () => {
  it('crawls a site and returns paginated documents', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), limit: 5, maxDepth: 2 })
      .expect(200);

    expect(started.body.id).toBeTruthy();
    expect(started.body.job_id).toBe(started.body.id);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    expect(job.status).toBe('completed');
    expect(job.completed).toBe(5);
    expect(job.data).toHaveLength(5);
    expect(job.data[0].markdown).toBeTruthy();
    expect(job.progress).toBe(100);

    const paged = await request(app)
      .get(`/v1/crawl/${started.body.id}?skip=0&limit=2`)
      .expect(200);
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.next).toContain('skip=2');
  });

  it('honours excludePaths', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), limit: 6, maxDepth: 2, excludePaths: ['/blog/**'] })
      .expect(200);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    const urls = job.data.map((document: any) => document.metadata.sourceURL);
    expect(urls.some((url: string) => url.includes('/blog/'))).toBe(false);
  });

  it('honours includePaths', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), limit: 5, maxDepth: 2, includePaths: ['/docs/**'] })
      .expect(200);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    const urls: string[] = job.data.map((document: any) => document.metadata.sourceURL);
    // The start URL is always crawled; everything after it must match the filter.
    expect(urls.filter((url) => url !== fixture.url('/')).every((url) => url.includes('/docs/'))).toBe(true);
    expect(urls.some((url) => url.includes('/docs/'))).toBe(true);
  });

  it('keeps crawling within the start path when crawlEntireDomain is false', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/docs/guide'), limit: 5, maxDepth: 2, crawlEntireDomain: false })
      .expect(200);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    const urls: string[] = job.data.map((document: any) => document.metadata.sourceURL);
    expect(urls.every((url) => new URL(url).pathname.startsWith('/docs/'))).toBe(true);
  });

  it('does not follow links when maxDepth is 0', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/article'), limit: 10, maxDepth: 0, ignoreSitemap: true })
      .expect(200);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    expect(job.completed).toBe(1);
  });

  it('accepts the legacy snake_case crawl fields', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), max_depth: 1, limit: 2, allow_external: false })
      .expect(200);

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    expect(job.status).toBe('completed');
    expect(job.completed).toBe(2);
  });

  it('cancels an in-flight crawl', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), limit: 50, maxDepth: 3 })
      .expect(200);

    const cancelled = await request(app).delete(`/v1/crawl/${started.body.id}`).expect(200);
    expect(cancelled.body.status).toBe('cancelled');

    const job = await pollJob(`/v1/crawl/${started.body.id}`);
    expect(job.status).toBe('cancelled');

    await request(app).delete(`/v1/crawl/${started.body.id}`).expect(409);
  });

  it('exposes per-URL errors', async () => {
    const started = await request(app)
      .post('/v1/crawl')
      .send({ url: fixture.url('/'), limit: 3 })
      .expect(200);

    await pollJob(`/v1/crawl/${started.body.id}`);
    const errors = await request(app).get(`/v1/crawl/${started.body.id}/errors`).expect(200);
    expect(Array.isArray(errors.body.errors)).toBe(true);
  });

  it('returns 404 for an unknown job', async () => {
    const response = await request(app).get('/v1/crawl/does-not-exist').expect(404);
    expect(response.body.code).toBe('not_found');
  });

  it('rejects an out-of-range limit', async () => {
    await request(app).post('/v1/crawl').send({ url: fixture.url('/'), limit: 0 }).expect(400);
  });
});

describe('POST /v1/batch/scrape', () => {
  it('scrapes every URL and reports failures separately', async () => {
    const started = await request(app)
      .post('/v1/batch/scrape')
      .send({
        urls: [fixture.url('/article'), fixture.url('/docs/guide'), fixture.url('/binary')],
        scrapeOptions: { formats: ['markdown'], engine: 'fetch' },
      })
      .expect(200);

    const job = await pollJob(`/v1/batch/scrape/${started.body.id}`);
    expect(job.status).toBe('completed');
    expect(job.completed).toBe(2);
    expect(job.errorCount).toBe(1);

    const errors = await request(app).get(`/v1/batch/scrape/${started.body.id}/errors`).expect(200);
    expect(errors.body.errors[0].url).toBe(fixture.url('/binary'));
  });

  it('rejects an empty URL list', async () => {
    await request(app).post('/v1/batch/scrape').send({ urls: [] }).expect(400);
  });
});

describe('POST /v1/extract', () => {
  it('reports a clear error when no AI provider is configured', async () => {
    const response = await request(app)
      .post('/v1/extract')
      .send({ urls: [fixture.url('/article')], prompt: 'Extract the heading' })
      .expect(501);

    expect(response.body.code).toBe('not_configured');
    expect(response.body.error).toContain('GEMINI_API_KEY');
  });

  it('requires a prompt or a schema', async () => {
    await request(app).post('/v1/extract').send({ urls: [fixture.url('/article')] }).expect(400);
  });

  it('requires at least one URL', async () => {
    await request(app).post('/v1/extract').send({ prompt: 'anything' }).expect(400);
  });
});

describe('unknown routes', () => {
  it('returns a JSON 404 under /v1', async () => {
    const response = await request(app).post('/v1/nope').expect(404);
    expect(response.body.code).toBe('not_found');
  });

  it('is not shadowed by the SPA middleware mounted after the API', async () => {
    const withFrontend = createApp({ logging: false });
    // Stands in for the Vite/static handler, which answers anything it is given.
    withFrontend.use((_req, res) => res.status(404).end());
    attachErrorHandlers(withFrontend);

    const response = await request(withFrontend).post('/v1/nope').expect(404);
    expect(response.body.code).toBe('not_found');
  });
});
