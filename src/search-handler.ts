import fetch from 'node-fetch';
import {
  USER_AGENT,
  httpsAgent,
  httpAgent,
  SEARXNG_MAX_ATTEMPTS,
  SEARXNG_RETRY_BASE_DELAY_MS,
  SEARXNG_RETRY_JITTER_MS,
  SEARXNG_REQUEST_TIMEOUT_MS
} from './config.js';
import type { StructuredSearchResponse } from './types.js';

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

function isRetriableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
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

async function executeSearchWithRetry(instance: string, searchParams: Record<string, string>): Promise<any> {
  const searchUrl = new URL('/search', instance);
  let lastError = 'Unknown error';
  let attemptsUsed = 0;

  for (let attempt = 1; attempt <= SEARXNG_MAX_ATTEMPTS; attempt += 1) {
    attemptsUsed = attempt;
    logDebug(`Attempt ${attempt}/${SEARXNG_MAX_ATTEMPTS} for instance: ${instance}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, SEARXNG_REQUEST_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(searchUrl.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          },
          agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent as any,
          body: new URLSearchParams(searchParams).toString(),
          signal: controller.signal as any
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        let errorText: string;
        try {
          errorText = await response.text();
        } catch {
          errorText = 'No response body available';
        }

        lastError = `${instance} returned HTTP ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}`;

        if (isRetriableStatus(response.status) && attempt < SEARXNG_MAX_ATTEMPTS) {
          const retryAfterMs = response.status === 429
            ? parseRetryAfterMs(response.headers.get('retry-after'))
            : undefined;
          const retryDelayMs = retryAfterMs ?? getRetryDelayMs(attempt);
          logDebug(`Retrying ${instance} after HTTP ${response.status}`, { attempt, retryDelayMs });
          await delay(retryDelayMs);
          continue;
        }

        break;
      }

      const data = await response.json();
      if (!data.results?.length) {
        const queryPreview = formatQueryPreview(searchParams.q);
        const timeRange = searchParams.time_range || 'all_time';
        lastError = `${instance} returned HTTP 200 with zero results (query="${queryPreview}", pageno=${searchParams.pageno}, language=${searchParams.language}, time_range=${timeRange}, safesearch=${searchParams.safesearch})`;
        break;
      }

      logDebug(`Search successful with ${instance}, found ${data.results.length} results`);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastError = `Failed to connect to ${instance}: ${errorMessage}`;

      if (attempt < SEARXNG_MAX_ATTEMPTS) {
        const retryDelayMs = getRetryDelayMs(attempt);
        logDebug(`Retrying ${instance} after network error`, { attempt, retryDelayMs, errorMessage });
        await delay(retryDelayMs);
        continue;
      }
    }

    break;
  }

  throw new Error(`${instance} failed after ${attemptsUsed} attempt(s). Last error: ${lastError}`);
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
    
    const errors: string[] = [];
    
    for (const instance of this.instances) {
      try {
        const data = await executeSearchWithRetry(
          instance,
          serializedSearchParams
        );
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsg = errorMessage;
        logError(errorMsg, error);
        errors.push(errorMsg);
        continue;
      }
    }

    const errorDetails = errors.map((err, i) => `  [${i+1}] ${err}`).join("\n");
    throw new Error(
      `All SearXNG instances failed. Please ensure SearXNG is running on one of these instances: ${this.instances.join(', ')}\n\nDetails:\n${errorDetails}`
    );
  }
}

export class ParallelSearchHandler extends SearchHandler {
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
    
    const searchPromises = this.instances.map(async (instance) => {
      try {
        const data = await executeSearchWithRetry(
          instance,
          serializedSearchParams
        );
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(errorMessage);
      }
    });

    const results = await Promise.allSettled(searchPromises);
    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const errors = results.filter(r => r.status === 'rejected').map(r => (r.reason as Error).message);

     if (fulfilled.length === 0) {
       const errorDetails = errors.map((err, i) => `  [${i+1}] ${err}`).join("\n");
       const errorMsg = `All SearXNG instances failed. Please ensure SearXNG is running on one of these instances: ${this.instances.join(', ')}\n\nDetails:\n${errorDetails}`;
       logError(errorMsg);
       throw new Error(errorMsg);
     }

    // Aggregate results from all successful instances
    const allResults = fulfilled.flatMap(r => r.results);
    
    return {
      results: allResults,
      number_of_results: allResults.length
    };
  }
}
