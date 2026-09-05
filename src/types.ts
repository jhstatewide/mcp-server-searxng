export interface SearchResult {
  title: string;
  content?: string;
  url: string;
  engine?: string;
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

export interface SearchMetadata {
  total_results: number;
  time_taken?: number;
  query: string;
}

export interface StructuredSearchResponse {
  results: StructuredSearchResult[];
  metadata: SearchMetadata;
}

export type SearchFailureCode =
  | 'challenge'
  | 'empty_results'
  | 'http_error'
  | 'malformed_response'
  | 'network_error';

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
