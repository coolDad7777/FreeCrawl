import { describe, expect, it } from 'vitest';
import { ScrapeCache, cacheKey } from '../src/core/cache';
import type { Document } from '../src/types';

function makeDocument(title: string): Document {
  return {
    markdown: `# ${title}`,
    metadata: {
      title,
      description: '',
      language: 'en',
      sourceURL: 'https://example.com/',
      scrapeDurationMs: 5,
      engine: 'fetch',
    },
  };
}

describe('cacheKey', () => {
  it('ignores option order', () => {
    expect(cacheKey('https://example.com', { formats: ['markdown', 'html'] })).toBe(
      cacheKey('https://example.com', { formats: ['html', 'markdown'] }),
    );
  });

  it('changes when an output-affecting option changes', () => {
    const base = cacheKey('https://example.com', { onlyMainContent: true });
    expect(cacheKey('https://example.com', { onlyMainContent: false })).not.toBe(base);
    expect(cacheKey('https://other.com', { onlyMainContent: true })).not.toBe(base);
  });

  it('ignores options that do not affect output', () => {
    expect(cacheKey('https://example.com', { skipCache: true, timeout: 1_000 })).toBe(
      cacheKey('https://example.com', { skipCache: false, timeout: 9_000 }),
    );
  });
});

describe('ScrapeCache', () => {
  it('stores and returns a document', () => {
    const cache = new ScrapeCache(':memory:', true);
    cache.set('k1', 'https://example.com/', makeDocument('Cached'));

    const hit = cache.get('k1');
    expect(hit?.document.metadata.title).toBe('Cached');
    expect(hit?.ageMs).toBeGreaterThanOrEqual(0);
    cache.close();
  });

  it('misses on an unknown key', () => {
    const cache = new ScrapeCache(':memory:', true);
    expect(cache.get('absent')).toBeNull();
    cache.close();
  });

  it('treats an entry older than maxAge as a miss', () => {
    const cache = new ScrapeCache(':memory:', true);
    cache.set('k2', 'https://example.com/', makeDocument('Stale'));
    expect(cache.get('k2', 0)).toBeNull();
    cache.close();
  });

  it('overwrites an existing key', () => {
    const cache = new ScrapeCache(':memory:', true);
    cache.set('k3', 'https://example.com/', makeDocument('First'));
    cache.set('k3', 'https://example.com/', makeDocument('Second'));

    expect(cache.get('k3')?.document.metadata.title).toBe('Second');
    expect(cache.stats().entries).toBe(1);
    cache.close();
  });

  it('is a no-op when disabled', () => {
    const cache = new ScrapeCache(':memory:', false);
    cache.set('k4', 'https://example.com/', makeDocument('Ignored'));

    expect(cache.get('k4')).toBeNull();
    expect(cache.stats()).toEqual({ entries: 0, enabled: false });
    cache.close();
  });

  it('clears every entry', () => {
    const cache = new ScrapeCache(':memory:', true);
    cache.set('k5', 'https://example.com/', makeDocument('Gone'));
    cache.clear();
    expect(cache.stats().entries).toBe(0);
    cache.close();
  });
});
