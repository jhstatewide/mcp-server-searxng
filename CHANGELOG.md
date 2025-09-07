# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2025-01-27

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