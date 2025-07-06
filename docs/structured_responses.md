# Structured Responses

## Overview

This current project is an "MCP" server that lets you query the "Searx-ng" search engine.
However, the current implementation just seems to return all the websites mashed together.

The objective of this project is to break that up into a JSON/XML document that
depicts the search results in a structured way.

## Example

```json
{
    "results": [
        {
            "title": "Title of the search result",
            "url": "https://www.example.com",
            "content": "Content of the search result", // possibly summarized, limited to a few sentences
            "score": 0.0, // searx "relevance" score
            "category": "news" // searx "category"
        }
    ],
    "metadata": {
        "total_results": 100,
        "time_taken": 0.123,
        "query": "search query"
    }
}
```

So, basically, we add a new "command" to the MCP server that takes a search query and returns the above response (massaged if it has to be to meet the "MCP" standard).

Let's leave the existing "search" command as is, and add a new "search_structured" command that takes a search query and returns the above response (massaged if it has to be to meet the "MCP" standard). That way this is just an "additive" change.

OK, I think there's enough going with the existing code we can just figure out how to extend this and meet our objective.

## Implementation Status

✅ **COMPLETED** - The structured response functionality has been successfully implemented!

### What was implemented:

1. **New Type Definitions** - Added interfaces for structured responses:
   - `StructuredSearchResult` - Individual result with all fields
   - `SearchMetadata` - Metadata about the search
   - `StructuredSearchResponse` - Complete response structure

2. **New Tool** - Added `web_search_structured` tool that:
   - Uses the same input parameters as the existing `web_search` tool
   - Returns structured JSON responses instead of plain text
   - Includes relevance scores, categories, and search metadata

3. **Helper Functions** - Implemented:
   - `formatStructuredSearchResult()` - Transforms raw SearXNG results
   - `buildStructuredResponse()` - Builds complete structured responses
   - Content truncation for better readability (limits to 2 sentences if content > 200 chars)

4. **Backward Compatibility** - The existing `web_search` tool remains unchanged

### Usage:

The new `web_search_structured` tool returns JSON in the format:
```json
{
  "results": [
    {
      "title": "Title of the search result",
      "url": "https://www.example.com",
      "content": "Content of the search result",
      "score": 0.85,
      "category": "news",
      "engine": "google",
      "publishedDate": "2023-01-01"
    }
  ],
  "metadata": {
    "total_results": 100,
    "time_taken": 0.123,
    "query": "search query"
  }
}
```

### Testing:

- All existing tests continue to pass
- Added comprehensive tests for new functionality
- Verified both tools work correctly
- Build process completes without errors

## Implementation Plan

### Phase 1: Extend Type Definitions
1. **Update SearchResult interface** - Add missing fields that SearXNG provides:
   - `score` (relevance score)
   - `category` (search category)
   - `engine` (already exists)
   - `publishedDate` (if available)

2. **Create new interfaces** for structured response:
   - `StructuredSearchResult` - Individual result with all fields
   - `SearchMetadata` - Metadata about the search
   - `StructuredSearchResponse` - Complete response structure

### Phase 2: Add New Tool Definition
1. **Create STRUCTURED_WEB_SEARCH_TOOL** - Copy existing tool definition with:
   - Name: `"web_search_structured"`
   - Same input parameters as existing tool
   - Updated description mentioning structured JSON response

2. **Add tool to server** - Update `ListToolsRequestSchema` handler to return both tools

### Phase 3: Implement Structured Response Handler
1. **Create `formatStructuredSearchResult` function** - Transform raw SearXNG JSON to our structured format:
   - Extract all available fields from SearXNG response
   - Map `engine` to `category` if category not provided
   - Calculate or extract relevance score
   - Format content (limit to a few sentences if needed)

2. **Create `buildStructuredResponse` function** - Build complete response with metadata:
   - Extract total results count from SearXNG response
   - Calculate time taken (if available from SearXNG)
   - Include original query
   - Return properly formatted JSON

### Phase 4: Add Request Handler
1. **Add structured search handler** in `CallToolRequestSchema`:
   - Handle `"web_search_structured"` tool name
   - Reuse existing `searchWithFallback` function
   - Apply structured formatting instead of plain text
   - Return JSON as text content (MCP requirement)

### Phase 5: Testing & Validation
1. **Add unit tests** for new functions:
   - Test structured result formatting
   - Test metadata extraction
   - Test complete response building

2. **Integration testing** - Verify the new tool works with actual SearXNG instances

### Implementation Details

**Key Files to Modify:**
- `src/index.ts` - Main implementation
- `src/index.test.ts` - Add tests for new functionality

**SearXNG Response Fields Available:**
Based on the existing code, SearXNG returns JSON with:
- `results[]` - Array of search results
- Each result contains: `title`, `url`, `content`, `engine`
- Additional fields may include: `score`, `category`, `publishedDate`

**MCP Integration Notes:**
- MCP tools must return text content, so JSON will be stringified
- Keep existing error handling and fallback logic
- Maintain same parameter validation as existing tool
- Use same environment variables and configuration

**Backward Compatibility:**
- Existing `web_search` tool remains unchanged
- New `web_search_structured` tool is additive only
- Same SearXNG instances and configuration used for both

This implementation plan ensures we can add structured responses while maintaining all existing functionality and following the established patterns in the codebase.
