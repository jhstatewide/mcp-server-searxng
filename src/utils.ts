import type { SearchResult, StructuredSearchResult, SearchMetadata, StructuredSearchResponse, SearchWarning, SearxngResponse, WebSearchParams } from './types.js';
import { getKnownCategories } from './instance-config.js';

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

export function formatStructuredSearchResult(result: SearchResult, contentLength: number = 200): StructuredSearchResult {
  const structuredResult: StructuredSearchResult = {
    title: result.title || '',
    url: result.url || '',
  };

  if (result.content) {
    const content = result.content.toString();
    if (contentLength <= 0) {
      // content_length=0 means metadata only: omit the content field entirely.
    } else if (content.length <= contentLength) {
      structuredResult.content = content;
    } else if (contentLength <= 3) {
      // Too small for an ellipsis; a hard cut is the only way to respect the limit.
      structuredResult.content = content.slice(0, contentLength);
    } else {
      // Prefer the last real sentence boundary that fits. Crucially, slice the
      // ORIGINAL text instead of splitting on [.!?] and rejoining with '. ', which
      // used to corrupt abbreviations ("e.g." became "e. g.", "Dr. Smith" became "Dr.").
      const window = content.slice(0, contentLength);
      const sentenceEnd = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? ')
      );

      if (sentenceEnd > 0) {
        structuredResult.content = window.slice(0, sentenceEnd + 1).trimEnd();
      } else {
        const budget = contentLength - 3;
        let cut = content.slice(0, budget);
        const lastSpace = cut.lastIndexOf(' ');
        if (lastSpace > 0) {
          cut = cut.slice(0, lastSpace);
        }
        structuredResult.content = `${cut.trimEnd()}...`;
      }
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

  // Non-web categories (images, videos, books, news) carry extra fields that used
  // to be dropped, which made categories like "images" close to useless.
  if (result.img_src) {
    structuredResult.img_src = result.img_src;
  }

  if (result.iframe_src) {
    structuredResult.iframe_src = result.iframe_src;
  }

  if (result.thumbnail) {
    structuredResult.thumbnail = result.thumbnail;
  }

  if (result.thumbnail_src) {
    structuredResult.thumbnail_src = result.thumbnail_src;
  }

  if (result.resolution) {
    structuredResult.resolution = result.resolution;
  }

  if (result.img_format) {
    structuredResult.img_format = result.img_format;
  }

  if (result.source) {
    structuredResult.source = result.source;
  }

  if (result.filesize !== undefined && result.filesize !== null) {
    structuredResult.filesize = result.filesize;
  }

  if (result.length !== undefined && result.length !== null) {
    structuredResult.length = result.length;
  }

  if (result.views !== undefined && result.views !== null) {
    structuredResult.views = result.views;
  }

  if (result.author) {
    structuredResult.author = result.author;
  }

  return structuredResult;
}

export function buildStructuredResponse(data: SearxngResponse, query: string, params: WebSearchParams, startTime?: number): StructuredSearchResponse {
  const endTime = startTime ? Date.now() : undefined;
  const timeTaken = startTime && endTime ? (endTime - startTime) / 1000 : undefined;

  const contentLength = params.content_length ?? 200;
  const maxResults = params.max_results ?? 10;
  const offset = params.offset ?? 0;

  const rawResults = Array.isArray(data.results) ? data.results : [];

  // Apply content length formatting to each result
  let structuredResults = rawResults.map((result: SearchResult) => formatStructuredSearchResult(result, contentLength));
  
  // Apply offset and max_results directly
  structuredResults = structuredResults.slice(offset, offset + maxResults);
  
  const metadata: SearchMetadata = {
    total_results: data.number_of_results ?? rawResults.length,
    query: query,
    status: data._resilience?.status || 'completed'
  };

  if (timeTaken !== undefined) {
    metadata.time_taken = timeTaken;
  }

  if (data._resilience?.warnings) {
    metadata.warnings = data._resilience.warnings as SearchWarning[];
  }

  if (data._resilience?.stale) {
    metadata.stale = true;
    metadata.stale_reason = data._resilience.reason;
    metadata.cached_at = data._resilience.cached_at;
  }

  return {
    results: structuredResults,
    metadata: metadata,
  };
}

export function isWebSearchArgs(args: unknown): { valid: boolean; error?: string } {
  if (typeof args !== 'object' || args === null) {
    return { valid: false, error: 'Arguments must be an object' };
  }
  
  if (!('query' in args)) {
    return { valid: false, error: 'Missing required parameter: \'query\'' };
  }
  
  if (typeof (args as { query: unknown }).query !== 'string') {
    return { valid: false, error: 'Parameter \'query\' must be a string' };
  }

  if ((args as { query: string }).query.trim().length === 0) {
    return { valid: false, error: 'Parameter \'query\' must not be empty' };
  }

  // Add more specific validations for optional parameters
  const typedArgs = args as Record<string, unknown>;
  
  if (typedArgs.page !== undefined && 
      (typeof typedArgs.page !== 'number' || isNaN(Number(typedArgs.page)))) {
    return { valid: false, error: 'Parameter \'page\' must be a valid number' };
  }
  
  if (typedArgs.language !== undefined && typeof typedArgs.language !== 'string') {
    return { valid: false, error: 'Parameter \'language\' must be a string' };
  }
  
  if (typedArgs.time_range !== undefined) {
    const validTimeRanges = ['all_time', 'day', 'week', 'month', 'year'];
    if (typeof typedArgs.time_range !== 'string' || !validTimeRanges.includes(typedArgs.time_range as string)) {
      return { 
        valid: false, 
        error: `Parameter 'time_range' must be one of the exact strings: ${validTimeRanges.join(', ')}. Shorthand formats like '3d' are not supported.` 
      };
    }
  }
  
  if (typedArgs.safesearch !== undefined && 
     (typeof typedArgs.safesearch !== 'number' || 
      ![0, 1, 2].includes(typedArgs.safesearch as number))) {
    return { 
      valid: false, 
      error: 'Parameter \'safesearch\' must be a number (0: None, 1: Moderate, 2: Strict)' 
    };
  }
  
  if (typedArgs.fresh !== undefined && typeof typedArgs.fresh !== 'boolean') {
    return { valid: false, error: 'Parameter \'fresh\' must be a boolean' };
  }

  if (typedArgs.categories !== undefined) {
    if (!Array.isArray(typedArgs.categories)) {
      return { valid: false, error: 'Parameter \'categories\' must be an array' };
    }
    
    // Sourced from the instance's /config when available, so categories the old
    // hardcoded list never knew about (books, repos, movies, translate, ...) work.
    const validCategories = getKnownCategories();
    for (const category of typedArgs.categories) {
      if (typeof category !== 'string' || !validCategories.includes(category)) {
        return { 
          valid: false, 
          error: `Invalid category: '${category}'. Must be one of: ${validCategories.join(', ')}` 
        };
      }
    }
  }
  
  if (typedArgs.engines !== undefined) {
    if (!Array.isArray(typedArgs.engines)) {
      return { valid: false, error: 'Parameter \'engines\' must be an array of engine names' };
    }

    for (const engine of typedArgs.engines) {
      if (typeof engine !== 'string' || engine.trim().length === 0) {
        return { valid: false, error: 'Parameter \'engines\' must contain non-empty engine name strings' };
      }
    }
  }

  if (typedArgs.max_results !== undefined) {
    if (typeof typedArgs.max_results !== 'number' || 
        typedArgs.max_results < 1 || 
        typedArgs.max_results > 100) {
      return { 
        valid: false, 
        error: 'Parameter \'max_results\' must be a number between 1 and 100' 
      };
    }
  }
  
  if (typedArgs.offset !== undefined) {
    if (typeof typedArgs.offset !== 'number' || typedArgs.offset < 0) {
      return { 
        valid: false, 
        error: 'Parameter \'offset\' must be a number >= 0' 
      };
    }
  }
  
  if (typedArgs.content_length !== undefined) {
    if (typeof typedArgs.content_length !== 'number' || 
        typedArgs.content_length < 0 || 
        typedArgs.content_length > 1000) {
      return { 
        valid: false, 
        error: 'Parameter \'content_length\' must be a number between 0 and 1000' 
      };
    }
  }
  
  return { valid: true };
}
