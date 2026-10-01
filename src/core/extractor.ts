import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type { PageMetadata } from '../types';
import { normalizeUrl } from './url';

/** Elements that never carry page content. */
const STRIP_SELECTORS = [
  'script', 'style', 'noscript', 'template', 'iframe', 'object', 'embed', 'applet',
  'link', 'meta', 'base', 'map', 'area', 'param', 'source', 'track', 'canvas',
];

/** Chrome that surrounds the article when `onlyMainContent` is enabled. */
const BOILERPLATE_SELECTORS = [
  'nav', 'header', 'footer', 'aside', 'form', 'button', 'dialog', 'menu',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="search"]',
  '[role="complementary"]', '[role="dialog"]', '[role="alertdialog"]', '[aria-hidden="true"]',
  '[hidden]',
];

const BOILERPLATE_PATTERN =
  /(^|[-_\s])(ad|ads|advert|advertisement|banner|breadcrumb|comment|cookie|consent|gdpr|disqus|footer|header|masthead|menu|modal|nav|navbar|newsletter|offcanvas|pagination|paywall|popup|promo|related|share|sharing|sidebar|signup|social|sponsor|subscribe|toolbar|tooltip|widget)([-_\s]|$)/i;

/** Containers that reliably hold the main article when present. */
const MAIN_CONTENT_SELECTORS = [
  'main article',
  'main',
  '[role="main"]',
  'article',
  '[itemprop="articleBody"]',
  '.post-content',
  '.entry-content',
  '.article-content',
  '.article-body',
  '.markdown-body',
  '#content',
  '.content',
];

const CANDIDATE_SELECTOR = 'article, main, section, div, td, [role="main"]';

export interface ExtractedPage {
  /** Cleaned HTML, already restricted to the main content when requested. */
  html: string;
  text: string;
  links: string[];
  metadata: Omit<PageMetadata, 'scrapeDurationMs' | 'engine'>;
}

export interface ExtractOptions {
  url: string;
  onlyMainContent?: boolean;
  includeTags?: string[];
  excludeTags?: string[];
  removeBase64Images?: boolean;
  statusCode?: number;
  contentType?: string;
}

function textOf($: CheerioAPI, element: Element | AnyNode): string {
  return $(element as never).text().replace(/\s+/g, ' ').trim();
}

function linkDensity($: CheerioAPI, element: AnyNode): number {
  const total = textOf($, element).length;
  if (total === 0) return 1;
  const linkText = $(element as never).find('a').text().replace(/\s+/g, ' ').trim().length;
  return linkText / total;
}

function attrSignature($: CheerioAPI, element: AnyNode): string {
  const node = $(element as never);
  return `${node.attr('class') ?? ''} ${node.attr('id') ?? ''}`.trim();
}

/**
 * Readability-style scoring: reward paragraph-dense blocks with real prose,
 * penalize link farms and anything whose class/id looks like page furniture.
 */
function scoreCandidate($: CheerioAPI, element: AnyNode): number {
  const node = $(element as never);
  const text = textOf($, element);
  if (text.length < 140) return 0;

  const paragraphs = node.find('p').length;
  const headings = node.find('h1, h2, h3, h4').length;
  const commas = (text.match(/[,，、]/g) ?? []).length;

  let score = Math.min(text.length / 100, 60);
  score += paragraphs * 3;
  score += headings * 2;
  score += Math.min(commas, 30);
  score += node.find('pre, code, table, blockquote, ul, ol').length * 2;

  const density = linkDensity($, element);
  score *= 1 - Math.min(density, 0.95);

  if (BOILERPLATE_PATTERN.test(attrSignature($, element))) score *= 0.2;

  const tag = (element as Element).tagName?.toLowerCase();
  if (tag === 'article' || tag === 'main') score *= 1.6;
  if (tag === 'section') score *= 1.1;

  return score;
}

function selectMainContent($: CheerioAPI): Cheerio<AnyNode> | null {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const candidate = $(selector).first();
    if (candidate.length > 0 && textOf($, candidate[0]).length >= 200) return candidate;
  }

  let best: { node: Cheerio<AnyNode>; score: number } | null = null;
  $(CANDIDATE_SELECTOR).each((_, element) => {
    const score = scoreCandidate($, element);
    if (score > 0 && (!best || score > best.score)) best = { node: $(element), score };
  });

  return best && (best as { node: Cheerio<AnyNode>; score: number }).score >= 20
    ? (best as { node: Cheerio<AnyNode> }).node
    : null;
}

function absolutize($: CheerioAPI, baseUrl: string): void {
  const resolve = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed || /^(#|javascript:|mailto:|tel:|sms:|data:|blob:|about:)/i.test(trimmed)) {
      return null;
    }
    try {
      return new URL(trimmed, baseUrl).toString();
    } catch {
      return null;
    }
  };

  $('a[href]').each((_, element) => {
    const resolved = resolve($(element).attr('href') ?? '');
    if (resolved) $(element).attr('href', resolved);
  });

  $('img[src], video[src], audio[src]').each((_, element) => {
    const resolved = resolve($(element).attr('src') ?? '');
    if (resolved) $(element).attr('src', resolved);
  });

  // Lazy-loaded images keep their real URL in data-src/srcset instead of src.
  $('img[data-src], img[data-original], img[data-lazy-src]').each((_, element) => {
    const node = $(element);
    const lazy = node.attr('data-src') ?? node.attr('data-original') ?? node.attr('data-lazy-src');
    const resolved = lazy ? resolve(lazy) : null;
    if (resolved && !node.attr('src')) node.attr('src', resolved);
  });
}

