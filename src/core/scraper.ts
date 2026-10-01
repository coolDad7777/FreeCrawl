import type { Page } from 'playwright';
import { config } from '../config';
import type { Action, Document, ScrapeOptions, ScrapeRequest } from '../types';
import { ScrapeOptionsSchema } from '../types';
import { getAIProvider } from '../ai';
import { browserManager } from './browser';
import { cacheKey, scrapeCache } from './cache';
import { htmlToMarkdown } from './converter';
import { BlockedByRobotsError, ScrapeFailedError, toErrorMessage } from './errors';
import { extractPage } from './extractor';
import { httpGet, isHtmlContentType, isTextContentType, needsBrowserRendering } from './fetcher';
import { isAllowedByRobots } from './robots';

type ResolvedOptions = ScrapeOptions;

export function resolveScrapeOptions(options: Partial<ScrapeOptions> = {}): ResolvedOptions {
  return ScrapeOptionsSchema.parse(options) as ResolvedOptions;
}

function wantsFormat(options: ResolvedOptions, format: string): boolean {
  return options.formats.includes(format as never);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Wraps a non-HTML text payload so the HTML pipeline can handle it uniformly. */
function wrapPlainText(body: string, contentType: string, url: string): string {
  const language = contentType.includes('json')
    ? 'json'
    : contentType.includes('csv')
      ? 'csv'
      : contentType.includes('javascript')
        ? 'javascript'
        : contentType.includes('xml')
          ? 'xml'
          : '';

  if (contentType.includes('markdown') || contentType.includes('plain')) {
    return `<html><body><pre>${escapeHtml(body)}</pre></body></html>`;
  }

  return `<html><head><title>${escapeHtml(new URL(url).pathname)}</title></head><body><pre><code class="language-${language}">${escapeHtml(
    body,
  )}</code></pre></body></html>`;
}

async function runActions(
  page: Page,
  actions: Action[],
  collected: { screenshots: string[]; scrapes: { url: string; html: string }[] },
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'wait':
        if (action.selector) {
          await page.waitForSelector(action.selector, { timeout: 15_000 }).catch(() => undefined);
        } else {
          await page.waitForTimeout(Math.min(action.milliseconds ?? 1_000, 30_000));
        }
        break;
      case 'click':
        await page.click(action.selector, { timeout: 15_000 }).catch(() => undefined);
        break;
      case 'write':
        if (action.selector) {
          await page.fill(action.selector, action.text, { timeout: 15_000 }).catch(() => undefined);
        } else {
          await page.keyboard.type(action.text);
        }
        break;
      case 'press':
        await page.keyboard.press(action.key).catch(() => undefined);
        break;
      case 'scroll':
        for (let index = 0; index < action.amount; index += 1) {
          const delta = action.direction === 'up' ? -1 : 1;
          await page.evaluate(
            (step: number) => window.scrollBy(0, step * window.innerHeight),
            delta,
          );
          await page.waitForTimeout(250);
        }
        break;
      case 'screenshot':
        collected.screenshots.push(
          (await page.screenshot({ fullPage: action.fullPage, type: 'png' })).toString('base64'),
        );
        break;
      case 'scrape':
        collected.scrapes.push({ url: page.url(), html: await page.content() });
        break;
    }
  }
}

interface RawPage {
  rawHtml: string;
  statusCode?: number;
  contentType: string;
  finalUrl: string;
  engine: 'fetch' | 'browser';
  actions?: Document['actions'];
  screenshot?: string;
  warning?: string;
}

async function fetchWithHttp(url: string, options: ResolvedOptions): Promise<RawPage> {
  const response = await httpGet(url, {
    timeout: options.timeout,
    headers: options.headers,
  });

  const isText = isHtmlContentType(response.contentType) || isTextContentType(response.contentType);
  if (!isText) {
    throw new ScrapeFailedError(
      `Unsupported content type "${response.contentType || 'unknown'}" at ${response.finalUrl}`,
      415,
    );
  }

  const rawHtml = isHtmlContentType(response.contentType)
    ? response.body
    : wrapPlainText(response.body, response.contentType, response.finalUrl);

  return {
    rawHtml,
    statusCode: response.statusCode,
    contentType: response.contentType,
    finalUrl: response.finalUrl,
    engine: 'fetch',
  };
}

async function fetchWithBrowser(url: string, options: ResolvedOptions): Promise<RawPage> {
  return browserManager.withPage(
    { mobile: options.mobile, headers: options.headers },
    async (page) => {
      page.setDefaultTimeout(options.timeout);

      const response = await page
        .goto(url, { waitUntil: 'domcontentloaded', timeout: options.timeout })
        .catch((error: Error) => {
          throw new ScrapeFailedError(`Navigation to ${url} failed: ${error.message}`, 504);
        });

      // Give client-side frameworks a chance to paint before reading the DOM.
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
      if (options.waitFor > 0) await page.waitForTimeout(options.waitFor);

      const collected: Document['actions'] = { screenshots: [], scrapes: [] };
      if (options.actions?.length) await runActions(page, options.actions, collected);

      const rawHtml = await page.content();
      if (Buffer.byteLength(rawHtml, 'utf8') > config.scrape.maxBytes) {
        throw new ScrapeFailedError(
          `Rendered page at ${url} exceeds the ${config.scrape.maxBytes} byte limit`,
          413,
        );
      }

      const wantsScreenshot = wantsFormat(options, 'screenshot') || wantsFormat(options, 'screenshot@fullPage');
      const screenshot = wantsScreenshot
        ? (
            await page.screenshot({
              fullPage: wantsFormat(options, 'screenshot@fullPage'),
              type: 'png',
            })
          ).toString('base64')
        : undefined;

      return {
        rawHtml,
        statusCode: response?.status(),
        contentType: String(response?.headers()['content-type'] ?? 'text/html').toLowerCase(),
        finalUrl: page.url(),
        engine: 'browser' as const,
        screenshot,
        actions:
          collected.screenshots.length > 0 || collected.scrapes.length > 0 ? collected : undefined,
      };
    },
  );
}

