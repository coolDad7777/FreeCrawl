import { useState } from 'react';
import { Zap } from 'lucide-react';
import { post, type Document } from '../client';
import { DocumentView } from '../components/DocumentView';
import {
  Button,
  ErrorBanner,
  Field,
  FormatPicker,
  Panel,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from '../components/ui';

const FORMATS = ['markdown', 'html', 'rawHtml', 'links', 'screenshot', 'screenshot@fullPage', 'json'];

export function ScrapePanel({ defaultUrl = '' }: { defaultUrl?: string }) {
  const [url, setUrl] = useState(defaultUrl);
  const [formats, setFormats] = useState<string[]>(['markdown']);
  const [engine, setEngine] = useState('auto');
  const [onlyMainContent, setOnlyMainContent] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [skipCache, setSkipCache] = useState(false);
  const [waitFor, setWaitFor] = useState('0');
  const [includeTags, setIncludeTags] = useState('');
  const [excludeTags, setExcludeTags] = useState('');
  const [schema, setSchema] = useState('{\n  "title": "The page title",\n  "summary": "A one sentence summary"\n}');
  const [prompt, setPrompt] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [document, setDocument] = useState<Document | null>(null);

  const wantsJson = formats.includes('json');

  const submit = async () => {
    setLoading(true);
    setError('');

    try {
      const body: Record<string, unknown> = {
        url,
        formats,
        engine,
        onlyMainContent,
        respectRobotsTxt: respectRobots,
        skipCache,
        waitFor: Number(waitFor) || 0,
      };

      const splitTags = (value: string) =>
        value.split(',').map((item) => item.trim()).filter(Boolean);
      if (includeTags.trim()) body.includeTags = splitTags(includeTags);
      if (excludeTags.trim()) body.excludeTags = splitTags(excludeTags);

      if (wantsJson) {
        const jsonOptions: Record<string, unknown> = {};
        if (prompt.trim()) jsonOptions.prompt = prompt.trim();
        if (schema.trim()) {
          try {
            jsonOptions.schema = JSON.parse(schema);
          } catch {
            throw new Error('The extraction schema is not valid JSON');
          }
        }
        body.jsonOptions = jsonOptions;
      }

      const response = await post<{ data: Document }>('/v1/scrape', body);
      setDocument(response.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Request failed');
      setDocument(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel title="Scrape one URL">
        <div className="space-y-4">
          <Field label="URL">
            <TextInput
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && url) void submit();
              }}
              placeholder="https://example.com/article"
            />
          </Field>

          <Field label="Formats" hint="Screenshots and JSON extraction both force the browser engine.">
            <FormatPicker value={formats} onChange={setFormats} options={FORMATS} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Engine" hint="auto fetches first, then renders if needed">
              <Select value={engine} onChange={(event) => setEngine(event.target.value)}>
                <option value="auto">auto</option>
                <option value="fetch">fetch (fast)</option>
                <option value="browser">browser (JS)</option>
              </Select>
            </Field>
            <Field label="Wait for (ms)" hint="Extra delay after load">
              <TextInput
                type="number"
                min={0}
                max={30000}
                value={waitFor}
                onChange={(event) => setWaitFor(event.target.value)}
              />
            </Field>
            <Field label="Include tags" hint="CSS selectors, comma separated">
              <TextInput
                value={includeTags}
                onChange={(event) => setIncludeTags(event.target.value)}
                placeholder="article, table"
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Exclude tags" hint="CSS selectors removed before conversion">
              <TextInput
                value={excludeTags}
                onChange={(event) => setExcludeTags(event.target.value)}
                placeholder=".ads, #comments"
              />
            </Field>
            <Field label="Options">
              <div className="flex flex-wrap gap-2">
                <Toggle label="Main content only" checked={onlyMainContent} onChange={setOnlyMainContent} />
                <Toggle label="Respect robots.txt" checked={respectRobots} onChange={setRespectRobots} />
                <Toggle label="Skip cache" checked={skipCache} onChange={setSkipCache} />
              </div>
            </Field>
          </div>

          {wantsJson && (
            <div className="grid gap-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 sm:grid-cols-2">
              <Field label="Extraction prompt" hint="Optional natural language instruction">
                <TextInput
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Pull out the pricing tiers"
                />
              </Field>
              <Field label="Schema" hint="JSON Schema, or a flat field-to-description map">
                <TextArea rows={5} value={schema} onChange={(event) => setSchema(event.target.value)} />
              </Field>
            </div>
          )}

          <Button onClick={() => void submit()} loading={loading} disabled={!url}>
            <Zap className="h-4 w-4" />
            Scrape
          </Button>
        </div>
      </Panel>

      {error && <ErrorBanner message={error} />}
      {document && <DocumentView document={document} />}
    </div>
  );
}
