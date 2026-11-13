import fetch from 'node-fetch';
import type { RequestInit } from 'node-fetch';
import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';

// Deliberately self-contained: importing ./config.js here would give that module a
// second runtime path (search-handler.ts already imports it), which trips Jest's ESM
// module cache under isolateModulesAsync. These are the same defaults config.ts uses.
const USER_AGENT = process.env.SEARXNG_USER_AGENT || 'MCP-SearXNG/1.0';
const REQUEST_TIMEOUT_MS = 10000;
const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});
const httpAgent = new HttpAgent();

/**
 * SearXNG's standard category set. Used as the fallback when /config is
 * unreachable, and replaced at runtime with whatever the instance actually
 * exposes (instances can disable or add categories).
 */
export const DEFAULT_CATEGORIES: readonly string[] = [
  'general',
  'videos',
  'stock images',
  'other',
  'social media',
  'packages',
  'it',
  'files',
  'books',
  'news',
  'apps',
  'software wikis',
  'images',
  'science',
  'scientific publications',
  'music',
  'web',
  'repos',
  'currency',
  'icons',
  'weather',
  'map',
  'dictionaries',
  'shopping',
  'lyrics',
  'cargo',
  'movies',
  'translate',
  'radio',
  'blogs',
  'q&a',
  'wikimedia',
  'define'
];

let knownCategories: readonly string[] = DEFAULT_CATEGORIES;

export function getKnownCategories(): readonly string[] {
  return knownCategories;
}

export function setKnownCategories(categories: readonly string[]): void {
  const cleaned = [...new Set(categories.map((category) => category.trim()).filter(Boolean))];
  if (cleaned.length > 0) {
    knownCategories = cleaned;
  }
}

export function resetKnownCategories(): void {
  knownCategories = DEFAULT_CATEGORIES;
}

export interface SearxngEngineInfo {
  name: string;
  categories: string[];
  enabled: boolean;
  shortcut?: string;
}

export interface InstanceConfig {
  categories: string[];
  engines: SearxngEngineInfo[];
}

interface RawConfig {
  categories?: Array<{ name?: string } | string>;
  engines?: Record<string, Partial<SearxngEngineInfo>>;
}

function extractCategories(raw: RawConfig): string[] {
  return (raw.categories ?? [])
    .map((entry) => (typeof entry === 'string' ? entry : entry?.name))
    .filter((name): name is string => typeof name === 'string' && name.trim().length > 0);
}

function extractEngines(raw: RawConfig): SearxngEngineInfo[] {
  return Object.values(raw.engines ?? {})
    .map((engine) => ({
      name: typeof engine?.name === 'string' ? engine.name : '',
      categories: Array.isArray(engine?.categories) ? engine.categories : [],
      enabled: engine?.enabled === true,
      shortcut: typeof engine?.shortcut === 'string' ? engine.shortcut : undefined
    }))
    .filter((engine) => engine.name.length > 0);
}

/**
 * The instance URL originates from operator configuration (SEARXNG_INSTANCES),
 * never from model or tool input. This guard keeps a malformed config from
 * reaching non-HTTP schemes such as file: or data:.
 */
function assertSafeInstanceUrl(configUrl: URL): void {
  if (configUrl.protocol !== 'http:' && configUrl.protocol !== 'https:') {
    throw new Error(`Unsupported SearXNG instance protocol: ${configUrl.protocol}`);
  }

  if (!configUrl.hostname) {
    throw new Error('SearXNG instance URL is missing a hostname');
  }
}

/**
 * Reads the instance's /config document. Returns undefined when the instance is
 * unreachable, does not expose /config, or returns something unexpected — callers
 * fall back to DEFAULT_CATEGORIES in that case.
 */
export async function fetchInstanceConfig(
  instance: string,
  options: { timeoutMs?: number } = {}
): Promise<InstanceConfig | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? REQUEST_TIMEOUT_MS
  );

  try {
    const configUrl = new URL('/config', instance);
    assertSafeInstanceUrl(configUrl);
    const configEndpoint = configUrl.toString();
    // SAFETY: `configEndpoint` was built from an operator-configured instance and
    // validated by assertSafeInstanceUrl; it is never derived from model or tool input.
    const response = await fetch(configEndpoint, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT
      },
      agent: configUrl.protocol === 'https:' ? httpsAgent : httpAgent,
      // SAFETY: @types/node-fetch declares its own structural AbortSignal to avoid a
      // DOM lib dependency; it is not nominally identical to Node's AbortSignal but is
      // compatible at runtime. The controller is only used to bound this request.
      signal: controller.signal as unknown as RequestInit['signal']
    });

    if (!response.ok) {
      return undefined;
    }

    const raw = (await response.json()) as RawConfig;
    const categories = extractCategories(raw);

    // Only trust the payload if it actually yielded categories; an unexpected
    // shape must not be allowed to empty the valid-category list.
    if (categories.length === 0) {
      return undefined;
    }

    return { categories, engines: extractEngines(raw) };
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Refreshes the cached category list from the instance. Never throws: a failed
 * refresh leaves the previous list in place.
 */
export async function loadInstanceCategories(instance: string): Promise<void> {
  const config = await fetchInstanceConfig(instance);
  if (config) {
    setKnownCategories(config.categories);
  }
}
