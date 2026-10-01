import { describe, expect, it } from 'vitest';
import { extractPage } from '../src/core/extractor';
import { htmlToMarkdown, tidyMarkdown } from '../src/core/converter';

const PAGE = `<!doctype html>
<html lang="fr">
<head>
  <title>Widget Pricing</title>
  <meta name="description" content="How much widgets cost">
  <meta property="og:image" content="https://cdn.example.com/og.png">
  <meta name="author" content="Ada Lovelace">
  <link rel="canonical" href="/pricing">
  <link rel="icon" href="/favicon.png">
</head>
<body>
  <nav class="navbar"><a href="/">Home</a><a href="/about">About</a></nav>
  <div class="cookie-banner">We use cookies to track you across the entire internet forever.</div>
  <main>
    <article>
      <h1>Widget Pricing</h1>
      <p>Widgets are sold in three tiers, and every tier includes unlimited support, a generous
      number of seats, and a predictable monthly bill, which makes budgeting straightforward for
      teams of almost any size at almost any stage of growth.</p>
      <p>The enterprise tier adds audit logging, single sign on, and a dedicated success manager,
      all of which matter once a company has compliance obligations to satisfy on a regular basis.</p>
      <table><thead><tr><th>Tier</th><th>Price</th></tr></thead>
      <tbody><tr><td>Free</td><td>$0</td></tr><tr><td>Pro</td><td>$20</td></tr></tbody></table>
      <pre><code class="language-bash">curl https://example.com</code></pre>
      <p>See the <a href="/terms">terms</a>.</p>
      <img src="/chart.png" alt="Price chart">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="pixel">
    </article>
  </main>
  <aside class="sidebar"><h3>Sponsored</h3><p>Totally unrelated advertisement content here.</p></aside>
  <footer class="site-footer">Copyright notice and a long list of legal links.</footer>
  <script>console.log('tracking');</script>
</body>
</html>`;

describe('extractPage', () => {
  const result = extractPage(PAGE, { url: 'https://example.com/pricing' });

  it('reads metadata including canonical, author, and favicon', () => {
    expect(result.metadata.title).toBe('Widget Pricing');
    expect(result.metadata.description).toBe('How much widgets cost');
    expect(result.metadata.language).toBe('fr');
    expect(result.metadata.canonical).toBe('https://example.com/pricing');
    expect(result.metadata.author).toBe('Ada Lovelace');
    expect(result.metadata.favicon).toBe('https://example.com/favicon.png');
    expect(result.metadata.ogImage).toBe('https://cdn.example.com/og.png');
  });

  it('keeps the article and drops navigation, cookie banners, sidebars, and footers', () => {
    expect(result.text).toContain('Widgets are sold in three tiers');
    expect(result.text).not.toContain('Sponsored');
    expect(result.text).not.toContain('We use cookies');
    expect(result.text).not.toContain('Copyright notice');
  });

  it('removes scripts entirely', () => {
    expect(result.html).not.toContain('console.log');
  });

  it('resolves relative links and images to absolute URLs', () => {
    expect(result.html).toContain('https://example.com/terms');
    expect(result.html).toContain('https://example.com/chart.png');
  });

  it('collects every link on the page, including navigation', () => {
    expect(result.links).toContain('https://example.com/');
    expect(result.links).toContain('https://example.com/about');
    expect(result.links).toContain('https://example.com/terms');
  });

  it('drops base64 images by default', () => {
    expect(result.html).not.toContain('data:image/gif');
  });

  it('keeps the whole document when onlyMainContent is false', () => {
    const full = extractPage(PAGE, { url: 'https://example.com/pricing', onlyMainContent: false });
    expect(full.text).toContain('Sponsored');
  });

  it('restricts output to includeTags when given', () => {
    const only = extractPage(PAGE, { url: 'https://example.com/pricing', includeTags: ['table'] });
    expect(only.html).toContain('<td>Pro</td>');
    expect(only.html).not.toContain('Widgets are sold');
  });

  it('removes excludeTags selectors', () => {
    const without = extractPage(PAGE, {
      url: 'https://example.com/pricing',
      onlyMainContent: false,
      excludeTags: ['table', 'aside'],
    });
    expect(without.html).not.toContain('<td>Pro</td>');
    expect(without.text).not.toContain('Sponsored');
  });
});

describe('extractPage with chrome nested inside the content container', () => {
  // Wikipedia's layout: <main> wraps both a site header holding the <h1> and a
  // language menu, and the article body. The header must go, the heading must not.
  const NESTED = `<!doctype html><html><head><title>Nested Chrome</title></head><body>
    <main id="content">
      <header class="page-titlebar">
        <h1>The Real Title</h1>
        <div class="language-menu"><span>22 languages</span><a href="/fr">Francais</a></div>
        <label>Toggle the table of contents</label>
      </header>
      <div class="body-content">
        <p>The article body carries the substance of the page, with enough prose, commas, and
        clauses that the extractor has no trouble recognising it as the primary content rather
        than as part of the surrounding furniture.</p>
        <p>A second paragraph makes the density heuristics even more confident about where the
        real content of this particular document actually begins and ends.</p>
      </div>
      <footer class="page-footer">Retrieved from a URL. Categories: things.</footer>
    </main>
  </body></html>`;

  const result = extractPage(NESTED, { url: 'https://example.com/page' });

  it('removes the nested header, language menu, and footer', () => {
    expect(result.text).not.toContain('22 languages');
    expect(result.text).not.toContain('Toggle the table of contents');
    expect(result.text).not.toContain('Retrieved from');
  });

  it('keeps the article body', () => {
    expect(result.text).toContain('The article body carries the substance');
  });

  it('restores the heading that lived in the removed chrome', () => {
    expect(result.html).toContain('<h1>The Real Title</h1>');
    expect(htmlToMarkdown(result.html)).toContain('# The Real Title');
  });

  it('never removes an element that contains the chosen content', () => {
    const wrapped = extractPage(
      `<html><body><header><main><article><p>${'Real content with commas, clauses, and enough length to be selected as the main body of this document. '.repeat(3)}</p></article></main></header></body></html>`,
      { url: 'https://example.com/x' },
    );
    expect(wrapped.text).toContain('Real content with commas');
  });
});

describe('htmlToMarkdown', () => {
  const markdown = htmlToMarkdown(extractPage(PAGE, { url: 'https://example.com/pricing' }).html);

  it('renders ATX headings', () => {
    expect(markdown).toContain('# Widget Pricing');
  });

  it('renders GFM tables', () => {
    expect(markdown).toMatch(/\|\s*Tier\s*\|\s*Price\s*\|/);
    expect(markdown).toMatch(/\|\s*Pro\s*\|\s*\$20\s*\|/);
  });

  it('renders fenced code blocks with the detected language', () => {
    expect(markdown).toContain('```bash');
    expect(markdown).toContain('curl https://example.com');
  });

  it('renders images with absolute sources and keeps alt text', () => {
    expect(markdown).toContain('![Price chart](https://example.com/chart.png)');
  });

  it('renders links inline', () => {
    expect(markdown).toContain('[terms](https://example.com/terms)');
  });

  it('never leaves three consecutive newlines', () => {
    expect(markdown).not.toMatch(/\n{3}/);
  });

  it('returns an empty string for empty input', () => {
    expect(htmlToMarkdown('   ')).toBe('');
  });
});

describe('tidyMarkdown', () => {
  it('collapses blank line runs and trailing whitespace', () => {
    expect(tidyMarkdown('a   \n\n\n\n\nb')).toBe('a\n\nb');
  });
});
