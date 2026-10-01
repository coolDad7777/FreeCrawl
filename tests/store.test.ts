import { describe, expect, it } from 'vitest';
import { JobStore } from '../src/queue/store';
import type { Document } from '../src/types';

function makeDocument(url: string): Document {
  return {
    markdown: `# ${url}`,
    metadata: {
      title: url,
      description: '',
      language: 'en',
      sourceURL: url,
      scrapeDurationMs: 1,
      engine: 'fetch',
    },
  };
}

function freshStore(): JobStore {
  return new JobStore(':memory:');
}

describe('JobStore', () => {
  it('creates and reads a job', () => {
    const store = freshStore();
    const job = store.create('job-1', 'crawl', { url: 'https://example.com' }, 3);

    expect(job.status).toBe('pending');
    expect(job.total).toBe(3);
    expect(store.getRequest<{ url: string }>('job-1')?.url).toBe('https://example.com');
    store.close();
  });

  it('returns null for an unknown job', () => {
    const store = freshStore();
    expect(store.get('nope')).toBeNull();
    store.close();
  });

  it('appends documents in order and counts them', () => {
    const store = freshStore();
    store.create('job-2', 'crawl', {});

    expect(store.appendDocument('job-2', 'https://a.example', makeDocument('a'))).toBe(1);
    expect(store.appendDocument('job-2', 'https://b.example', makeDocument('b'))).toBe(2);

    expect(store.countDocuments('job-2')).toBe(2);
    expect(store.get('job-2')?.completed).toBe(2);
    expect(store.listDocuments('job-2').map((document) => document.metadata.title)).toEqual(['a', 'b']);
    store.close();
  });

  it('paginates documents', () => {
    const store = freshStore();
    store.create('job-3', 'crawl', {});
    for (const name of ['a', 'b', 'c', 'd']) {
      store.appendDocument('job-3', `https://${name}.example`, makeDocument(name));
    }

    expect(store.listDocuments('job-3', { offset: 1, limit: 2 }).map((d) => d.metadata.title)).toEqual(['b', 'c']);
    expect(store.listDocuments('job-3', { offset: 3, limit: 2 }).map((d) => d.metadata.title)).toEqual(['d']);
    store.close();
  });

  it('records per-URL errors', () => {
    const store = freshStore();
    store.create('job-4', 'crawl', {});
    store.appendError('job-4', {
      url: 'https://bad.example',
      error: 'boom',
      timestamp: new Date().toISOString(),
    });

    const errors = store.get('job-4')!.errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ url: 'https://bad.example', error: 'boom' });
    store.close();
  });

  it('cancels only active jobs', () => {
    const store = freshStore();
    store.create('job-5', 'crawl', {});

    expect(store.cancel('job-5')).toBe(true);
    expect(store.getStatus('job-5')).toBe('cancelled');
    expect(store.cancel('job-5')).toBe(false);
    expect(store.cancel('missing')).toBe(false);
    store.close();
  });

  it('marks interrupted jobs as failed', () => {
    const store = freshStore();
    store.create('job-6', 'crawl', {});
    store.update('job-6', { status: 'scraping' });
    store.create('job-7', 'crawl', {});
    store.update('job-7', { status: 'completed' });

    expect(store.failInterrupted()).toBe(1);
    expect(store.getStatus('job-6')).toBe('failed');
    expect(store.get('job-6')?.error).toMatch(/restart/i);
    expect(store.getStatus('job-7')).toBe('completed');
    store.close();
  });

  it('reports active and total counts', () => {
    const store = freshStore();
    store.create('job-8', 'crawl', {});
    store.create('job-9', 'crawl', {});
    store.update('job-9', { status: 'completed' });

    expect(store.stats()).toEqual({ total: 2, active: 1 });
    store.close();
  });
});
