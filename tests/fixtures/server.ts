import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FixtureServer {
  origin: string;
  url(path: string): string;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
}

function page(title: string, body: string, head = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="description" content="Description for ${title}">
<meta property="og:title" content="OG ${title}">
<meta property="og:site_name" content="Fixture Site">
<link rel="canonical" href="/canonical/${encodeURIComponent(title)}">
${head}
</head>
<body>
<nav class="site-nav"><a href="/">Home</a> <a href="/docs/guide">Guide</a> <a href="/private/secret">Secret</a></nav>
<header class="masthead"><h1>Fixture Site</h1></header>
${body}
<aside class="sidebar"><h4>Sponsored</h4><p>Buy things now from our sponsor.</p></aside>
<footer class="site-footer"><p>Copyright fixture. All rights reserved.</p></footer>
<script>window.__analytics = true;</script>
</body>
</html>`;
}

const ARTICLE_BODY = `
<main>
  <article class="entry-content">
    <h1>The Main Article Heading</h1>
    <p>FreeCrawl converts web pages into clean Markdown that large language models can read without
    tripping over navigation chrome, cookie banners, or sidebars. This paragraph exists so the main
    content scorer has a healthy amount of prose to work with, including several commas, clauses,
    and enough characters to clear the minimum length threshold used by the extractor.</p>
    <h2>A Second Section</h2>
    <p>The second paragraph adds more text, more commas, and more sentences so that the density
    heuristics reliably prefer this article element over the navigation and the sidebar blocks that
    surround it on the page.</p>
    <ul><li>First bullet</li><li>Second bullet</li></ul>
    <table>
      <thead><tr><th>Feature</th><th>Supported</th></tr></thead>
      <tbody><tr><td>Markdown</td><td>Yes</td></tr><tr><td>Tables</td><td>Yes</td></tr></tbody>
    </table>
    <pre><code class="language-python">print("hello from freecrawl")</code></pre>
    <p>Read the <a href="/docs/guide">guide</a> or the <a href="https://external.example.com/page">external page</a>.</p>
    <img src="/images/diagram.png" alt="Architecture diagram">
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="tracking pixel">
  </article>
</main>`;

const ROUTES: Record<string, { status?: number; type?: string; body: string }> = {
  '/': {
    body: page(
      'Fixture Home',
      `<main><article class="entry-content"><h1>Welcome</h1>
      <p>The home page links to the rest of the fixture site so the crawler and the mapper both have
      something to discover. It contains enough prose, with commas and clauses, to be chosen as the
      main content block by the extractor heuristics.</p>
      <p>Visit <a href="/article">the article</a>, <a href="/docs/guide">the guide</a>,
      <a href="/docs/reference">the reference</a>, <a href="/blog/post-1">post one</a>,
      <a href="/blog/post-2">post two</a>, and <a href="/private/secret">the secret page</a>.
      Also see <a href="/assets/app.css">a stylesheet</a> and
      <a href="https://external.example.com/">an external site</a>.</p>
      </article></main>`,
    ),
  },
  '/article': { body: page('Fixture Article', ARTICLE_BODY) },
  '/docs/guide': {
    body: page(
      'Guide',
      `<main><article><h1>Guide</h1><p>The guide page explains how the fixture site is laid out, with
      plenty of prose, commas, and clauses so the extractor treats it as real content rather than
      boilerplate furniture around the edges of the document.</p>
      <p>See also <a href="/docs/reference">the reference</a> and <a href="/article">the article</a>.</p></article></main>`,
    ),
  },
  '/docs/reference': {
    body: page(
      'Reference',
      `<main><article><h1>Reference</h1><p>The reference page lists every option, with prose, commas,
      and clauses so that the content scorer has a substantial block of text to select as the main
      article body for this particular page.</p></article></main>`,
    ),
  },
  '/blog/post-1': {
    body: page(
      'Post One',
      `<main><article><h1>Post One</h1><p>Post one is a blog entry with sufficient prose, commas, and
      clauses for the extractor to classify it as the main content of the page rather than as
      navigation or sidebar boilerplate.</p><p><a href="/blog/post-2">Next post</a></p></article></main>`,
    ),
  },
  '/blog/post-2': {
    body: page(
      'Post Two',
      `<main><article><h1>Post Two</h1><p>Post two is another blog entry with sufficient prose,
      commas, and clauses for the extractor to classify it as the main content of the page rather
      than as navigation or sidebar boilerplate.</p></article></main>`,
    ),
  },
  '/private/secret': {
    body: page(
      'Secret',
      `<main><article><h1>Secret</h1><p>This page is disallowed by robots.txt and should never be
      scraped unless the caller explicitly opts out of robots handling.</p></article></main>`,
    ),
  },
  '/spa': {
    body: `<!doctype html><html lang="en"><head><title>SPA Shell</title></head>
<body><div id="root"></div>
<script>
  document.getElementById('root').innerHTML =
    '<main><article><h1>Rendered By JavaScript</h1><p>' +
    'This paragraph only exists after the browser executes the page script, which is how the ' +
    'scraper proves that it escalated from a plain HTTP fetch to a real headless browser when the ' +
    'initial markup turned out to be an empty application shell with no readable prose at all.' +
    '</p></article></main>';
</script></body></html>`,
  },
  '/robots.txt': {
    type: 'text/plain',
    body: ['User-agent: *', 'Disallow: /private/', 'Allow: /private/public', '', 'Sitemap: /sitemap.xml'].join('\n'),
  },
  '/text.txt': { type: 'text/plain', body: 'A plain text document.\nSecond line.' },
  '/data.json': { type: 'application/json', body: '{"ok":true,"items":[1,2,3]}' },
  '/assets/app.css': { type: 'text/css', body: 'body { color: red }' },
  '/images/diagram.png': { type: 'image/png', body: 'not-a-real-png' },
  '/status/404': { status: 404, body: page('Missing', '<main><p>Not found.</p></main>') },
  '/status/500': { status: 500, body: page('Error', '<main><p>Server error.</p></main>') },
};

const SITEMAP_PATHS = ['/', '/article', '/docs/guide', '/docs/reference', '/blog/post-1', '/blog/post-2'];

export async function startFixtureServer(): Promise<FixtureServer> {
  const requests: { method: string; path: string }[] = [];

  const server = http.createServer((req, res) => {
    const parsed = new URL(req.url ?? '/', 'http://fixture.local');
    const pathname = parsed.pathname;
    requests.push({ method: req.method ?? 'GET', path: pathname });

    const origin = `http://${req.headers.host ?? 'localhost'}`;

    if (pathname === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${SITEMAP_PATHS.map((path) => `  <url><loc>${origin}${path}</loc><lastmod>2026-01-01</lastmod></url>`).join('\n')}
</urlset>`,
      );
      return;
    }

    if (pathname === '/redirect') {
      res.writeHead(302, { location: `${origin}/article` });
      res.end();
      return;
    }

    if (pathname === '/slow') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(page('Slow', '<main><p>Finally.</p></main>'));
      }, 2_000);
      return;
    }

    if (pathname === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><p>${'x'.repeat(5 * 1024 * 1024)}</p></body></html>`);
      return;
    }

    if (pathname === '/binary') {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.end(Buffer.from([0, 1, 2, 3]));
      return;
    }

    const route = ROUTES[pathname];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/html' });
      res.end(page('Not Found', '<main><p>No such page.</p></main>'));
      return;
    }

    res.writeHead(route.status ?? 200, { 'content-type': route.type ?? 'text/html; charset=utf-8' });
    res.end(route.body);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    url: (path: string) => `${origin}${path}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
