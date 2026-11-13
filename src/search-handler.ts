import fetch from 'node-fetch';
import type { RequestInit } from 'node-fetch';
import {
  USER_AGENT,
  httpsAgent,
  httpAgent,
  SEARXNG_MAX_ATTEMPTS,
  SEARXNG_RETRY_BASE_DELAY_MS,
  SEARXNG_RETRY_JITTER_MS,
  SEARXNG_REQUEST_TIMEOUT_MS,
  SEARXNG_RETRY_SOFT_FAILURES,
  SEARXNG_RETRY_MAX_DELAY_MS,
  SEARXNG_RETRY_BUDGET_MS
} from './config.js';
import {
  cacheResult,
  circuitDiagnostic,
  getCachedResult,
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  resilienceCacheKey
} from './resilience.js';
import type {
  SearxngResponse,
  SearchFailureCode,
  SearchFailureDiagnostic,
  SearchResult,
  SearchWarning,
  WebSearchParams
} from './types.js';

// Add debug logging function that can be enabled via environment variable
const DEBUG = process.env.MCP_SEARXNG_DEBUG === 'true';
function logDebug(message: string, data?: unknown) {
  if (DEBUG) {
    console.error(`Debug: ${message}`, data ? `\n${JSON.stringify(data, null, 2)}` : '');
  }
}

