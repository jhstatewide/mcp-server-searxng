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
const { version } = require('./package.json');

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

class SearchHandler {
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
    
    const errors: string[] = [];
    
    for (const instance of this.instances) {
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
            acc[key] = String(value);
            return acc;
          }, {} as Record<string, string>)).toString()
        });

        if (!response.ok) {
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

    const errorDetails = errors.map((err, i) => `  [${i+1}] ${err}`).join("\n");
    throw new Error(
      `All SearXNG instances failed. Please ensure SearXNG is running on one of these instances: ${this.instances.join(', ')}\n\nDetails:\n${errorDetails}`
    );
  }
}

class ParallelSearchHandler extends SearchHandler {
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
    
    const searchPromises = this.instances.map(async (instance) => {
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
            acc[key] = String(value);
            return acc;
          }, {} as Record<string, string>)).toString()
        });

        if (!response.ok) {
          let errorText: string;
          try {
            errorText = await response.text();
          } catch {
            errorText = 'No response body available';
          }
          
          const errorMsg = `${instance} returned HTTP ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}`;
          logError(errorMsg);
          throw new Error(errorMsg);
        }

        const data = await response.json();
        if (!data.results?.length) {
          const errorMsg = `${instance} returned no results`;
          logError(errorMsg);
          throw new Error(errorMsg);
        }

        logDebug(`Search successful with ${instance}, found ${data.results.length} results`);
        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsg = `Failed to connect to ${instance}: ${errorMessage}`;
        logError(errorMsg, error);
        throw new Error(errorMsg);
      }
    });

    const results = await Promise.allSettled(searchPromises);
    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const errors = results.filter(r => r.status === 'rejected').map(r => (r.reason as Error).message);

    if (fulfilled.length === 0) {
      const errorDetails = errors.map((err, i) => `  [${i+1}] ${err}`).join("\n");
      throw new Error(
        `All SearXNG instances failed. Please ensure SearXNG is running on one of these instances: ${this.instances.join(', ')}\n\nDetails:\n${errorDetails}`
      );
    }

    // Aggregate results from all successful instances
    const allResults = fulfilled.flatMap(r => r.results);
    
    return {
      results: allResults,
      number_of_results: allResults.length
    };
  }
}

const PARAMETER_HELP = `
# How to get a specific range of results
- To get results 1-10: set offset=0, max_results=10
- To get results 11-20: set offset=10, max_results=10
- To get results 40-43: set offset=39, max_results=4

# Common mistakes
- Do NOT use 'page' for pagination. Use 'offset' and 'max_results'.
- 'offset' is zero-based: offset=0 means start from the first result.
- 'max_results' is the number of results you want to get (not the last result number).

# Typical values
- offset: 0, 10, 20, 39, etc. (zero-based)
- max_results: 1-100 (how many results to return)
- content_length: 50-1000 (max characters per result's content)

# Example
To get results 40-43, use: { "offset": 39, "max_results": 4 }
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

interface SearchResult {
  title: string;
  content?: string;
  url: string;
  engine?: string;
}

// New interfaces for structured responses
interface StructuredSearchResult {
  title: string;
  url: string;
  content?: string;
  score?: number;
  category?: string;
  engine?: string;
  publishedDate?: string;
}

interface SearchMetadata {
  total_results: number;
  time_taken?: number;
  query: string;
}

interface StructuredSearchResponse {
  results: StructuredSearchResult[];
  metadata: SearchMetadata;
}

export function formatSearchResult(result: SearchResult) {
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

export function formatStructuredSearchResult(result: any, contentLength: number = 200): StructuredSearchResult {
  const structuredResult: StructuredSearchResult = {
    title: result.title || '',
    url: result.url || '',
  };

  if (result.content) {
    const content = result.content.toString();
    if (content.length > contentLength) {
      // Try to truncate at sentence boundaries when possible
      const sentences = content.split(/[.!?]+/).filter((s: string) => s.trim().length > 0).map((s: string) => s.trim());
      let truncated = '';
      for (const sentence of sentences) {
        if ((truncated + sentence + '. ').length <= contentLength) {
          truncated += sentence + '. ';
        } else {
          break;
        }
      }
      
      // If no complete sentences fit, just truncate at character limit
      if (truncated.length === 0) {
        truncated = content.substring(0, contentLength - 3) + '...';
      }
      
      structuredResult.content = truncated.trim();
    } else {
      structuredResult.content = content;
    }
  }

  if (result.score !== undefined) {
    structuredResult.score = Number(result.score);
  }

  if (result.category) {
    structuredResult.category = result.category;
  } else if (result.engine) {
    // Map engine to category if category not provided
    structuredResult.category = result.engine;
  }

  if (result.engine) {
    structuredResult.engine = result.engine;
  }

  if (result.publishedDate || result.published_date) {
    structuredResult.publishedDate = result.publishedDate || result.published_date;
  }

  return structuredResult;
}

export function buildStructuredResponse(data: any, query: string, params: any, startTime?: number): StructuredSearchResponse {
  const endTime = startTime ? Date.now() : undefined;
  const timeTaken = startTime && endTime ? (endTime - startTime) / 1000 : undefined;

  const contentLength = params.content_length || 200;
  const maxResults = params.max_results || 10;
  const offset = params.offset || 0;
  
  // Apply content length formatting to each result
  let structuredResults = data.results.map((result: any) => formatStructuredSearchResult(result, contentLength));
  
  // Apply offset and max_results directly
  structuredResults = structuredResults.slice(offset, offset + maxResults);
  
  const metadata: SearchMetadata = {
    total_results: data.number_of_results || data.results.length,
    query: query,
  };

  if (timeTaken !== undefined) {
    metadata.time_taken = timeTaken;
  }

  return {
    results: structuredResults,
    metadata: metadata,
  };
}

export function isWebSearchArgs(args: unknown): { valid: boolean; error?: string } {
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
        error: `Parameter 'time_range' must be one of the exact strings: ${validTimeRanges.join(", ")}. Shorthand formats like '3d' are not supported.` 
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
  
  if (typedArgs.max_results !== undefined) {
    if (typeof typedArgs.max_results !== "number" || 
        typedArgs.max_results < 1 || 
        typedArgs.max_results > 100) {
      return { 
        valid: false, 
        error: "Parameter 'max_results' must be a number between 1 and 100" 
      };
    }
  }
  
  if (typedArgs.offset !== undefined) {
    if (typeof typedArgs.offset !== "number" || typedArgs.offset < 0) {
      return { 
        valid: false, 
        error: "Parameter 'offset' must be a number >= 0" 
      };
    }
  }
  
  if (typedArgs.content_length !== undefined) {
    if (typeof typedArgs.content_length !== "number" || 
        typedArgs.content_length < 0 || 
        typedArgs.content_length > 1000) {
      return { 
        valid: false, 
        error: "Parameter 'content_length' must be a number between 0 and 1000" 
      };
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
