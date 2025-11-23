# Go Memory Layout Visualizer

A VS Code extension for real-time visualization and optimization of Go struct memory layout. This GitHub repository provides a powerful golang tool for analyzing struct padding, alignment, and cache performance in your Go code.

[![Go](https://img.shields.io/badge/Go-00ADD8?logo=go&logoColor=white)](https://go.dev)
[![VS Code](https://img.shields.io/badge/VS_Code-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

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
git clone https://github.com/yourusername/go-memory-visualizer.git
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

- Nested struct support (planned for v0.2.0)
- Embedded struct handling (planned for v0.2.0)
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

### v0.2.0 (Planned)
- [ ] Nested struct support
- [ ] Embedded field handling
- [ ] Export layout reports

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
  <a href="https://github.com/1rhino2/go-memory-visualizer">GitHub</a> •
  <a href="https://marketplace.visualstudio.com/items?itemName=RhinoSoftware.go-memory-visualizer">Marketplace</a> •
  <a href="DEVELOPMENT.md">Docs</a>
</p>
