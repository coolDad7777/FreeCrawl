import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../config';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1440, height: 900 };
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

/** Hostnames whose requests are dropped before they are made, to speed pages up. */
const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googletagmanager.com', 'google-analytics.com',
  'googleadservices.com', 'adservice.google.com', 'facebook.net', 'connect.facebook.net',
  'hotjar.com', 'segment.io', 'segment.com', 'mixpanel.com', 'amplitude.com', 'intercom.io',
  'taboola.com', 'outbrain.com', 'criteo.com', 'scorecardresearch.com', 'quantserve.com',
  'adnxs.com', 'rubiconproject.com', 'pubmatic.com', 'bing.com/bat.js', 'clarity.ms',
];

export interface PageOptions {
  mobile?: boolean;
  headers?: Record<string, string>;
  blockMedia?: boolean;
  blockAds?: boolean;
}

class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  private release() {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

class BrowserManager {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private readonly pageSemaphore = new Semaphore(config.scrape.concurrency);

  async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (this.launching) return this.launching;

    this.launching = chromium
      .launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--no-first-run',
          '--no-zygote',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          if (this.browser === browser) this.browser = null;
        });
        this.browser = browser;
        return browser;
      })
      .finally(() => {
        this.launching = null;
      });

    return this.launching;
  }

  /**
   * Runs `work` against a fresh isolated context. Contexts are always disposed,
   * and a global semaphore keeps concurrent page count bounded.
   */
  async withPage<T>(options: PageOptions, work: (page: Page) => Promise<T>): Promise<T> {
    const release = await this.pageSemaphore.acquire();
    let context: BrowserContext | null = null;

    try {
      const browser = await this.getBrowser();
      context = await browser.newContext({
        userAgent: options.mobile ? MOBILE_USER_AGENT : config.scrape.userAgent,
        viewport: options.mobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT,
        isMobile: options.mobile ?? false,
        hasTouch: options.mobile ?? false,
        deviceScaleFactor: 1,
        locale: 'en-US',
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: options.headers,
        javaScriptEnabled: true,
      });

      const blockMedia = options.blockMedia ?? config.scrape.blockMedia;
      const blockAds = options.blockAds ?? true;

      if (blockMedia || blockAds) {
        await context.route('**/*', (route) => {
          const request = route.request();
          if (blockMedia && BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
            return route.abort();
          }
          if (blockAds && AD_HOSTS.some((host) => request.url().includes(host))) {
            return route.abort();
          }
          return route.continue();
        });
      }

      const page = await context.newPage();
      // Headless Chromium advertises itself through navigator.webdriver; a lot of
      // sites gate content on it, so hide it before any page script runs.
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });

      return await work(page);
    } finally {
      if (context) await context.close().catch(() => undefined);
      release();
    }
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (browser) await browser.close().catch(() => undefined);
  }
}

export const browserManager = new BrowserManager();