// Add console error wrapper
function logError(message: string, error?: unknown) {
  // Suppress error logging during tests to keep console output clean
  if (process.env.NODE_ENV !== 'test') {
    console.error(`Error: ${message}`, error ? `\n${error}` : '');
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseRetryAfterMs(headerValue: string | null): number | undefined {
  if (!headerValue) {
    return undefined;
  }

  const seconds = Number(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.floor(seconds * 1000));
  }

  const retryAfterDate = Date.parse(headerValue);
  if (Number.isNaN(retryAfterDate)) {
    return undefined;
  }

  return Math.max(0, retryAfterDate - Date.now());
}

function getRetryDelayMs(attempt: number): number {
  const exponent = Math.max(attempt - 1, 0);
  const backoffDelay = SEARXNG_RETRY_BASE_DELAY_MS * (2 ** exponent);
  const jitter = SEARXNG_RETRY_JITTER_MS > 0
    ? Math.floor(Math.random() * (SEARXNG_RETRY_JITTER_MS + 1))
    : 0;

  return backoffDelay + jitter;
}

interface InstanceResult {
  instance: string;
  data: SearxngResponse;
  _diagnostic?: SearchFailureDiagnostic;
}

class SearchAttemptError extends Error {
  constructor(public readonly diagnostic: SearchFailureDiagnostic) {
    super(diagnostic.message);
    this.name = 'SearchAttemptError';
  }
}

export class AggregateSearchError extends Error {
  constructor(public readonly diagnostics: SearchFailureDiagnostic[]) {
    super(`All SearXNG instances failed: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`);
    this.name = 'AggregateSearchError';
  }
}

export function truncateDetails(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function isChallengeBody(body: string, contentType: string | null): boolean {
  if (contentType?.toLowerCase().includes('html')) {
    return /captcha|challenge|verify you are human|cloudflare|robot/i.test(body);
  }

  return /captcha|challenge|verify you are human|cloudflare|robot/i.test(body);
}

function codeForStatus(status: number): SearchFailureCode {
  return status === 403 ? 'challenge' : 'http_error';
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function hasChallengeSignal(value: unknown): boolean {
  return /captcha|challenge|verify you are human|cloudflare|robot/i.test(JSON.stringify(value));
}

function hasUnresponsiveEngines(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function isSoftFailure(code: SearchFailureCode): boolean {
  return code === 'challenge'
    || code === 'empty_results'
    || code === 'upstream_degraded'
    || code === 'malformed_response';
}

export function getHint(diagnostics: SearchFailureDiagnostic[]): string {
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  if (codes.has('challenge')) {
    return 'Do not treat this as proof that the query has no matches. Avoid immediately repeating the same request; retry later, and report the upstream challenge if it persists.';
  }
  if (codes.has('upstream_degraded')) {
    return 'Do not treat this as proof that the query has no matches. Avoid immediately repeating the same request; retry later, and report the upstream degradation if it persists.';
  }
  if (codes.has('empty_results')) {
    return 'The search completed successfully but found no matching results.';
  }
  if (codes.has('http_error')) {
    return 'Check the SearXNG instance status, rate limits, and whether JSON search output is enabled.';
  }
  return 'Check the configured SearXNG instance and retry if the failure is transient.';
}

export function toSearchWarning(diagnostic: SearchFailureDiagnostic): SearchWarning {
  if (diagnostic.code === 'challenge') {
    return {
      code: 'engine_challenge',
      message: 'Some SearXNG engines may have returned CAPTCHA or bot-challenge responses; results may be incomplete.',
      retryable: diagnostic.retryable,
      recommendation: 'If complete coverage matters, retry later; do not treat missing results as proof of no matches, and report the upstream challenge if it persists.',
      affected_engines: diagnostic.unresponsiveEngines
    };
  }

  if (diagnostic.code === 'upstream_degraded') {
    return {
      code: 'engine_degraded',
      message: 'Some SearXNG engines were unavailable; results may be incomplete.',
      retryable: diagnostic.retryable,
      recommendation: 'Retry later before concluding that no matches exist; report the upstream degradation if it persists.',
      affected_engines: diagnostic.unresponsiveEngines
    };
  }

  return {
    code: 'upstream_failure',
    message: 'A SearXNG instance failed while other search results were available; results may be incomplete.',
    retryable: diagnostic.retryable,
    recommendation: 'Use the results cautiously; retry later if complete coverage is important, and report the upstream failure if it persists.'
  };
}

async function executeSearchWithRetry(instance: string, searchParams: Record<string, string>): Promise<SearxngResponse> {
  const searchUrl = new URL('/search', instance);
  let lastDiagnostic: SearchFailureDiagnostic = {
    code: 'network_error',
    message: `Failed to connect to ${instance}`,
    retryable: true,
    instance,
    attempts: 0
  };
  const startedAt = Date.now();
  let data: SearxngResponse | undefined;

  for (let attempt = 1; attempt <= SEARXNG_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARXNG_REQUEST_TIMEOUT_MS);
    // Reset per attempt so a failed retry cannot resurrect a previous payload.
    data = undefined;

    try {
      logDebug(`Attempt ${attempt}/${SEARXNG_MAX_ATTEMPTS} for instance: ${instance}`);
      const response = await fetch(searchUrl.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent,
        body: new URLSearchParams(searchParams).toString(),
        // SAFETY: @types/node-fetch declares its own structural AbortSignal so it can
        // avoid a DOM lib dependency; it is not nominally identical to Node's AbortSignal
        // but is compatible at runtime. The controller is only used to abort the request.
        signal: controller.signal as unknown as RequestInit['signal']
      });
      const body = await response.text();
      const contentType = response.headers.get('content-type');

      if (!response.ok) {
        const challenge = isChallengeBody(body, contentType);
        lastDiagnostic = {
          code: challenge ? 'challenge' : codeForStatus(response.status),
          message: challenge
            ? `${instance} returned a possible CAPTCHA or bot challenge`
            : `${instance} returned HTTP ${response.status} ${response.statusText}`,
          retryable: challenge || isRetryableStatus(response.status),
          instance,
          attempts: attempt,
          status: response.status,
          details: truncateDetails(body),
          retryAfterMs: response.status === 429
            ? parseRetryAfterMs(response.headers.get('retry-after'))
            : undefined
        };
      } else {
        try {
          data = JSON.parse(body);
        } catch {
          const challenge = isChallengeBody(body, contentType);
          lastDiagnostic = {
            code: challenge ? 'challenge' : 'malformed_response',
            message: challenge
              ? `${instance} returned a possible CAPTCHA or bot challenge instead of JSON`
              : `${instance} returned a malformed JSON response`,
            retryable: SEARXNG_RETRY_SOFT_FAILURES,
            instance,
            attempts: attempt,
            details: truncateDetails(body)
          };
        }

        if (data !== undefined && !Array.isArray(data.results)) {
          lastDiagnostic = {
            code: 'malformed_response',
            message: `${instance} returned JSON without a results array`,
            retryable: SEARXNG_RETRY_SOFT_FAILURES,
            instance,
            attempts: attempt,
            details: truncateDetails(body)
          };
          // Discard the unusable payload. Returning it made downstream code call
          // .map() on a non-array and surface a raw TypeError to the caller.
          data = undefined;
        } else if (data !== undefined && data.results.length === 0) {
          const unresponsiveEngines = data.unresponsive_engines;
          if (!hasUnresponsiveEngines(unresponsiveEngines)) {
            // An empty result set with no provider diagnostics is a valid no-match search.
            return data;
          }

          const challenge = hasChallengeSignal(unresponsiveEngines);
          lastDiagnostic = {
            code: challenge ? 'challenge' : 'upstream_degraded',
            message: challenge
              ? `${instance} returned zero results with a possible CAPTCHA or bot challenge reported by SearXNG`
              : `${instance} returned zero results while one or more SearXNG engines were unresponsive`,
            retryable: true,
            instance,
            attempts: attempt,
            unresponsiveEngines
          };
          // Return immediately — CAPTCHA/unresponsive-engine empty results are persistent;
          // retrying won't help and just wastes time. Surface the warning to the caller.
          return { ...data, _search_failure_diagnostic: lastDiagnostic };
        } else if (data !== undefined) {
          // Even when results exist, some engines may have been challenged or unresponsive.
          // Surface that so the caller knows coverage may be incomplete.
          const unresponsiveEngines = data.unresponsive_engines;
          if (hasUnresponsiveEngines(unresponsiveEngines)) {
            const challenge = hasChallengeSignal(unresponsiveEngines);
            return {
              ...data,
              _search_failure_diagnostic: {
                code: challenge ? 'challenge' : 'upstream_degraded',
                message: challenge
                  ? `${instance} returned results with a possible CAPTCHA or bot challenge from some engines`
                  : `${instance} returned results while one or more SearXNG engines were unresponsive`,
                retryable: true,
                instance,
                attempts: attempt,
                unresponsiveEngines
              }
            };
          }
          logDebug(`Search successful with ${instance}, found ${data.results.length} results`);
          return data;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastDiagnostic = {
        code: 'network_error',
        message: `Failed to connect to ${instance}: ${errorMessage}`,
        retryable: true,
        instance,
        attempts: attempt
      };
    } finally {
      clearTimeout(timeoutId);
    }

    const elapsedMs = Date.now() - startedAt;
    const canRetry = lastDiagnostic.retryable
      && attempt < SEARXNG_MAX_ATTEMPTS
      && elapsedMs < SEARXNG_RETRY_BUDGET_MS
      && (!isSoftFailure(lastDiagnostic.code) || SEARXNG_RETRY_SOFT_FAILURES);
    if (!canRetry) {
      break;
    }

    const retryDelayMs = Math.min(
      lastDiagnostic.retryAfterMs ?? getRetryDelayMs(attempt),
      SEARXNG_RETRY_MAX_DELAY_MS,
      Math.max(0, SEARXNG_RETRY_BUDGET_MS - elapsedMs)
    );
    logDebug(`Retrying ${instance}`, { attempt, retryDelayMs, code: lastDiagnostic.code });
    await delay(retryDelayMs);
  }

  // For soft failures that produced data (even if empty), return it with an embedded
  // diagnostic so callers can surface warnings about challenged engines rather than getting nothing.
  if (isSoftFailure(lastDiagnostic.code) && data !== undefined) {
    return { ...data, _search_failure_diagnostic: lastDiagnostic };
  }

  throw new SearchAttemptError({
    ...lastDiagnostic,
    message: `${lastDiagnostic.message}; failed after ${lastDiagnostic.attempts} attempt(s)`
  });
}

const MAX_PAGES_PER_SEARCH = 10;

/**
 * Builds the request parameters shared by every page fetch.
 *
 * `offset` is deliberately NOT translated into a page number here. SearXNG's page
 * size is server-configured and unrelated to the caller's max_results, so deriving
 * a page from offset produced wrong pages. Instead we fetch enough pages to cover
 * offset+max_results and let buildStructuredResponse slice the concatenated list.
 */
function buildSearchParams(params: WebSearchParams): {
  baseParams: Record<string, string>;
  needed: number;
  startPage: number;
} {
  const offset = params.offset ?? 0;
  const maxResults = params.max_results ?? 10;
  const startPage = params.page || 1;

  const searchParams: Record<string, string> = {
    q: params.query,
    pageno: String(startPage),
    language: params.language || 'all',
    time_range: params.time_range === 'all_time' ? '' : (params.time_range || ''),
    safesearch: String(params.safesearch ?? 0),
    format: 'json'
  };

  // Only send categories when the caller asked for them, so the request body for
  // ordinary searches stays byte-identical to what it was before.
  if (Array.isArray(params.categories) && params.categories.length > 0) {
    searchParams.categories = params.categories.join(',');
  }

  // Only fetch beyond the first page when an offset actually requires it. With
  // offset=0 the first page is the whole answer, which keeps the common case at
  // one request and preserves the previous single-page behaviour.
  const needed = offset > 0 ? offset + maxResults : 0;

  return { baseParams: searchParams, needed, startPage };
}

/**
 * Fetches consecutive pages until `needed` results are available, a page comes back
 * empty, or the page cap is reached. The first page's metadata (including any
 * soft-failure diagnostic) is preserved on the merged result.
 */
async function fetchEnoughPages(
  instance: string,
  baseParams: Record<string, string>,
  needed: number,
  startPage: number
): Promise<SearxngResponse> {
  let first: SearxngResponse | undefined;
  let accumulated: SearchResult[] = [];

  for (let i = 0; i < MAX_PAGES_PER_SEARCH; i += 1) {
    const pageno = startPage + i;
    const data = await executeSearchWithRetry(instance, { ...baseParams, pageno: String(pageno) });
    if (first === undefined) {
      first = data;
    }

    const pageResults = Array.isArray(data.results) ? data.results : [];
    accumulated = accumulated.concat(pageResults);

    if (accumulated.length >= needed || pageResults.length === 0) {
      break;
    }
  }

  return { ...first, results: accumulated };
}

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'ref_src', 'ref_url'
]);

/**
 * Reduces a result URL to a comparison key so the same page is not reported twice.
 * Ignores fragments, tracking query parameters, scheme/host casing and a trailing
 * slash. Falls back to the raw string for anything unparseable.
 */
export function normalizeResultUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '');
    }

    return url.toString();
  } catch {
    return rawUrl.trim();
  }
}

