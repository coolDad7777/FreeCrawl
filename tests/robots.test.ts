import { describe, expect, it } from 'vitest';
import { isPathAllowed, parseRobotsTxt } from '../src/core/robots';

describe('parseRobotsTxt', () => {
  it('extracts sitemaps and crawl delay', () => {
    const robots = parseRobotsTxt(
      ['User-agent: *', 'Crawl-delay: 2', 'Disallow: /admin', 'Sitemap: https://example.com/sitemap.xml'].join('\n'),
    );
    expect(robots.sitemaps).toEqual(['https://example.com/sitemap.xml']);
    expect(robots.crawlDelayMs).toBe(2_000);
  });

  it('prefers a group matching our user agent over the wildcard group', () => {
    const robots = parseRobotsTxt(
      [
        'User-agent: *',
        'Disallow: /',
        '',
        'User-agent: freecrawl',
        'Disallow: /admin',
      ].join('\n'),
      'freecrawl',
    );
    expect(isPathAllowed(robots, '/anything')).toBe(true);
    expect(isPathAllowed(robots, '/admin')).toBe(false);
  });

  it('merges consecutive user-agent lines into one group', () => {
    const robots = parseRobotsTxt(
      ['User-agent: googlebot', 'User-agent: *', 'Disallow: /private'].join('\n'),
    );
    expect(isPathAllowed(robots, '/private/x')).toBe(false);
  });

  it('treats an empty Disallow as allow-all', () => {
    const robots = parseRobotsTxt(['User-agent: *', 'Disallow:'].join('\n'));
    expect(isPathAllowed(robots, '/anything')).toBe(true);
  });

  it('ignores comments', () => {
    const robots = parseRobotsTxt(['# a comment', 'User-agent: *', 'Disallow: /x # trailing'].join('\n'));
    expect(isPathAllowed(robots, '/x')).toBe(false);
  });
});

describe('isPathAllowed', () => {
  it('lets the longest matching rule win, with Allow breaking ties', () => {
    const robots = parseRobotsTxt(
      ['User-agent: *', 'Disallow: /private/', 'Allow: /private/public/'].join('\n'),
    );
    expect(isPathAllowed(robots, '/private/secret')).toBe(false);
    expect(isPathAllowed(robots, '/private/public/page')).toBe(true);
  });

  it('supports wildcards and end anchors', () => {
    const robots = parseRobotsTxt(
      ['User-agent: *', 'Disallow: /*.pdf$', 'Disallow: /search?*'].join('\n'),
    );
    expect(isPathAllowed(robots, '/files/report.pdf')).toBe(false);
    expect(isPathAllowed(robots, '/files/report.pdf.html')).toBe(true);
    expect(isPathAllowed(robots, '/search?q=x')).toBe(false);
  });

  it('allows everything when robots.txt is absent', () => {
    expect(isPathAllowed({ rules: [], crawlDelayMs: 0, sitemaps: [], absent: true }, '/any')).toBe(true);
  });
});
