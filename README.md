# SearXNG MCP Server (Enhanced Error Handling Fork)

A fork of [kevinwatt/mcp-server-searxng](https://github.com/kevinwatt/mcp-server-searxng) with enhanced error messaging and parameter validation, specifically designed to improve the experience when used with AI agents.

This MCP server implementation integrates with SearXNG, providing privacy-focused meta search capabilities with improved feedback for LLM agents.

## Features

- **Meta Search**: Combines results from multiple search engines
- **Privacy-Focused**: No tracking, no user profiling
- **Multiple Categories**: Support for general, news, science, files, images, videos, and more
- **Language Support**: Search in specific languages or all languages
- **Time Range Filtering**: Filter results by day, week, month, or year
- **Safe Search**: Three levels of safe search filtering
- **Fallback Support**: Multiple SearXNG instances for reliability

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

## Tool Documentation

- **web_search**
  - Execute meta searches across multiple engines
  - Inputs:
    - `query` (string): Search terms
    - `page` (number, optional): Page number (default: 1)
    - `language` (string, optional): Language code (e.g., 'en', 'all', default: 'all')
    - `categories` (array, optional): Search categories (default: ['general'])
      - Available: "general", "news", "science", "files", "images", "videos", "music", "social media", "it"
    - `time_range` (string, optional): Time filter (day/week/month/year)
    - `safesearch` (number, optional): Safe search level (0: None, 1: Moderate, 2: Strict, default: 1)

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
