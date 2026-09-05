import type { SearchFailureDiagnostic } from './types.js';

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  return value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : fallback;
}

const isTestEnv = process.env.NODE_ENV === 'test';
const SEARXNG_CACHE_TTL_MS = parseNonNegativeInt(
  process.env.SEARXNG_CACHE_TTL_MS,
  isTestEnv ? 1000 : 300000
);
const SEARXNG_STALE_IF_ERROR_MS = parseNonNegativeInt(
  process.env.SEARXNG_STALE_IF_ERROR_MS,
  isTestEnv ? 10000 : 3600000
);
const SEARXNG_CIRCUIT_COOLDOWN_MS = parseNonNegativeInt(
  process.env.SEARXNG_CIRCUIT_COOLDOWN_MS,
  isTestEnv ? 100 : 30000
);

interface CacheEntry {
  data: any;
  expiresAt: number;
  staleUntil: number;
  cachedAt: number;
}

interface CircuitState {
  failures: number;
  openUntil: number;
}

const cache = new Map<string, CacheEntry>();
const circuits = new Map<string, CircuitState>();

export function resilienceCacheKey(params: any): string {
  return JSON.stringify({
    query: params.query,
    page: params.page || 1,
    language: params.language || 'all',
    time_range: params.time_range || 'all_time',
    safesearch: params.safesearch ?? 0,
    categories: params.categories || []
  });
}

export function getCachedResult(key: string, now = Date.now()): { data: any; stale: boolean; cachedAt: number } | undefined {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }

  if (now <= entry.expiresAt) {
    return { data: entry.data, stale: false, cachedAt: entry.cachedAt };
  }

  if (now <= entry.staleUntil) {
    return { data: entry.data, stale: true, cachedAt: entry.cachedAt };
  }

  cache.delete(key);
  return undefined;
}

export function cacheResult(key: string, data: any, now = Date.now()): void {
  cache.set(key, {
    data,
    expiresAt: now + SEARXNG_CACHE_TTL_MS,
    staleUntil: now + SEARXNG_CACHE_TTL_MS + SEARXNG_STALE_IF_ERROR_MS,
    cachedAt: now
  });
}

export function isCircuitOpen(instance: string, now = Date.now()): boolean {
  const state = circuits.get(instance);
  return Boolean(state && state.openUntil > now);
}

export function recordCircuitSuccess(instance: string): void {
  circuits.delete(instance);
}

export function recordCircuitFailure(diagnostic: SearchFailureDiagnostic, now = Date.now()): void {
  const previous = circuits.get(diagnostic.instance) || { failures: 0, openUntil: 0 };
  const failures = previous.failures + 1;
  const threshold = 1;

  if (failures < threshold) {
    circuits.set(diagnostic.instance, { failures, openUntil: 0 });
    return;
  }

  const cooldown = diagnostic.status === 429 && diagnostic.retryAfterMs !== undefined
    ? Math.max(SEARXNG_CIRCUIT_COOLDOWN_MS, diagnostic.retryAfterMs)
    : SEARXNG_CIRCUIT_COOLDOWN_MS;
  circuits.set(diagnostic.instance, { failures, openUntil: now + cooldown });
}

export function circuitDiagnostic(instance: string): SearchFailureDiagnostic {
  return {
    code: 'circuit_open',
    message: `[circuit_open] ${instance} is temporarily suppressed after repeated upstream failures`,
    retryable: true,
    instance,
    attempts: 0
  };
}

export function resetResilienceState(options: { preserveCache?: boolean; expireFreshCache?: boolean } = {}): void {
  circuits.clear();
  if (!options.preserveCache) {
    cache.clear();
  } else if (options.expireFreshCache) {
    for (const entry of cache.values()) {
      entry.expiresAt = 0;
    }
  }
}
