import { Page } from 'playwright';
import * as cheerio from 'cheerio';
import { browserManager } from './browser';
import { htmlToMarkdown } from './converter';
import { fetchText } from './fetcher';
import { ScrapeRequest, ScrapeResponse } from '../types';
import { getAIProvider } from '../ai';

function pickMetadata(html: string, url: string, statusCode?: number, startedAt = Date.now()) {
  const $ = cheerio.load(html);
  return {
    title: $('title').first().text().trim(),
    description: $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '',
    language: $('html').attr('lang') || 'en',
    scrape_duration_ms: Date.now() - startedAt,
    url,
    status_code: statusCode,
  };
}

async function scrapeStatic(options: ScrapeRequest, startedAt: number): Promise<ScrapeResponse> {
  const fetched = await fetchText(options.url);
  const html = fetched.body;
  if (html.length > 10 * 1024 * 1024) {
    throw new Error('Page content exceeds the 10 MB limit');
  }

  const markdown = options.formats.includes('markdown') || options.extract ? htmlToMarkdown(html) : undefined;
  const metadata = pickMetadata(html, fetched.url, fetched.statusCode, startedAt);

  let extractData = undefined;
  if (options.extract) {
    const ai = getAIProvider(options.ai_provider);
    extractData = await ai.extractStructured(
      markdown || html.substring(0, 20000),
      options.extract.schema || { summary: 'A brief summary of the page' },
      options.extract.prompt,
    );
  }

  return {
    success: true,
    data: {
      markdown,
      html: options.formats.includes('html') ? html : undefined,
      extract: extractData,
      metadata,
    },
  };
}

function needsBrowser(options: ScrapeRequest): boolean {
  return options.formats.includes('screenshot') || Boolean(options.actions?.length);
}

export async function scrapeUrl(options: ScrapeRequest): Promise<ScrapeResponse> {
  const startTime = Date.now();
  let page: Page | null = null;

  try {
    if (!needsBrowser(options)) {
      return await scrapeStatic(options, startTime);
    }

    page = await browserManager.newPage();
    
    // Set a timeout for navigation
    const response = await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Execute actions
    if (options.actions) {
      for (const action of options.actions) {
        switch (action.type) {
          case 'scroll':
            if (action.direction === 'down') {
              await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            } else {
              await page.evaluate(() => window.scrollBy(0, -window.innerHeight));
            }
            break;
          case 'click':
            if (action.selector) await page.click(action.selector);
            break;
          case 'wait':
            if (action.ms) await page.waitForTimeout(action.ms);
            break;
          case 'type':
            if (action.selector && action.value) await page.type(action.selector, action.value);
            break;
        }
      }
    }

    const title = await page.title();
    const html = await page.content();
    if (html.length > 10 * 1024 * 1024) {
      throw new Error('Page content exceeds the 10 MB limit');
    }
    const markdown = options.formats.includes('markdown') ? htmlToMarkdown(html) : undefined;
    const screenshot = options.formats.includes('screenshot') ? 
      (await page.screenshot({ fullPage: true })).toString('base64') : undefined;

    const metadata = pickMetadata(html, page.url(), response?.status(), startTime);
    metadata.title = title || metadata.title;

    let extractData = undefined;
    if (options.extract) {
      const ai = getAIProvider(options.ai_provider);
      const contentToExtract = markdown || html.substring(0, 20000);
      extractData = await ai.extractStructured(
        contentToExtract, 
        options.extract.schema || { summary: "A brief summary of the page" },
        options.extract.prompt
      );
    }

    return {
      success: true,
      data: {
        markdown,
        html: options.formats.includes('html') ? html : undefined,
        screenshot,
        extract: extractData,
        metadata: metadata as any,
      }
    };

  } catch (error: any) {
    console.error(`Error scraping ${options.url}:`, error);
    return {
      success: false,
      error: error.message,
      data: null as any
    };
  } finally {
    if (page) await page.context().close();
  }
}
