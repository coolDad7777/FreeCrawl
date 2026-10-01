import { useState } from 'react';
import { ExternalLink, Map as MapIcon } from 'lucide-react';
import { post } from '../client';
import { Badge, Button, CopyButton, ErrorBanner, Field, Panel, TextInput, Toggle } from '../components/ui';

interface MapResponse {
  links: string[];
  sources: { sitemap: number; page: number };
}

export function MapPanel({ defaultUrl = '' }: { defaultUrl?: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState('100');
  const [ignoreSitemap, setIgnoreSitemap] = useState(false);
  const [includeSubdomains, setIncludeSubdomains] = useState(false);

  const [result, setResult] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      setResult(
        await post<MapResponse>('/v1/map', {
          url,
          limit: Number(limit) || 100,
          ignoreSitemap,
          includeSubdomains,
          ...(search.trim() ? { search: search.trim() } : {}),
        }),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Map every URL on a site">
        <div className="space-y-4">
          <Field label="URL">
            <TextInput
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url) void submit();
              }}
              placeholder="https://example.com"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Search term" hint="Keeps and ranks only matching URLs">
              <TextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="docs" />
            </Field>
            <Field label="Limit">
              <TextInput type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Toggle label="Ignore sitemap" checked={ignoreSitemap} onChange={setIgnoreSitemap} />
            <Toggle label="Include subdomains" checked={includeSubdomains} onChange={setIncludeSubdomains} />
          </div>

          <Button onClick={() => void submit()} loading={loading} disabled={!url}>
            <MapIcon className="h-4 w-4" />
            Map site
          </Button>
        </div>
      </Panel>

      {error && <ErrorBanner message={error} />}

      {result && (
        <Panel
          title={`${result.links.length} URLs`}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone="blue">{result.sources.sitemap} from sitemap</Badge>
              <Badge>{result.sources.page} from page</Badge>
              <CopyButton text={result.links.join('\n')} filename="freecrawl-links.txt" />
            </div>
          }
        >
          <div className="flex max-h-[32rem] flex-col gap-0.5 overflow-auto">
            {result.links.map((link) => (
              <a
                key={link}
                href={link}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between gap-3 rounded-md px-3 py-1.5 font-mono text-xs text-neutral-400 transition hover:bg-neutral-800/60 hover:text-blue-300"
              >
                <span className="truncate">{link}</span>
                <ExternalLink className="h-3 w-3 shrink-0 opacity-0 transition group-hover:opacity-100" />
              </a>
            ))}
            {result.links.length === 0 && <p className="text-sm text-neutral-500">No URLs matched.</p>}
          </div>
        </Panel>
      )}
    </div>
  );
}
