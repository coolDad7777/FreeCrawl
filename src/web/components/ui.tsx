import React, { useState } from 'react';
import { AlertTriangle, Check, ChevronDown, Copy, Download, Loader2 } from 'lucide-react';

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">{label}</span>
      {children}
      {hint && <span className="text-xs text-neutral-600">{hint}</span>}
    </label>
  );
}

const INPUT_CLASS =
  'w-full rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 ' +
  'placeholder:text-neutral-600 outline-none transition focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${INPUT_CLASS} ${props.className ?? ''}`} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${INPUT_CLASS} font-mono ${props.className ?? ''}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${INPUT_CLASS} appearance-none pr-9 ${props.className ?? ''}`} />
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500" />
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${
        checked
          ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
          : 'border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700'
      }`}
    >
      <span
        className={`flex h-4 w-4 items-center justify-center rounded border ${
          checked ? 'border-blue-400 bg-blue-500' : 'border-neutral-700'
        }`}
      >
        {checked && <Check className="h-3 w-3 text-white" />}
      </span>
      {label}
    </button>
  );
}

export function FormatPicker({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
}) {
  const toggle = (format: string) => {
    const next = value.includes(format) ? value.filter((item) => item !== format) : [...value, format];
    onChange(next.length > 0 ? next : [format]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((format) => (
        <button
          key={format}
          type="button"
          onClick={() => toggle(format)}
          className={`rounded-full border px-3 py-1 font-mono text-xs transition ${
            value.includes(format)
              ? 'border-blue-500/40 bg-blue-500/10 text-blue-300'
              : 'border-neutral-800 bg-neutral-900 text-neutral-500 hover:border-neutral-700'
          }`}
        >
          {format}
        </button>
      ))}
    </div>
  );
}

export function Button({
  children,
  loading,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-500 disabled:bg-blue-600/40',
    ghost: 'border border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-700',
    danger: 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20',
  }[variant];

  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${styles} ${props.className ?? ''}`}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="break-words">{message}</span>
    </div>
  );
}

export function CopyButton({ text, filename }: { text: string; filename?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename ?? 'freecrawl-output.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={copy}
        title="Copy to clipboard"
        className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
      >
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
      {filename && (
        <button
          type="button"
          onClick={download}
          title={`Download ${filename}`}
          className="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-800 hover:text-neutral-200"
        >
          <Download className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export function Panel({
  title,
  actions,
  children,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900/60">
      <header className="flex items-center justify-between gap-4 border-b border-neutral-800 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-neutral-300">{title}</div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Pre({ children }: { children: string }) {
  return (
    <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/60 p-4 font-mono text-xs leading-relaxed text-neutral-300">
      {children}
    </pre>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'blue' | 'green' | 'amber' | 'red';
}) {
  const tones = {
    neutral: 'border-neutral-700 bg-neutral-800/60 text-neutral-400',
    blue: 'border-blue-500/30 bg-blue-500/10 text-blue-300',
    green: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
    red: 'border-red-500/30 bg-red-500/10 text-red-300',
  }[tone];

  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${tones}`}>
      {children}
    </span>
  );
}
