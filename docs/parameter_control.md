# Parameter Control

# Overview

We've just had a very successful 0.4.2 release with our new "structured response" tool. This 0.5.0 release adds comprehensive parameter control capabilities.
Now, the idea is let's extend that feature by allowing the MCP client to control the parameters of the search, like for example, the number of results to return, or the offset of the results to return or the length of the content to return.

## Implemented Parameters

### High Priority Parameters (✅ COMPLETED)

The following parameters are now available for both `web_search` and `web_search_structured` tools:

#### 1. `max_results` (number)
- **Description**: Maximum number of results to return
- **Range**: 1-100
- **Default**: 10
- **Usage Example**: 
  ```typescript
  web_search_structured("climate change", { max_results: 20 })
  // Returns up to 20 results instead of the default 10
  ```

#### 2. `offset` (number)  
- **Description**: Number of results to skip (for pagination)
- **Range**: 0 or greater
- **Default**: 0
- **Usage Example**:
  ```typescript
  // Get results 21-30 (skip first 20, return next 10)
  web_search_structured("climate change", { 
    offset: 20, 
    max_results: 10 
  })
  
  // Get results 41-60 (skip first 40, return next 20)
  web_search_structured("climate change", { 
    offset: 40, 
    max_results: 20 
  })
  ```

#### 3. `content_length` (number)
- **Description**: Maximum characters per result content snippet
- **Range**: 50-1000
- **Default**: 200
- **Usage Example**:
  ```typescript
  // Get shorter snippets (100 characters max)
  web_search_structured("climate change", { content_length: 100 })
  
  // Get longer, more detailed snippets (500 characters max)
  web_search_structured("climate change", { content_length: 500 })
  ```

## Pagination Examples

### Basic Pagination
```typescript
// Page 1: Results 1-10
web_search_structured("AI research", { 
  max_results: 10, 
  offset: 0 
})

// Page 2: Results 11-20  
web_search_structured("AI research", { 
  max_results: 10, 
  offset: 10 
})

// Page 3: Results 21-30
web_search_structured("AI research", { 
  max_results: 10, 
  offset: 20 
})
```

### Custom Page Sizes
```typescript
// Large pages: 50 results per page
web_search_structured("machine learning", { 
  max_results: 50, 
  offset: 0 
})

// Small pages: 5 results per page, page 3
web_search_structured("machine learning", { 
  max_results: 5, 
  offset: 10 
})
```

## Combined Usage Examples

### Efficient Data Collection
```typescript
// Get first 30 results with short snippets for quick overview
web_search_structured("quantum computing", {
  max_results: 30,
  offset: 0,
  content_length: 100
})
```

### Detailed Analysis
```typescript
// Get 5 results with detailed content for deep analysis  
web_search_structured("climate change solutions", {
  max_results: 5,
  offset: 0, 
  content_length: 800,
  categories: ["science", "news"],
  time_range: "month"
})
```

### Progressive Loading
```typescript
// Load more results as needed
const loadPage = (pageNum: number, pageSize: number = 15) => {
  return web_search_structured("renewable energy", {
    max_results: pageSize,
    offset: pageNum * pageSize,
    content_length: 250
  });
};

// Load page 0 (results 1-15)
await loadPage(0);
// Load page 1 (results 16-30) 
await loadPage(1);
// Load page 2 (results 31-45)
await loadPage(2);
```

## Implementation Notes

- **Offset Conversion**: The `offset` parameter is automatically converted to SearXNG's page-based system internally
- **Content Truncation**: Content is intelligently truncated at sentence boundaries when possible
- **Validation**: All parameters are validated with clear error messages
- **Backward Compatibility**: All existing functionality remains unchanged; these parameters are optional

## Error Handling

The system provides clear validation errors:

```typescript
// Invalid max_results
web_search_structured("test", { max_results: 150 })
// Error: "Parameter 'max_results' must be a number between 1 and 100"

// Invalid content_length  
web_search_structured("test", { content_length: 25 })
// Error: "Parameter 'content_length' must be a number between 50 and 1000"

// Invalid offset
web_search_structured("test", { offset: -5 })
// Error: "Parameter 'offset' must be a number >= 0"
```