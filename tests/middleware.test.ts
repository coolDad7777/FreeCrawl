import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { createRateLimiter, errorHandler, requireApiKey } from '../src/api/middleware';
import { FreeCrawlError } from '../src/core/errors';

function appWith(...handlers: express.RequestHandler[]): express.Express {
  const app = express();
  app.use(express.json());
  app.use(...handlers);
  app.get('/ping', (_req, res) => res.json({ ok: true }));
  app.get('/boom', () => {
    throw new FreeCrawlError('teapot', 418, 'teapot');
  });
  app.use(errorHandler);
  return app;
}

describe('requireApiKey', () => {
  const originalKeys = [...config.apiKeys];

  afterEach(() => {
    config.apiKeys = [...originalKeys];
  });

  it('allows every request when no key is configured', async () => {
    config.apiKeys = [];
    await request(appWith(requireApiKey)).get('/ping').expect(200);
  });

  it('rejects a missing or wrong key', async () => {
    config.apiKeys = ['secret-key'];
    const app = appWith(requireApiKey);

    const missing = await request(app).get('/ping').expect(401);
    expect(missing.body.code).toBe('unauthorized');
    await request(app).get('/ping').set('Authorization', 'Bearer nope').expect(401);
  });

  it('accepts the key as a bearer token or an x-api-key header', async () => {
    config.apiKeys = ['secret-key'];
    const app = appWith(requireApiKey);

    await request(app).get('/ping').set('Authorization', 'Bearer secret-key').expect(200);
    await request(app).get('/ping').set('x-api-key', 'secret-key').expect(200);
  });
});

describe('createRateLimiter', () => {
  it('rejects once the bucket is empty and reports Retry-After', async () => {
    const app = appWith(createRateLimiter(2));

    await request(app).get('/ping').expect(200);
    await request(app).get('/ping').expect(200);

    const limited = await request(app).get('/ping').expect(429);
    expect(limited.body.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('reports the remaining budget', async () => {
    const response = await request(appWith(createRateLimiter(10))).get('/ping').expect(200);
    expect(response.headers['x-ratelimit-limit']).toBe('10');
    expect(Number(response.headers['x-ratelimit-remaining'])).toBe(9);
  });

  it('is disabled when the limit is zero', async () => {
    const app = appWith(createRateLimiter(0));
    for (let index = 0; index < 5; index += 1) await request(app).get('/ping').expect(200);
  });
});

describe('errorHandler', () => {
  it('maps a FreeCrawlError onto its status code and code', async () => {
    const response = await request(appWith(requireApiKey)).get('/boom').expect(418);
    expect(response.body).toEqual({ success: false, error: 'teapot', code: 'teapot' });
  });
});
