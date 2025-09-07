import fetch from 'node-fetch';
import { USER_AGENT, httpsAgent, httpAgent } from './config.js';
import type { StructuredSearchResponse } from './types.js';

export class SearchHandler {
  constructor(protected instances: string[]) {}

  async search(params: any): Promise<any> {
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
        
        const response = await fetch(searchUrl.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          },
          agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent as any,
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
          errors.push(errorMsg);
          continue;
        }

        const data = await response.json();
        if (!data.results?.length) {
          const errorMsg = `${instance} returned no results`;
          errors.push(errorMsg);
          continue;
        }

        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsg = `Failed to connect to ${instance}: ${errorMessage}`;
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

export class ParallelSearchHandler extends SearchHandler {
  async search(params: any): Promise<StructuredSearchResponse> {
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
        
        const response = await fetch(searchUrl.toString(), {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': USER_AGENT
          },
          agent: searchUrl.protocol === 'https:' ? httpsAgent : httpAgent as any,
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
          throw new Error(errorMsg);
        }

        const data = await response.json();
        if (!data.results?.length) {
          const errorMsg = `${instance} returned no results`;
          throw new Error(errorMsg);
        }

        return data;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorMsg = `Failed to connect to ${instance}: ${errorMessage}`;
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
    const totalResults = fulfilled.reduce((sum, r) => sum + r.metadata.total_results, 0);
    
    return {
      results: allResults,
      metadata: {
        total_results: totalResults,
        query: params.query
      }
    };
  }
}