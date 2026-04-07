# FreeCrawl

A complete, self-hosted web scraping API that provides Firecrawl-equivalent functionality using only free AI providers.

## Features

- **Scrape**: Single URL to markdown, HTML, or screenshot.
- **Crawl**: Recursive site crawling with depth control.
- **Map**: Discover all internal URLs on a site.
- **Extract**: AI-powered structured data extraction using Gemini 2.5 Flash.
- **Search**: Web search integration via DuckDuckGo.
- **Self-Hosted**: Run on your own infrastructure with total privacy.

## Tech Stack

- **API**: Express.js (Node.js)
- **Browser**: Playwright (Headless Chrome)
- **Queue**: BullMQ + Redis
- **AI**: Gemini 2.5 Flash, Groq (Llama 3)
- **Frontend**: React + Tailwind CSS + Framer Motion

## Getting Started

### Prerequisites

- Node.js 18+
- Redis (for crawl jobs)
- Gemini API Key (from Google AI Studio)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env`:
   ```env
   GEMINI_API_KEY=your_key_here
   REDIS_URL=redis://localhost:6379
   ```
4. Start the server:
   ```bash
   npm run dev
   ```

## API Usage

### Scrape a URL

```bash
curl -X POST http://localhost:3000/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown"],
    "ai_provider": "gemini"
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
