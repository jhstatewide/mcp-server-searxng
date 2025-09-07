import type { SearchResult, StructuredSearchResult, SearchMetadata, StructuredSearchResponse } from './types.js';

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
