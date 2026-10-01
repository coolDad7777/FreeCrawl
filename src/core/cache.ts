import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import type { Document, ScrapeOptions } from '../types';

/** Options that change the scraped output and therefore the cache identity. */
const CACHE_KEY_FIELDS: (keyof ScrapeOptions)[] = [
  'formats',
  'onlyMainContent',
  'includeTags',
  'excludeTags',
  'waitFor',
  'mobile',
  'actions',
  'jsonOptions',
  'aiProvider',
  'removeBase64Images',
  'engine',
  'headers',
];

export function cacheKey(url: string, options: Partial<ScrapeOptions>): string {
  const relevant: Record<string, unknown> = {};
  for (const field of CACHE_KEY_FIELDS) {
    const value = options[field];
    if (value !== undefined) relevant[field] = value;
  }
  if (Array.isArray(relevant.formats)) relevant.formats = [...relevant.formats].sort();

  return crypto
    .createHash('sha256')
    .update(`${url}\u0000${JSON.stringify(relevant)}`)
    .digest('hex');
}

interface CacheRow {
  payload: string;
  created_at: number;
}

export class ScrapeCache {
  private db: Database.Database | null = null;
  private disabled: boolean;

  constructor(private readonly filePath = config.cache.path, enabled = config.cache.enabled) {
    this.disabled = !enabled || config.cache.ttlHours <= 0;
  }

  private connect(): Database.Database | null {
    if (this.disabled) return null;
    if (this.db) return this.db;

    try {
      if (this.filePath !== ':memory:') {
        fs.mkdirSync(path.dirname(path.resolve(this.filePath)), { recursive: true });
      }
      const db = new Database(this.filePath);
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.exec(`
        CREATE TABLE IF NOT EXISTS scrape_cache (
          key TEXT PRIMARY KEY,
          url TEXT NOT NULL,
          payload TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scrape_cache_created_at ON scrape_cache(created_at);
      `);
      this.db = db;
      return db;
    } catch (error) {
      console.warn(
        `[cache] disabled: ${error instanceof Error ? error.message : 'unavailable'}`,
      );
      this.disabled = true;
      return null;
    }
  }

  /** Returns the cached document when it is younger than `maxAgeMs`. */
  get(key: string, maxAgeMs?: number): { document: Document; ageMs: number } | null {
    const db = this.connect();
    if (!db) return null;

    const ttlMs = maxAgeMs ?? config.cache.ttlHours * 3600 * 1000;
    if (ttlMs <= 0) return null;

    try {
      const row = db
        .prepare<[string], CacheRow>('SELECT payload, created_at FROM scrape_cache WHERE key = ?')
        .get(key);
      if (!row) return null;

      const ageMs = Date.now() - row.created_at;
      if (ageMs > ttlMs) {
        db.prepare('DELETE FROM scrape_cache WHERE key = ?').run(key);
        return null;
      }

      return { document: JSON.parse(row.payload) as Document, ageMs };
    } catch {
      return null;
    }
  }

  set(key: string, url: string, document: Document): void {
    const db = this.connect();
    if (!db) return;

    try {
      db.prepare(
        `INSERT INTO scrape_cache (key, url, payload, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, created_at = excluded.created_at`,
      ).run(key, url, JSON.stringify(document), Date.now());

      const { count } = db
        .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM scrape_cache')
        .get() ?? { count: 0 };

      if (count > config.cache.maxEntries) {
        db.prepare(
          `DELETE FROM scrape_cache WHERE key IN (
             SELECT key FROM scrape_cache ORDER BY created_at ASC LIMIT ?
           )`,
        ).run(count - config.cache.maxEntries);
      }
    } catch {
      // A failed cache write must never fail the scrape.
    }
  }

  prune(): number {
    const db = this.connect();
    if (!db) return 0;
    const cutoff = Date.now() - config.cache.ttlHours * 3600 * 1000;
    try {
      return db.prepare('DELETE FROM scrape_cache WHERE created_at < ?').run(cutoff).changes;
    } catch {
      return 0;
    }
  }

  stats(): { entries: number; enabled: boolean } {
    const db = this.connect();
    if (!db) return { entries: 0, enabled: false };
    try {
      const row = db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM scrape_cache').get();
      return { entries: row?.count ?? 0, enabled: true };
    } catch {
      return { entries: 0, enabled: false };
    }
  }

  clear(): void {
    const db = this.connect();
    if (!db) return;
    try {
      db.prepare('DELETE FROM scrape_cache').run();
    } catch {
      // Ignore.
    }
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}

export const scrapeCache = new ScrapeCache();
