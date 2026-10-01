# FreeCrawl

A free, self-hosted web data API. Scrape, crawl, map, search, and extract
structured JSON from any public site, with request and response shapes that
follow [Firecrawl](https://firecrawl.dev) v1 so existing clients work with
minimal changes.

No per-page billing, no vendor account, and no paid API key required: the
scraping stack is Playwright plus Cheerio, search runs through SearXNG or
DuckDuckGo, and AI extraction uses the free tiers of Gemini or Groq.

```bash
cp .env.example .env
npm install
npm run dev
# open http://localhost:3000
```

## What it does

| Endpoint | What you get |
| --- | --- |
| `POST /v1/scrape` | One URL as Markdown, cleaned HTML, raw HTML, links, a screenshot, or LLM-extracted JSON |
| `POST /v1/batch/scrape` | The same for up to 1,000 URLs, as a background job |
| `POST /v1/crawl` | Breadth-first crawl of a site with depth, page, and path limits |
| `GET /v1/crawl/:id` | Live progress plus a paginated page of results |
| `DELETE /v1/crawl/:id` | Cancel a running crawl |
| `GET /v1/crawl/:id/errors` | The URLs that failed and why |
| `POST /v1/map` | Every URL on a site, from its sitemap and its links |
| `POST /v1/search` | Web search, optionally scraping each result |
| `POST /v1/extract` | Structured JSON from one or more pages, against your JSON Schema |
| `GET /health` | Queue backend, cache size, configured AI providers and search engines |

A browser playground for all of it is served at `/`, and the full contract is in
[`openapi.yaml`](./openapi.yaml) (also served at `/openapi.yaml`).

## How the scraper works

**Two engines, chosen per page.** The default `auto` engine issues a plain HTTP
request first, which handles most of the web in tens of milliseconds. It
escalates to headless Chromium only when the returned markup turns out to be an
empty application shell — an unfilled `#root`, a `__NEXT_DATA__` blob with no
prose, or a "JavaScript is required" notice. Force either engine with
`"engine": "fetch"` or `"engine": "browser"`.

**Main-content extraction.** `onlyMainContent` (on by default) runs a
Readability-style scorer: it prefers `<main>`/`<article>` containers, scores
candidates by paragraph density and prose markers, penalizes link farms, and
discards anything whose class or id looks like navigation, cookie consent, a
sidebar, or a share widget. Relative links and images are rewritten to absolute
URLs, lazy-loaded `data-src` images are recovered, and base64 tracking pixels
are dropped.

**Markdown built for LLMs.** Turndown with the GFM plugin, so tables stay
tables, fenced code blocks keep their detected language, and the output never
contains runs of blank lines.

**Everything else you need in production.** `robots.txt` is parsed properly
(longest-match wins, `Allow` breaks ties, wildcards and `$` anchors, plus
`Crawl-delay`) and obeyed by default. Sitemaps are discovered from `robots.txt`
and the conventional paths, gzip included, and followed through sitemap indexes.
Results are cached in SQLite with a TTL. Scrapes are capped by a streaming byte
limit, and every redirect hop is re-validated against the SSRF rules.

## Examples

### Scrape a page as Markdown

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://en.wikipedia.org/wiki/Web_scraping",
    "formats": ["markdown", "links"],
    "onlyMainContent": true
  }'
```

### Crawl a documentation section

```bash
curl -X POST http://localhost:3000/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/docs",
    "limit": 50,
    "maxDepth": 3,
    "includePaths": ["/docs/**"],
    "excludePaths": ["/docs/changelog/**"],
    "scrapeOptions": { "formats": ["markdown"] }
  }'
# → { "success": true, "id": "<uuid>", "url": ".../v1/crawl/<uuid>" }

