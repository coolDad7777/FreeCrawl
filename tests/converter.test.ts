import { describe, expect, it } from 'vitest';
import { htmlToMarkdown, normalizeTables } from '../src/core/converter';
import { extractPage } from '../src/core/extractor';

describe('normalizeTables', () => {
  it('leaves markup without tables untouched', () => {
    const html = '<p>Nothing tabular here.</p>';
    expect(normalizeTables(html)).toBe(html);
  });

  it('promotes the first row of a header-less table', () => {
    const normalized = normalizeTables(
      '<table><tbody><tr><td>Tier</td><td>Price</td></tr><tr><td>Pro</td><td>$20</td></tr></tbody></table>',
    );
    expect(normalized).toContain('<th>Tier</th>');
    expect(normalized).toContain('<td>Pro</td>');
  });

  it('flattens presentational tables', () => {
    const normalized = normalizeTables(
      '<table role="presentation"><tr><td><p>A notice.</p></td><td><p>An icon.</p></td></tr></table>',
    );
    expect(normalized).not.toContain('<table');
    expect(normalized).toContain('A notice.');
    expect(normalized).toContain('An icon.');
  });

  it('lifts captions out of the table', () => {
    const normalized = normalizeTables(
      '<table><caption>Pricing</caption><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(normalized).toContain('<strong>Pricing</strong>');
    expect(normalized.indexOf('Pricing')).toBeLessThan(normalized.indexOf('<table'));
    expect(normalized).not.toContain('<caption');
  });
});

describe('htmlToMarkdown table handling', () => {
  it('converts a header-less table instead of keeping raw HTML', () => {
    const markdown = htmlToMarkdown(
      '<table><tbody><tr><td>Tier</td><td>Price</td></tr><tr><td>Pro</td><td>$20</td></tr></tbody></table>',
    );
    expect(markdown).not.toContain('<table');
    expect(markdown).not.toContain('<td');
    expect(markdown).toMatch(/\|\s*Tier\s*\|\s*Price\s*\|/);
    expect(markdown).toMatch(/\|\s*Pro\s*\|\s*\$20\s*\|/);
  });

  it('emits exactly one divider row, even when later rows are header cells', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>Key</th><th>Value</th></tr><tr><th>Rows can be headers too</th><td>yes</td></tr></table>',
    );
    expect(markdown.match(/\|\s*---\s*\|/g)).toHaveLength(1);
  });

  it('keeps every row on a single line when cells contain paragraphs', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>Name</th><th>Notes</th></tr>' +
        '<tr><td><p>Pro</p></td><td><p>First note.</p><p>Second note.</p></td></tr></table>',
    );
    const row = markdown.split('\n').find((line) => line.includes('Pro'));
    expect(row).toBe('| Pro | First note. Second note. |');
  });

  it('escapes pipes inside cell text so columns stay aligned', () => {
    const markdown = htmlToMarkdown('<table><tr><th>Op</th></tr><tr><td>a | b</td></tr></table>');
    expect(markdown).toContain('| a \\| b |');
  });

  it('honours colspan by padding the row out to the full column count', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">Spans both</td></tr></table>',
    );
    expect(markdown).toContain('| Spans both | |');
  });

  it('carries column alignment into the divider row', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th align="left">L</th><th style="text-align: right">R</th></tr>' +
        '<tr><td>1</td><td>2</td></tr></table>',
    );
    expect(markdown).toContain('| :--- | ---: |');
  });

  it('flattens tables whose cells hold code blocks rather than breaking the rows', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>Markdown</th><th>HTML</th></tr>' +
        '<tr><td><pre><code class="language-md"># Heading</code></pre></td>' +
        '<td><pre><code class="language-html">&lt;h1&gt;Heading&lt;/h1&gt;</code></pre></td></tr></table>',
    );
    expect(markdown).not.toContain('<table');
    expect(markdown).toContain('```md');
    expect(markdown).toContain('# Heading');
    expect(markdown).toContain('```html');
    expect(markdown).toContain('<h1>Heading</h1>');
    // A torn row would leave a stray pipe on its own line.
    expect(markdown).not.toMatch(/^\|\s*$/m);
  });

  it('flattens nested tables from the inside out', () => {
    const markdown = htmlToMarkdown(
      '<table role="presentation"><tr><td>' +
        '<table><tr><td>Inner A</td><td>Inner B</td></tr><tr><td>1</td><td>2</td></tr></table>' +
        '</td></tr></table>',
    );
    expect(markdown).not.toContain('<table');
    expect(markdown).toMatch(/\|\s*Inner A\s*\|\s*Inner B\s*\|/);
  });

  it('drops tables that hold no cells at all', () => {
    expect(htmlToMarkdown('<table><tbody><tr></tr></tbody></table>')).toBe('');
  });
});

describe('htmlToMarkdown on markup that embeds HTML in attributes', () => {
  // Wikipedia stores serialized wikitext in data-* attributes, which used to
  // convince the extractor that the page already had a heading of its own.
  const PAGE = `<html><head><title>Attr Trap</title></head><body>
    <main id="content">
      <header class="titlebar"><h1>Real Heading</h1></header>
      <div data-mw='{"parts":[{"html":"<h1>Not a heading</h1>"}]}'>
        <p>The body of the article runs long enough, with commas, clauses, and several sentences,
        that the content heuristics settle on it as the primary content of the document.</p>
        <p>A second paragraph removes any remaining ambiguity about where the article lives.</p>
      </div>
    </main>
  </body></html>`;

  it('still restores the heading from the removed chrome', () => {
    const markdown = htmlToMarkdown(extractPage(PAGE, { url: 'https://example.com/a' }).html);
    expect(markdown).toContain('# Real Heading');
  });
});

describe('extractPage in-content furniture removal', () => {
  const PAGE = `<html><head><title>Docs</title></head><body>
    <main>
      <article>
        <h1>Install</h1>
        <h2>Prerequisites<span class="mw-editsection">[<a href="/edit">edit</a>]</span></h2>
        <p>The installation instructions are long enough, with commas and clauses, to register as
        the real content of this page rather than as part of the page furniture around it.</p>
        <div class="share-buttons"><a href="/tweet">Tweet this</a></div>
        <span class="sr-only">Skip to content</span>
        <p>A second paragraph keeps the density heuristics comfortable with this choice.</p>
      </article>
    </main>
  </body></html>`;

  const markdown = htmlToMarkdown(extractPage(PAGE, { url: 'https://example.com/install' }).html);

  it('strips per-section edit links, share widgets, and screen-reader-only text', () => {
    expect(markdown).not.toContain('[edit]');
    expect(markdown).not.toContain('Tweet this');
    expect(markdown).not.toContain('Skip to content');
  });

  it('keeps the headings and prose around them', () => {
    expect(markdown).toContain('# Install');
    expect(markdown).toContain('## Prerequisites');
    expect(markdown).toContain('The installation instructions are long enough');
  });
});
