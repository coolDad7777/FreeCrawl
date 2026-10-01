import { describe, expect, it } from 'vitest';
import {
  directoryPrefix,
  isCrawlableLink,
  isPrivateIp,
  looksLikePage,
  matchesPathFilters,
  normalizeUrl,
  pathPatternToRegExp,
  registrableSuffix,
  urlSimilarityKey,
} from '../src/core/url';

describe('isPrivateIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.5.5',
    '172.31.255.255',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
    '224.0.0.1',
  ])('blocks %s', (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946', '172.32.0.1'])(
    'allows %s',
    (address) => {
      expect(isPrivateIp(address)).toBe(false);
    },
  );
});

describe('normalizeUrl', () => {
  it('drops fragments, default ports, and trailing slashes', () => {
    expect(normalizeUrl('https://Example.com:443/docs/#section')).toBe('https://example.com/docs');
    expect(normalizeUrl('http://example.com:80/')).toBe('http://example.com/');
  });

  it('removes tracking parameters but keeps meaningful ones', () => {
    expect(normalizeUrl('https://example.com/p?utm_source=x&id=7&fbclid=abc')).toBe(
      'https://example.com/p?id=7',
    );
  });

  it('sorts query parameters so equivalent URLs dedupe', () => {
    expect(normalizeUrl('https://example.com/p?b=2&a=1')).toBe(normalizeUrl('https://example.com/p?a=1&b=2'));
  });
});

describe('looksLikePage', () => {
  it('rejects asset URLs and accepts page URLs', () => {
    expect(looksLikePage('https://example.com/style.css')).toBe(false);
    expect(looksLikePage('https://example.com/image.PNG')).toBe(false);
    expect(looksLikePage('https://example.com/report.pdf')).toBe(true);
    expect(looksLikePage('https://example.com/docs/guide')).toBe(true);
    expect(looksLikePage('https://example.com/index.html')).toBe(true);
  });
});

describe('pathPatternToRegExp', () => {
  it('treats a single star as one path segment', () => {
    const pattern = pathPatternToRegExp('/blog/*');
    expect(pattern.test('/blog/post-1')).toBe(true);
    expect(pattern.test('/blog/2026/post-1')).toBe(false);
  });

  it('treats a double star as any number of segments', () => {
    const pattern = pathPatternToRegExp('/blog/**');
    expect(pattern.test('/blog/2026/post-1')).toBe(true);
  });

  it('matches an exact path', () => {
    const pattern = pathPatternToRegExp('/docs/guide');
    expect(pattern.test('/docs/guide')).toBe(true);
    expect(pattern.test('/docs/guide/advanced')).toBe(false);
  });
});

describe('matchesPathFilters', () => {
  it('applies excludes before includes', () => {
    expect(matchesPathFilters('/blog/post-1', ['/blog/*'], [])).toBe(true);
    expect(matchesPathFilters('/blog/post-1', ['/blog/*'], ['/blog/post-1'])).toBe(false);
    expect(matchesPathFilters('/docs/guide', ['/blog/*'], [])).toBe(false);
  });

  it('allows everything when no filters are set', () => {
    expect(matchesPathFilters('/anything/at/all')).toBe(true);
  });
});

describe('isCrawlableLink', () => {
  const base = new URL('https://example.com/docs/guide');

  it('keeps same-host page links', () => {
    expect(isCrawlableLink('https://example.com/docs/other', { base })).toBe(true);
  });

  it('rejects other hosts unless allowed', () => {
    expect(isCrawlableLink('https://other.com/page', { base })).toBe(false);
    expect(isCrawlableLink('https://other.com/page', { base, allowExternalLinks: true })).toBe(true);
  });

  it('rejects subdomains unless includeSubdomains is set', () => {
    expect(isCrawlableLink('https://blog.example.com/p', { base })).toBe(false);
    expect(isCrawlableLink('https://blog.example.com/p', { base, includeSubdomains: true })).toBe(true);
  });

  it('honours a base path prefix', () => {
    expect(isCrawlableLink('https://example.com/other/page', { base, basePathPrefix: '/docs/' })).toBe(false);
    expect(isCrawlableLink('https://example.com/docs/page', { base, basePathPrefix: '/docs/' })).toBe(true);
  });

  it('rejects non-http schemes and asset URLs', () => {
    expect(isCrawlableLink('mailto:a@b.com', { base })).toBe(false);
    expect(isCrawlableLink('https://example.com/app.js', { base })).toBe(false);
  });
});

describe('directoryPrefix', () => {
  it('returns the containing directory', () => {
    expect(directoryPrefix(new URL('https://example.com/docs/guide'))).toBe('/docs/');
    expect(directoryPrefix(new URL('https://example.com/docs/'))).toBe('/docs/');
    expect(directoryPrefix(new URL('https://example.com/page'))).toBe('/');
  });
});

describe('registrableSuffix', () => {
  it('handles plain and two-part suffixes', () => {
    expect(registrableSuffix('blog.example.com')).toBe('example.com');
    expect(registrableSuffix('www.example.co.uk')).toBe('example.co.uk');
  });
});

describe('urlSimilarityKey', () => {
  it('collapses index files and trailing slashes', () => {
    expect(urlSimilarityKey('https://example.com/docs/index.html')).toBe(
      urlSimilarityKey('https://example.com/docs/'),
    );
  });
});
