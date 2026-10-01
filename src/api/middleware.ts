import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { config } from '../config';
import { FreeCrawlError } from '../core/errors';

/** Lets async route handlers reject without crashing the process. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (config.apiKeys.length === 0) {
    next();
    return;
  }

  const header = req.header('authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const provided = bearer || (req.header('x-api-key') ?? '').trim();

  if (!provided || !config.apiKeys.includes(provided)) {
    res.status(401).json({
      success: false,
      error: 'Missing or invalid API key. Send "Authorization: Bearer <FREECRAWL_API_KEY>".',
      code: 'unauthorized',
    });
    return;
  }

  next();
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Per-caller token bucket. Smooths bursts rather than resetting on a fixed
 * window, and is keyed by API key when present so tenants are isolated.
 */
export function createRateLimiter(requestsPerMinute = config.rateLimit.requestsPerMinute): RequestHandler {
  if (requestsPerMinute <= 0) {
    return (_req, _res, next) => next();
  }

  const buckets = new Map<string, Bucket>();
  const refillPerMs = requestsPerMinute / 60_000;
  const capacity = Math.max(requestsPerMinute, 1);

  // Keep memory bounded when many distinct IPs hit the service.
  const prune = () => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [key, bucket] of buckets) {
      if (bucket.updatedAt < cutoff) buckets.delete(key);
    }
  };
  const pruneTimer = setInterval(prune, 60_000);
  pruneTimer.unref();

  return (req, res, next) => {
    const apiKey = (req.header('authorization') ?? req.header('x-api-key') ?? '').slice(-16);
    const key = apiKey || req.ip || 'anonymous';
    const now = Date.now();
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: now };

    bucket.tokens = Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      const retryAfterSeconds = Math.ceil((1 - bucket.tokens) / refillPerMs / 1000);
      buckets.set(key, bucket);
      res.setHeader('Retry-After', String(Math.max(retryAfterSeconds, 1)));
      res.setHeader('X-RateLimit-Limit', String(capacity));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        success: false,
        error: `Rate limit of ${requestsPerMinute} requests/minute exceeded`,
        code: 'rate_limited',
      });
      return;
    }

    bucket.tokens -= 1;
    buckets.set(key, bucket);
    res.setHeader('X-RateLimit-Limit', String(capacity));
    res.setHeader('X-RateLimit-Remaining', String(Math.floor(bucket.tokens)));
    next();
  };
}

function formatZodError(error: ZodError): { message: string; details: unknown } {
  const issues = error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
  const summary = issues.map(({ path, message }) => `${path}: ${message}`).join('; ');
  return { message: `Invalid request body — ${summary}`, details: issues };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: `No route matches ${req.method} ${req.path}`,
    code: 'not_found',
  });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ZodError) {
    const { message, details } = formatZodError(error);
    res.status(400).json({ success: false, error: message, code: 'invalid_request', details });
    return;
  }

  if (error instanceof FreeCrawlError) {
    res.status(error.statusCode).json({
      success: false,
      error: error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {}),
    });
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    res.status(400).json({ success: false, error: 'Request body is not valid JSON', code: 'invalid_json' });
    return;
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  if (!config.isProduction) console.error('[error]', error);
  res.status(500).json({ success: false, error: message, code: 'internal_error' });
}
