import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';

export const USER_AGENT = process.env.SEARXNG_USER_AGENT || 'MCP-SearXNG/1.0';

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return fallback;
  }

  return Number(trimmed);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  if (value.trim().toLowerCase() === 'true') {
    return true;
  }

  if (value.trim().toLowerCase() === 'false') {
    return false;
  }

  return fallback;
}

const isTestEnv = process.env.NODE_ENV === 'test';
const defaultRetryBaseDelayMs = isTestEnv ? 1 : 300;
const defaultRetryJitterMs = isTestEnv ? 0 : 100;
const defaultRequestTimeoutMs = isTestEnv ? 1000 : 10000;
const defaultRetryMaxDelayMs = 10000;
const defaultRetryBudgetMs = isTestEnv ? 5000 : 30000;

// Retry and timeout settings are read on every call rather than captured at import
// time, so a caller (or a test) can change the environment without reloading the
// module. Capturing them at import forced tests to re-import the whole module graph
// via jest.isolateModulesAsync.

export function getMaxAttempts(): number {
  return Math.max(1, parseNonNegativeInt(process.env.SEARXNG_MAX_ATTEMPTS, 4));
}

export function getRetryBaseDelayMs(): number {
  return parseNonNegativeInt(process.env.SEARXNG_RETRY_BASE_DELAY_MS, defaultRetryBaseDelayMs);
}

export function getRetryJitterMs(): number {
  return parseNonNegativeInt(process.env.SEARXNG_RETRY_JITTER_MS, defaultRetryJitterMs);
}

export function getRequestTimeoutMs(): number {
  return Math.max(
    1,
    parseNonNegativeInt(process.env.SEARXNG_REQUEST_TIMEOUT_MS, defaultRequestTimeoutMs)
  );
}

export function getRetrySoftFailures(): boolean {
  return parseBoolean(process.env.SEARXNG_RETRY_SOFT_FAILURES, true);
}

export function getRetryMaxDelayMs(): number {
  return Math.max(
    0,
    parseNonNegativeInt(process.env.SEARXNG_RETRY_MAX_DELAY_MS, defaultRetryMaxDelayMs)
  );
}

export function getRetryBudgetMs(): number {
  return Math.max(
    0,
    parseNonNegativeInt(process.env.SEARXNG_RETRY_BUDGET_MS, defaultRetryBudgetMs)
  );
}

export const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});

export const httpAgent = new HttpAgent();