function collectEngines(result: SearchResult): string[] {
  const names = new Set<string>();

  if (typeof result.engine === 'string' && result.engine.length > 0) {
    names.add(result.engine);
  }

  if (Array.isArray(result.engines)) {
    for (const name of result.engines) {
      if (typeof name === 'string' && name.length > 0) {
        names.add(name);
      }
    }
  }

  return [...names];
}

/**
 * Collapses results that point at the same page. When several sources returned it,
 * the highest-scoring row wins and the engine names are unioned, so multi-instance
 * setups report one entry per URL instead of one per instance.
 */
export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const byUrl = new Map<string, SearchResult>();

  for (const result of results) {
    if (!result || typeof result.url !== 'string' || result.url.length === 0) {
      continue;
    }

    const key = normalizeResultUrl(result.url);
    const existing = byUrl.get(key);

    if (!existing) {
      byUrl.set(key, { ...result });
      continue;
    }

    const existingScore = existing.score ?? 0;
    const candidateScore = result.score ?? 0;
    const winner = candidateScore > existingScore ? result : existing;
    const loser = winner === result ? existing : result;

    byUrl.set(key, {
      ...loser,
      ...winner,
      engines: [...new Set([...collectEngines(existing), ...collectEngines(result)])]
    });
  }

  return [...byUrl.values()];
}

