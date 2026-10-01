# FreeCrawl

A complete, self-hosted web scraping API that provides Firecrawl-style functionality with a no-key local extraction fallback and optional free-tier AI providers.

## Features

- **Scrape**: Single URL to markdown, HTML, or screenshot.
- **Crawl**: Recursive site crawling with depth control.
- **Map**: Discover all internal URLs on a site.
- **Extract**: Structured data extraction using the local fallback, Gemini, or Groq.
- **Search**: Web search integration via DuckDuckGo.
- **Self-Hosted**: Run on your own infrastructure with total privacy.

## Tech Stack

- **API**: Express.js (Node.js)
- **Browser**: Playwright (Headless Chrome)
- **Queue**: BullMQ + Redis
- **Extraction**: Local heuristic fallback, Gemini 2.5 Flash, Groq (Llama 3)
- **Frontend**: React + Tailwind CSS + Framer Motion

## Getting Started

### Prerequisites

- Node.js 18+
- Redis (optional, for durable crawl queues; the app falls back to in-memory jobs)
- Gemini or Groq API key (optional, only needed when using those providers)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env`:
   ```env
   PORT=3000
   REDIS_URL=redis://localhost:6379
   GEMINI_API_KEY=your_optional_key_here
   GROQ_API_KEY=your_optional_key_here
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

## API overview

All endpoints return `{ "success": boolean, ... }`. Invalid request bodies return
`400`; unsafe or unreachable target URLs return `422`.

- `POST /v1/scrape` — scrape a URL as Markdown, HTML, or a screenshot.
- `POST /v1/crawl` — enqueue a bounded recursive crawl and return its `job_id`.
- `GET /v1/crawl/:jobId` — read crawl progress and results.
- `DELETE /v1/crawl/:jobId` — cancel an active crawl.
- `POST /v1/map` — list same-host links, up to the requested limit.
- `POST /v1/search` — search DuckDuckGo and optionally scrape results.
- `POST /v1/extract` — scrape one or more URLs and return structured JSON.
- `GET /health` — liveness check.

Target URLs are restricted to public HTTP(S) hosts. Private IP ranges, localhost,
URL credentials, unsupported schemes, oversized pages, and excessively large
requests are rejected by the API. For local development and tests, set
`FREECRAWL_ALLOW_PRIVATE_HOSTS=true` to allow private hosts.

An OpenAPI 3 description is available at [`openapi.yaml`](./openapi.yaml).

## API Usage

### Scrape a URL

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown"],
    "ai_provider": "local"
  }'
```

### Extract structured data

```bash
curl -X POST http://localhost:3000/v1/extract \
  -H "Content-Type: application/json" \
  -d '{
    "urls": ["https://example.com"],
    "schema": {
      "title": "Page title",
      "summary": "Short summary"
    },
    "ai_provider": "local"
  }'
```

### Start a Crawl

```bash
curl -X POST http://localhost:3000/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "max_depth": 2,
    "limit": 10
  }'
```

## License

Apache-2.0
