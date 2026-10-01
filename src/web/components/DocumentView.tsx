import { useMemo, useState } from 'react';
import { Clock, ExternalLink, FileCode2, FileText, Image, Link2, Braces } from 'lucide-react';
import type { Document } from '../client';
import { Badge, CopyButton, Panel, Pre } from './ui';

type ViewKey = 'markdown' | 'html' | 'rawHtml' | 'links' | 'json' | 'screenshot' | 'metadata';

const VIEW_LABELS: Record<ViewKey, { label: string; icon: typeof FileText }> = {
  markdown: { label: 'Markdown', icon: FileText },
  html: { label: 'HTML', icon: FileCode2 },
  rawHtml: { label: 'Raw HTML', icon: FileCode2 },
  links: { label: 'Links', icon: Link2 },
  json: { label: 'JSON', icon: Braces },
  screenshot: { label: 'Screenshot', icon: Image },
  metadata: { label: 'Metadata', icon: Braces },
};

function engineTone(engine: string): 'blue' | 'green' | 'amber' {
  if (engine === 'browser') return 'blue';
  if (engine === 'cache') return 'amber';
  return 'green';
}

export function DocumentView({ document }: { document: Document }) {
  const available = useMemo<ViewKey[]>(() => {
    const keys: ViewKey[] = [];
    if (document.markdown !== undefined) keys.push('markdown');
    if (document.json !== undefined) keys.push('json');
    if (document.html !== undefined) keys.push('html');
    if (document.rawHtml !== undefined) keys.push('rawHtml');
    if (document.links !== undefined) keys.push('links');
    if (document.screenshot !== undefined) keys.push('screenshot');
    keys.push('metadata');
    return keys;
  }, [document]);

  const [view, setView] = useState<ViewKey>(available[0]);
  const active = available.includes(view) ? view : available[0];

  const body = useMemo(() => {
    switch (active) {
      case 'markdown':
        return document.markdown ?? '';
      case 'html':
        return document.html ?? '';
      case 'rawHtml':
        return document.rawHtml ?? '';
      case 'links':
        return (document.links ?? []).join('\n');
      case 'json':
        return JSON.stringify(document.json ?? {}, null, 2);
      case 'metadata':
        return JSON.stringify(document.metadata, null, 2);
      default:
        return '';
    }
  }, [active, document]);

  const extension = active === 'markdown' ? 'md' : active === 'links' ? 'txt' : active.includes('ml') ? 'html' : 'json';

  return (
    <Panel
      title={
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate" title={document.metadata.title}>
            {document.metadata.title || 'Untitled page'}
          </span>
          <a
            href={document.metadata.sourceURL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 truncate font-mono text-xs text-neutral-500 hover:text-blue-400"
          >
            {document.metadata.sourceURL}
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </div>
      }
      actions={
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={engineTone(document.metadata.engine)}>{document.metadata.engine}</Badge>
          {document.metadata.statusCode !== undefined && (
            <Badge tone={document.metadata.statusCode < 400 ? 'green' : 'red'}>
              {document.metadata.statusCode}
            </Badge>
          )}
          <span className="hidden items-center gap-1 text-xs text-neutral-500 sm:flex">
            <Clock className="h-3 w-3" />
            {document.metadata.scrapeDurationMs} ms
          </span>
        </div>
      }
    >
      {document.warning && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {document.warning}
        </p>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {available.map((key) => {
            const { label, icon: Icon } = VIEW_LABELS[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setView(key)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs transition ${
                  active === key
                    ? 'bg-neutral-800 text-neutral-100'
                    : 'text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
                {key === 'links' && document.links && (
                  <span className="text-[10px] text-neutral-600">{document.links.length}</span>
                )}
              </button>
            );
          })}
        </div>
        {active !== 'screenshot' && <CopyButton text={body} filename={`freecrawl.${extension}`} />}
      </div>

      {active === 'screenshot' ? (
        <img
          src={`data:image/png;base64,${document.screenshot}`}
          alt="Page screenshot"
          className="max-h-[32rem] w-full rounded-lg border border-neutral-800 object-contain object-top"
        />
      ) : (
        <Pre>{body || '(empty)'}</Pre>
      )}
    </Panel>
  );
}
