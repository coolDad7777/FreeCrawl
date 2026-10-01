import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Playwright and SQLite are both happiest with a single worker here.
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      // The fixture server runs on 127.0.0.1, which the SSRF guard blocks by default.
      ALLOW_PRIVATE_URLS: 'true',
      CACHE_ENABLED: 'false',
      JOB_STORE_PATH: ':memory:',
      RATE_LIMIT_RPM: '0',
      RESPECT_ROBOTS_TXT: 'false',
      SCRAPE_CONCURRENCY: '4',
      // Smaller than the 5 MB `/big` fixture so the size guard is exercised.
      SCRAPE_MAX_BYTES: '2097152',
      REDIS_URL: '',
      GEMINI_API_KEY: '',
      GROQ_API_KEY: '',
      SEARXNG_URL: '',
    },
  },
});
