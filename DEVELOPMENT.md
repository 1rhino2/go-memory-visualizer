# Development Guide

## Setup

1. Install dependencies:
```bash
npm install
```

2. Compile TypeScript:
```bash
npm run compile
```

3. Run tests:
```bash
node out/test/memoryCalculator.test.js
node out/test/goParser.test.js
node out/test/optimizer.test.js
```

## Running the Extension

### Option 1: Debug in VS Code
1. Open this folder in VS Code
2. Press F5 to launch Extension Development Host
3. Open a Go file (try `examples/structs.go`, `examples/nested-structs.go`, or `examples/embedded-fields.go`)
4. See inline memory annotations above struct fields
5. Hover over fields for detailed info
6. Click CodeLens "Optimize Layout" button above structs
7. Use `Go: Export Memory Layout Report` to export struct analysis

### Option 2: Package and Install
```bash
npm install -g @vscode/vsce
vsce package
code --install-extension go-memory-visualizer-0.1.0.vsix
```

## Features to Test

### 1. Inline Annotations
- Open `examples/structs.go`
- You should see annotations like `[0-7] 8B` above each field
- Fields with padding show `+7B padding [!]`

### 2. Hover Information
- Hover over any struct field
- See detailed breakdown:
  - Type, offset, size, alignment
  - Padding warnings

### 3. CodeLens Optimization
- Look for `Optimize Layout (save XB)` above poorly ordered structs
- Click to automatically reorder fields
- See confirmation message with bytes saved

### 4. Commands
- `Ctrl+Shift+P` → "Go: Show Memory Layout"
  - Opens side panel with full memory breakdown table
- `Ctrl+Shift+P` → "Go: Toggle Architecture"
  - Switch between amd64, arm64, 386
  - Recalculates layouts for selected architecture
- `Ctrl+Shift+P` → "Go: Optimize Struct Memory Layout"
  - Optimizes struct under cursor
- `Ctrl+Shift+P` → "Go: Export Memory Layout Report"
  - **NEW in v0.2**: Export to JSON/Markdown/CSV

### 5. Architecture Support
- Test with different architectures
- Note how pointer/int sizes change between 386 (32-bit) and amd64/arm64 (64-bit)

## Configuration

Settings in `.vscode/settings.json`:
```json
{
  "goMemoryVisualizer.defaultArchitecture": "amd64",
  "goMemoryVisualizer.showInlineAnnotations": true,
  "goMemoryVisualizer.highlightPadding": true,
  "goMemoryVisualizer.paddingWarningThreshold": 8,
  "goMemoryVisualizer.showCacheLineWarnings": true
}
```

## Architecture

```
src/
├── types.ts              - TypeScript interfaces
├── memoryCalculator.ts   - Core memory layout logic
├── goParser.ts           - Go AST parsing
├── optimizer.ts          - Struct field reordering
├── extension.ts          - VS Code integration
└── test/
    ├── memoryCalculator.test.ts
    ├── goParser.test.ts
    └── optimizer.test.ts
```

## Memory Layout Rules

### Go Type Sizes (amd64)
- `bool`, `int8`, `uint8`, `byte`: 1 byte
- `int16`, `uint16`: 2 bytes
- `int32`, `uint32`, `float32`, `rune`: 4 bytes
- `int64`, `uint64`, `float64`: 8 bytes
- `int`, `uint`, `uintptr`, `*T`: 8 bytes (pointer size)
- `string`: 16 bytes (pointer + length)
- `[]T`: 8 bytes (slice header pointer)
- `interface{}`: 16 bytes (type + data pointers)

### Alignment Rules
- Fields are aligned to their natural alignment
- Structs are aligned to their largest field alignment
- Padding is added to maintain alignment

### Optimization Strategy
1. Sort fields by alignment (descending)
2. Within same alignment, sort by size (descending)
3. This minimizes padding between fields

## Troubleshooting

### No decorations showing
- Check `goMemoryVisualizer.showInlineAnnotations` is `true`
- Verify file language is `Go`
- Try reloading VS Code window

### Wrong sizes displayed
- Check selected architecture matches your target
- Use `Go: Toggle Architecture` command

### Tests failing
- Run `npm run compile` first
- Check Node.js version (requires 20.x)

## Publishing

1. Update version in `package.json`
2. Update `README.md` and `CHANGELOG.md`
3. Run tests: `npm test`
4. Package: `vsce package`
5. Publish: `vsce publish`

## v0.2.0 Features

### Nested Struct Support

The memory calculator now handles nested custom structs:

- Struct registry stores all struct definitions
- Two-pass parsing: register definitions, then calculate layouts
- Recursive size resolution for nested structs

### Embedded Field Handling

Parser detects embedded fields (no explicit name):

- Matches patterns like `TypeName` or `*TypeName`
- Handles promoted fields correctly
- Works with embedded interfaces

### Export Functionality

New command exports memory layouts in multiple formats:

- JSON: Machine-readable with full details
- Markdown: Human-readable documentation
- CSV: Spreadsheet-compatible data

## Future Enhancements

- [ ] Cache line boundary visualization
- [ ] Union type support
- [ ] Comparison view (before/after optimization)
- [ ] Integration with Go's `unsafe.Sizeof`
- [ ] Benchmark impact visualization
