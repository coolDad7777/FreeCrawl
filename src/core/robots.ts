import { config } from '../config';
import { httpGet } from './fetcher';

export interface RobotsRule {
  allow: boolean;
  pattern: string;
  regexp: RegExp;
  /** Specificity used for longest-match resolution, per the REP draft. */
  length: number;
}

export interface RobotsTxt {
  rules: RobotsRule[];
  crawlDelayMs: number;
  sitemaps: string[];
  /** True when robots.txt was missing or unreadable, in which case everything is allowed. */
  absent: boolean;
}

const EMPTY_ROBOTS: RobotsTxt = { rules: [], crawlDelayMs: 0, sitemaps: [], absent: true };

const cache = new Map<string, { value: RobotsTxt; expiresAt: number }>();
const inflight = new Map<string, Promise<RobotsTxt>>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function patternToRegExp(pattern: string): RegExp {
  let normalized = pattern;
  const mustEnd = normalized.endsWith('$');
  if (mustEnd) normalized = normalized.slice(0, -1);

  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');

  return new RegExp(`^${escaped}${mustEnd ? '$' : ''}`);
}

/**
 * Parses robots.txt and keeps only the group that applies to `userAgentToken`,
 * falling back to the `*` group when no specific group matches.
 */
export function parseRobotsTxt(body: string, userAgentToken = 'freecrawl'): RobotsTxt {
  const token = userAgentToken.toLowerCase();
  const groups: { agents: string[]; rules: RobotsRule[]; crawlDelayMs: number }[] = [];
  const sitemaps: string[] = [];

  let current: { agents: string[]; rules: RobotsRule[]; crawlDelayMs: number } | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelayMs: 0 };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;

    if (field === 'sitemap') {
      if (value) sitemaps.push(value);
      continue;
    }

    if (!current) continue;

    if (field === 'allow' || field === 'disallow') {
      // "Disallow:" with an empty value explicitly allows everything.
      if (field === 'disallow' && value === '') continue;
      if (!value) continue;
      current.rules.push({
        allow: field === 'allow',
        pattern: value,
        regexp: patternToRegExp(value),
        length: value.replace(/\$$/, '').length,
      });
      continue;
    }

    if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        current.crawlDelayMs = Math.min(seconds * 1000, 30_000);
      }
    }
  }

  const exact = groups.filter((group) => group.agents.some((agent) => token.includes(agent) && agent !== '*'));
  const wildcard = groups.filter((group) => group.agents.includes('*'));
  const applicable = exact.length > 0 ? exact : wildcard;

  return {
    rules: applicable.flatMap((group) => group.rules),
    crawlDelayMs: Math.max(0, ...applicable.map((group) => group.crawlDelayMs), 0),
    sitemaps,
    absent: false,
  };
}

export function isPathAllowed(robots: RobotsTxt, pathWithQuery: string): boolean {
  if (robots.absent || robots.rules.length === 0) return true;

  let best: RobotsRule | null = null;
  for (const rule of robots.rules) {
    if (!rule.regexp.test(pathWithQuery)) continue;
    if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) {
      best = rule;
    }
  }

  return best ? best.allow : true;
}

export async function fetchRobotsTxt(targetUrl: string): Promise<RobotsTxt> {
  let origin: string;
  try {
    origin = new URL(targetUrl).origin;
  } catch {
    return EMPTY_ROBOTS;
  }

  const cached = cache.get(origin);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const existing = inflight.get(origin);
  if (existing) return existing;

  const request = (async (): Promise<RobotsTxt> => {
    try {
      const response = await httpGet(`${origin}/robots.txt`, {
        timeout: 10_000,
        maxBytes: 512 * 1024,
        headers: { Accept: 'text/plain,*/*' },
      });
      // 4xx means "no restrictions"; 5xx is treated the same way so a broken
      // origin does not block an otherwise valid crawl.
      if (response.statusCode >= 400 || !response.body) return EMPTY_ROBOTS;
      return parseRobotsTxt(response.body, config.scrape.userAgent.toLowerCase().includes('freecrawl')
        ? 'freecrawl'
        : config.scrape.userAgent.toLowerCase());
    } catch {
      return EMPTY_ROBOTS;
    }
  })();

  inflight.set(origin, request);
  try {
    const value = await request;
    cache.set(origin, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } finally {
    inflight.delete(origin);
  }
}

export async function isAllowedByRobots(targetUrl: string): Promise<boolean> {
  const robots = await fetchRobotsTxt(targetUrl);
  const parsed = new URL(targetUrl);
  return isPathAllowed(robots, `${parsed.pathname}${parsed.search}`);
}

export function clearRobotsCache(): void {
  cache.clear();
}
