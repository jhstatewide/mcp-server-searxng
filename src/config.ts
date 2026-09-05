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

const isTestEnv = process.env.NODE_ENV === 'test';
const defaultRetryBaseDelayMs = isTestEnv ? 1 : 300;
const defaultRetryJitterMs = isTestEnv ? 0 : 100;
const defaultRequestTimeoutMs = isTestEnv ? 1000 : 10000;

export const SEARXNG_MAX_ATTEMPTS = Math.max(
  1,
  parseNonNegativeInt(process.env.SEARXNG_MAX_ATTEMPTS, 4)
);
export const SEARXNG_RETRY_BASE_DELAY_MS = parseNonNegativeInt(
  process.env.SEARXNG_RETRY_BASE_DELAY_MS,
  defaultRetryBaseDelayMs
);
export const SEARXNG_RETRY_JITTER_MS = parseNonNegativeInt(
  process.env.SEARXNG_RETRY_JITTER_MS,
  defaultRetryJitterMs
);
export const SEARXNG_REQUEST_TIMEOUT_MS = Math.max(
  1,
  parseNonNegativeInt(
    process.env.SEARXNG_REQUEST_TIMEOUT_MS,
    defaultRequestTimeoutMs
  )
);

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

const defaultRetryMaxDelayMs = 10000;
const defaultRetryBudgetMs = isTestEnv ? 5000 : 30000;

export const SEARXNG_RETRY_SOFT_FAILURES = parseBoolean(
  process.env.SEARXNG_RETRY_SOFT_FAILURES,
  true
);
export const SEARXNG_RETRY_MAX_DELAY_MS = Math.max(
  0,
  parseNonNegativeInt(process.env.SEARXNG_RETRY_MAX_DELAY_MS, defaultRetryMaxDelayMs)
);
export const SEARXNG_RETRY_BUDGET_MS = Math.max(
  0,
  parseNonNegativeInt(process.env.SEARXNG_RETRY_BUDGET_MS, defaultRetryBudgetMs)
);

import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';

export const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});

export const httpAgent = new HttpAgent();
