#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// Import ParallelSearchHandler and error helpers from search-handler.ts
import { ParallelSearchHandler, AggregateSearchError, getHint } from './search-handler.js';
// Import utility functions from utils.ts
import { buildStructuredResponse, isWebSearchArgs } from './utils.js';
import type { SearxngResponse, WebSearchParams } from './types.js';
import { buildStatusReport, loadInstanceCategories } from './instance-config.js';

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

const PARAMETER_HELP = `
# Pagination: Use offset (not page) - offset=0=first result, offset=10=11th result
# Example: offset=39, max_results=4 gets results 40-43
`;

export const WEB_SEARCH_TOOL: Tool = {
  name: 'web_search',
  description:
    'Performs a web search using SearXNG and returns structured JSON results.\n' +
    '\n' +
    '# IMPORTANT: Pagination is offset-based, NOT page-based.\n' +
    'To get a specific range of results, set \'offset\' to the zero-based index of the first result you want, and \'max_results\' to how many results you want.\n' +
    'For example, to get results 40-43, set offset=39 and max_results=4.\n' +
    PARAMETER_HELP,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search terms. Example: \'climate change\''
      },
      max_results: {
        type: 'number',
        description: 'Number of results to return (1-100, default: 10)',
        default: 10,
        minimum: 1,
        maximum: 100
      },
      offset: {
        type: 'number',
        description: 'Number of results to skip (default: 0)',
        default: 0,
        minimum: 0
      },
      content_length: {
        type: 'number',
        description: 'Max characters per result (0 for no content, only metadata; 1-1000, default: 200)',
        default: 200,
        minimum: 0,
        maximum: 1000
      },
      page: {
        type: 'number',
        description: '(Advanced) Page number. Usually leave as default.',
        default: 1
      },
      language: {
        type: 'string',
        description: 'Language code (e.g. \'en\', \'all\'). Default: \'all\'',
        default: 'all'
      },
      time_range: {
        type: 'string',
        enum: ['all_time', 'day', 'week', 'month', 'year'],
        description: 'Time range: \'all_time\', \'day\', \'week\', \'month\', \'year\'',
        default: 'all_time'
      },
      safesearch: {
        type: 'number',
        description: 'Safe search: 0 (off, default), 1 (moderate), 2 (strict)',
        default: 0
      },
      categories: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'SearXNG categories to search (e.g. general, news, images, books, repos, movies). Omit for the instance default. Call searxng_status to list the categories this instance exposes.'
      },
      engines: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'Restrict the search to specific SearXNG engines (e.g. ["bing", "wikipedia"]). Omit to use every enabled engine. Call searxng_status with probe=true to find which engines actually work.'
      }
    },
    required: ['query']
  }
};

const serverConfig = {
  name: '@jharding_npm/mcp-server-searxng',
  version,
  description: 'SearXNG meta search integration for MCP with enhanced error handling and parameter control'
};

