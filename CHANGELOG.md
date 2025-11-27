# Changelog

All notable changes to the Go Memory Layout Visualizer extension will be documented in this file.

## [0.2.2] - 2025-11-26

### Security

- Fixed path traversal vulnerability in export function
- Added path normalization and validation before file writes
- Implemented parent directory existence check
- Added write verification to ensure file integrity
- Set explicit file permissions (0o644) for exported files

## [0.2.1] - 2025-11-26

### Fixed

- Added error handling for file export operations
- Fixed deprecated `workspace.rootPath` usage, now uses `workspaceFolders`
- Export success message no longer exposes full file path

## [0.2.0] - 2025-11-23

### Added

- **Nested struct support**: Automatically calculates memory layout for structs containing other custom structs
- **Embedded field handling**: Properly detects and analyzes embedded fields (promoted fields)
- **Export memory layout reports**: New command to export detailed struct analysis to JSON, Markdown, or CSV formats
- Example files demonstrating nested structs and embedded fields
- Struct registry for tracking custom type definitions across the codebase

### Enhanced

- Parser now performs two-pass analysis to register all struct definitions before calculating layouts
- Memory calculator recursively resolves nested custom struct sizes
- Improved field detection to handle embedded fields without explicit names

### Technical Details

- Added `StructDefinition` and `ExportFormat` interfaces
- Implemented struct registry in `MemoryCalculator` with `registerStruct()` and `clearStructRegistry()` methods
- Added `registerStructDefinitions()` private method to `GoParser` for first-pass analysis
- New export command with multiple format support (JSON/Markdown/CSV)
- Enhanced field parsing regex to detect embedded fields

## [0.1.0] - 2025-11-21

### Initial Release

- Initial release
- Real-time memory layout visualization for Go structs
- Inline annotations showing byte offsets, sizes, and padding
- Multi-architecture support (amd64, arm64, 386)
- Hover provider with detailed field information
- CodeLens provider for one-click struct optimization
- Automatic field reordering to minimize memory usage
- Padding detection and highlighting
- Commands:
  - `Go: Optimize Struct Memory Layout`
  - `Go: Show Memory Layout`
  - `Go: Toggle Architecture`
- Configuration options:
  - Default architecture selection
  - Toggle inline annotations
  - Padding warning threshold
  - Cache line warnings

### Features

- Supports all Go primitive types (bool, int8-64, uint8-64, float32/64, complex64/128)
- Handles pointers, slices, arrays, maps, channels, interfaces
- Smart field ordering by alignment and size
- Visual padding warnings with configurable thresholds
- Side-by-side memory layout comparison panel
- Comprehensive test coverage for calculator, parser, and optimizer

### Implementation

- Built with TypeScript
- Zero external runtime dependencies
- Full test suite with 30+ test cases
- Follows Go's memory layout rules precisely
- Accurate padding calculation
- Support for embedded fields and complex types
