import type { Readable } from 'node:stream';
import axios, { type AxiosResponse } from 'axios';
import { config } from '../config';
import { ScrapeFailedError } from './errors';
import { assertSafeUrl } from './url';

export interface HttpGetOptions {
  timeout?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
  /** Re-validates every redirect hop; disable only for same-origin internals. */
  validateRedirects?: boolean;
  responseType?: 'text' | 'arraybuffer';
}

export interface HttpResponse {
  statusCode: number;
  body: string;
  buffer?: Buffer;
  contentType: string;
  finalUrl: string;
}

const MAX_REDIRECTS = 5;

function defaultHeaders(): Record<string, string> {
  return {
    'User-Agent': config.scrape.userAgent,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
  };
}

/**
 * Reads at most `maxBytes` and aborts the connection past that, so a server
 * that streams without declaring a Content-Length cannot exhaust memory.
 */
async function readStream(stream: Readable, maxBytes: number, url: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
      total += buffer.byteLength;
      if (total > maxBytes) {
        stream.destroy();
        throw new ScrapeFailedError(
          `Response from ${url} exceeds the ${maxBytes} byte limit`,
          413,
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ScrapeFailedError) throw error;
    throw new ScrapeFailedError(
      `Reading the response from ${url} failed: ${error instanceof Error ? error.message : 'stream error'}`,
    );
  }

  return Buffer.concat(chunks);
}

/**
 * Performs a GET with a hard byte ceiling and manual redirect handling, so each
 * hop is re-checked against the SSRF rules instead of trusting the first URL.
 */
export async function httpGet(url: string, options: HttpGetOptions = {}): Promise<HttpResponse> {
  const maxBytes = options.maxBytes ?? config.scrape.maxBytes;
  const timeout = options.timeout ?? config.scrape.timeoutMs;
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response: AxiosResponse<Readable>;
    try {
      response = await axios.get<Readable>(currentUrl, {
        timeout,
        maxRedirects: 0,
        responseType: 'stream',
        decompress: true,
        headers: { ...defaultHeaders(), ...options.headers },
        // Non-2xx bodies are still useful (error pages, 404 content).
        validateStatus: () => true,
      });
    } catch (error) {
      const axiosError = error as { code?: string; message?: string };
      if (axiosError.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED') {
        throw new ScrapeFailedError(
          `Response from ${currentUrl} exceeds the ${maxBytes} byte limit`,
          413,
        );
      }
      if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
        throw new ScrapeFailedError(`Request to ${currentUrl} timed out after ${timeout}ms`, 504);
      }
      throw new ScrapeFailedError(
        `Request to ${currentUrl} failed: ${axiosError.message ?? 'network error'}`,
      );
    }

    const location = response.headers?.location as string | undefined;
    if (response.status >= 300 && response.status < 400 && location) {
      response.data?.destroy();
      if (hop === MAX_REDIRECTS) {
        throw new ScrapeFailedError(`Too many redirects while fetching ${url}`);
      }
      const next = new URL(location, currentUrl).toString();
      currentUrl = options.validateRedirects === false ? next : await assertSafeUrl(next);
      continue;
    }

    const declaredLength = Number(response.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      response.data?.destroy();
      throw new ScrapeFailedError(
        `Response from ${currentUrl} is ${declaredLength} bytes, over the ${maxBytes} byte limit`,
        413,
      );
    }

    const buffer = await readStream(response.data, maxBytes, currentUrl);

    return {
      statusCode: response.status,
      body: buffer.toString('utf8'),
      buffer,
      contentType: String(response.headers?.['content-type'] ?? '').toLowerCase(),
      finalUrl: currentUrl,
    };
  }

  throw new ScrapeFailedError(`Too many redirects while fetching ${url}`);
}

const HTML_CONTENT_TYPES = ['text/html', 'application/xhtml', 'application/xml', 'text/xml'];

export function isHtmlContentType(contentType: string): boolean {
  if (!contentType) return true;
  return HTML_CONTENT_TYPES.some((type) => contentType.includes(type));
}

export function isTextContentType(contentType: string): boolean {
  return contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('javascript') ||
    contentType.includes('markdown') ||
    contentType.includes('csv');
}

/**
 * Detects pages whose markup is an empty shell, which means the content is
 * client-rendered and the request has to be retried in a real browser.
 */
export function needsBrowserRendering(html: string, extractedTextLength: number): boolean {
  if (extractedTextLength >= 600) return false;

  const lower = html.toLowerCase();
  const hasAppRoot = /<(div|main)[^>]+id=["'](root|app|__next|__nuxt|svelte|ember-app)["']/.test(lower);
  const emptyAppRoot =
    /<(div|main)[^>]+id=["'](root|app|__next|__nuxt)["'][^>]*>\s*<\/(div|main)>/.test(lower);
  const frameworkHints = /\b(window\.__nuxt__|__next_data__|data-reactroot|ng-version|v-cloak)\b/.test(lower);
  const noscriptWarning = /<noscript>[^<]*(enable javascript|javascript is required)/i.test(html);

  if (emptyAppRoot || noscriptWarning) return true;
  if (extractedTextLength < 200 && (hasAppRoot || frameworkHints)) return true;
  return extractedTextLength === 0 && lower.includes('<script');
}
