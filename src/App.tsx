import { useEffect, useState } from 'react';
import {
  Database,
  Github,
  KeyRound,
  Map as MapIcon,
  Network,
  Search,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { get, getApiKey, setApiKey, type HealthStatus } from './web/client';
import { Badge, TextInput } from './web/components/ui';
import { CrawlPanel } from './web/panels/CrawlPanel';
import { ExtractPanel } from './web/panels/ExtractPanel';
import { MapPanel } from './web/panels/MapPanel';
import { ScrapePanel } from './web/panels/ScrapePanel';
import { SearchPanel } from './web/panels/SearchPanel';

const TABS = [
  { id: 'scrape', label: 'Scrape', icon: Zap, hint: 'One URL to Markdown' },
  { id: 'crawl', label: 'Crawl', icon: Network, hint: 'Follow links across a site' },
  { id: 'map', label: 'Map', icon: MapIcon, hint: 'List every URL' },
  { id: 'search', label: 'Search', icon: Search, hint: 'Query the web' },
  { id: 'extract', label: 'Extract', icon: Sparkles, hint: 'LLM to JSON' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  const [tab, setTab] = useState<TabId>('scrape');
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [apiKey, setKey] = useState(getApiKey());
  const [showKeyInput, setShowKeyInput] = useState(false);

  useEffect(() => {
    void get<HealthStatus>('/health')
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    setApiKey(apiKey);
  }, [apiKey]);

  return (
    <div className="min-h-screen bg-neutral-950 font-sans text-neutral-100 selection:bg-blue-500/30">
      <header className="sticky top-0 z-50 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600">
              <Zap className="h-5 w-5 fill-current text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">FreeCrawl</span>
            <Badge tone="blue">self-hosted</Badge>
          </div>

          <div className="flex items-center gap-3">
            {health && (
              <div className="hidden items-center gap-2 text-xs text-neutral-500 md:flex">
                <span className="flex items-center gap-1" title={`Job queue: ${health.queue}`}>
                  <Server className="h-3.5 w-3.5" />
                  {health.queue}
                </span>
                <span className="flex items-center gap-1" title="Cached scrape results">
                  <Database className="h-3.5 w-3.5" />
                  {health.cache.enabled ? `${health.cache.entries} cached` : 'cache off'}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowKeyInput((value) => !value)}
              title="Set the API key sent with every request"
              className={`rounded-lg border p-2 transition ${
                apiKey
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-neutral-800 text-neutral-500 hover:border-neutral-700'
              }`}
            >
              <KeyRound className="h-4 w-4" />
            </button>
            <a
              href="https://github.com/coolDad7777/freecrawl"
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-neutral-800 p-2 text-neutral-500 transition hover:border-neutral-700 hover:text-neutral-200"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>

        {showKeyInput && (
          <div className="border-t border-neutral-800 bg-neutral-900/60 px-4 py-3">
            <div className="mx-auto flex max-w-6xl items-center gap-3">
              <TextInput
                type="password"
                value={apiKey}
                onChange={(event) => setKey(event.target.value)}
                placeholder={
                  health?.authRequired
                    ? 'FREECRAWL_API_KEY is required by this server'
                    : 'Optional — this server does not require a key'
                }
                className="max-w-md"
              />
              <span className="text-xs text-neutral-500">Stored in this browser only.</span>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-6xl px-4 py-10">
        <div className="mb-10 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-4xl font-bold tracking-tight text-transparent md:text-6xl"
          >
            Turn the web into
            <br />
            LLM-ready data.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mx-auto max-w-2xl text-neutral-400"
          >
            A free, self-hosted alternative to Firecrawl. Scrape, crawl, map, search, and extract
            structured JSON — on your own hardware, with no per-page billing.
          </motion.p>
        </div>

        <nav className="mb-6 flex flex-wrap gap-2">
          {TABS.map(({ id, label, icon: Icon, hint }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              title={hint}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
                tab === id
                  ? 'border-blue-500/40 bg-blue-500/10 text-blue-200'
                  : 'border-neutral-800 bg-neutral-900/60 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </nav>

        {tab === 'scrape' && <ScrapePanel />}
        {tab === 'crawl' && <CrawlPanel />}
        {tab === 'map' && <MapPanel />}
        {tab === 'search' && <SearchPanel />}
        {tab === 'extract' && <ExtractPanel providers={health?.aiProviders} />}

        <section className="mt-16 rounded-2xl border border-neutral-800 bg-neutral-900/40 p-6 md:p-8">
          <h2 className="mb-2 text-xl font-bold">Use it from your own code</h2>
          <p className="mb-6 text-sm text-neutral-400">
            Every panel above is a thin wrapper over the HTTP API. The full contract lives in{' '}
            <a href="/openapi.yaml" className="text-blue-400 hover:underline">
              openapi.yaml
            </a>
            .
          </p>
          <pre className="overflow-x-auto rounded-xl bg-black/60 p-5 font-mono text-xs leading-relaxed text-neutral-300">
{`curl -X POST http://localhost:3000/v1/scrape \\
  -H 'Content-Type: application/json' \\
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "links"],
    "onlyMainContent": true
  }'`}
          </pre>
        </section>
      </main>

      <footer className="mt-16 border-t border-neutral-800 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-neutral-600 md:flex-row">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 fill-current text-blue-600" />
            <span className="font-bold text-neutral-400">FreeCrawl</span>
            {health && <span className="font-mono text-xs">v{health.version}</span>}
          </div>
          <span>Apache-2.0. Built for the open web.</span>
        </div>
      </footer>
    </div>
  );
}
