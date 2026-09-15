# Go Memory Layout Visualizer

<p align="center">
  <img src="docs/demo.gif" alt="Sparse struct memory map, CodeLens optimize, pack score after reorder" width="880" />
</p>

<p align="center">
  <b>See the padding Go inserts. Reorder in one click.</b><br/>
  Inline annotations, byte map, pack score, cache lines, amd64 / arm64 / 386
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=RhinoSoftware.go-memory-visualizer"><img src="https://img.shields.io/visual-studio-marketplace/i/RhinoSoftware.go-memory-visualizer?label=VS%20Marketplace&logo=visualstudiocode" alt="VS Marketplace" /></a>
  <a href="https://open-vsx.org/extension/RhinoSoftware/go-memory-visualizer"><img src="https://img.shields.io/open-vsx/dt/RhinoSoftware/go-memory-visualizer?label=Open%20VSX&logo=vscodium" alt="Open VSX" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT" /></a>
</p>

VS Code extension that shows how a Go struct sits in memory: the byte offset of
each field, the padding the compiler adds between them, and how much of the
struct is wasted space. When a reorder would shrink it, one click rewrites the
field order for you (comments and tags kept).

## 30 seconds to it

```go
type Sparse struct {
    Active bool    // 1B + 7B padding
    ID     uint64
    Tag    uint8   // 1B + 7B padding
    Name   string
}
// 40B, pack 65%, 14B wasted
```

Open the file, annotations appear, click **Optimize Layout**:

```text
Sparse  40B  pack 65%  pad 14B
0000  A.......BBBBBBBB
0010  C.......DDDDDDDD
0020  DDDDDDDD
legend: A=Active  B=ID  C=Tag  D=Name  .=padding
```

After reorder: **32B, pack 85%, saved 8 bytes**. Same fields, less air.

## Why people install it

- Spot padding without running `unsafe.Sizeof` or reading the Go ABI by hand
- Cut struct size on hot types (API responses, events, DB models)
- Paste the ASCII map into a PR so reviewers see the waste
- Learn how alignment actually works

## Install

In VS Code, `Ctrl+P` then:

```text
ext install RhinoSoftware.go-memory-visualizer
```

Or from the [Marketplace](https://marketplace.visualstudio.com/items?itemName=RhinoSoftware.go-memory-visualizer) or [Open VSX](https://open-vsx.org/extension/RhinoSoftware/go-memory-visualizer).

From source:

```bash
git clone https://github.com/1rhino2/go-memory-visualizer.git
cd go-memory-visualizer
npm install
npm run compile
# open in VS Code, press F5 for the Extension Development Host
```

## Commands

Command Palette (`Ctrl+Shift+P`):

| Command | What it does |
|---------|--------------|
| `Go: Show Memory Layout` | Memory breakdown for every struct in the file |
| `Go: Show Visual Memory Map` | Byte grid + ASCII map for the struct at the cursor |
| `Go: Optimize Struct Memory Layout` | Reorder fields to cut padding |
| `Go: Toggle Architecture` | Switch amd64 / arm64 / 386 |
| `Go: Export Memory Layout Report` | Export to JSON, Markdown, or CSV |
| `Go: Analyze Workspace Memory Layout` | Scan the workspace for padding and cache-line issues |
| `Go: Compare Struct Layout Across Architectures` | Side-by-side amd64 / arm64 / 386 |

Optimize is also a Quick Fix (`Ctrl+.`) on any reorderable struct, and the
status bar shows the bytes you could save in the current file.

## Config

Settings live under `goMemoryVisualizer.*` (default architecture, padding warning
threshold, cache-line warnings, confirm-before-optimize, and more). Open VS Code
Settings and search "Go Memory" to see them all.

## Requirements

- VS Code 1.85.0 or higher
- Node.js 20+ to build from source

## Development

```bash
npm install
npm run compile
npm test
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the internals and [CHANGELOG.md](CHANGELOG.md)
for version history.

## License

MIT, see [LICENSE](LICENSE).
