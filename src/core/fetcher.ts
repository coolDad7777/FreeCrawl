import axios from 'axios';
import { assertSafeUrl, normalizeUrl } from './url';

export interface FetchedText {
  url: string;
  statusCode: number;
  headers: Record<string, unknown>;
  body: string;
}

const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; FreeCrawl/1.0; +https://github.com/freecrawl/freecrawl)';

function getHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : undefined;
}

export async function fetchText(
  inputUrl: string,
  options: { timeoutMs?: number; maxBytes?: number; maxRedirects?: number } = {},
): Promise<FetchedText> {
  const timeout = options.timeoutMs ?? 30000;
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  let currentUrl = await assertSafeUrl(inputUrl);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await axios.get<string>(currentUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1',
        'User-Agent': DEFAULT_USER_AGENT,
      },
      maxBodyLength: maxBytes,
      maxContentLength: maxBytes,
      maxRedirects: 0,
      responseType: 'text',
      timeout,
      transformResponse: [(data) => data],
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (response.status >= 300 && response.status < 400) {
      const location = getHeader(response.headers as Record<string, unknown>, 'location');
      if (!location) {
        throw new Error(`Redirect from ${currentUrl} did not include a location header`);
      }
      currentUrl = await assertSafeUrl(new URL(location, currentUrl).toString());
      continue;
    }

    const contentType = getHeader(response.headers as Record<string, unknown>, 'content-type') || '';
    if (
      contentType &&
      !/^(text\/|application\/(xhtml\+xml|xml|json|ld\+json)|.*\+xml)/i.test(contentType)
    ) {
      throw new Error(`Unsupported content type: ${contentType}`);
    }

    return {
      body: response.data,
      headers: response.headers as Record<string, unknown>,
      statusCode: response.status,
      url: normalizeUrl(currentUrl),
    };
  }

  throw new Error(`Too many redirects while fetching ${inputUrl}`);
}