curl http://localhost:3000/v1/crawl/<uuid>
# → { "status": "scraping", "completed": 12, "total": 50, "data": [...], "next": "...?skip=12" }
```

Path filters accept glob-ish syntax: `/docs/*` matches a single path segment,
`/docs/**` matches any depth, and raw regular expressions are passed through.
`excludePaths` is applied before `includePaths`.

### Extract structured data

```bash
curl -X POST http://localhost:3000/v1/extract \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com/pricing"],
    "prompt": "Pull out every pricing tier.",
    "schema": {
      "type": "object",
      "properties": {
        "tiers": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "monthlyUsd": { "type": "number" }
            }
          }
        }
      }
    }
  }'
```

`schema` accepts a full JSON Schema or the shorthand
`{ "fieldName": "what to look for" }`. The same options are available per-page
through the `json` scrape format and `jsonOptions`.

### Search

```bash
curl -X POST http://localhost:3000/v1/search \
  -H 'Content-Type: application/json' \
  -d '{ "query": "open source web scraping", "limit": 5,
        "scrapeOptions": { "formats": ["markdown"] } }'
```

## Configuration

Everything is environment-driven; see [`.env.example`](./.env.example) for the
annotated list. The settings that matter most:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Bind port. FreeCrawl always listens on `0.0.0.0`. |
| `FREECRAWL_API_KEY` | _(unset)_ | When set, `/v1/*` requires `Authorization: Bearer <key>`. Comma-separated for several keys. |
| `RATE_LIMIT_RPM` | `60` | Per-key (or per-IP) token bucket. `0` disables it. |
| `GEMINI_API_KEY` / `GROQ_API_KEY` | _(unset)_ | Needed only for the `json` format and `/v1/extract`. |
| `SEARXNG_URL` | _(unset)_ | SearXNG instance for `/v1/search`. Strongly recommended. |
| `REDIS_URL` | _(unset)_ | Enables BullMQ so crawls can run in separate worker processes. |
| `SCRAPE_CONCURRENCY` | `4` | Parallel page loads shared across all jobs. |
| `RESPECT_ROBOTS_TXT` | `true` | Default for every scrape and crawl. |
| `CACHE_TTL_HOURS` | `24` | How long a scraped page stays reusable. |
| `ALLOW_PRIVATE_URLS` | `false` | Permits localhost and RFC1918 targets. See the security note below. |

### Search needs an engine

`/v1/search` has no API key to fall back on, so it scrapes free engines:
SearXNG first (if `SEARXNG_URL` is set), then DuckDuckGo, then Bing's RSS feed.
DuckDuckGo blocks most datacenter IP ranges outright, which means **a
cloud-hosted FreeCrawl will usually need SearXNG**. The quickest path:

```bash
docker run -d -p 8080:8080 \
  -v "$PWD/searxng:/etc/searxng" \
  searxng/searxng:latest
# then set SEARXNG_URL=http://localhost:8080
```

The bundled [`searxng/settings.yml`](./searxng/settings.yml) enables the JSON
format that FreeCrawl reads, which SearXNG disables by default.
`docker compose up` wires this together for you.

### Queue backend

Without `REDIS_URL`, crawl and batch jobs run inside the API process. Job state
still lives in SQLite, so progress survives a restart and polling keeps working.
With `REDIS_URL`, jobs go through BullMQ and can be processed by additional
worker processes sharing the same `JOB_STORE_PATH`.

## Deploying

```bash
docker compose up --build
```

This starts FreeCrawl, Redis, and SearXNG, and persists the job and cache
databases in a named volume. Change `secret_key` in `searxng/settings.yml`
before exposing it beyond your own network.

To run without Docker:

```bash
npm ci
npm run build
NODE_ENV=production npm start
```

## Security

The SSRF guard rejects non-HTTP schemes, URLs with embedded credentials,
loopback and link-local addresses, RFC1918 and CGNAT ranges, cloud metadata
endpoints, IPv4-mapped IPv6 addresses, and multicast space. Hostnames are
resolved and every resolved address is checked, and redirects are re-validated
at each hop rather than trusted after the first.

`ALLOW_PRIVATE_URLS=true` disables all of that. It exists so you can crawl an
intranet host, and because the test suite points at a local fixture server.
Never enable it on an instance that untrusted callers can reach.

When a server sets `FREECRAWL_API_KEY`, requests to `/v1/*` must carry it as a
bearer token or an `x-api-key` header. `/health` stays public.

## Development

```bash
npm run dev     # API + Vite playground with HMR
npm test        # 155 vitest cases, fully offline
npm run lint    # tsc --noEmit
npm run build   # production frontend bundle
```

The suite runs against a local fixture site in `tests/fixtures/server.ts`, so it
needs no network and no API keys. It covers the SSRF rules, the robots.txt
matcher, sitemap parsing, main-content extraction, Markdown conversion, the
cache, the job store, search-result parsing, auth, rate limiting, and every HTTP
endpoint end to end — including a real headless-Chromium escalation on a
client-rendered page.

## Migrating from FreeCrawl 0.x

The pre-1.0 snake_case fields still work as aliases: `max_depth`,
`scrape_options`, `ai_provider`, `allow_external`, `only_main_content`, and
`extract` (now `jsonOptions`). Two responses changed shape to match Firecrawl:

- `POST /v1/crawl` returns `id` at the top level. `job_id` is still present.
- `GET /v1/crawl/:id` returns `status`, `total`, `completed`, and a paginated
  `data` array at the top level, rather than nesting a job object under `data`.
  `progress` is still included.

`POST /v1/map` now returns `links` at the top level, and keeps the old
`data.links` alongside it.

## Known limitations

- **PDFs are not parsed.** A PDF URL is rejected with HTTP 415 rather than
  returning garbled text.
- **Search quality depends on the engine.** Bing's RSS fallback returns
  noticeably worse results than SearXNG or DuckDuckGo.
- **No webhooks.** Crawl progress is polled, not pushed.

## License

Apache-2.0
