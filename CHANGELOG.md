# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.10.0] - 2026-11-13

### Added
- Structured results now preserve the extra fields SearXNG returns for non-web categories: `img_src`, `iframe_src`, `thumbnail`, `thumbnail_src`, `resolution`, `img_format`, `source`, `filesize`, `length`, `views` and `author`. Previously only title, url, content, score, category, engine and publishedDate survived, which left `categories: ["images"]` with no image URL at all. Verified live: image searches now return `img_src`, `resolution` and `img_format`.

## [0.9.0] - 2026-11-13

### Added
- `web_search` accepts an `engines` parameter to restrict a search to specific SearXNG engines, for example `["bing", "wikipedia"]`. Omit it to use every enabled engine. Combined with `searxng_status` probing this lets a caller route around engines that are failing.

### Changed
- The `categories` parameter is no longer constrained to a hardcoded enum in the tool schema. The enum listed only nine categories, so clients could not see the categories the instance actually exposes. Use `searxng_status` to discover them.

## [0.8.0] - 2026-11-13

### Added
- New `searxng_status` tool. It reports, per configured instance, whether the instance is reachable, the categories it exposes, and how many engines are enabled. With `probe: true` it sends a minimal query to each enabled engine in the selected category and reports which ones actually return results. This turns the vague `degraded` status from `web_search` into a concrete list of failing engines.

  Against the local instance it reported 259 engines with 109 enabled, and probing the `general` category showed `wikipedia`, `bing` and `duckduckgo web` returning results while `google`, `duckduckgo`, `google cse`, `lingva` and `currency` returned nothing — which is what produced the degraded warnings.

## [0.6.20] - 2026-11-13

### Fixed
- Category validation no longer rejects valid categories. The hardcoded 9-item list (`general`, `news`, `science`, …) rejected 25 categories the instance actually exposes — `books`, `repos`, `apps`, `movies`, `translate`, `q&a`, `wikimedia` and others. The valid set is now read from the instance's `/config` at startup, falling back to SearXNG's standard category list when `/config` is unavailable.
- Multi-instance aggregation now deduplicates results. Every configured instance's results were concatenated unconditionally, so running more than one instance produced duplicate entries. Results are now collapsed by normalized URL (ignoring fragments, tracking parameters and a trailing slash), keeping the highest-scoring row and unioning the matched engine names.

## [0.6.19] - 2026-11-12

### Fixed
- `offset` is now a true zero-based result index. It was previously applied twice — once to derive a page number and again to slice the response — so results depended on the instance's page size and the documented `offset=39, max_results=4` example returned nothing.
- `content_length: 0` now returns metadata only, as documented, instead of falling back to 200 characters.
- `total_results` now reports SearXNG's own total instead of the number of results on the fetched page.
- The resilience cache key now includes `max_results`, which changes how many pages are fetched, and the cache is bounded to 500 entries.
- A JSON response without a `results` array now returns an empty result set with a warning instead of surfacing a raw `TypeError`.
- Content truncation no longer corrupts abbreviations (`e.g.` became `e. g.`) and never exceeds the requested `content_length`.
- Empty queries are rejected during validation.
- A degraded response no longer clears an open circuit breaker.
- The server no longer starts when an unrelated entry point happens to be named `index.js`.
- `--version` reports a clean error instead of an unhandled exception when `package.json` cannot be read.

### Added
- `categories` is now declared in the `web_search` tool schema and forwarded to SearXNG.
- `npm run lint` and `npm run lint:fix`, with eslint and the TypeScript plugins added as devDependencies.

### Changed
- Typed the SearXNG payload (`SearxngResponse`, `WebSearchParams`, `SearchResult`, `ResilienceInfo`) and removed all `any` from the codebase.
- Removed dead code left behind when `config.ts`, `search-handler.ts` and `utils.ts` were split out of `index.ts`.

## [0.6.5] - 2025-07-20

### Added
- Added bounded retries for SearXNG response-level soft failures, including empty-result responses and detected CAPTCHA/challenge pages.
- Added structured MCP error diagnostics with stable failure codes, retryability, attempt counts, affected instances, and actionable hints.
- Added retry delay and total retry budget controls through environment variables.

### Security
- Upstream response details included in diagnostics are truncated and sanitized; full HTML response bodies and credentials are never returned.

### Changed
- **BREAKING**: Removed the regular `web_search` tool that returned plain text results
- **BREAKING**: Renamed `web_search_structured` to `web_search` - now the only search tool
- Updated all documentation to reflect the single, superior structured search tool
- Simplified the API by having only one search method that returns structured JSON
- Updated tests to focus on the unified search functionality

### Removed
- Plain text search functionality (`web_search` tool)
- `web_search_structured` tool name (functionality moved to `web_search`)

## [0.4.1] - 2025-06-08

### Changed
- Updated repository URLs to reflect actual source repository at https://github.com/jhstatewide/mcp-server-searxng

### Fixed
- Emergency update to align package metadata with actual repository

## [0.4.0] - 2025-06-08

### Added
- Enhanced parameter validation with clear error messages
- Improved schema descriptions optimized for LLM understanding
- Added examples in error messages for expected parameter formats
- Added detailed feedback for invalid time_range parameters
- Enhanced debug logging for validation failures
- Updated documentation to reflect fork status

### Changed
- Forked from kevinwatt/mcp-server-searxng
- Updated package metadata to reflect new maintainer

## [0.3.8] - 2024-03-19

### Fixed
- Added support for both HTTP and HTTPS protocols

## [0.3.7] - 2024-03-19

### Fixed
- Fixed server startup issue by removing conditional runServer() call

## [0.3.6] - 2024-03-19

### Changed
- Improved test coverage using nock for HTTP request mocking
- Removed redundant mock implementations
- Fixed test reliability issues
- add NODE_TLS_REJECT_UNAUTHORIZED to allow self-signed certificates