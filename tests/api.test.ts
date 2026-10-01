import assert from 'node:assert/strict';
import http, { Server } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { AddressInfo } from 'node:net';

process.env.FREECRAWL_ALLOW_PRIVATE_HOSTS = 'true';
process.env.FREECRAWL_DISABLE_REDIS = 'true';
process.env.FREECRAWL_DISABLE_VITE = 'true';

let fixtureServer: Server;
let apiServer: Server;
let fixtureBaseUrl = '';
let apiBaseUrl = '';

function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function post(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function waitForCrawl(jobId: string): Promise<any> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(`${apiBaseUrl}/v1/crawl/${jobId}`);
    const body = await response.json();
    if (['completed', 'failed', 'cancelled'].includes(body.data?.status)) return body;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for crawl job ${jobId}`);
}

before(async () => {
  fixtureServer = http.createServer((req, res) => {
    if (req.url === '/about') {
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html lang="en"><title>About FreeCrawl</title><body><main><h1>About FreeCrawl</h1><p>FreeCrawl turns websites into LLM-ready markdown.</p></main></body></html>');
      return;
    }

    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html lang="en"><head><title>FreeCrawl Fixture</title><meta name="description" content="Fixture page for API tests"></head><body><main><h1>Welcome to FreeCrawl</h1><p>FreeCrawl is a no-key web scraping service.</p><a href="/about">About</a></main></body></html>');
  });
  fixtureBaseUrl = await listen(fixtureServer);

  const { createApp } = await import('../server');
  const app = await createApp();
  apiServer = http.createServer(app);
  apiBaseUrl = await listen(apiServer);
});

after(async () => {
  await close(apiServer);
  await close(fixtureServer);
});

describe('FreeCrawl API', () => {
  it('scrapes markdown, html, metadata, and local extraction without API keys', async () => {
    const body = await post('/v1/scrape', {
      url: fixtureBaseUrl,
      formats: ['markdown', 'html'],
      extract: {
        schema: {
          title: 'Page title',
          summary: 'Short summary',
        },
      },
      ai_provider: 'local',
    });

    assert.equal(body.success, true);
    assert.match(body.data.markdown, /Welcome to FreeCrawl/);
    assert.match(body.data.html, /Fixture page for API tests/);
    assert.equal(body.data.metadata.title, 'FreeCrawl Fixture');
    assert.equal(body.data.extract.title, 'Welcome to FreeCrawl');
    assert.ok(body.data.extract.summary.length > 0);
  });

  it('maps same-host links from a page', async () => {
    const body = await post('/v1/map', { url: fixtureBaseUrl, limit: 5 });

    assert.equal(body.success, true);
    assert.deepEqual(body.data.links, [`${fixtureBaseUrl}/about`]);
    assert.equal(body.data.count, 1);
  });

  it('crawls recursively with the in-memory fallback', async () => {
    const created = await post('/v1/crawl', {
      url: fixtureBaseUrl,
      max_depth: 1,
      limit: 2,
      scrape_options: { formats: ['markdown'], ai_provider: 'local' },
    });
    assert.equal(created.success, true);

    const job = await waitForCrawl(created.job_id);
    assert.equal(job.data.status, 'completed');
    assert.equal(job.data.total_pages, 2);
    assert.match(job.data.results[0].data.markdown, /Welcome to FreeCrawl/);
    assert.equal(job.data.results[0].data.html, undefined);
  });

  it('extracts structured data from one or more URLs', async () => {
    const body = await post('/v1/extract', {
      urls: [fixtureBaseUrl],
      schema: { title: 'Page title', summary: 'Short summary' },
      ai_provider: 'local',
    });

    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].success, true);
    assert.equal(body.data[0].data.title, 'Welcome to FreeCrawl');
  });
});
