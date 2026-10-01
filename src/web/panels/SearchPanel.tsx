import { useState } from 'react';
import { ExternalLink, Search } from 'lucide-react';
import { post, type Document } from '../client';
import { DocumentView } from '../components/DocumentView';
import { Badge, Button, ErrorBanner, Field, Panel, Select, TextInput, Toggle } from '../components/ui';

interface SearchHit {
  url: string;
  title: string;
  description: string;
  engine?: string;
  markdown?: string;
  metadata?: Document['metadata'];
  error?: string;
}

interface SearchResponse {
  engine: string;
  data: SearchHit[];
  warning?: string;
}

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState('5');
  const [engine, setEngine] = useState('auto');
  const [scrapeResults, setScrapeResults] = useState(false);

  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<number | null>(null);

  const submit = async () => {
    setLoading(true);
    setError('');
    setSelected(null);
    try {
      setResult(
        await post<SearchResponse>('/v1/search', {
          query,
          limit: Number(limit) || 5,
          engine,
          ...(scrapeResults ? { scrapeOptions: { formats: ['markdown'] } } : {}),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const selectedHit = selected !== null ? result?.data[selected] : undefined;

  return (
    <div className="space-y-4">
      <Panel title="Search the web">
        <div className="space-y-4">
          <Field label="Query">
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && query) void submit();
              }}
              placeholder="open source web scraping api"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Results">
              <TextInput type="number" min={1} max={50} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Field>
            <Field label="Engine" hint="auto falls back across engines">
              <Select value={engine} onChange={(event) => setEngine(event.target.value)}>
                <option value="auto">auto</option>
                <option value="searxng">searxng</option>
                <option value="duckduckgo">duckduckgo</option>
                <option value="bing">bing</option>
              </Select>
            </Field>
            <Field label="Options">
              <Toggle label="Scrape each result" checked={scrapeResults} onChange={setScrapeResults} />
            </Field>
          </div>

          <Button onClick={() => void submit()} loading={loading} disabled={!query}>
            <Search className="h-4 w-4" />
            Search
          </Button>
        </div>
      </Panel>

      {error && <ErrorBanner message={error} />}

      {result && (
        <Panel
          title={`${result.data.length} results`}
          actions={<Badge tone="blue">{result.engine}</Badge>}
        >
          {result.warning && <p className="mb-3 text-xs text-amber-300">{result.warning}</p>}
          <div className="space-y-2">
            {result.data.map((hit, index) => (
              <div key={hit.url} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 text-sm font-medium text-blue-300 hover:underline"
                    >
                      <span className="truncate">{hit.title || hit.url}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <p className="truncate font-mono text-xs text-neutral-600">{hit.url}</p>
                    {hit.description && <p className="mt-1.5 text-xs text-neutral-400">{hit.description}</p>}
                    {hit.error && <p className="mt-1.5 text-xs text-red-300">{hit.error}</p>}
                  </div>
                  {hit.markdown && (
                    <Button variant="ghost" onClick={() => setSelected(selected === index ? null : index)}>
                      {selected === index ? 'Hide' : 'View'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {selectedHit?.markdown && selectedHit.metadata && (
        <DocumentView document={{ markdown: selectedHit.markdown, metadata: selectedHit.metadata }} />
      )}
    </div>
  );
}
