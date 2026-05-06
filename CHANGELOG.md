# Changelog

All notable changes to the Go Memory Layout Visualizer extension will be documented in this file.

## [1.0.0] - 2026-05-06

### Added

- Quick Fix code action: optimization is now available via the standard
  lightbulb (`Ctrl+.` / `Cmd+.`) on any reorderable struct, in addition to
  the existing CodeLens.
- Diagnostic provider: high-padding, optimization-eligible, and
  cache-line-crossing structs are surfaced in the Problems panel.
- Status bar item: shows the total saveable bytes for the active Go file at
  a glance, click-through opens the layout view.
- New command `Go: Compare Struct Layout Across Architectures` opens a
  side-by-side amd64/arm64/386 view for the struct at the cursor.
- Same-file type alias support, including aliases declared in `type (...)` blocks.
- Named-interface sizing: `error` is built in as a 2-word value, and any
  `type X interface { ... }` declared in the same file is registered and sized
  correctly (16 bytes on amd64/arm64, 8 bytes on 386).
- Anonymous inline struct fields: `Header struct { ... }` field types are now
  parsed and sized recursively, including multi-line declarations.
- A 28-case automated test suite covering layout sizing, alias resolution,
  interfaces, anonymous structs, nested and embedded structs, cache-line
  detection, multi-architecture optimizer behaviour, and array overflow guards.
- GitHub Actions CI running compile, lint, and tests on Node 20 and 22.
- Incremental TypeScript builds via `tsBuildInfoFile`, cutting warm rebuilds
  by roughly a third.

### Fixed

- ESLint `no-case-declarations` failure in the memory calculator.
- Go slice sizing now uses the correct three-word slice header on each
  supported architecture (24 B on amd64/arm64, 12 B on 386).
- `complex64` is now 8 bytes with 4-byte alignment, matching Go layout rules.
- `unsafe.Pointer` is correctly pointer-sized.
- `error` and other named interfaces no longer collapse to a single word.
- Optimizer emits grouped field declarations like `A, B uint8` exactly once.
- Interface declarations are no longer accidentally treated as structs by the
  parser when they precede a real struct in the same file.

## [0.3.1] - 2025-12-05

### Security

- **Critical**: Fixed DOM-based XSS vulnerabilities in Workspace Analysis and Memory Layout webviews
- **Critical**: Fixed private member access bypass via bracket notation
- **High**: Fixed CSV formula injection in exported reports
- **High**: Fixed ReDoS vulnerabilities in struct field and embedded field regex patterns
- **High**: Converted synchronous file I/O to async to prevent extension host blocking
- **High**: Added resource limits to workspace analyzer (1,000 files max, 1MB per file, 500 results)
- **Medium**: Added Content Security Policy headers to all webview panels
- **Medium**: Fixed information disclosure in error messages
- **Medium**: Set secure file permissions (0o600) on exported files
- **Medium**: Added integer overflow protection in array size calculations
- **Medium**: Fixed Markdown injection in hover provider and editor decorations
- **Medium**: Added mutex locking to prevent race conditions in decoration updates
- **Medium**: Added recursion depth limits for circular struct references
- **Medium**: Fixed XSS in documentation site calculator
- **Low**: Added architecture configuration validation

### Added

- Security advisory page on documentation site
- HTML, Markdown, and CSV escaping utilities for user-controlled content
- Configurable constants for resource limits and timeouts

### Documentation

- Published comprehensive security advisory with remediation timeline
- Added JSDoc comments to GoParser and MemoryCalculator classes

## [0.3.0] - 2025-12-03

### Added

- **Cache line visualization**: Shows which cache line (64-byte) each field occupies
- **Cache line crossing detection**: Warns when fields span multiple cache lines (performance issue)
- **Workspace memory analyzer**: New command `Go: Analyze Workspace Memory Layout` scans all Go files for optimization opportunities
- **Hot field detection**: Identifies fields that cross cache line boundaries (false sharing risk)
- Cache line breakdown in memory layout view showing bytes used vs padding per line
- New example file `cache-lines.go` demonstrating cache line issues

### Enhanced

- Inline annotations now show cache line number for each field (e.g., `[L0]`, `[L1]`)
- Fields crossing cache lines highlighted with distinct warning style
- Hover tooltips explain cache line crossing performance implications
- Memory layout panel includes cache line breakdown table

### New Command

- `Go: Analyze Workspace Memory Layout` - Scans entire workspace for:
  - Structs with excessive padding
  - Optimization opportunities (bytes saveable)
  - Cache line boundary issues
  - Hot fields that may cause false sharing

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
- Initial test coverage for calculator, parser, and optimizer

### Implementation

- Built with TypeScript
- Zero external runtime dependencies
- Follows Go's memory layout rules precisely
- Accurate padding calculation
- Support for embedded fields and complex types