const SEARXNG_STATUS_TOOL: Tool = {
  name: 'searxng_status',
  description:
    'Reports the health and capabilities of the configured SearXNG instances.\n' +
    '\n' +
    'Returns, per instance: whether it is reachable, the categories it exposes, and how many engines are enabled.\n' +
    'Set probe=true to send a minimal query to each enabled engine in the category and report which ones actually return results.\n' +
    'Use this when web_search reports a degraded status, to find out which engines are failing before concluding a topic has no coverage.',
  inputSchema: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        description: 'Category to report engines for. Default: general'
      },
      probe: {
        type: 'boolean',
        description: 'Actively query each enabled engine in the category. Slower. Default: false',
        default: false
      },
      max_engines: {
        type: 'number',
        description: 'Maximum number of engines to probe (1-50, default: 10)',
        default: 10,
        minimum: 1,
        maximum: 50
      }
    }
  }
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
  tools: [WEB_SEARCH_TOOL, SEARXNG_STATUS_TOOL]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;
    
    logDebug('Tool request received', { name, args });

    if (name === 'searxng_status') {
      const options = (args ?? {}) as {
        category?: unknown;
        probe?: unknown;
        max_engines?: unknown;
      };

      const report = await buildStatusReport(SEARXNG_INSTANCES, {
        category: typeof options.category === 'string' ? options.category : undefined,
        probe: options.probe === true,
        maxEngines: typeof options.max_engines === 'number' ? options.max_engines : undefined
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(report, null, 2) }]
      };
    }

    if (name !== 'web_search') {
      const errorMsg = `Invalid tool: expected 'web_search', got '${name}'`;
      logError(errorMsg);
      return {
        content: [{ type: 'text', text: errorMsg }],
        isError: true,
      };
    }

    if (!args) {
      const errorMsg = 'Missing arguments for web_search';
      logError(errorMsg);
      return {
        content: [{ type: 'text', text: errorMsg }],
        isError: true,
      };
    }

    // Validate arguments with improved validation
    const validation = isWebSearchArgs(args);
    if (!validation.valid) {
      const errorMsg = validation.error || 'Invalid arguments for web_search';
      logError(errorMsg, args);
      
      // For time_range parameter specifically, provide more helpful guidance
      if (errorMsg.includes('time_range') && args.time_range) {
        const receivedValue = String(args.time_range);
        logDebug(`Invalid time_range value received: "${receivedValue}"`, {
          received: receivedValue,
          validValues: ['all_time', 'day', 'week', 'month', 'year']
        });
        
        // Return enhanced error message with examples
        return {
          content: [{ 
            type: 'text', 
            text: `${errorMsg}\n\nYou provided: "${receivedValue}"\nValid examples: "day" (not "1d"), "week" (not "7d"), "month" (not "30d")` 
          }],
          isError: true,
        };
      }
      
      return {
        content: [{ type: 'text', text: errorMsg }],
        isError: true,
      };
    }

    const startTime = Date.now();
    const searchHandler = new ParallelSearchHandler(SEARXNG_INSTANCES);
    // SAFETY: isWebSearchArgs validated the shape above; the MCP SDK types tool
    // arguments as Record<string, unknown>.
    const params = args as unknown as WebSearchParams;
    const data = await searchHandler.search(params);
    const structuredResponse = buildStructuredResponse(data, params.query, params, startTime);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(structuredResponse, null, 2)
      }]
    };
  } catch (error) {
    logError('Search failed', error);

    if (error instanceof AggregateSearchError) {
      const diagnosticResponse = {
        code: 'SEARXNG_SEARCH_FAILED',
        message: 'All configured SearXNG instances failed to return usable search results.',
        retryable: error.diagnostics.some((diagnostic) => diagnostic.retryable),
        hint: getHint(error.diagnostics),
        attempts: error.diagnostics.reduce((total, diagnostic) => total + diagnostic.attempts, 0),
        instances: error.diagnostics
      };

      return {
        content: [{
          type: 'text',
          text: JSON.stringify(diagnosticResponse, null, 2)
        }],
        isError: true
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          code: 'SEARXNG_SEARCH_FAILED',
          message: errorMessage,
          retryable: true,
          hint: 'Retry the search or check the configured SearXNG instance.'
        }, null, 2)
      }],
      isError: true
    };
  }
});

export { resetResilienceState } from './resilience.js';

export async function searchWithFallback(params: WebSearchParams): Promise<SearxngResponse> {
  const searchHandler = new ParallelSearchHandler(SEARXNG_INSTANCES);
  return await searchHandler.search(params);
}

export async function runServer() {
  // Refresh the cached category list from the instance without blocking startup.
  // Falls back to DEFAULT_CATEGORIES if /config is unavailable.
  void loadInstanceCategories(SEARXNG_INSTANCES[0]);
  await server.connect(new StdioServerTransport());
}

// Start the server only when this file is executed directly (not imported or in tests).
// Comparing resolved file URLs avoids the old heuristic that started a server whenever
// the entry point happened to be named index.js.
export function shouldStartServer(
  argv1: string | undefined,
  importMetaUrl: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (!argv1) {
    return false;
  }

  if (env.NODE_ENV?.includes('test')) {
    return false;
  }

  if (argv1.includes('jest')) {
    return false;
  }

  try {
    return importMetaUrl === pathToFileURL(argv1).href;
  } catch {
    return false;
  }
}

const isMainModule = shouldStartServer(process.argv[1], import.meta.url);

logDebug('Server startup check', {
  importMetaUrl: import.meta.url,
  processArgv1: process.argv[1],
  isMainModule,
  endsWithIndex: process.argv[1]?.endsWith('index.js'),
  includesPackageName: process.argv[1]?.includes('mcp-server-searxng')
});

if (isMainModule && process.argv.includes('--version')) {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    // eslint-disable-next-line no-console -- --version writes to stdout by design
    console.log(packageJson.version);
  } catch (error) {
    logError('Failed to read package version', error);
    process.exit(1);
  }
} else if (isMainModule) {
  logDebug('Starting MCP server...');
  runServer().catch((error) => {
    logError('Failed to start server', error);
    process.exit(1);
  });
} else {
  logDebug('Not starting server - file was imported, not executed directly');
}
