import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { parseBingRss, parseDuckDuckGoHtml, resolveEngineOrder, searchWeb } from '../src/core/search';

const DDG_HTML = `<html><body>
<div class="result results_links">
  <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone&amp;rut=x">First Result</a></h2>
  <a class="result__snippet">The first snippet text.</a>
</div>
<div class="result results_links">
  <h2><a class="result__a" href="https://example.com/two">Second Result</a></h2>
  <a class="result__snippet">The second snippet text.</a>
</div>
<div class="result results_links result--ad">
  <h2><a class="result__a" href="//duckduckgo.com/l/?rut=noTarget">Ad With No Target</a></h2>
</div>
</body></html>`;

const BING_RSS = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
  <title>Bing: test</title>
  <item><title>Alpha</title><link>https://alpha.example.com/</link><description>Alpha description</description></item>
  <item><title>Beta</title><link>https://beta.example.com/page</link><description>Beta description</description></item>
  <item><title>Relative</title><link>/not-absolute</link><description>Dropped</description></item>
</channel></rss>`;

describe('parseDuckDuckGoHtml', () => {
  const hits = parseDuckDuckGoHtml(DDG_HTML);

  it('unwraps redirect links', () => {
    expect(hits[0].url).toBe('https://example.com/one');
  });

  it('keeps titles and snippets', () => {
    expect(hits[0].title).toBe('First Result');
    expect(hits[0].description).toBe('The first snippet text.');
  });

  it('keeps direct links', () => {
    expect(hits[1].url).toBe('https://example.com/two');
  });

  it('drops entries with no resolvable target', () => {
    expect(hits).toHaveLength(2);
  });
});

describe('parseBingRss', () => {
  const hits = parseBingRss(BING_RSS);

  it('reads each item', () => {
    expect(hits.map((hit) => hit.url)).toEqual([
      'https://alpha.example.com/',
      'https://beta.example.com/page',
    ]);
    expect(hits[0].title).toBe('Alpha');
    expect(hits[1].description).toBe('Beta description');
  });

  it('returns nothing for an empty feed', () => {
    expect(parseBingRss('<rss><channel></channel></rss>')).toEqual([]);
  });
});

describe('resolveEngineOrder', () => {
  const originalEngines = [...config.search.engines];
  const originalSearxng = config.search.searxngUrl;

  afterEach(() => {
    config.search.engines = [...originalEngines];
    config.search.searxngUrl = originalSearxng;
  });

  it('skips SearXNG when no instance is configured', () => {
    config.search.engines = ['searxng', 'duckduckgo', 'bing'];
    config.search.searxngUrl = '';
    expect(resolveEngineOrder('auto')).toEqual(['duckduckgo', 'bing']);
  });

  it('keeps SearXNG first when it is configured', () => {
    config.search.searxngUrl = 'https://searx.internal';
    expect(resolveEngineOrder('auto')).toEqual(['searxng', 'duckduckgo', 'bing']);
  });

  it('honours an explicit engine choice', () => {
    expect(resolveEngineOrder('bing')).toEqual(['bing']);
  });
});

describe('searchWeb against a SearXNG instance', () => {
  let server: http.Server;
  let origin: string;
  let mode: 'ok' | 'empty' | 'html' | 'error' = 'ok';
  const originalSearxng = config.search.searxngUrl;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const query = new URL(req.url ?? '/', 'http://x').searchParams.get('q');

      if (mode === 'error') {
        res.writeHead(503).end('unavailable');
        return;
      }
      if (mode === 'html') {
        res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not json</html>');
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          query,
          results:
            mode === 'empty'
              ? []
              : [
                  { url: 'https://example.com/a?utm_source=searx', title: 'Result A', content: 'Snippet A' },
                  { url: 'https://example.com/b', title: 'Result B', content: 'Snippet B' },
                  { url: 'https://example.com/a', title: 'Duplicate A', content: 'Dupe' },
                  { title: 'No URL', content: 'skipped' },
                ],
        }),
      );
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    config.search.searxngUrl = origin;
  });

  afterAll(async () => {
    config.search.searxngUrl = originalSearxng;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns deduplicated, normalized results', async () => {
    mode = 'ok';
    const { results, engine } = await searchWeb(
      { query: 'freecrawl', limit: 5, lang: 'en', country: 'us' },
      'searxng',
    );

    expect(engine).toBe('searxng');
    expect(results.map((hit) => hit.url)).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(results[0].title).toBe('Result A');
    expect(results[0].engine).toBe('searxng');
  });

  it('respects the limit', async () => {
    mode = 'ok';
    const { results } = await searchWeb({ query: 'x', limit: 1, lang: 'en', country: 'us' }, 'searxng');
    expect(results).toHaveLength(1);
  });

  it('explains how to fix a non-JSON response', async () => {
    mode = 'html';
    await expect(
      searchWeb({ query: 'x', limit: 3, lang: 'en', country: 'us' }, 'searxng'),
    ).rejects.toThrow(/json.*settings\.yml/i);
  });

  it('reports every failed engine when none succeed', async () => {
    mode = 'error';
    await expect(
      searchWeb({ query: 'x', limit: 3, lang: 'en', country: 'us' }, 'searxng'),
    ).rejects.toThrow(/searxng: /);
  });

  it('fails clearly when an engine returns no results', async () => {
    mode = 'empty';
    await expect(
      searchWeb({ query: 'x', limit: 3, lang: 'en', country: 'us' }, 'searxng'),
    ).rejects.toThrow(/No results/);
  });
});
