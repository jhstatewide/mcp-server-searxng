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
const SEARXNG_INSTANCES = process.env.SEARXNG_INSTANCES 
  ? process.env.SEARXNG_INSTANCES.split(',')
  : ['http://localhost:8080'];

// HTTP headers with user agent from env
const USER_AGENT = process.env.SEARXNG_USER_AGENT || 'MCP-SearXNG/1.0';

// Add HTTP/HTTPS agent configuration
const httpsAgent = new HttpsAgent({
  rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'
});
const httpAgent = new HttpAgent();

const WEB_SEARCH_TOOL: Tool = {
  name: "web_search",
  description: 
    "Performs a web search using SearXNG, ideal for general queries, news, articles and online content. " +
    "Supports multiple search categories, languages, time ranges and safe search filtering. " +
    "Returns relevant results from multiple search engines combined.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query"
      },
      page: {
        type: "number", 
        description: "Page number (default 1)",
        default: 1
      },
      language: {
        type: "string",
        description: "Search language code (e.g. 'en', 'zh', 'jp', 'all')",
        default: "all"
      },
      categories: {
        type: "array",
        items: {
          type: "string",
          enum: ["general", "news", "science", "files", "images", "videos", "music", "social media", "it"]
        },
        default: ["general"]
      },
      time_range: {
        type: "string",
        enum: ["all_time", "day", "week", "month", "year"],
        default: "all_time"
      },
      safesearch: {
        type: "number",
        description: "0: None, 1: Moderate, 2: Strict",
        default: 1
      }
    },
    required: ["query"]
  }
};