function parseMetadata(
  $: CheerioAPI,
  options: ExtractOptions,
): Omit<PageMetadata, 'scrapeDurationMs' | 'engine'> {
  const meta = (names: string[]): string | undefined => {
    for (const name of names) {
      const value =
        $(`meta[property="${name}"]`).attr('content') ??
        $(`meta[name="${name}"]`).attr('content');
      if (value && value.trim()) return value.trim();
    }
    return undefined;
  };

  const favicon = (() => {
    const href =
      $('link[rel="icon"]').attr('href') ??
      $('link[rel="shortcut icon"]').attr('href') ??
      $('link[rel="apple-touch-icon"]').attr('href');
    try {
      return href ? new URL(href, options.url).toString() : new URL('/favicon.ico', options.url).toString();
    } catch {
      return undefined;
    }
  })();

  const canonicalHref = $('link[rel="canonical"]').attr('href');
  let canonical: string | undefined;
  try {
    canonical = canonicalHref ? new URL(canonicalHref, options.url).toString() : undefined;
  } catch {
    canonical = undefined;
  }

  const ogTitle = meta(['og:title', 'twitter:title']);
  const description = meta(['description', 'og:description', 'twitter:description']) ?? '';

  return {
    title: ($('title').first().text().trim() || ogTitle || $('h1').first().text().trim() || '').slice(0, 1_000),
    description: description.slice(0, 5_000),
    language: ($('html').attr('lang') ?? meta(['og:locale']) ?? '').trim() || 'en',
    sourceURL: options.url,
    statusCode: options.statusCode,
    contentType: options.contentType,
    canonical,
    keywords: meta(['keywords']),
    author: meta(['author', 'article:author']),
    publishedTime: meta(['article:published_time', 'datePublished', 'og:updated_time']),
    ogTitle,
    ogDescription: meta(['og:description']),
    ogImage: meta(['og:image', 'twitter:image']),
    ogSiteName: meta(['og:site_name']),
    favicon,
  };
}

function collectLinks($: CheerioAPI, baseUrl: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;
    try {
      const absolute = normalizeUrl(new URL(href, baseUrl).toString(), { stripTracking: false });
      if (!/^https?:$/.test(new URL(absolute).protocol)) return;
      if (!seen.has(absolute)) {
        seen.add(absolute);
        links.push(absolute);
      }
    } catch {
      // Ignore unparseable hrefs.
    }
  });

  return links;
}

export function extractPage(rawHtml: string, options: ExtractOptions): ExtractedPage {
  const $ = cheerio.load(rawHtml);

  const metadata = parseMetadata($, options);
  // Links come from the full document: navigation links drive crawling even
  // when they are stripped from the content body.
  const links = collectLinks($, options.url);

  absolutize($, options.url);
  $(STRIP_SELECTORS.join(', ')).remove();
  $('*')
    .contents()
    .filter((_, node) => node.type === 'comment')
    .remove();

  for (const selector of options.excludeTags ?? []) {
    try {
      $(selector).remove();
    } catch {
      // Ignore invalid user-supplied selectors rather than failing the scrape.
    }
  }

  if (options.removeBase64Images !== false) {
    $('img[src^="data:"]').remove();
  }

  // Many sites place the <h1> in page chrome rather than inside the article, so
  // keep it before anything is removed and restore it below if it is lost.
  const documentHeading = $('h1').first().text().replace(/\s+/g, ' ').trim();

  let root: Cheerio<AnyNode> = $('body').length > 0 ? $('body') : $.root();

  if (options.includeTags && options.includeTags.length > 0) {
    const kept = options.includeTags
      .flatMap((selector) => {
        try {
          return $(selector).toArray();
        } catch {
          return [];
        }
      })
      .map((element) => $.html(element))
      .join('\n');
    root = cheerio.load(`<div>${kept}</div>`)('div').first() as unknown as Cheerio<AnyNode>;
  } else if (options.onlyMainContent !== false) {
    const noise = $(BOILERPLATE_SELECTORS.join(', '));
    const main = selectMainContent($);
    if (main && main.length > 0) {
      const mainTextLength = Math.max(textOf($, main[0]).length, 1);
      noise.each((_, element) => {
        const node = $(element);
        // Never remove the chosen article or anything that contains it.
        if (node.is(main as never) || node.find(main.toArray() as never).length > 0) return;
        // Chrome often nests *inside* the content container (a site header that
        // wraps both the title and a language menu, say). Remove it too, but only
        // when it is small enough that it cannot be the content itself.
        const inside = main.find(element as never).length > 0;
        if (!inside || textOf($, element).length / mainTextLength < 0.3) node.remove();
      });
      root = main;
    } else {
      noise.remove();
      $('*').each((_, element) => {
        if (BOILERPLATE_PATTERN.test(attrSignature($, element))) $(element).remove();
      });
    }
  }

  let html = (root.html() ?? '').trim();
  if (documentHeading && !/<h1[\s>]/i.test(html)) {
    html = `<h1>${documentHeading.replace(/</g, '&lt;')}</h1>\n${html}`;
  }

  const text = cheerio.load(html).root().text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

  return { html, text, links, metadata };
}
