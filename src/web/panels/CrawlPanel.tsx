import { useEffect, useRef, useState } from 'react';
import { Network, Square } from 'lucide-react';
import { del, get, post, type Document, type JobStatus } from '../client';
import { DocumentView } from '../components/DocumentView';
import { Badge, Button, ErrorBanner, Field, Panel, TextInput, Toggle } from '../components/ui';

const TERMINAL = ['completed', 'failed', 'cancelled'];

export function CrawlPanel({ defaultUrl = '' }: { defaultUrl?: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [limit, setLimit] = useState('10');
  const [maxDepth, setMaxDepth] = useState('2');
  const [includePaths, setIncludePaths] = useState('');
  const [excludePaths, setExcludePaths] = useState('');
  const [allowExternal, setAllowExternal] = useState(false);
  const [ignoreSitemap, setIgnoreSitemap] = useState(false);

  const [job, setJob] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(0);
  const pollTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (pollTimer.current) window.clearTimeout(pollTimer.current);
  }, []);

  const poll = (jobId: string) => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const status = await get<JobStatus>(`/v1/crawl/${jobId}?limit=1000`);
        setJob(status);
        if (!TERMINAL.includes(status.status)) poll(jobId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Polling failed');
      }
    }, 700);
  };

  const start = async () => {
    setStarting(true);
    setError('');
    setJob(null);
    setSelected(0);

    try {
      const splitPaths = (value: string) =>
        value.split(',').map((item) => item.trim()).filter(Boolean);
      const body: Record<string, unknown> = {
        url,
        limit: Number(limit) || 10,
        maxDepth: Number(maxDepth) || 0,
        allowExternalLinks: allowExternal,
        ignoreSitemap,
      };
      if (includePaths.trim()) body.includePaths = splitPaths(includePaths);
      if (excludePaths.trim()) body.excludePaths = splitPaths(excludePaths);

      const started = await post<{ id: string }>('/v1/crawl', body);
      poll(started.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
    } finally {
      setStarting(false);
    }
  };

  const cancel = async () => {
    if (!job) return;
    try {
      await del(`/v1/crawl/${job.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Cancel failed');
    }
  };

  const running = job !== null && !TERMINAL.includes(job.status);
  const documents: Document[] = job?.data ?? [];

  return (
    <div className="space-y-4">
      <Panel title="Crawl a whole site">
        <div className="space-y-4">
          <Field label="Start URL">
            <TextInput
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/docs"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Page limit">
              <TextInput type="number" min={1} value={limit} onChange={(event) => setLimit(event.target.value)} />
            </Field>
            <Field label="Max depth">
              <TextInput type="number" min={0} value={maxDepth} onChange={(event) => setMaxDepth(event.target.value)} />
            </Field>
            <Field label="Include paths" hint="e.g. /docs/**">
              <TextInput value={includePaths} onChange={(event) => setIncludePaths(event.target.value)} />
            </Field>
            <Field label="Exclude paths" hint="e.g. /blog/**">
              <TextInput value={excludePaths} onChange={(event) => setExcludePaths(event.target.value)} />
            </Field>
          </div>

          <div className="flex flex-wrap gap-2">
            <Toggle label="Follow external links" checked={allowExternal} onChange={setAllowExternal} />
            <Toggle label="Ignore sitemap" checked={ignoreSitemap} onChange={setIgnoreSitemap} />
          </div>

          <div className="flex gap-2">
            <Button onClick={() => void start()} loading={starting || running} disabled={!url}>
              <Network className="h-4 w-4" />
              {running ? 'Crawling' : 'Start crawl'}
            </Button>
            {running && (
              <Button variant="danger" onClick={() => void cancel()}>
                <Square className="h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Panel>

      {error && <ErrorBanner message={error} />}

      {job && (
        <Panel
          title={
            <div className="flex items-center gap-2">
              <span>Job</span>
              <code className="font-mono text-xs text-neutral-500">{job.id.slice(0, 8)}</code>
            </div>
          }
          actions={
            <div className="flex items-center gap-2">
              {job.errorCount > 0 && <Badge tone="amber">{job.errorCount} errors</Badge>}
              <Badge
                tone={
                  job.status === 'completed' ? 'green' : job.status === 'failed' ? 'red' : job.status === 'cancelled' ? 'amber' : 'blue'
                }
              >
                {job.status}
              </Badge>
            </div>
          }
        >
          <div className="mb-4">
            <div className="mb-1.5 flex justify-between text-xs text-neutral-500">
              <span>
                {job.completed} of {job.total} pages
              </span>
              <span>{job.progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${Math.max(job.progress, 2)}%` }}
              />
            </div>
          </div>

          {job.error && <ErrorBanner message={job.error} />}

          {documents.length > 0 && (
            <div className="flex max-h-64 flex-col gap-1 overflow-auto">
              {documents.map((document, index) => (
                <button
                  key={`${document.metadata.sourceURL}-${index}`}
                  type="button"
                  onClick={() => setSelected(index)}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition ${
                    selected === index ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/50'
                  }`}
                >
                  <span className="truncate font-mono">{document.metadata.sourceURL}</span>
                  <span className="shrink-0 text-neutral-600">
                    {(document.markdown?.length ?? 0).toLocaleString()} chars
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      )}

      {documents[selected] && <DocumentView document={documents[selected]} />}
    </div>
  );
}