export class SearchHandler {
  constructor(protected instances: string[]) {}

  async search(params: WebSearchParams): Promise<SearxngResponse> {
    logDebug('Search parameters', params);

    const { baseParams, needed, startPage } = buildSearchParams(params);
    const errors: SearchFailureDiagnostic[] = [];

    for (const instance of this.instances) {
      try {
        const data = await fetchEnoughPages(instance, baseParams, needed, startPage);
        const deduped: SearxngResponse = { ...data, results: dedupeResults(data.results) };
        // Surface embedded diagnostics from soft failures as warnings on the result.
        if (deduped._search_failure_diagnostic) {
          return { ...deduped, _resilience: { status: 'degraded', warnings: [toSearchWarning(deduped._search_failure_diagnostic)] } };
        }
        return deduped;
      } catch (error) {
        const diagnostic = error instanceof SearchAttemptError
          ? error.diagnostic
          : {
            code: 'network_error' as const,
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
            instance,
            attempts: 0
          };
        logError(diagnostic.message, error);
        errors.push(diagnostic);
      }
    }

    // If all instances failed with soft failures, return empty results with warnings
    // instead of throwing, so the caller gets useful diagnostic info.
    if (errors.length > 0 && errors.every((d) => isSoftFailure(d.code))) {
      return { results: [], number_of_results: 0, _resilience: { status: 'degraded', warnings: errors.map(toSearchWarning) } };
    }

    throw new AggregateSearchError(errors);
  }
}

