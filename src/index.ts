#!/usr/bin/env node

import type { Response } from 'node-fetch';
import fetch from 'node-fetch';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { Agent as HttpsAgent } from 'node:https';
import { Agent as HttpAgent } from 'node:http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// Import SearchHandler and ParallelSearchHandler from search-handler.ts
import { SearchHandler, ParallelSearchHandler } from './search-handler.js';
// Import types from types.ts
import type { SearchResult, StructuredSearchResult, SearchMetadata, StructuredSearchResponse } from './types.js';
// Import utility functions from utils.ts
import { formatSearchResult, formatStructuredSearchResult, buildStructuredResponse, isWebSearchArgs } from './utils.js';

// Add console error wrapper
function logError(message: string, error?: unknown) {
  console.error(`Error: ${message}`, error ? `\n${error}` : '');
}

// Add debug logging function that can be enabled via environment variable
const DEBUG = process.env.MCP_SEARXNG_DEBUG === 'true';
function logDebug(message: string, data?: unknown) {
  if (DEBUG) {
    console.error(`Debug: ${message}`, data ? `\n${JSON.stringify(data, null, 2)}` : '');
  }
}

// Primary SearXNG instances for fallback
export const SEARXNG_INSTANCES = process.env.SEARXNG_INSTANCES 
  ? process.env.SEARXNG_INSTANCES.split(',')
  : ['http://localhost:8080'];

// HTTP headers with user agent from env
const USER_AGENT = process.env.SEARXNG_USER_AGENT || 'MCP-SearXNG/1.0';

// Add HTTP/HTTPS agent configuration
const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});
const httpAgent = new HttpAgent();


const PARAMETER_HELP = `
# Pagination: Use offset (not page) - offset=0=first result, offset=10=11th result
# Example: offset=39, max_results=4 gets results 40-43
`;

const WEB_SEARCH_TOOL: Tool = {
  name: "web_search",
  description:
    "Performs a web search using SearXNG and returns structured JSON results.\n" +
    "\n" +
    "# IMPORTANT: Pagination is offset-based, NOT page-based.\n" +
    "To get a specific range of results, set 'offset' to the zero-based index of the first result you want, and 'max_results' to how many results you want.\n" +
    "For example, to get results 40-43, set offset=39 and max_results=4.\n" +
    PARAMETER_HELP,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search terms. Example: 'climate change'"
      },
      max_results: {
        type: "number",
        description: "Number of results to return (1-100, default: 10)",
        default: 10,
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: "number",
        description: "Number of results to skip (default: 0)",
        default: 0,
        minimum: 0
      },
      content_length: {
        type: "number",
        description: "Max characters per result (0 for no content, only metadata; 1-1000, default: 200)",
        default: 200,
        minimum: 0,
        maximum: 1000
      },
      page: {
        type: "number",
        description: "(Advanced) Page number. Usually leave as default.",
        default: 1
      },
      language: {
        type: "string",
        description: "Language code (e.g. 'en', 'all'). Default: 'all'",
        default: "all"
      },
      time_range: {
        type: "string",
        enum: ["all_time", "day", "week", "month", "year"],
        description: "Time range: 'all_time', 'day', 'week', 'month', 'year'",
        default: "all_time"
      },
      safesearch: {
        type: "number",
        description: "Safe search: 0 (off, default), 1 (moderate), 2 (strict)",
        default: 0
      }
    },
    required: ["query"]
  }
};

const serverConfig = {
  name: "@jharding_npm/mcp-server-searxng",
  version,
  description: "SearXNG meta search integration for MCP with enhanced error handling and parameter control"
};

const server = new Server(
  serverConfig,
  {
    capabilities: {
      tools: {},
    },
  },
);



// Tool handlers
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [WEB_SEARCH_TOOL]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    
    logDebug('Tool request received', { name, args });

    if (name !== "web_search") {
      const errorMsg = `Invalid tool: expected 'web_search', got '${name}'`;
      logError(errorMsg);
      return {
        content: [{ type: "text", text: errorMsg }],
        isError: true,
      };
    }

    if (!args) {
      const errorMsg = "Missing arguments for web_search";
      logError(errorMsg);
      return {
        content: [{ type: "text", text: errorMsg }],
        isError: true,
      };
    }

    // Validate arguments with improved validation
    const validation = isWebSearchArgs(args);
    if (!validation.valid) {
      const errorMsg = validation.error || "Invalid arguments for web_search";
      logError(errorMsg, args);
      
      // For time_range parameter specifically, provide more helpful guidance
      if (errorMsg.includes("time_range") && args.time_range) {
        const receivedValue = String(args.time_range);
        logDebug(`Invalid time_range value received: "${receivedValue}"`, {
          received: receivedValue,
          validValues: ["all_time", "day", "week", "month", "year"]
        });
        
        // Return enhanced error message with examples
        return {
          content: [{ 
            type: "text", 
            text: `${errorMsg}\n\nYou provided: "${receivedValue}"\nValid examples: "day" (not "1d"), "week" (not "7d"), "month" (not "30d")` 
          }],
          isError: true,
        };
      }
      
      return {
        content: [{ type: "text", text: errorMsg }],
        isError: true,
      };
    }

    const startTime = Date.now();
    const searchHandler = new ParallelSearchHandler(SEARXNG_INSTANCES);
    const data = await searchHandler.search(args);
    const structuredResponse = buildStructuredResponse(data, args.query as string, args, startTime);

    return {
      content: [{
        type: "text",
        text: JSON.stringify(structuredResponse, null, 2)
      }]
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError("Search failed", error);
    
    return {
      content: [{
        type: "text",
        text: `Search failed: ${errorMessage}`
      }],
      isError: true
    };
  }
});

export async function searchWithFallback(params: any) {
  const searchHandler = new ParallelSearchHandler(SEARXNG_INSTANCES);
  return await searchHandler.search(params);
}

export async function runServer() {
  await server.connect(new StdioServerTransport());
}

// Always start the server when this file is executed
// This ensures it works regardless of how it's invoked (npx, direct execution, etc.)
logDebug("Starting MCP server...", {
  importMetaUrl: import.meta.url,
  processArgv1: process.argv[1],
  nodeVersion: process.version
});

runServer().catch((error) => {
  logError("Failed to start server", error);
  process.exit(1);
});
