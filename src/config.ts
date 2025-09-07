export const USER_AGENT = process.env.SEARXNG_USER_AGENT || 'MCP-SearXNG/1.0';

import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';

export const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});

export const httpAgent = new HttpAgent();