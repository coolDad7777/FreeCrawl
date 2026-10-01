import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { post } from '../client';
import { Badge, Button, CopyButton, ErrorBanner, Field, Panel, Pre, Select, TextArea } from '../components/ui';

interface ExtractResponse {
  data: Record<string, unknown>;
  provider: string;
  sources: { url: string; status: 'ok' | 'failed'; title?: string; error?: string }[];
}

const EXAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "productName": { "type": "string" },
    "price": { "type": "number" },
    "features": { "type": "array", "items": { "type": "string" } }
  }
}`;

export function ExtractPanel({
  providers = [],
}: {
  providers?: { name: string; configured: boolean }[];
}) {
  const [urls, setUrls] = useState('');
  const [prompt, setPrompt] = useState('Extract the product name, price, and key features.');
  const [schema, setSchema] = useState(EXAMPLE_SCHEMA);
  const [provider, setProvider] = useState(providers.find((item) => item.configured)?.name ?? 'gemini');

  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const configured = providers.filter((item) => item.configured);

  const submit = async () => {
    setLoading(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        urls: urls.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
        aiProvider: provider,
      };
      if (prompt.trim()) body.prompt = prompt.trim();
      if (schema.trim()) {
        try {
          body.schema = JSON.parse(schema);
        } catch {
          throw new Error('The schema is not valid JSON');
        }
      }

      setResult(await post<ExtractResponse>('/v1/extract', body));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Extract structured data with an LLM">
        <div className="space-y-4">
          {configured.length === 0 && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              No AI provider is configured. Set <code className="font-mono">GEMINI_API_KEY</code> or{' '}
              <code className="font-mono">GROQ_API_KEY</code> in <code className="font-mono">.env</code> and restart
              the server.
            </p>
          )}

          <Field label="URLs" hint="One per line, or comma separated. Up to 20.">
            <TextArea
              rows={3}
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
              placeholder={'https://example.com/product/1\nhttps://example.com/product/2'}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Prompt">
              <TextArea rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            <Field label="Schema" hint="JSON Schema, or a flat field-to-description map">
              <TextArea rows={6} value={schema} onChange={(event) => setSchema(event.target.value)} />
            </Field>
          </div>

          <Field label="Provider" className="max-w-xs">
            <Select value={provider} onChange={(event) => setProvider(event.target.value)}>
              {(providers.length > 0 ? providers : [{ name: 'gemini', configured: false }]).map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}
                  {item.configured ? '' : ' (no key)'}
                </option>
              ))}
            </Select>
          </Field>

          <Button onClick={() => void submit()} loading={loading} disabled={!urls.trim()}>
            <Sparkles className="h-4 w-4" />
            Extract
          </Button>
        </div>
      </Panel>

      {error && <ErrorBanner message={error} />}

      {result && (
        <Panel
          title="Extracted JSON"
          actions={
            <div className="flex items-center gap-2">
              <Badge tone="blue">{result.provider}</Badge>
              <CopyButton text={JSON.stringify(result.data, null, 2)} filename="freecrawl-extract.json" />
            </div>
          }
        >
          <Pre>{JSON.stringify(result.data, null, 2)}</Pre>
          <div className="mt-3 space-y-1">
            {result.sources.map((source) => (
              <div key={source.url} className="flex items-center gap-2 font-mono text-xs">
                <Badge tone={source.status === 'ok' ? 'green' : 'red'}>{source.status}</Badge>
                <span className="truncate text-neutral-500">{source.url}</span>
                {source.error && <span className="text-red-300">{source.error}</span>}
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
