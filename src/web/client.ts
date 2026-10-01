export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

const API_KEY_STORAGE = 'freecrawl.apiKey';

export function getApiKey(): string {
  try {
    return localStorage.getItem(API_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setApiKey(value: string): void {
  try {
    if (value) localStorage.setItem(API_KEY_STORAGE, value);
    else localStorage.removeItem(API_KEY_STORAGE);
  } catch {
    // Private browsing modes reject writes; the key simply will not persist.
  }
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok) {
    const body = payload as ApiError;
    const error = new Error(body?.error ?? `Request failed with HTTP ${response.status}`);
    (error as Error & { code?: string; details?: unknown }).code = body?.code;
    (error as Error & { code?: string; details?: unknown }).details = body?.details;
    throw error;
  }

  return payload as T;
}

function headers(): Record<string, string> {
  const key = getApiKey();
  return {
    'Content-Type': 'application/json',
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  return parse<T>(response);
}

export async function get<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: headers() });
  return parse<T>(response);
}

export async function del<T>(path: string): Promise<T> {
  const response = await fetch(path, { method: 'DELETE', headers: headers() });
  return parse<T>(response);
}

export interface PageMetadata {
  title: string;
  description: string;
  language: string;
  sourceURL: string;
  statusCode?: number;
  engine: 'fetch' | 'browser' | 'cache';
  scrapeDurationMs: number;
  favicon?: string;
  ogImage?: string;
  author?: string;
}

export interface Document {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  screenshot?: string;
  json?: Record<string, unknown>;
  metadata: PageMetadata;
  warning?: string;
}

export interface JobStatus {
  success: boolean;
  id: string;
  status: 'pending' | 'scraping' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  progress: number;
  errorCount: number;
  error?: string;
  data: Document[];
}

export interface HealthStatus {
  status: string;
  version: string;
  queue: string;
  cache: { enabled: boolean; entries: number };
  aiProviders: { name: string; configured: boolean }[];
  searchEngines: { configured: string[]; searxng: boolean };
  authRequired: boolean;
}
