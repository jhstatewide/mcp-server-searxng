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

import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';

export const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});

export const httpAgent = new HttpAgent();