/**
 * Picks the cheapest engine that can render the page: a plain HTTP fetch when
 * the markup already contains the content, a headless browser otherwise.
 */
async function loadPage(url: string, options: ResolvedOptions): Promise<RawPage> {
  const needsBrowserUpfront =
    options.engine === 'browser' ||
    Boolean(options.actions?.length) ||
    options.waitFor > 0 ||
    wantsFormat(options, 'screenshot') ||
    wantsFormat(options, 'screenshot@fullPage');

  if (needsBrowserUpfront) {
    if (options.engine === 'fetch') {
      throw new ScrapeFailedError(
        'Actions, waitFor, and screenshots require the browser engine',
        400,
      );
    }
    return fetchWithBrowser(url, options);
  }

  try {
    const page = await fetchWithHttp(url, options);
    if (options.engine === 'fetch') return page;

    const probe = extractPage(page.rawHtml, { url: page.finalUrl, onlyMainContent: true });
    if (!needsBrowserRendering(page.rawHtml, probe.text.length)) return page;

    try {
      return await fetchWithBrowser(url, options);
    } catch {
      // The HTTP response is still the best available answer.
      return page;
    }
  } catch (error) {
    if (options.engine === 'fetch') throw error;
    if (error instanceof ScrapeFailedError && error.statusCode === 415) throw error;
    return fetchWithBrowser(url, options);
  }
}

async function runJsonExtraction(
  document: Document,
  options: ResolvedOptions,
): Promise<Record<string, unknown>> {
  return getAIProvider(options.aiProvider).extractStructured({
    content: document.markdown || document.html || document.rawHtml || '',
    schema: options.jsonOptions?.schema,
    prompt: options.jsonOptions?.prompt,
    systemPrompt: options.jsonOptions?.systemPrompt,
    sourceUrl: document.metadata.sourceURL,
  });
}

export async function scrapeDocument(
  url: string,
  rawOptions: Partial<ScrapeOptions> = {},
): Promise<Document> {
  const startedAt = Date.now();
  const options = resolveScrapeOptions(rawOptions);

  if (options.respectRobotsTxt && !(await isAllowedByRobots(url))) {
    throw new BlockedByRobotsError(url);
  }

  const key = cacheKey(url, options);
  if (!options.skipCache) {
    const hit = scrapeCache.get(key, options.maxAge);
    if (hit) {
      return {
        ...hit.document,
        metadata: { ...hit.document.metadata, engine: 'cache', scrapeDurationMs: Date.now() - startedAt },
      };
    }
  }

  const page = await loadPage(url, options);
  const extracted = extractPage(page.rawHtml, {
    url: page.finalUrl,
    onlyMainContent: options.onlyMainContent,
    includeTags: options.includeTags,
    excludeTags: options.excludeTags,
    removeBase64Images: options.removeBase64Images,
    statusCode: page.statusCode,
    contentType: page.contentType,
  });

  const document: Document = {
    metadata: {
      ...extracted.metadata,
      sourceURL: page.finalUrl,
      scrapeDurationMs: Date.now() - startedAt,
      engine: page.engine,
    },
    warning: page.warning,
  };

  if (wantsFormat(options, 'markdown')) document.markdown = htmlToMarkdown(extracted.html);
  if (wantsFormat(options, 'html')) document.html = extracted.html;
  if (wantsFormat(options, 'rawHtml')) document.rawHtml = page.rawHtml;
  if (wantsFormat(options, 'links')) document.links = extracted.links;
  if (page.screenshot) document.screenshot = page.screenshot;
  if (page.actions) document.actions = page.actions;

  if (wantsFormat(options, 'json')) {
    // Markdown is the best LLM input, so derive it even when not requested.
    const markdownForLlm = document.markdown ?? htmlToMarkdown(extracted.html);
    try {
      const json = await runJsonExtraction({ ...document, markdown: markdownForLlm }, options);
      document.json = json;
      document.extract = json;
    } catch (error) {
      document.warning = [document.warning, `JSON extraction failed: ${toErrorMessage(error)}`]
        .filter(Boolean)
        .join('; ');
    }
  }

  document.metadata.scrapeDurationMs = Date.now() - startedAt;

  if (!options.skipCache && page.statusCode !== undefined && page.statusCode < 400) {
    scrapeCache.set(key, url, document);
  }

  return document;
}

/** Back-compatible wrapper returning the `{ success, data }` envelope. */
export async function scrapeUrl(request: ScrapeRequest): Promise<{
  success: boolean;
  data: Document | null;
  error?: string;
}> {
  try {
    const { url, ...options } = request;
    return { success: true, data: await scrapeDocument(url, options) };
  } catch (error) {
    return { success: false, data: null, error: toErrorMessage(error) };
  }
}

/** Collects every link on a page without producing any other format. */
export async function scrapeLinks(url: string, options: Partial<ScrapeOptions> = {}): Promise<string[]> {
  const document = await scrapeDocument(url, { ...options, formats: ['links'] });
  return document.links ?? [];
}
