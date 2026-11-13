export interface SearchResult {
  title: string;
  content?: string;
  url: string;
  engine?: string;
  score?: number;
  category?: string;
  publishedDate?: string;
  published_date?: string;
  /** Every engine that returned this URL, as reported by SearXNG. */
  engines?: string[];
}

export interface WebSearchParams {
  query: string;
  max_results?: number;
  offset?: number;
  content_length?: number;
  page?: number;
  language?: string;
  time_range?: 'all_time' | 'day' | 'week' | 'month' | 'year';
  safesearch?: 0 | 1 | 2;
  categories?: string[];
}

export interface ResilienceInfo {
  status?: 'completed' | 'degraded';
  warnings?: SearchWarning[];
  stale?: boolean;
  reason?: string;
  cached_at?: string;
}

/**
 * A SearXNG /search?format=json payload, plus the fields this server attaches.
 */
export interface SearxngResponse {
  results: SearchResult[];
  number_of_results?: number;
  unresponsive_engines?: unknown;
  _search_failure_diagnostic?: SearchFailureDiagnostic;
  _resilience?: ResilienceInfo;
}

export interface StructuredSearchResult {
  title: string;
  url: string;
  content?: string;
  score?: number;
  category?: string;
  engine?: string;
  publishedDate?: string;
}

export interface SearchWarning {
  code: 'engine_challenge' | 'engine_degraded' | 'upstream_failure';
  message: string;
  retryable: boolean;
  recommendation: string;
  affected_engines?: unknown;
}

export interface SearchMetadata {
  total_results: number;
  time_taken?: number;
  query: string;
  status?: 'completed' | 'degraded';
  warnings?: SearchWarning[];
  stale?: boolean;
  stale_reason?: string;
  cached_at?: string;
}

export interface StructuredSearchResponse {
  results: StructuredSearchResult[];
  metadata: SearchMetadata;
}

export type SearchFailureCode =
  | 'challenge'
  | 'empty_results'
  | 'upstream_degraded'
  | 'http_error'
  | 'malformed_response'
  | 'network_error'
  | 'circuit_open';

export interface SearchFailureDiagnostic {
  code: SearchFailureCode;
  message: string;
  retryable: boolean;
  instance: string;
  attempts: number;
  status?: number;
  details?: string;
  retryAfterMs?: number;
  unresponsiveEngines?: unknown;
}

export interface SearchFailureResponse {
  code: 'SEARXNG_SEARCH_FAILED';
  message: string;
  retryable: boolean;
  hint: string;
  attempts: number;
  instances: SearchFailureDiagnostic[];
}
