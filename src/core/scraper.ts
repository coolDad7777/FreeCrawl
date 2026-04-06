import { Page } from 'playwright';
import { browserManager } from './browser';
import { htmlToMarkdown } from './converter';
import { ScrapeRequest, ScrapeResponse } from '../types';
import { getAIProvider } from '../ai';

export async function scrapeUrl(options: ScrapeRequest): Promise<ScrapeResponse> {
  const startTime = Date.now();
  let page: Page | null = null;

  try {
    page = await browserManager.newPage();
    
    // Set a timeout for navigation
    await page.goto(options.url, { waitUntil: 'networkidle', timeout: 30000 });

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
    const markdown = options.formats.includes('markdown') ? htmlToMarkdown(html) : undefined;
    const screenshot = options.formats.includes('screenshot') ? 
      (await page.screenshot({ fullPage: true })).toString('base64') : undefined;

    const metadata = {
      title,
      description: await page.locator('meta[name="description"]').getAttribute('content').catch(() => ''),
      language: await page.locator('html').getAttribute('lang').catch(() => 'en'),
      scrape_duration_ms: Date.now() - startTime,
      url: options.url,
    };

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
    if (page) await page.close();
  }
}
