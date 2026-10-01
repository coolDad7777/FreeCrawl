export class FreeCrawlError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, statusCode = 500, code = 'internal_error', details?: unknown) {
    super(message);
    this.name = 'FreeCrawlError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/** The target URL is syntactically valid but refused by policy (SSRF, robots, scheme). */
export class UnsafeUrlError extends FreeCrawlError {
  constructor(message: string) {
    super(message, 422, 'unsafe_url');
    this.name = 'UnsafeUrlError';
  }
}

export class BlockedByRobotsError extends FreeCrawlError {
  constructor(url: string) {
    super(`robots.txt disallows scraping ${url}`, 403, 'blocked_by_robots');
    this.name = 'BlockedByRobotsError';
  }
}

export class ScrapeFailedError extends FreeCrawlError {
  constructor(message: string, statusCode = 502) {
    super(message, statusCode, 'scrape_failed');
    this.name = 'ScrapeFailedError';
  }
}

export class NotFoundError extends FreeCrawlError {
  constructor(message = 'Not found') {
    super(message, 404, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ConfigurationError extends FreeCrawlError {
  constructor(message: string) {
    super(message, 501, 'not_configured');
    this.name = 'ConfigurationError';
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}
