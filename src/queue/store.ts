import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import type { Document, JobError, JobRecord, JobStatus } from '../types';

interface JobRow {
  id: string;
  kind: 'crawl' | 'batch_scrape';
  status: JobStatus;
  total: number;
  completed: number;
  created_at: number;
  updated_at: number;
  expires_at: number;
  error: string | null;
  request: string;
}

/**
 * SQLite-backed store for crawl and batch jobs. Using a shared database rather
 * than process memory means job state survives a restart and stays correct when
 * a BullMQ worker runs in a separate process from the API.
 */
class JobStore {
  private db: Database.Database;

  constructor(filePath = config.jobs.path) {
    if (filePath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    }
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        total INTEGER NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        error TEXT,
        request TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS job_documents (
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        url TEXT NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (job_id, seq)
      );
      CREATE TABLE IF NOT EXISTS job_errors (
        job_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        url TEXT NOT NULL,
        error TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (job_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_expires_at ON jobs(expires_at);
    `);
  }

  private toRecord(row: JobRow): JobRecord {
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      total: row.total,
      completed: row.completed,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      error: row.error ?? undefined,
      errors: this.listErrors(row.id),
    };
  }

  create(id: string, kind: 'crawl' | 'batch_scrape', request: unknown, total = 0): JobRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO jobs (id, kind, status, total, completed, created_at, updated_at, expires_at, request)
         VALUES (?, ?, 'pending', ?, 0, ?, ?, ?, ?)`,
      )
      .run(id, kind, total, now, now, now + config.jobs.retentionHours * 3600 * 1000, JSON.stringify(request));

    return this.get(id)!;
  }

  get(id: string): JobRecord | null {
    const row = this.db.prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
    return row ? this.toRecord(row) : null;
  }

  getRequest<T>(id: string): T | null {
    const row = this.db
      .prepare<[string], { request: string }>('SELECT request FROM jobs WHERE id = ?')
      .get(id);
    return row ? (JSON.parse(row.request) as T) : null;
  }

  getStatus(id: string): JobStatus | null {
    const row = this.db
      .prepare<[string], { status: JobStatus }>('SELECT status FROM jobs WHERE id = ?')
      .get(id);
    return row?.status ?? null;
  }

  update(id: string, patch: { status?: JobStatus; total?: number; completed?: number; error?: string }): void {
    const assignments: string[] = ['updated_at = ?'];
    const values: unknown[] = [Date.now()];

    if (patch.status !== undefined) {
      assignments.push('status = ?');
      values.push(patch.status);
    }
    if (patch.total !== undefined) {
      assignments.push('total = ?');
      values.push(patch.total);
    }
    if (patch.completed !== undefined) {
      assignments.push('completed = ?');
      values.push(patch.completed);
    }
    if (patch.error !== undefined) {
      assignments.push('error = ?');
      values.push(patch.error);
    }

    values.push(id);
    this.db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
  }

  /** Appends a scraped document and returns the job's new completed count. */
  appendDocument(id: string, url: string, document: Document): number {
    const insert = this.db.transaction((jobId: string, pageUrl: string, payload: string) => {
      const { seq } = this.db
        .prepare<[string], { seq: number }>(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM job_documents WHERE job_id = ?',
        )
        .get(jobId) ?? { seq: 1 };

      this.db
        .prepare('INSERT INTO job_documents (job_id, seq, url, payload) VALUES (?, ?, ?, ?)')
        .run(jobId, seq, pageUrl, payload);
      this.db
        .prepare('UPDATE jobs SET completed = completed + 1, updated_at = ? WHERE id = ?')
        .run(Date.now(), jobId);
      return seq;
    });

    insert(id, url, JSON.stringify(document));
    return this.countDocuments(id);
  }

  appendError(id: string, error: JobError): void {
    const insert = this.db.transaction((jobId: string, item: JobError) => {
      const { seq } = this.db
        .prepare<[string], { seq: number }>(
          'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM job_errors WHERE job_id = ?',
        )
        .get(jobId) ?? { seq: 1 };
      this.db
        .prepare('INSERT INTO job_errors (job_id, seq, url, error, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(jobId, seq, item.url, item.error, Date.parse(item.timestamp) || Date.now());
    });

    insert(id, error);
  }

  listDocuments(id: string, options: { offset?: number; limit?: number } = {}): Document[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1_000);
    const offset = Math.max(options.offset ?? 0, 0);
    return this.db
      .prepare<[string, number, number], { payload: string }>(
        'SELECT payload FROM job_documents WHERE job_id = ? ORDER BY seq ASC LIMIT ? OFFSET ?',
      )
      .all(id, limit, offset)
      .map((row) => JSON.parse(row.payload) as Document);
  }

  countDocuments(id: string): number {
    const row = this.db
      .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM job_documents WHERE job_id = ?')
      .get(id);
    return row?.count ?? 0;
  }

  listErrors(id: string): JobError[] {
    return this.db
      .prepare<[string], { url: string; error: string; created_at: number }>(
        'SELECT url, error, created_at FROM job_errors WHERE job_id = ? ORDER BY seq ASC LIMIT 500',
      )
      .all(id)
      .map((row) => ({
        url: row.url,
        error: row.error,
        timestamp: new Date(row.created_at).toISOString(),
      }));
  }

  /** Marks an in-flight job cancelled. Returns false when it already finished. */
  cancel(id: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE jobs SET status = 'cancelled', updated_at = ?
         WHERE id = ? AND status IN ('pending', 'scraping')`,
      )
      .run(Date.now(), id);
    return result.changes > 0;
  }

  prune(): number {
    const now = Date.now();
    const expired = this.db
      .prepare<[number], { id: string }>('SELECT id FROM jobs WHERE expires_at < ?')
      .all(now);

    const remove = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        this.db.prepare('DELETE FROM job_documents WHERE job_id = ?').run(id);
        this.db.prepare('DELETE FROM job_errors WHERE job_id = ?').run(id);
        this.db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
      }
    });

    remove(expired.map((row) => row.id));
    return expired.length;
  }

  /** Re-opens any job left mid-flight by an unclean shutdown. */
  failInterrupted(): number {
    return this.db
      .prepare(
        `UPDATE jobs SET status = 'failed', error = 'Interrupted by a server restart', updated_at = ?
         WHERE status IN ('pending', 'scraping')`,
      )
      .run(Date.now()).changes;
  }

  stats(): { total: number; active: number } {
    const total = this.db.prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM jobs').get();
    const active = this.db
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM jobs WHERE status IN ('pending', 'scraping')",
      )
      .get();
    return { total: total?.count ?? 0, active: active?.count ?? 0 };
  }

  close(): void {
    this.db.close();
  }
}

export const jobStore = new JobStore();
export { JobStore };
