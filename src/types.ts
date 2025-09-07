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