export class ParallelSearchHandler extends SearchHandler {
  async search(params: WebSearchParams): Promise<SearxngResponse> {
    logDebug('Search parameters', params);
    const cacheKey = resilienceCacheKey(params);
    const cached = getCachedResult(cacheKey);
    if (cached && !cached.stale) {
      return cached.data;
    }

    const availableInstances = this.instances.filter((instance) => !isCircuitOpen(instance));

    if (availableInstances.length === 0) {
      if (cached?.stale) {
        return { ...cached.data, _resilience: { stale: true, reason: 'circuit_open', cached_at: new Date(cached.cachedAt).toISOString() } };
      }
      throw new AggregateSearchError(this.instances.map(circuitDiagnostic));
    }

    const { baseParams, needed, startPage } = buildSearchParams(params);

    const searchPromises = availableInstances.map(async (instance) => {
      try {
        const data = await fetchEnoughPages(instance, baseParams, needed, startPage);
        // Propagate embedded diagnostic from soft failures
        if (data && data._search_failure_diagnostic) {
          return { instance, data, _diagnostic: data._search_failure_diagnostic };
        }
        return { instance, data };
      } catch (error) {
        throw { instance, error };
      }
    });

    const settled = await Promise.allSettled(searchPromises);
    const fulfilled = settled
      .filter((result): result is PromiseFulfilledResult<InstanceResult> => result.status === 'fulfilled')
      .map((result) => {
        // A degraded response still means the instance answered, but it must not
        // clear a circuit that a previous hard failure opened.
        if (result.value._diagnostic === undefined) {
          recordCircuitSuccess(result.value.instance);
        }
        return result.value;
      });
    const diagnostics = [
      ...settled
        .filter((result): result is PromiseFulfilledResult<InstanceResult> => result.status === 'fulfilled' && result.value._diagnostic !== undefined)
        .map((result) => result.value._diagnostic!),
      ...settled
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => {
          const reason = result.reason as { instance?: string; error?: unknown };
          const error = reason.error ?? result.reason;
          const diagnostic = error instanceof SearchAttemptError
            ? error.diagnostic
            : {
              code: 'network_error' as const,
              message: error instanceof Error ? error.message : String(error),
              retryable: true,
              instance: reason.instance || 'unknown',
              attempts: 0
            };
          recordCircuitFailure(diagnostic);
          return diagnostic;
        })
    ];

    if (fulfilled.length === 0) {
      if (cached?.stale) {
        return { ...cached.data, _resilience: { stale: true, reason: 'upstream_unavailable', cached_at: new Date(cached.cachedAt).toISOString() } };
      }
      // If all instances failed with soft failures, return empty results with warnings
      // instead of throwing, so the caller gets useful diagnostic info.
      if (diagnostics.length > 0 && diagnostics.every((d) => isSoftFailure(d.code))) {
        const errorMsg = `All SearXNG instances returned soft failures: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
        logError(errorMsg);
        return { results: [], number_of_results: 0, _resilience: { status: 'degraded', warnings: diagnostics.map(toSearchWarning) } };
      }
      const errorMsg = `All SearXNG instances failed: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
      logError(errorMsg);
      throw new AggregateSearchError(diagnostics);
    }

    // Aggregate results from all successful instances
    const allResults = dedupeResults(fulfilled.flatMap(({ data }) => (Array.isArray(data.results) ? data.results : [])));
    // Preserve SearXNG's own total instead of reporting the size of the fetched page.
    const upstreamTotal = fulfilled.reduce((max, { data }) => {
      const total = data.number_of_results;
      return typeof total === 'number' && total > max ? total : max;
    }, 0);
    const result = {
      results: allResults,
      number_of_results: upstreamTotal || allResults.length,
      ...(diagnostics.length > 0
        ? {
          _resilience: {
            status: 'degraded' as const,
            warnings: diagnostics.map(toSearchWarning)
          }
        }
        : {})
    };
    cacheResult(cacheKey, result);
    return result;
  }
}
