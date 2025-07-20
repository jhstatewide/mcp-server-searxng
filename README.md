# SearXNG MCP Server (Enhanced Error Handling Fork)

A fork of [kevinwatt/mcp-server-searxng](https://github.com/kevinwatt/mcp-server-searxng) with enhanced error messaging and parameter validation, specifically designed to improve the experience when used with AI agents.

This MCP server implementation integrates with SearXNG, providing privacy-focused meta search capabilities with improved feedback for LLM agents.

## For LLMs and Beginners

**How to get a specific range of results (advanced/structured use only):**

- To get results 1-10: set `offset=0`, `max_results=10`
- To get results 11-20: set `offset=10`, `max_results=10`
- To get results 40-43: set `offset=39`, `max_results=4`

**Important:**
- Do NOT use `page` for pagination in advanced/structured mode. Use `offset` and `max_results`.
- `offset` is zero-based: `offset=0` means start from the first result.
- `max_results` is the number of results you want to get (not the last result number).

**Common Patterns Table:**

| Results Wanted | offset | max_results |
|:--------------:|:------:|:-----------:|
| 1-10           |   0    |     10      |
| 11-20          |  10    |     10      |
| 21-30          |  20    |     10      |
| 40-43          |  39    |      4      |

**Example:**
```json
{ "offset": 39, "max_results": 4 }
```

## Features

- **Meta Search**: Combines results from multiple search engines
- **Privacy-Focused**: No tracking, no user profiling
- **Multiple Categories**: Support for general, news, science, files, images, videos, and more
- **Language Support**: Search in specific languages or all languages
- **Time Range Filtering**: Filter results by day, week, month, or year
- **Safe Search**: Three levels of safe search filtering
- **Fallback Support**: Multiple SearXNG instances for reliability
- **Structured JSON Responses**: New structured format for programmatic access to search results

### Enhanced Error Handling Features

- **Improved Parameter Validation**: Clear messaging about valid formats for all parameters
- **Contextual Error Messages**: Detailed feedback showing what was provided vs. what was expected
- **LLM-Friendly Descriptions**: Schema descriptions optimized for LLM understanding
- **Example-Based Feedback**: Error messages include examples of correct formats
- **Enhanced Debug Logging**: More detailed logging of parameter validation issues

## Why This Fork?

This fork was created to address specific issues when AI agents (particularly models like qwen3) interact with MCP tools. The main improvements include:

1. **Better Error Messages for LLMs**: Enhanced error responses that clearly explain what went wrong in a way that's easier for LLMs to understand and correct.

2. **Explicit Format Requirements**: More detailed schema definitions that help prevent common mistakes like using shorthand date formats (e.g., "3d" instead of "day").

3. **Comparative Error Feedback**: When validation fails, the error shows both what was received and what was expected, making it easier for agents to learn from mistakes.

4. **Example-Based Learning**: Error messages include concrete examples of valid values and explicitly mention invalid formats to avoid.

5. **Structured JSON Responses**: Added a new `web_search_structured` tool that returns search results in a structured JSON format, making it easier for applications to programmatically process search results with proper metadata, scores, and categorization.

These changes aim to reduce the friction when AI agents use this tool through the MCP protocol, leading to fewer errors and a better overall user experience.

## Installation

### Manual Installation
```bash
npm install -g @jharding_npm/mcp-server-searxng
```

### From Source
```bash
git clone https://github.com/jhstatewide/mcp-server-searxng.git
cd mcp-server-searxng
npm install
npm run build
```

## Usage

### Direct Run

```bash
mcp-server-searxng
```

### With [Dive Desktop](https://github.com/OpenAgentPlatform/Dive)

1. Click "+ Add MCP Server" in Dive Desktop
2. Copy and paste this configuration:

```json
{
  "mcpServers": {
    "searxng": {
      "command": "npx",
      "args": [
        "-y",
        "@jharding_npm/mcp-server-searxng"
      ]
    }
  }
}
```

3. Click "Save" to install the MCP server

### Usage Examples

**Basic Search (Plain Text):**
```bash
# Returns formatted plain text results
web_search("artificial intelligence news")
```

**Structured Search (JSON):**
```bash
# Returns structured JSON with metadata
web_search_structured("artificial intelligence news")
```

**Advanced Search with Filters:**
```bash
# Search with specific parameters
web_search_structured("climate change", {
  "time_range": "week",
  "language": "en",
  "safesearch": 1
})
```

**Parameter Control Examples:**
```bash
# Pagination: Get results 21-30 with custom content length
web_search_structured("artificial intelligence", {
  "max_results": 10,
  "offset": 20,
  "content_length": 300
})

# Large batch: Get 50 results with short snippets
web_search_structured("machine learning", {
  "max_results": 50,
  "offset": 0,
  "content_length": 100
})
```

## Tool Documentation

### web_search
Execute meta searches across multiple engines with plain text results.

**Inputs:**
- `query` (string, required): Text to search for
- `page` (number, optional, default 1): Page number (1 = first page)
- `language` (string, optional, default 'all'): Language code (e.g., 'en', 'all')
- `time_range` (string, optional, default 'all_time'): 'all_time', 'day', 'week', 'month', or 'year'
- `safesearch` (number, optional, default 0): 0 = Off (default, most complete results), 1 = Moderate, 2 = Strict

**Output:** Plain text formatted search results

### web_search_structured
Execute meta searches across multiple engines with structured JSON results.

**Inputs:**
- `query` (string, required): Text to search for
- `page` (number, optional, default 1): Page number (1 = first page)
- `language` (string, optional, default 'all'): Language code (e.g., 'en', 'all')
- `time_range` (string, optional, default 'all_time'): 'all_time', 'day', 'week', 'month', or 'year'
- `safesearch` (number, optional, default 0): 0 = Off (default, most complete results), 1 = Moderate, 2 = Strict

**Output:** Structured JSON response with the following format:
```json
{
  "results": [
    {
      "title": "Title of the search result",
      "url": "https://www.example.com",
      "content": "Content of the search result (truncated to 2 sentences if long)",
      "score": 0.85,
      "category": "news",
      "engine": "google",
      "publishedDate": "2023-01-01"
    }
  ],
  "metadata": {
    "total_results": 100,
    "time_taken": 0.123,
    "query": "original search query"
  }
}
```

**Features:**
- Individual result objects with all available fields
- Automatic content truncation for readability
- Search metadata including timing and result counts
- Relevance scores when available from search engines
- Engine and category information for each result

## Development

```bash
git clone https://github.com/jhstatewide/mcp-server-searxng.git
cd mcp-server-searxng
npm install
npm run build
npm start
```

## License

This MCP server is licensed under the MIT License. See the LICENSE file for details.

## Prerequisites

You need a local SearXNG instance running. To set it up:

# Run SearXNG with Docker

## Quick Start

```bash
# Create config directory
mkdir -p searxng

# Create config file
tee searxng/settings.yml << EOF
use_default_settings: true

server:
  bind_address: "0.0.0.0"
  secret_key: "CHANGE_THIS_TO_SOMETHING_SECURE"  # Generate a random key
  port: 8080

search:
  safe_search: 0
  formats:
    - html
    - json

engines:
  - name: google
    engine: google
    shortcut: g

  - name: duckduckgo
    engine: duckduckgo
    shortcut: d

  - name: bing
    engine: bing
    shortcut: b

server.limiter: false
EOF

# Start container
docker run -d \
  --name searxng \
  -p 8080:8080 \
  -v "$(pwd)/searxng:/etc/searxng" \
  searxng/searxng
```

## Test Search Function

```bash
# Test JSON API with curl
curl -v 'http://localhost:8080/search?q=test&format=json'

# Or visit in browser
http://localhost:8080/search?q=test
```

## Container Management

```bash
# Stop container
docker stop searxng

# Remove container
docker rm searxng

# View container logs
docker logs searxng

# Enable auto-start on boot
docker update --restart always searxng
```

The `--restart always` flag ensures that:
- Container starts automatically when Docker daemon starts
- Container restarts automatically if it crashes
- Container restarts automatically if it is stopped unless explicitly stopped by user

## Custom Configuration

Edit `searxng/settings.yml` to:
- Modify search engine list
- Adjust security settings
- Configure UI language
- Change API limits

For detailed configuration options, see [SearXNG Documentation](https://docs.searxng.org/)

## Environment Variables

- `SEARXNG_INSTANCES`: Comma-separated list of SearXNG instances URLs
  Default: `http://localhost:8080`

- `SEARXNG_USER_AGENT`: Custom User-Agent header for requests
  Default: `MCP-SearXNG/1.0`

- `NODE_TLS_REJECT_UNAUTHORIZED`: Set to '0' to bypass SSL certificate verification (for development with self-signed certificates)
  Default: undefined (SSL verification enabled)

Example configuration with all options:
```json
{
  "mcpServers": {
    "searxng": {
      "name": "searxng",
      "command": "npx",
      "args": [
        "-y",
        "@jharding_npm/mcp-server-searxng"
      ],
      "env": {
        "SEARXNG_INSTANCES": "http://localhost:8080,https://searx.example.com",
        "SEARXNG_USER_AGENT": "CustomBot/1.0",
        "NODE_TLS_REJECT_UNAUTHORIZED": "0"
      }
    }
  }
}
```

> ⚠️ Warning: Disabling SSL certificate verification is not recommended in production environments.

By default, safe search is OFF (0), which returns the most complete set of results. This is recommended for research and general use, as enabling safe search may filter out relevant information.

The tool is now optimized for use with small LLMs (7b models) by simplifying the schema and defaults.

## Maintainer: Build, Pack, and Release Procedure

To release a new version to npm:

1. **Bump the version** in `package.json` (e.g., to 0.5.4):
   ```bash
   # Edit package.json and update the "version" field
   ```

2. **Build the project:**
   ```bash
   npm run build
   # or
   yarn build
   ```

3. **Pack the project (optional, to verify contents):**
   ```bash
   npm pack
   # This creates a tarball like jharding_npm-mcp-server-searxng-0.5.4.tgz
   # You can inspect it with:
   tar -tzf jharding_npm-mcp-server-searxng-0.5.4.tgz
   ```

4. **Test the packed tarball locally (optional):**
   ```bash
   npx -y ./jharding_npm-mcp-server-searxng-0.5.4.tgz --help
   # Should show CLI help and not hang
   ```

5. **Publish to npm:**
   ```bash
   npm publish --access public
   ```

6. **Verify the published CLI:**
   ```bash
   npx @jharding_npm/mcp-server-searxng@latest --help
   ```

**Note:** Ensure you have the correct permissions to publish to npm and that your npm account is logged in.

## Versioning Note

When making a new release, you must update the version number in both:
- `package.json`
- `src/index.ts` (the `version` constant)

This ensures the version displayed by the CLI matches the published package version.
