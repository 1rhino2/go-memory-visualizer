# Go Memory Layout Visualizer

**v0.2.0 is now available!** [Download from GitHub](https://github.com/1rhino2/go-memory-visualizer/releases/tag/v0.2.0) | [Install from OpenVSX](https://open-vsx.org/extension/RhinoSoftware/go-memory-visualizer) | [Visit Website](https://1rhino2.github.io/go-memory-visualizer/)



A VS Code extension for real-time visualization and optimization of Go struct memory layout. This GitHub repository provides a powerful golang tool for analyzing struct padding, alignment, and cache performance in your Go code.

[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![VS Code](https://img.shields.io/badge/VS_Code-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[WEBSITE](https://1rhino2.github.io/go-memory-visualizer/)

## What It Does

This vscode-go extension shows you exactly how Go lays out structs in memory - byte offsets, alignment, padding, and cache line boundaries. It highlights wasteful padding in your golang structs and optimizes field ordering with one click, helping you reduce memory usage and improve performance.

## Why Use This

- Reduce struct sizes by 10-30% without changing logic
- Better cache locality means better performance
- Learn how Go actually stores your data in memory
- See the impact of field ordering in real-time

## Features

### Real-Time Analysis

- Inline annotations showing memory details for each field
- Byte offsets so you know exactly where fields live
- Size calculations and alignment requirements
- Padding detection with visual warnings
- **NEW in v0.2**: Nested struct support with recursive size calculation
- **NEW in v0.2**: Embedded field detection and analysis

### Visual Feedback

- Color-coded warnings for excessive padding
- Cache line boundary detection (64-byte warnings)
- Hover tooltips with detailed breakdowns
- CodeLens buttons for one-click optimization

### Optimization Tools

- Automatic field reordering by alignment and size
- Shows exact bytes saved before and after
- Preserves your comments and struct tags
- Safe refactoring that doesn't break anything
- **NEW in v0.2**: Works with nested and embedded structs

### Export and Reporting

- **NEW in v0.2**: Export memory layout reports to JSON, Markdown, or CSV
- Detailed field-by-field analysis with offset, size, alignment, and padding information
- Architecture-specific reports for cross-platform analysis
- Perfect for documentation, code reviews, and performance audits

### Multi-Architecture Support

Supports amd64, arm64, and 386. Switch between them to see how pointer sizes affect layout.

---

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Press `Ctrl+P` (Windows/Linux) or `Cmd+P` (Mac)
3. Type: `ext install RhinoSoftware.go-memory-visualizer`
4. Press Enter

Or visit the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=RhinoSoftware.go-memory-visualizer)

### From Source

```bash
git clone https://github.com/1rhino2/go-memory-visualizer.git
cd go-memory-visualizer
npm install
npm run compile
code .
# Press F5 to launch Extension Development Host
```

---

## Quick Start

### 1. Open a Go File

Create or open any `.go` file with struct definitions:

```go
type User struct {
    Active    bool    //  1 byte + 7 padding
    ID        uint64  // 8 bytes
    Name      string  // 16 bytes
    Age       uint8   //  1 byte + 7 padding
    Balance   float64 // 8 bytes
}
```

### 2. See Instant Analysis

The extension automatically shows:

```text
// offset: 0 | size: 1 | align: 1 | padding: 7 
Active    bool

// offset: 8 | size: 8 | align: 8 | padding: 0
ID        uint64

// Total: 48 bytes | Padding: 14 bytes (29% waste)
```

### 3. Optimize with One Click

Click the CodeLens button above the struct:

```text
 Optimize struct - save 14 bytes (29% reduction)
```

### 4. See Optimized Result

```go
type User struct {
    ID        uint64  // 8 bytes (no padding)
    Balance   float64 // 8 bytes (no padding)
    Name      string  // 16 bytes (no padding)
    Active    bool    // 1 byte (no padding)
    Age       uint8   // 1 byte + 6 final padding
}
// Total: 40 bytes | Padding: 6 bytes (15% waste)
//  Saved 8 bytes (16.7% reduction)
```

---

## Commands

Access via Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`):

| Command | Description |
|---------|-------------|
| `Go: Show Memory Layout` | Display detailed memory breakdown for all structs |
| `Go: Optimize Struct Memory Layout` | Reorder fields in struct at cursor to minimize padding |
| `Go: Toggle Architecture` | Switch between amd64, arm64, and 386 |
| `Go: Export Memory Layout Report` | **NEW in v0.2**: Export struct analysis to JSON/Markdown/CSV |

---

## Configuration

Customize via VS Code Settings (`Ctrl+,` / `Cmd+,`):

```json
{
  // Default architecture for memory calculations
  "goMemoryVisualizer.defaultArchitecture": "amd64",
  
  // Show inline annotations above struct fields
  "goMemoryVisualizer.showInlineAnnotations": true,
  
  // Highlight fields with excessive padding
  "goMemoryVisualizer.highlightPadding": true,
  
  // Minimum padding bytes to trigger warning (default: 8)
  "goMemoryVisualizer.paddingWarningThreshold": 8,
  
  // Show warnings for cache line boundary crossings
  "goMemoryVisualizer.showCacheLineWarnings": true
}
```

### Configuration Details

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `defaultArchitecture` | string | `"amd64"` | Architecture for calculations: `amd64`, `arm64`, or `386` |
| `showInlineAnnotations` | boolean | `true` | Display memory info above each field |
| `highlightPadding` | boolean | `true` | Highlight fields with padding waste |
| `paddingWarningThreshold` | number | `8` | Min padding bytes to show warning |
| `showCacheLineWarnings` | boolean | `true` | Warn about 64-byte cache line crossings |

---

## Examples

See `examples/structs.go` for demonstrations of:

- **Well-optimized structs** (minimal padding)
- **Poorly-optimized structs** (excessive padding)
- **Common anti-patterns** to avoid
- **Best practices** for field ordering

### Real-World Savings

#### API Response (56 to 48 bytes, 14% reduction)

**Before:**
```go
type APIResponse struct {
    Success   bool      // 1 + 7 padding
    Timestamp int64     // 8
    Message   string    // 16
    Code      int32     // 4 + 4 padding
    RequestID string    // 16
}
// 56 bytes, 11 bytes wasted
```

**After:**
```go
type APIResponse struct {
    Timestamp int64     // 8
    Message   string    // 16
    RequestID string    // 16
    Code      int32     // 4
    Success   bool      // 1 + 3 final padding
}
// 48 bytes, 3 bytes wasted
```

**Impact**: 1M responses = **8 MB saved**

---

## New in v0.2.0

### Nested Struct Support

The extension now automatically calculates memory layout for structs containing other custom structs:

```go
type Point struct {
    X float64 // 8 bytes
    Y float64 // 8 bytes
}

type Rectangle struct {
    TopLeft  Point  // 16 bytes (nested struct)
    Width    uint32 // 4 bytes
    Height   uint32 // 4 bytes
}
// Total: 24 bytes
```

The parser performs two-pass analysis:

1. First pass: Register all struct definitions
2. Second pass: Calculate layouts with nested struct sizes resolved

### Embedded Field Handling

Embedded fields (promoted fields) are now properly detected and analyzed:

```go
type Base struct {
    ID        uint64 // 8 bytes
    CreatedAt int64  // 8 bytes
}

type User struct {
    Base           // embedded: 16 bytes
    Name   string  // 16 bytes
    Active bool    // 1 byte + 7 padding
}
// Total: 40 bytes
```

Embedded pointers are also supported:

```go
type Document struct {
    *Metadata         // embedded pointer: 8 bytes
    Title     string  // 16 bytes
    Published bool    // 1 byte
}
```

### Export Memory Layout Reports

New command to export detailed struct analysis:

**JSON Format**: Machine-readable with full field details

```json
{
  "structs": [{
    "name": "User",
    "totalSize": 40,
    "alignment": 8,
    "totalPadding": 7,
    "paddingPercentage": 17.5,
    "fields": [...]
  }],
  "architecture": "amd64",
  "exportedAt": "2025-11-23T12:00:00.000Z"
}
```

**Markdown Format**: Human-readable documentation

```markdown
## User

- **Total Size:** 40 bytes
- **Alignment:** 8 bytes
- **Total Padding:** 7 bytes (17.5%)

### Fields

| Field | Type | Offset | Size | Alignment | Padding After |
|-------|------|--------|------|-----------|---------------|
| ID    | uint64 | 0    | 8    | 8         | 0             |
```

**CSV Format**: Perfect for spreadsheets and data analysis

```csv
Struct,Field,Type,Offset,Size,Alignment,Padding After,Total Size,Total Padding,Padding Percentage,Architecture
User,ID,uint64,0,8,8,0,40,7,17.5,amd64
```

**Usage:**

1. Open a Go file with struct definitions
2. Run command: `Go: Export Memory Layout Report`
3. Choose format: JSON, Markdown, or CSV
4. Save to desired location

Perfect for:

- Code reviews and documentation
- Performance audits
- Cross-architecture analysis
- Team collaboration

---

## How It Works

### Memory Layout Calculation

The extension follows Go's alignment rules:

1. **Type Alignment**: Each type has an alignment requirement:
   - `bool`, `int8`, `uint8`: 1 byte
   - `int16`, `uint16`: 2 bytes
   - `int32`, `uint32`, `float32`: 4 bytes
   - `int64`, `uint64`, `float64`: 8 bytes
   - Pointers, strings, slices: 8 bytes (amd64/arm64), 4 bytes (386)

2. **Field Placement**: Each field starts at an offset aligned to its requirement

3. **Padding Insertion**: Go adds padding bytes to satisfy alignment

4. **Final Padding**: Struct size is rounded up to largest field alignment

### Optimization Algorithm

```
1. Extract all fields from struct
2. Calculate current layout and total size
3. Sort fields:
   - Primary: by alignment (descending)
   - Secondary: by size (descending)
4. Recalculate layout with new ordering
5. Compare sizes and show savings
```

---

## Testing

Run the comprehensive test suite:

```bash
npm test
```

**Test Coverage:**
- 33 unit tests across 3 modules
- Memory calculator (18 tests)
- Go parser (8 tests)
- Struct optimizer (7 tests)
- All architectures tested

---

## Documentation

- **[DEMO.md](DEMO.md)**: Interactive demonstrations and visual examples
- **[DEVELOPMENT.md](DEVELOPMENT.md)**: Developer guide and architecture
- **[CHANGELOG.md](CHANGELOG.md)**: Version history and release notes

---

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/1rhino2/go-memory-visualizer.git
cd go-memory-visualizer
npm install
npm run compile
npm test
```

---

## Requirements

- **VS Code**: 1.85.0 or higher
- **Go files**: `.go` extension in workspace
- **Node.js**: 20.x or higher (for development)

---

## Known Issues

None for v0.2.0! Previous limitations resolved:

- ~~Nested struct support~~ ✅ Added in v0.2.0
- ~~Embedded struct handling~~ ✅ Added in v0.2.0
- Union type support (planned for v0.3.0)

See [GitHub Issues](https://github.com/1rhino2/go-memory-visualizer/issues) for full list.

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Inspired by Go's memory layout documentation
- Built with VS Code Extension API
- Thanks to the Go community for feedback

---

## Support

- **Issues**: [GitHub Issues](https://github.com/1rhino2/go-memory-visualizer/issues)
- **Discussions**: [GitHub Discussions](https://github.com/1rhino2/go-memory-visualizer/discussions)
- **Contact**: 1rhino2 on discord

---

## Roadmap

### v0.2.0 - Released 2025-11-23

- [x] Nested struct support
- [x] Embedded field handling
- [x] Export layout reports

### v0.3.0 (Planned)

- [ ] Union type support
- [ ] Bitfield visualization
- [ ] Memory alignment profiler

### v1.0.0 (Future)

- [ ] Integration with Go compiler
- [ ] Benchmark comparison tools
- [ ] Team collaboration features

---

<p align="center">
  <strong>Made for the Go community</strong>
</p>

<p align="center">
  <a href="https://1rhino2.github.io/go-memory-visualizer">Website</a> •
  <a href="https://github.com/1rhino2/go-memory-visualizer">GitHub</a> •
  <a href="https://marketplace.visualstudio.com/items?itemName=RhinoSoftware.go-memory-visualizer">Marketplace</a> •
  <a href="DEVELOPMENT.md">Docs</a>
</p>
