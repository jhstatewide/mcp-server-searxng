import fetch from 'node-fetch';
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
  SearchFailureCode,
  SearchFailureDiagnostic,
  StructuredSearchResponse
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

function formatQueryPreview(query: string | undefined): string {
  if (!query) {
    return '<empty>';
  }

  const maxLength = 120;
  if (query.length <= maxLength) {
    return query;
  }

  return `${query.substring(0, maxLength)}...`;
}

function getRetryDelayMs(attempt: number): number {
  const exponent = Math.max(attempt - 1, 0);
  const backoffDelay = SEARXNG_RETRY_BASE_DELAY_MS * (2 ** exponent);
  const jitter = SEARXNG_RETRY_JITTER_MS > 0
    ? Math.floor(Math.random() * (SEARXNG_RETRY_JITTER_MS + 1))
    : 0;

  return backoffDelay + jitter;
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

function truncateDetails(value: string, maxLength = 200): string {
  const normalized = value.replace(/\\s+/g, ' ').trim();
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

function isSoftFailure(code: SearchFailureCode): boolean {
  return code === 'challenge' || code === 'empty_results' || code === 'malformed_response';
}

export function getHint(diagnostics: SearchFailureDiagnostic[]): string {
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  if (codes.has('challenge')) {
    return 'Try another SearXNG instance or retry later; the upstream may be presenting a CAPTCHA or bot challenge.';
  }
  if (codes.has('empty_results')) {
    return 'Verify that the query should have matches and inspect the SearXNG instance health or engine configuration.';
  }
  if (codes.has('http_error')) {
    return 'Check the SearXNG instance status, rate limits, and whether JSON search output is enabled.';
  }
  return 'Check the configured SearXNG instance and retry if the failure is transient.';
}

async function executeSearchWithRetry(instance: string, searchParams: Record<string, string>): Promise<any> {
  const searchUrl = new URL('/search', instance);
  let lastDiagnostic: SearchFailureDiagnostic = {
    code: 'network_error',
    message: `Failed to connect to ${instance}`,
    retryable: true,
    instance,
    attempts: 0
  };
  const startedAt = Date.now();

  for (let attempt = 1; attempt <= SEARXNG_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SEARXNG_REQUEST_TIMEOUT_MS);

    try {
      logDebug(`Attempt ${attempt}/${SEARXNG_MAX_ATTEMPTS} for instance: ${instance}`);
      const response = await fetch(searchUrl.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent as any,
        body: new URLSearchParams(searchParams).toString(),
        signal: controller.signal as any
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
        let data: any;
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
        } else if (data !== undefined && data.results.length === 0) {
          lastDiagnostic = {
            code: 'empty_results',
            message: `${instance} returned HTTP 200 with zero results`,
            retryable: SEARXNG_RETRY_SOFT_FAILURES,
            instance,
            attempts: attempt,
            unresponsiveEngines: data.unresponsive_engines
          };
        } else if (data !== undefined) {
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
      && (!isSoftFailure(lastDiagnostic.code) || SEARXNG_RETRY_SOFT_FAILURES)
      && lastDiagnostic.code !== 'challenge'
      && lastDiagnostic.code !== 'malformed_response';
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

  throw new SearchAttemptError({
    ...lastDiagnostic,
    message: `${lastDiagnostic.message}; failed after ${lastDiagnostic.attempts} attempt(s)`
  });
}

export class SearchHandler {
  constructor(protected instances: string[]) {}

  async search(params: any): Promise<any> {
    logDebug("Search parameters", params);
    
    // Handle offset by converting to page number
    let pageNumber = params.page || 1;
    if (params.offset && params.offset > 0) {
      const resultsPerPage = params.max_results || 10;
      pageNumber = Math.floor(params.offset / resultsPerPage) + 1;
    }
    
    const searchParams = {
      q: params.query,
      pageno: pageNumber,
      language: params.language || 'all',
      time_range: params.time_range === 'all_time' ? '' : (params.time_range || ''),
      safesearch: params.safesearch ?? 0,
      format: 'json'
    };

    const serializedSearchParams = Object.entries(searchParams).reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {} as Record<string, string>);
    
    const errors: SearchFailureDiagnostic[] = [];

    for (const instance of this.instances) {
      try {
        const data = await executeSearchWithRetry(
          instance,
          serializedSearchParams
        );
        return data;
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

    throw new AggregateSearchError(errors);
  }
}

export class ParallelSearchHandler extends SearchHandler {
  async search(params: any): Promise<any> {
    logDebug("Search parameters", params);
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

    // Handle offset by converting to page number
    let pageNumber = params.page || 1;
    if (params.offset && params.offset > 0) {
      const resultsPerPage = params.max_results || 10;
      pageNumber = Math.floor(params.offset / resultsPerPage) + 1;
    }

    const searchParams = {
      q: params.query,
      pageno: pageNumber,
      language: params.language || 'all',
      time_range: params.time_range === 'all_time' ? '' : (params.time_range || ''),
      safesearch: params.safesearch ?? 0,
      categories: Array.isArray(params.categories) ? params.categories.join(',') : '',
      format: 'json'
    };

    const serializedSearchParams = Object.entries(searchParams).reduce((acc, [key, value]) => {
      acc[key] = String(value);
      return acc;
    }, {} as Record<string, string>);

    const searchPromises = availableInstances.map(async (instance) => {
      try {
        const data = await executeSearchWithRetry(instance, serializedSearchParams);
        return { instance, data };
      } catch (error) {
        throw { instance, error };
      }
    });

    const settled = await Promise.allSettled(searchPromises);
    const fulfilled = settled
      .filter((result): result is PromiseFulfilledResult<{ instance: string; data: any }> => result.status === 'fulfilled')
      .map((result) => {
        recordCircuitSuccess(result.value.instance);
        return result.value;
      });
    const diagnostics = settled
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
      });

    if (fulfilled.length === 0) {
      if (cached?.stale) {
        return { ...cached.data, _resilience: { stale: true, reason: 'upstream_unavailable', cached_at: new Date(cached.cachedAt).toISOString() } };
      }
      const errorMsg = `All SearXNG instances failed: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
      logError(errorMsg);
      throw new AggregateSearchError(diagnostics);
    }

    // Aggregate results from all successful instances
    const allResults = fulfilled.flatMap(({ data }) => data.results);
    const result = {
      results: allResults,
      number_of_results: allResults.length
    };
    cacheResult(cacheKey, result);
    return result;
  }
}