// Server implementation
const server = new Server(
  {
    name: "kevinwatt/mcp-server-searxng",
    version: "0.3.5",
    description: "SearXNG meta search integration for MCP"
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Helper function to try different instances
async function searchWithFallback(params: any) {
  if (SEARXNG_INSTANCES.length === 0) {
    throw new Error("No SearXNG instances configured. Please set the SEARXNG_INSTANCES environment variable.");
  }

  logDebug("Search parameters", params);
  
  const searchParams = {
    q: params.query,
    pageno: params.page || 1,
    language: params.language || 'all',
    categories: params.categories?.join(',') || 'general',
    time_range: params.time_range === 'all_time' ? '' : (params.time_range || ''),
    safesearch: params.safesearch ?? 1,
    format: 'json'
  };
  
  const errors: string[] = [];
  
  for (const instance of SEARXNG_INSTANCES) {
    try {
      const searchUrl = new URL('/search', instance);
      logDebug(`Attempting search with instance: ${instance}`);
      
      const response = await fetch(searchUrl.toString(), {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT
        },
        agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent,
        body: new URLSearchParams(Object.entries(searchParams).reduce((acc, [key, value]) => {
          acc[key] = String(value); // Convert all values to strings for URLSearchParams
          return acc;
        }, {} as Record<string, string>)).toString()
      });

      if (!response.ok) {
        // Try to get detailed error information from the response
        let errorText: string;
        try {
          errorText = await response.text();
        } catch {
          errorText = 'No response body available';
        }
        
        const errorMsg = `${instance} returned HTTP ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}`;
        logError(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      const data = await response.json();
      if (!data.results?.length) {
        const errorMsg = `${instance} returned no results`;
        logError(errorMsg);
        errors.push(errorMsg);
        continue;
      }

      logDebug(`Search successful with ${instance}, found ${data.results.length} results`);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorMsg = `Failed to connect to ${instance}: ${errorMessage}`;
      logError(errorMsg, error);
      errors.push(errorMsg);
      continue;
    }
  }

  // Provide detailed error information about all failed attempts
  const errorDetails = errors.map((err, i) => `  [${i+1}] ${err}`).join("\n");
  throw new Error(
    `All SearXNG instances failed. Please ensure SearXNG is running on one of these instances: ${SEARXNG_INSTANCES.join(', ')}\n\nDetails:\n${errorDetails}`
  );
}

interface SearchResult {
  title: string;
  content?: string;
  url: string;
  engine?: string;
}

function formatSearchResult(result: SearchResult) {
  const parts = [
    `Title: ${result.title}`,
    `URL: ${result.url}`
  ];

  if (result.content) {
    parts.push(`Content: ${result.content}`);
  }

  if (result.engine) {
    parts.push(`Source: ${result.engine}`);
  }

  return parts.join('\n');
}

function isWebSearchArgs(args: unknown): { valid: boolean; error?: string } {
  if (typeof args !== "object" || args === null) {
    return { valid: false, error: "Arguments must be an object" };
  }
  
  if (!("query" in args)) {
    return { valid: false, error: "Missing required parameter: 'query'" };
  }
  
  if (typeof (args as { query: unknown }).query !== "string") {
    return { valid: false, error: "Parameter 'query' must be a string" };
  }

  // Add more specific validations for optional parameters
  const typedArgs = args as Record<string, unknown>;
  
  if (typedArgs.page !== undefined && 
      (typeof typedArgs.page !== "number" || isNaN(Number(typedArgs.page)))) {
    return { valid: false, error: "Parameter 'page' must be a valid number" };
  }
  
  if (typedArgs.language !== undefined && typeof typedArgs.language !== "string") {
    return { valid: false, error: "Parameter 'language' must be a string" };
  }
  
  if (typedArgs.time_range !== undefined) {
    const validTimeRanges = ["all_time", "day", "week", "month", "year"];
    if (typeof typedArgs.time_range !== "string" || !validTimeRanges.includes(typedArgs.time_range as string)) {
      return { 
        valid: false, 
        error: `Parameter 'time_range' must be one of: ${validTimeRanges.join(", ")}` 
      };
    }
  }
  
  if (typedArgs.safesearch !== undefined && 
     (typeof typedArgs.safesearch !== "number" || 
      ![0, 1, 2].includes(typedArgs.safesearch as number))) {
    return { 
      valid: false, 
      error: "Parameter 'safesearch' must be a number (0: None, 1: Moderate, 2: Strict)" 
    };
  }
  
  if (typedArgs.categories !== undefined) {
    if (!Array.isArray(typedArgs.categories)) {
      return { valid: false, error: "Parameter 'categories' must be an array" };
    }
    
    const validCategories = ["general", "news", "science", "files", "images", "videos", "music", "social media", "it"];
    for (const category of typedArgs.categories) {
      if (typeof category !== "string" || !validCategories.includes(category)) {
        return { 
          valid: false, 
          error: `Invalid category: '${category}'. Must be one of: ${validCategories.join(", ")}` 
        };
      }
    }
  }
  
  return { valid: true };
}

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
      return {
        content: [{ type: "text", text: errorMsg }],
        isError: true,
      };
    }

    const results = await searchWithFallback(args);
    
    const formattedResults = results.results.map(formatSearchResult).join('\n\n');
    logDebug(`Search successful, returning ${results.results.length} results`);
    
    return {
      content: [{ 
        type: "text", 
        text: formattedResults
      }],
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logError('Search failed', error);
    
    // Send detailed error message back to the client
    return {
      content: [{ 
        type: "text", 
        text: `Search failed: ${errorMessage}` 
      }],
      isError: true,
    };
  }
});

// 修改 runServer 為可選的運行
export async function runServer() {
  const transport = new StdioServerTransport();
  try {
    // Log configuration details on startup
    console.error("Starting SearXNG MCP Server...");
    console.error(`SEARXNG_INSTANCES: ${SEARXNG_INSTANCES.join(", ")}`);
    console.error(`TLS Verification: ${process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' ? 'Disabled' : 'Enabled'}`);
    console.error(`Debug Mode: ${DEBUG ? 'Enabled' : 'Disabled'}`);
    
    await server.connect(transport);
    console.error("SearXNG Search MCP Server running on stdio");
  } catch (error) {
    logError('Fatal error running server', error);
    process.exit(1);
  }
}

runServer();

export { 
  formatSearchResult, 
  isWebSearchArgs, 
  searchWithFallback,
  SEARXNG_INSTANCES
};
