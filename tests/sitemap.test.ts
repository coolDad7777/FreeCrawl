import { describe, expect, it } from 'vitest';
import { parseSitemapXml } from '../src/core/sitemap';

describe('parseSitemapXml', () => {
  it('parses a urlset with lastmod', () => {
    const { entries, sitemaps } = parseSitemapXml(`<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>https://example.com/a</loc><lastmod>2026-01-02</lastmod></url>
        <url><loc>https://example.com/b</loc></url>
      </urlset>`);

    expect(entries).toEqual([
      { url: 'https://example.com/a', lastModified: '2026-01-02' },
      { url: 'https://example.com/b', lastModified: undefined },
    ]);
    expect(sitemaps).toEqual([]);
  });

  it('parses a sitemap index', () => {
    const { entries, sitemaps } = parseSitemapXml(`<?xml version="1.0"?>
      <sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>
        <sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap>
      </sitemapindex>`);

    expect(entries).toEqual([]);
    expect(sitemaps).toEqual(['https://example.com/sitemap-1.xml', 'https://example.com/sitemap-2.xml']);
  });

  it('handles a single-entry sitemap without collapsing it to an object', () => {
    const { entries } = parseSitemapXml(
      `<urlset><url><loc>https://example.com/only</loc></url></urlset>`,
    );
    expect(entries).toHaveLength(1);
  });

  it('returns empty results for malformed XML instead of throwing', () => {
    expect(parseSitemapXml('not xml at all')).toEqual({ entries: [], sitemaps: [] });
  });
});
